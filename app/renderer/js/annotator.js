// Annotation workspace — mounted directly inside the page, not a separate
// page that has to be "opened". Annotation is part of the dataset flow
// (Step 1), so it belongs on the same tab as Split and Augmentation.
//
// Wrapped in a single module because it piggybacks on a page that already
// has dozens of its own global names: every ID and class gets the "an-"
// prefix, and not a single name leaks into the global scope except Annotator.
//
// Usage:
//   Annotator.mount(element, { project, model });
//   Annotator.isDirty();   // are there unsaved changes?
//   Annotator.unmount();
(function () {
    const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];
    const CIRCLE_PTS = 24;   // circles are stored as polygons; 24 points is already smooth

    let host = null, projectName = '', modelName = '';
    let classes = [], aiType = 'AI Detection';
    let images = [], idx = -1;
    let shapes = [], activeCls = 0, selected = -1;
    let tool = 'rect';
    let polyPts = [], drag = null, vertexDrag = null, dirty = false;
    let canvas = null, ctx = null, imgEl = null;

    const $ = (id) => document.getElementById('an-' + id);
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // Only reacts when the workspace is actually visible. Without this,
    // pressing "R" or Delete in the Train tab would also change the annotation tool.
    const terlihat = () => !!host && host.offsetParent !== null;

    // Classification annotates something different: not "what object is
    // where", but "what is this image, overall". There's nothing to draw,
    // so the drawing tools are hidden and all that's left is picking a class.
    //
    // The class is still stored as a normal YOLO label file - one line, a
    // box spanning the whole image. That way split, augmentation, deleting
    // images, and computing statistics keep working as-is, with no second
    // storage format that has to be kept in sync.
    const modeKelas = () => aiType === 'AI Classification';

    const MARKUP = `
        <div class="an-head">
            <span class="an-title" id="an-title">Anotasi</span>
            <span class="an-catatan" id="an-catatan">Semua gambar dianotasi di sini &mdash; pembagian train/val/test di Langkah 3</span>
            <span style="flex:1"></span>
            <button class="btn small" id="an-prev">&larr; Sebelumnya</button>
            <button class="btn small" id="an-next">Berikutnya &rarr;</button>
            <button class="btn small primary" id="an-save">&#128190; Simpan (Ctrl+S)</button>
            <span class="an-saved" id="an-savedMsg"></span>
        </div>

        <div class="an-wrap">
            <div class="an-pane">
                <div class="an-pane-head">Gambar (<span id="an-imgCount">0</span>)</div>
                <div class="an-pane-body" id="an-imgList"></div>
            </div>

            <div class="an-pane">
                <div class="an-toolbar">
                    <button class="an-tool" id="an-tool-rect" title="Kotak (R)">&#9645; Kotak</button>
                    <button class="an-tool" id="an-tool-poly" title="Poligon (P) — ikuti tepi benda">&#11039; Poligon</button>
                    <button class="an-tool" id="an-tool-circle" title="Lingkaran (C) — untuk lubang bulat">&#9711; Lingkaran</button>
                    <button class="an-tool" id="an-tool-edit" title="Ubah titik (E)">&#10021; Ubah titik</button>
                    <span style="flex:1"></span>
                    <button class="an-tool" id="an-undo">&#8630; Undo</button>
                    <button class="an-tool" id="an-clear">Kosongkan</button>
                </div>
                <div class="an-stage" id="an-stage">
                    <img id="an-img" alt="">
                    <canvas id="an-canvas"></canvas>
                </div>
            </div>

            <div class="an-pane">
                <div class="an-pane-head">Kelas</div>
                <div class="an-pane-body" style="flex:none; max-height:150px"><div id="an-classList"></div></div>
                <div class="an-pane-head">Objek (<span id="an-shapeCount">0</span>)</div>
                <div class="an-pane-body" id="an-shapeList"></div>
                <div class="an-pane-body" style="flex:none; border-top:1px solid var(--border)">
                    <p class="an-hint" id="an-help"></p>
                </div>
            </div>
        </div>`;

    // ---------- mounting ----------
    async function mount(el, opts) {
        if (host) unmount();
        host = el;
        projectName = opts.project || '';
        modelName = opts.model || '';
        host.innerHTML = MARKUP;

        canvas = $('canvas');
        ctx = canvas.getContext('2d');
        imgEl = $('img');

        $('prev').onclick = prevImg;
        $('next').onclick = nextImg;
        $('save').onclick = save;
        $('undo').onclick = undoShape;
        $('clear').onclick = clearShapes;
        for (const t of ['rect', 'poly', 'circle', 'edit']) $('tool-' + t).onclick = () => setTool(t);

        canvas.addEventListener('mousedown', onDown);
        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mouseup', onUp);
        canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); closePoly(); });
        window.addEventListener('resize', onResize);
        document.addEventListener('keydown', onKey);

        const p = await window.api.loadProject(projectName);
        const m = (p.models || []).find((x) => x.name === modelName);
        if (!m) { host.innerHTML = '<p class="muted" style="padding:12px">Model tidak ditemukan.</p>'; return; }
        classes = m.classes || [];
        aiType = m.type || m.aiType || 'AI Detection';
        $('title').textContent = `${modelName} · ${aiType}`;

        if (modeKelas()) {
            host.classList.add('an-mode-kelas');
            $('catatan').innerHTML = 'Pilih satu kelas untuk tiap gambar &mdash; tekan <strong>1-9</strong>, '
                + 'tersimpan sendiri lalu lompat ke gambar berikutnya';
            $('help').innerHTML = 'Model klasifikasi menilai <strong>seluruh gambar</strong>, '
                + 'jadi tidak ada yang perlu digambar.<br>Tekan <strong>1-9</strong> atau klik kelas di atas '
                + '&mdash; tersimpan otomatis lalu maju ke gambar berikutnya.<br>'
                + '<strong>&larr; &rarr;</strong> pindah gambar tanpa mengubah apa pun.';
        } else {
            // All tools are available for every model type. Polygon/circle
            // are useful for more than just segmentation: a shape that
            // follows the object's edge makes GD&T measurement far more accurate than a box.
            setTool(aiType === 'AI Segmentation' ? 'poly' : 'rect');
        }
        renderClasses();
        await muatSemua();
    }

    function unmount() {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('keydown', onKey);
        if (host) { host.classList.remove('an-mode-kelas'); host.innerHTML = ''; }
        host = null; canvas = null; ctx = null; imgEl = null;
        images = []; shapes = []; polyPts = []; idx = -1; selected = -1; dirty = false;
    }

    // ---------- tools & classes ----------
    function setTool(t) {
        tool = t;
        polyPts = [];
        for (const id of ['rect', 'poly', 'circle', 'edit']) $('tool-' + id).classList.toggle('active', id === t);
        canvas.style.cursor = t === 'edit' ? 'default' : 'crosshair';
        $('help').innerHTML = ({
            rect: 'Drag untuk menggambar <strong>kotak</strong>.',
            poly: 'Klik menaruh titik mengikuti tepi benda. <strong>Klik kanan</strong> / <strong>Enter</strong> untuk menutup. Makin rapat titiknya, makin akurat ukurannya.',
            circle: 'Drag dari <strong>tengah lubang</strong> ke tepi. Tahan <strong>Ctrl</strong> untuk lingkaran sempurna; tanpa Ctrl bentuknya elips mengikuti drag.',
            edit: 'Klik objek untuk memilih, lalu <strong>geser titik-titiknya</strong> agar pas ke tepi benda.',
        })[t] + '<br>Tombol <strong>1-9</strong> pilih kelas · <strong>R/P/C/E</strong> ganti alat · '
              + '<strong>Esc</strong> batal / keluar mode · <strong>Del</strong> hapus terpilih.';
        redraw();
    }

    function renderClasses() {
        const el = $('classList');
        // In drawing mode, the highlight marks the class for the NEXT object.
        // In class mode, it marks the class of the currently open image - and
        // an image that hasn't been given a class deliberately highlights
        // nothing, so it's clear which ones haven't been done yet.
        const terpilih = modeKelas() ? (shapes.length ? shapes[0].cls : -1) : activeCls;
        el.innerHTML = classes.map((c, i) => `
            <button class="an-cls ${i === terpilih ? 'active' : ''}" data-i="${i}">
                <span class="an-swatch" style="background:${COLORS[i % COLORS.length]}"></span>${esc(c)} <span style="color:var(--muted)">(${i + 1})</span>
            </button>`).join('') || '<p class="an-hint">Model ini belum punya kelas.</p>';
        el.querySelectorAll('.an-cls').forEach((b) => { b.onclick = () => setClass(+b.dataset.i); });
    }

    function setClass(i) {
        activeCls = i;
        if (modeKelas()) {
            if (idx < 0) return;
            // One class per image: the old one is replaced, not added to.
            shapes = [{ cls: i, cx: 0.5, cy: 0.5, w: 1, h: 1 }];
            dirty = true;
            renderClasses(); redraw();
            // Saved immediately. Classifying hundreds of images is repetitive
            // work; requiring Ctrl+S on every image would just add one more
            // keystroke that decides nothing.
            save().then(() => { if (idx < images.length - 1) selectImg(idx + 1); });
            return;
        }
        if (selected >= 0 && shapes[selected]) { shapes[selected].cls = i; dirty = true; }
        renderClasses(); redraw();
    }

    // ---------- image list ----------
    // Annotation doesn't know about train/val/test. That division is Step
    // 3's job, and splitDataset actually moves val/test back into train
    // first before re-splitting - so before splitting, everything really is
    // in one place. Even after splitting, images can still be fixed up here, because
    // all three folders are read as a single list. Each image remembers its
    // own source folder, so its label gets saved back to the right place.
    async function muatSemua() {
        const kumpulan = [];
        for (const s2 of ['train', 'val', 'test']) {
            const daftar = await window.api.annotList(projectName, modelName, s2);
            for (const im of daftar) kumpulan.push(Object.assign({ split: s2 }, im));
        }
        images = kumpulan;
        $('imgCount').textContent = images.length;
        renderImgList();
        if (images.length) selectImg(0);
        else { imgEl.src = ''; shapes = []; redraw(); }
    }

    function renderImgList() {
        const el = $('imgList');
        // The folder tag only appears if the dataset has actually been
        // split: before Step 3 everything is in train, and showing it would just be noise.
        const sudahDibagi = images.some((im) => im.split !== 'train');
        el.innerHTML = images.map((im, i) => `
            <div class="an-item ${i === idx ? 'active' : ''}" data-i="${i}" title="${esc(im.name)}">
                <span class="an-nm">${esc(im.name)}</span>
                ${sudahDibagi && im.split !== 'train' ? `<span class="an-split">${esc(im.split)}</span>` : ''}
                ${modeKelas() && im.boxes && im.boxes.length
                    ? `<span class="an-split">${esc(classes[im.boxes[0].cls] || im.boxes[0].cls)}</span>` : ''}
                <span class="an-dot ${(im.boxes && im.boxes.length) ? 'on' : 'off'}"></span>
            </div>`).join('') || '<p class="an-hint">Belum ada gambar. Upload dulu di tab Dataset.</p>';
        el.querySelectorAll('.an-item').forEach((d) => { d.onclick = () => selectImg(+d.dataset.i); });
    }

    async function selectImg(i) {
        if (dirty && !await tanya('Anotasi pada gambar ini belum disimpan.',
            { judul: 'Perubahan belum disimpan', ya: 'Lanjut tanpa menyimpan' })) return;
        idx = i; dirty = false; polyPts = []; selected = -1;
        const im = images[i];
        const r = await window.api.annotImage(projectName, modelName, im.split, im.name);
        if (!r.ok) { pesan(r.error, 'err'); return; }

        shapes = (im.boxes || []).map((b) => b.poly
            ? { cls: b.cls, poly: b.poly.slice() }
            : { cls: b.cls, cx: b.cx, cy: b.cy, w: b.w, h: b.h });

        imgEl.onload = () => { fitCanvas(); redraw(); };
        imgEl.src = r.dataUrl;
        renderImgList();
        // The class list is redrawn too: in classification mode, its
        // highlight marks THIS IMAGE's class, so if it weren't refreshed,
        // the previous image's class would look like it was already picked for the new one.
        renderClasses();
    }

    function fitCanvas() {
        const r = imgEl.getBoundingClientRect();
        const st = $('stage').getBoundingClientRect();
        canvas.width = r.width; canvas.height = r.height;
        canvas.style.left = (r.left - st.left) + 'px';
        canvas.style.top = (r.top - st.top) + 'px';
    }

    function onResize() { if (terlihat() && imgEl && imgEl.src) { fitCanvas(); redraw(); } }

    // ---------- redraw ----------
    // Circle/ellipse radius in canvas PIXELS.
    //
    // Coordinates are stored normalized 0-1 against width and height
    // separately. If the same radius were used for x and y, the shape would
    // be round in normalized space but squashed when drawn on a non-square
    // image. So the radius is computed in pixel space first, then normalized back.
    //
    // Without Ctrl: the ellipse freely follows the start-end points.
    // With Ctrl: locked to a perfect circle (uses the longer side).
    function circleRadiusPx(d) {
        const dxPx = Math.abs(d.x1 - d.x0) * canvas.width;
        const dyPx = Math.abs(d.y1 - d.y0) * canvas.height;
        if (d.ctrl) { const r = Math.max(dxPx, dyPx); return { rx: r, ry: r }; }
        return { rx: dxPx, ry: dyPx };
    }

    function shapePoints(s) {
        if (s.poly) { const p = []; for (let i = 0; i < s.poly.length; i += 2) p.push([s.poly[i], s.poly[i + 1]]); return p; }
        const x1 = s.cx - s.w / 2, y1 = s.cy - s.h / 2, x2 = s.cx + s.w / 2, y2 = s.cy + s.h / 2;
        return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    }

    function redraw() {
        if (!ctx) return;
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        if (modeKelas()) {
            // Drawing a box spanning the whole image explains nothing - it
            // just reframes the image's own edge. What's useful is the class name.
            if (shapes.length) {
                const col = COLORS[shapes[0].cls % COLORS.length];
                const teks = classes[shapes[0].cls] || String(shapes[0].cls);
                ctx.font = '600 15px sans-serif';
                ctx.fillStyle = col;
                ctx.fillRect(8, 8, ctx.measureText(teks).width + 24, 26);
                ctx.fillStyle = '#fff';
                ctx.fillText(teks, 20, 26);
                ctx.strokeStyle = col; ctx.lineWidth = 3;
                ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
            }
            $('shapeCount').textContent = shapes.length ? 1 : 0;
            const daftar = $('shapeList');
            daftar.innerHTML = shapes.length
                ? `<div class="an-row sel"><span><span class="an-swatch" style="background:${COLORS[shapes[0].cls % COLORS.length]}"></span>${esc(classes[shapes[0].cls] || shapes[0].cls)}</span></div>`
                : '<p class="an-hint">Gambar ini belum diberi kelas.</p>';
            return;
        }

        shapes.forEach((s, i) => {
            const col = COLORS[s.cls % COLORS.length];
            const pts = shapePoints(s);
            ctx.strokeStyle = col; ctx.lineWidth = i === selected ? 3 : 2; ctx.fillStyle = col + (i === selected ? '38' : '22');
            ctx.beginPath();
            pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p[0] * W, p[1] * H) : ctx.lineTo(p[0] * W, p[1] * H)));
            ctx.closePath(); ctx.fill(); ctx.stroke();

            // Points are only shown in edit mode, so they don't clutter the image.
            if (tool === 'edit' && i === selected) {
                ctx.fillStyle = '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 2;
                pts.forEach((p) => { ctx.beginPath(); ctx.arc(p[0] * W, p[1] * H, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
            }
            ctx.fillStyle = col; ctx.font = '11px sans-serif';
            ctx.fillText(classes[s.cls] || s.cls, pts[0][0] * W + 3, pts[0][1] * H - 4);
        });

        if (polyPts.length) {
            ctx.strokeStyle = COLORS[activeCls % COLORS.length]; ctx.lineWidth = 2;
            ctx.beginPath();
            polyPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0] * W, p[1] * H) : ctx.lineTo(p[0] * W, p[1] * H)));
            ctx.stroke();
            ctx.fillStyle = '#fff';
            polyPts.forEach((p) => { ctx.beginPath(); ctx.arc(p[0] * W, p[1] * H, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
        }

        if (drag) {
            ctx.strokeStyle = COLORS[activeCls % COLORS.length]; ctx.setLineDash([4, 3]); ctx.lineWidth = 2;
            if (tool === 'circle') {
                const { rx, ry } = circleRadiusPx(drag);
                ctx.beginPath();
                ctx.ellipse(drag.x0 * W, drag.y0 * H, rx, ry, 0, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                ctx.strokeRect(drag.x0 * W, drag.y0 * H, (drag.x1 - drag.x0) * W, (drag.y1 - drag.y0) * H);
            }
            ctx.setLineDash([]);
        }

        $('shapeCount').textContent = shapes.length;
        const list = $('shapeList');
        list.innerHTML = shapes.map((s, i) => `
            <div class="an-row ${i === selected ? 'sel' : ''}" data-i="${i}">
                <span><span class="an-swatch" style="background:${COLORS[s.cls % COLORS.length]}"></span>${esc(classes[s.cls] || s.cls)}
                    <span style="color:var(--muted)">${s.poly ? (s.poly.length / 2) + ' titik' : 'kotak'}</span></span>
                <button data-del="${i}" title="Hapus">&#10005;</button>
            </div>`).join('') || '<p class="an-hint">Belum ada objek.</p>';
        list.querySelectorAll('.an-row').forEach((d) => { d.onclick = () => pickShape(+d.dataset.i); });
        list.querySelectorAll('[data-del]').forEach((b) => {
            b.onclick = (e) => { e.stopPropagation(); delShape(+b.dataset.del); };
        });
    }

    function pickShape(i) { selected = i; if (shapes[i]) activeCls = shapes[i].cls; renderClasses(); redraw(); }

    // ---------- interaction ----------
    function relPos(e) {
        const r = canvas.getBoundingClientRect();
        return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
                Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    }

    function hitVertex(x, y) {
        if (selected < 0 || !shapes[selected]) return -1;
        const pts = shapePoints(shapes[selected]);
        const tolX = 8 / canvas.width, tolY = 8 / canvas.height;
        for (let i = 0; i < pts.length; i++) {
            if (Math.abs(pts[i][0] - x) < tolX && Math.abs(pts[i][1] - y) < tolY) return i;
        }
        return -1;
    }

    function hitShape(x, y) {
        // Searched from the back: the last object drawn is on top.
        for (let i = shapes.length - 1; i >= 0; i--) {
            const pts = shapePoints(shapes[i]);
            let inside = false;
            for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
                const [xa, ya] = pts[a], [xb, yb] = pts[b];
                if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) inside = !inside;
            }
            if (inside) return i;
        }
        return -1;
    }

    function onDown(e) {
        if (!imgEl.src || modeKelas()) return;
        const [x, y] = relPos(e);

        if (tool === 'edit') {
            const v = hitVertex(x, y);
            if (v >= 0) { vertexDrag = v; return; }
            selected = hitShape(x, y);
            if (selected >= 0) activeCls = shapes[selected].cls;
            renderClasses(); redraw();
            return;
        }
        if (tool === 'poly') {
            if (e.button === 2) return;
            polyPts.push([x, y]); redraw(); return;
        }
        drag = { x0: x, y0: y, x1: x, y1: y, ctrl: e.ctrlKey };
    }

    function onMove(e) {
        if (modeKelas()) return;
        const [x, y] = relPos(e);
        if (vertexDrag !== null && selected >= 0) {
            const s = shapes[selected];
            if (s.poly) { s.poly[vertexDrag * 2] = x; s.poly[vertexDrag * 2 + 1] = y; }
            else {
                // The box is resized via its corner: the opposite corner becomes the anchor.
                const pts = shapePoints(s);
                const opp = pts[(vertexDrag + 2) % 4];
                s.cx = (x + opp[0]) / 2; s.cy = (y + opp[1]) / 2;
                s.w = Math.abs(x - opp[0]); s.h = Math.abs(y - opp[1]);
            }
            dirty = true; redraw(); return;
        }
        if (drag) { drag.x1 = x; drag.y1 = y; drag.ctrl = e.ctrlKey; redraw(); }
    }

    function onUp(e) {
        if (modeKelas()) return;
        if (drag) drag.ctrl = e.ctrlKey;
        if (vertexDrag !== null) { vertexDrag = null; return; }
        if (!drag) return;
        const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);

        if (tool === 'circle') {
            const { rx, ry } = circleRadiusPx(drag);
            // A minimum pixel threshold so an accidental click doesn't become an object.
            if (Math.max(rx, ry) > 3) {
                const poly = [];
                for (let i = 0; i < CIRCLE_PTS; i++) {
                    const a = (i / CIRCLE_PTS) * Math.PI * 2;
                    // The pixel radius is converted back to normalized units
                    // per axis, so the shape stays round when redrawn.
                    poly.push(Math.min(1, Math.max(0, drag.x0 + (Math.cos(a) * rx) / canvas.width)),
                              Math.min(1, Math.max(0, drag.y0 + (Math.sin(a) * ry) / canvas.height)));
                }
                shapes.push({ cls: activeCls, poly });
                selected = shapes.length - 1; dirty = true;
            }
        } else if (w > 0.005 && h > 0.005) {
            shapes.push({ cls: activeCls, cx: (drag.x0 + drag.x1) / 2, cy: (drag.y0 + drag.y1) / 2, w, h });
            selected = shapes.length - 1; dirty = true;
        }
        drag = null; redraw();
    }

    function closePoly() {
        if (polyPts.length >= 3) {
            shapes.push({ cls: activeCls, poly: polyPts.flat() });
            selected = shapes.length - 1; dirty = true;
        }
        polyPts = []; redraw();
    }

    function delShape(i) { shapes.splice(i, 1); if (selected >= i) selected--; dirty = true; redraw(); }
    function undoShape() { if (polyPts.length) polyPts.pop(); else { shapes.pop(); selected = -1; } dirty = true; redraw(); }
    async function clearShapes() {
        if (!await tanya('Semua objek pada gambar ini akan dihapus.',
            { judul: 'Kosongkan anotasi', ya: 'Kosongkan', bahaya: true })) return;
        shapes = []; polyPts = []; selected = -1; dirty = true; redraw();
    }

    async function save() {
        if (idx < 0) return;
        const im = images[idx];
        const r = await window.api.annotSave(projectName, modelName, im.split, im.name, shapes);
        if (!r.ok) { pesan('Gagal simpan: ' + r.error, 'err'); return; }
        dirty = false;
        im.boxes = shapes.map((x) => ({ ...x }));
        renderImgList();
        const el = $('savedMsg');
        el.textContent = `Tersimpan (${r.count} objek)`;
        setTimeout(() => { el.textContent = ''; }, 1800);
    }

    function prevImg() { if (idx > 0) selectImg(idx - 1); }
    function nextImg() { if (idx < images.length - 1) selectImg(idx + 1); }

    function onKey(e) {
        if (!terlihat()) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
        if (modeKelas()) {
            // R/P/C/E, Del, and Enter have no meaning if there's nothing to draw.
            if (e.key >= '1' && e.key <= '9') { const i = +e.key - 1; if (i < classes.length) setClass(i); }
            else if (e.key === 'ArrowLeft') prevImg();
            else if (e.key === 'ArrowRight') nextImg();
            return;
        }
        const k = e.key.toLowerCase();
        if (k === 'r') setTool('rect');
        else if (k === 'p') setTool('poly');
        else if (k === 'c') setTool('circle');
        else if (k === 'e') setTool('edit');
        else if (e.key >= '1' && e.key <= '9') { const i = +e.key - 1; if (i < classes.length) setClass(i); }
        else if (e.key === 'Escape') {
            // Esc = cancel, not finish. If a polygon is being drawn, its
            // points are discarded first; pressing again exits drawing mode into select mode.
            if (polyPts.length) { polyPts = []; redraw(); }
            else if (drag) { drag = null; redraw(); }
            else if (tool !== 'edit') setTool('edit');
            else { selected = -1; redraw(); }
        }
        else if (e.key === 'Enter') closePoly();
        else if (e.key === 'Delete') { if (selected >= 0) delShape(selected); else { shapes.pop(); dirty = true; redraw(); } }
        else if (e.key === 'ArrowLeft') prevImg();
        else if (e.key === 'ArrowRight') nextImg();
    }

    window.Annotator = {
        mount,
        unmount,
        isDirty: () => dirty,
        refit: () => { if (terlihat() && imgEl && imgEl.src) { fitCanvas(); redraw(); } },
    };
})();
