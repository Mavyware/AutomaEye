// Ruang kerja anotasi — dipasang langsung di dalam halaman, bukan halaman
// tersendiri yang harus "dibuka". Anotasi bagian dari alur dataset (Langkah 1),
// jadi tempatnya memang di tab yang sama dengan Split dan Augmentasi.
//
// Dibungkus dalam satu modul karena ia menumpang halaman yang sudah punya
// puluhan nama global sendiri: seluruh ID dan kelasnya diberi awalan "an-",
// dan tidak ada satu pun nama yang bocor ke lingkup global selain Annotator.
//
// Cara pakai:
//   Annotator.mount(elemen, { project, model });
//   Annotator.isDirty();   // ada perubahan yang belum disimpan?
//   Annotator.unmount();
(function () {
    const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];
    const CIRCLE_PTS = 24;   // lingkaran disimpan sebagai poligon; 24 titik sudah halus

    let host = null, projectName = '', modelName = '';
    let classes = [], aiType = 'AI Detection';
    let images = [], idx = -1, split = 'train';
    let shapes = [], activeCls = 0, selected = -1;
    let tool = 'rect';
    let polyPts = [], drag = null, vertexDrag = null, dirty = false;
    let canvas = null, ctx = null, imgEl = null;

    const $ = (id) => document.getElementById('an-' + id);
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // Hanya bereaksi saat ruang kerjanya benar-benar terlihat. Tanpa ini,
    // menekan "R" atau Delete di tab Train ikut mengubah alat anotasi.
    const terlihat = () => !!host && host.offsetParent !== null;

    const MARKUP = `
        <div class="an-head">
            <span class="an-title" id="an-title">Anotasi</span>
            <select id="an-splitSel" style="font-size:12px">
                <option value="train">train</option><option value="val">val</option><option value="test">test</option>
            </select>
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

    // ---------- pemasangan ----------
    async function mount(el, opts) {
        if (host) unmount();
        host = el;
        projectName = opts.project || '';
        modelName = opts.model || '';
        host.innerHTML = MARKUP;

        canvas = $('canvas');
        ctx = canvas.getContext('2d');
        imgEl = $('img');

        $('splitSel').onchange = loadSplit;
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

        // Semua alat tersedia untuk semua tipe model. Poligon/lingkaran berguna
        // bukan hanya untuk segmentasi: bentuk yang mengikuti tepi benda membuat
        // pengukuran GD&T jauh lebih akurat daripada kotak.
        setTool(aiType === 'AI Segmentation' ? 'poly' : 'rect');
        renderClasses();
        await loadSplit();
    }

    function unmount() {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('keydown', onKey);
        if (host) host.innerHTML = '';
        host = null; canvas = null; ctx = null; imgEl = null;
        images = []; shapes = []; polyPts = []; idx = -1; selected = -1; dirty = false;
    }

    // ---------- alat & kelas ----------
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
        el.innerHTML = classes.map((c, i) => `
            <button class="an-cls ${i === activeCls ? 'active' : ''}" data-i="${i}">
                <span class="an-swatch" style="background:${COLORS[i % COLORS.length]}"></span>${esc(c)} <span style="color:var(--muted)">(${i + 1})</span>
            </button>`).join('') || '<p class="an-hint">Model ini belum punya kelas.</p>';
        el.querySelectorAll('.an-cls').forEach((b) => { b.onclick = () => setClass(+b.dataset.i); });
    }

    function setClass(i) {
        activeCls = i;
        if (selected >= 0 && shapes[selected]) { shapes[selected].cls = i; dirty = true; }
        renderClasses(); redraw();
    }

    // ---------- daftar gambar ----------
    async function loadSplit() {
        split = $('splitSel').value;
        images = await window.api.annotList(projectName, modelName, split);
        $('imgCount').textContent = images.length;
        renderImgList();
        if (images.length) selectImg(0);
        else { imgEl.src = ''; shapes = []; redraw(); }
    }

    function renderImgList() {
        const el = $('imgList');
        el.innerHTML = images.map((im, i) => `
            <div class="an-item ${i === idx ? 'active' : ''}" data-i="${i}" title="${esc(im.name)}">
                <span class="an-nm">${esc(im.name)}</span>
                <span class="an-dot ${(im.boxes && im.boxes.length) ? 'on' : 'off'}"></span>
            </div>`).join('') || '<p class="an-hint">Belum ada gambar. Upload dulu di tab Dataset.</p>';
        el.querySelectorAll('.an-item').forEach((d) => { d.onclick = () => selectImg(+d.dataset.i); });
    }

    async function selectImg(i) {
        if (dirty && !confirm('Perubahan belum disimpan. Lanjut tanpa menyimpan?')) return;
        idx = i; dirty = false; polyPts = []; selected = -1;
        const im = images[i];
        const r = await window.api.annotImage(projectName, modelName, split, im.name);
        if (!r.ok) { alert(r.error); return; }

        shapes = (im.boxes || []).map((b) => b.poly
            ? { cls: b.cls, poly: b.poly.slice() }
            : { cls: b.cls, cx: b.cx, cy: b.cy, w: b.w, h: b.h });

        imgEl.onload = () => { fitCanvas(); redraw(); };
        imgEl.src = r.dataUrl;
        renderImgList();
    }

    function fitCanvas() {
        const r = imgEl.getBoundingClientRect();
        const st = $('stage').getBoundingClientRect();
        canvas.width = r.width; canvas.height = r.height;
        canvas.style.left = (r.left - st.left) + 'px';
        canvas.style.top = (r.top - st.top) + 'px';
    }

    function onResize() { if (terlihat() && imgEl && imgEl.src) { fitCanvas(); redraw(); } }

    // ---------- gambar ulang ----------
    // Radius lingkaran/elips dalam PIKSEL kanvas.
    //
    // Koordinat disimpan ternormalisasi 0-1 terhadap lebar dan tinggi secara
    // terpisah. Kalau radius yang sama dipakai untuk x dan y, bentuknya bulat di
    // ruang normalisasi tapi gepeng saat digambar pada gambar yang tidak persegi.
    // Maka radius dihitung di ruang piksel dulu, baru dinormalkan kembali.
    //
    // Tanpa Ctrl: elips bebas mengikuti titik awal-akhir.
    // Dengan Ctrl: dikunci jadi lingkaran sempurna (pakai sisi terpanjang).
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

        shapes.forEach((s, i) => {
            const col = COLORS[s.cls % COLORS.length];
            const pts = shapePoints(s);
            ctx.strokeStyle = col; ctx.lineWidth = i === selected ? 3 : 2; ctx.fillStyle = col + (i === selected ? '38' : '22');
            ctx.beginPath();
            pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p[0] * W, p[1] * H) : ctx.lineTo(p[0] * W, p[1] * H)));
            ctx.closePath(); ctx.fill(); ctx.stroke();

            // Titik hanya ditampilkan saat mode ubah, supaya tidak mengaburkan gambar.
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

    // ---------- interaksi ----------
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
        // Dicari dari belakang: objek yang digambar terakhir ada di atas.
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
        if (!imgEl.src) return;
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
        const [x, y] = relPos(e);
        if (vertexDrag !== null && selected >= 0) {
            const s = shapes[selected];
            if (s.poly) { s.poly[vertexDrag * 2] = x; s.poly[vertexDrag * 2 + 1] = y; }
            else {
                // Kotak diubah lewat sudutnya: sudut seberang dijadikan jangkar.
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
        if (drag) drag.ctrl = e.ctrlKey;
        if (vertexDrag !== null) { vertexDrag = null; return; }
        if (!drag) return;
        const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);

        if (tool === 'circle') {
            const { rx, ry } = circleRadiusPx(drag);
            // Ambang minimum dalam piksel supaya klik tak sengaja tidak jadi objek.
            if (Math.max(rx, ry) > 3) {
                const poly = [];
                for (let i = 0; i < CIRCLE_PTS; i++) {
                    const a = (i / CIRCLE_PTS) * Math.PI * 2;
                    // Radius piksel dikembalikan ke satuan normalisasi per sumbu,
                    // sehingga bentuknya tetap bulat saat digambar ulang.
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
    function clearShapes() { if (confirm('Kosongkan semua objek di gambar ini?')) { shapes = []; polyPts = []; selected = -1; dirty = true; redraw(); } }

    async function save() {
        if (idx < 0) return;
        const r = await window.api.annotSave(projectName, modelName, split, images[idx].name, shapes);
        if (!r.ok) { alert('Gagal simpan: ' + r.error); return; }
        dirty = false;
        images[idx].boxes = shapes.map((s) => ({ ...s }));
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
        const k = e.key.toLowerCase();
        if (k === 'r') setTool('rect');
        else if (k === 'p') setTool('poly');
        else if (k === 'c') setTool('circle');
        else if (k === 'e') setTool('edit');
        else if (e.key >= '1' && e.key <= '9') { const i = +e.key - 1; if (i < classes.length) setClass(i); }
        else if (e.key === 'Escape') {
            // Esc = batalkan, bukan menyelesaikan. Kalau ada poligon yang sedang
            // digambar, titik-titiknya dibuang dulu; menekan lagi keluar dari
            // mode gambar ke mode pilih.
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
