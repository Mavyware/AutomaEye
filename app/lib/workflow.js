// Workflow executor — chain semua model, aggregate verdict, save output.

const path = require('path');
const fs = require('fs');
const inference = require('./inference');

// Path weights untuk model: pakai VERSI yang dipilih di step workflow bila ada,
// lalu versi aktif model, terakhir weights/best.pt (legacy).
function weightsFor(m, step) {
    const ver = step && (step.version || (step.config && step.config.version));
    if (ver) {
        const vw = path.join(m.dir, 'versions', 'v' + ver, 'best.pt');
        if (fs.existsSync(vw)) return vw;
    }
    if (m.activeVersion) {
        const aw = path.join(m.dir, 'versions', 'v' + m.activeVersion, 'best.pt');
        if (fs.existsSync(aw)) return aw;
    }
    return path.join(m.dir, 'weights', 'best.pt');
}

// ---- Evaluasi Add-ons (Rule-based Tools) ----
// Menentukan OK/NG dari hasil deteksi YOLO berdasarkan add-on yang diaktifkan
// per-model. Semua add-on harus lulus → OK; satu saja gagal → NG.
/**
 * Analisis piksel yang perlu diminta ke Python untuk add-on model ini.
 * Dikirim lewat inferOnce -> infer_server.py.
 */
function analysisFor(m) {
    const a = (m && m.addons) || [];
    const need = [];
    if (a.includes('Color Inspection')) need.push('color');
    if (a.includes('Scratches')) need.push('scratch');
    if (a.includes('1D Code') || a.includes('2D Code')) need.push('codes');
    if (a.includes('Character Recognition')) need.push('text');
    return need;
}
exports.analysisFor = analysisFor;

// Return { verdict, checks:[{addon, pass, detail}], minConf }.
function evaluateAddons(m, detections, measureFromBox, extra = {}) {
    const dets = detections || [];
    const addons = m.addons || [];
    const acfg = m.addonConfig || {};
    const checks = [];
    const has = (name) => addons.includes(name);
    const minConf = dets.length ? Math.min(...dets.map(d => d.confidence || 0)) : 0;
    let verdict = 'OK';
    let incomplete = false;   // true = jumlah fitur (n) belum terpenuhi → inspeksi menunggu

    // Presence Check — part harus ADA (minimal 1 objek terdeteksi).
    if (has('Presence Check')) {
        const pass = dets.length >= 1;
        checks.push({ addon: 'Presence Check', pass, detail: pass ? `${dets.length} objek terdeteksi` : 'Tidak ada objek — part hilang' });
        if (!pass) verdict = 'NG';
    }

    // Count — jumlah objek harus PAS sama dengan target (aturan =N).
    if (has('Count')) {
        const expected = Number.isFinite(acfg.countExpected) ? acfg.countExpected : null;
        if (expected == null) {
            checks.push({ addon: 'Count', pass: true, detail: `Target belum diatur (${dets.length} terdeteksi)` });
        } else {
            const pass = dets.length === expected;
            checks.push({ addon: 'Count', pass, detail: `${dets.length}/${expected} objek` });
            if (!pass) verdict = 'NG';
        }
    }

    // Scratches - goresan dideteksi dari tepi tipis-memanjang di dalam ROI
    // (CV klasik di infer_server.py, tanpa model AI tambahan).
    if (has('Scratches')) {
        const maxAllowed = Number.isFinite(acfg.scratchMax) ? acfg.scratchMax : 0;
        const found = dets.reduce((n, d) => n + ((d.scratch && d.scratch.count) || 0), 0);
        const pass = found <= maxAllowed;
        checks.push({ addon: 'Scratches', pass, detail: `${found} goresan terdeteksi (maks ${maxAllowed})` });
        if (!pass) verdict = 'NG';
    }

    // Color Inspection - warna rata-rata tiap objek harus dekat warna acuan.
    if (has('Color Inspection')) {
        const cc = acfg.color || {};
        const per = cc.perClass || {};
        const tol = Number.isFinite(cc.tolerance) ? cc.tolerance : 25;
        let bad = 0, checked = 0;
        for (const d of dets) {
            const ref = per[d.class_name];
            if (!ref || !d.color || !Number.isFinite(ref.h)) continue;
            checked++;
            // Hue melingkar 0-180 di OpenCV: ambil selisih lewat jalur terpendek.
            let dh = Math.abs(d.color.h - ref.h);
            if (dh > 90) dh = 180 - dh;
            const ds = Math.abs(d.color.s - (Number.isFinite(ref.s) ? ref.s : d.color.s));
            if (dh > tol || ds > tol * 2) bad++;
        }
        const pass = bad === 0;
        checks.push({
            addon: 'Color Inspection', pass,
            detail: checked ? `${checked - bad}/${checked} objek warnanya sesuai` : 'Acuan warna belum diatur',
        });
        if (!pass) verdict = 'NG';
    }

    // 1D / 2D Code - kode harus terbaca, dan bila diisi harus cocok teks harapan.
    for (const pair of [['2D Code', 'qr'], ['1D Code', 'barcode']]) {
        const addon = pair[0], key = pair[1];
        if (!has(addon)) continue;
        const codes = (extra.codes && extra.codes[key]) || [];
        const expect = (acfg.code && acfg.code.expected) || '';
        let pass = codes.length > 0;
        let detail = pass ? `Terbaca: ${codes.join(', ')}` : 'Kode tidak terbaca';
        if (pass && expect) {
            pass = codes.some((c) => c === expect);
            detail = pass ? `Cocok: ${expect}` : `Terbaca "${codes.join(', ')}" != harapan "${expect}"`;
        }
        checks.push({ addon, pass, detail });
        if (!pass) verdict = 'NG';
    }

    // Character Recognition - teks dirangkai dari deteksi karakter (kiri->kanan)
    // oleh model AI OCR, lalu dicocokkan dengan teks/pola harapan.
    if (has('Character Recognition')) {
        const text = extra.text || '';
        const oc = acfg.ocr || {};
        let pass = text.length > 0;
        let detail = pass ? `Terbaca: "${text}"` : 'Tidak ada karakter terbaca';
        if (pass && oc.expected) {
            pass = text === oc.expected;
            detail = pass ? `Cocok: "${text}"` : `"${text}" != harapan "${oc.expected}"`;
        } else if (pass && oc.pattern) {
            try {
                pass = new RegExp(oc.pattern).test(text);
                detail = `${pass ? 'Cocok' : 'Tidak cocok'} pola /${oc.pattern}/ - "${text}"`;
            } catch (e) { detail = `Pola regex tidak valid: ${oc.pattern}`; pass = false; }
        }
        checks.push({ addon: 'Character Recognition', pass, detail });
        if (!pass) verdict = 'NG';
    }

    // Positioning - part harus dekat posisi acuan (mendeteksi part geser/miring).
    if (has('Positioning')) {
        const pc = acfg.position || {};
        if (!dets.length) {
            checks.push({ addon: 'Positioning', pass: false, detail: 'Part tidak terdeteksi' });
            verdict = 'NG';
        } else if (!Number.isFinite(pc.refX) || !Number.isFinite(pc.refY)) {
            checks.push({ addon: 'Positioning', pass: true, detail: 'Posisi acuan belum diatur' });
        } else {
            const main = dets.reduce((a, d) =>
                ((d.x2 - d.x1) * (d.y2 - d.y1) > (a.x2 - a.x1) * (a.y2 - a.y1) ? d : a), dets[0]);
            const cx = (main.x1 + main.x2) / 2, cy = (main.y1 + main.y2) / 2;
            const dist = Math.hypot(cx - pc.refX, cy - pc.refY);
            const tol = Number.isFinite(pc.tolerancePx) ? pc.tolerancePx : 40;
            const pass = dist <= tol;
            checks.push({ addon: 'Positioning', pass, detail: `Geser ${dist.toFixed(0)} px (maks ${tol})` });
            if (!pass) verdict = 'NG';
        }
    }

    // Calibration - jaga mm/piksel tidak melenceng: ukur objek acuan berukuran
    // diketahui lalu bandingkan dengan nilai kalibrasi yang sedang dipakai.
    if (has('Calibration')) {
        const cal = acfg.calibration || {};
        const gg = acfg.gdt || {};
        const mmpp = gg.mmPerPixel;
        if (!Number.isFinite(mmpp) || !cal.refClass || !Number.isFinite(cal.refSizeMM)) {
            checks.push({ addon: 'Calibration', pass: true, detail: 'Objek acuan / mm-per-piksel belum diatur' });
        } else {
            const ref = dets.find((d) => d.class_name === cal.refClass);
            if (!ref) {
                checks.push({ addon: 'Calibration', pass: false, detail: `Objek acuan "${cal.refClass}" tidak terlihat` });
                verdict = 'NG';
            } else {
                const px = Math.max(ref.x2 - ref.x1, ref.y2 - ref.y1);
                const mm = px * mmpp;
                const driftPct = Math.abs(mm - cal.refSizeMM) / cal.refSizeMM * 100;
                const maxPct = Number.isFinite(cal.maxDriftPct) ? cal.maxDriftPct : 5;
                const pass = driftPct <= maxPct;
                checks.push({
                    addon: 'Calibration', pass,
                    detail: `Acuan terukur ${mm.toFixed(2)} mm vs ${cal.refSizeMM} mm - melenceng ${driftPct.toFixed(1)}% (maks ${maxPct}%)`,
                });
                if (!pass) verdict = 'NG';
            }
        }
    }

    // GD&T Measurement — ukur dimensi PER KELAS: tiap kelas punya jenis ukur,
    // nominal, dan toleransi sendiri (mirip tool terpisah di Keyence).
    // Ukuran diambil dari kontur mask (segmentation, presisi) kalau ada, else kotak.
    // mm = piksel × mmPerPixel (kalibrasi global, satu untuk semua kelas).
    if (has('GD&T Measurement')) {
        const g = acfg.gdt || {};
        const mmpp = Number(g.mmPerPixel) || 0;
        const perClass = g.perClass || null;
        // Spesifikasi per kelas → normalisasi ke { dia, long, short } (tiap opsional).
        // Dukung format lama single-config { measure, nominalMM, toleranceMM }.
        const specFor = (cls) => {
            let s = perClass && perClass[cls];
            if (!s && !perClass && Number.isFinite(Number(g.nominalMM))) s = { measure: g.measure, nominalMM: g.nominalMM, toleranceMM: g.toleranceMM };
            if (!s) return null;
            if (s.dia || s.long || s.short) return s;         // format baru
            // konversi format lama
            const spec = Number.isFinite(Number(s.nominalMM)) ? { nominalMM: s.nominalMM, toleranceMM: s.toleranceMM } : null;
            if (!spec) return null;
            return s.measure === 'width' ? { short: spec } : s.measure === 'height' ? { long: spec } : { dia: spec };
        };
        // Ukuran piksel per jenis: diameter / sisi panjang (max) / sisi pendek (min).
        const pxOf = (d, key) => {
            const w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);   // kotak (axis-aligned)
            const boxVal = key === 'widthPx' ? Math.min(w, h) : key === 'heightPx' ? Math.max(w, h) : (w + h) / 2;
            if (measureFromBox) return boxVal;                // mode "ukur dari kotak" → lebih stabil
            if (d.measure) return d.measure[key] || boxVal;   // dari kontur mask (segmentasi, presisi)
            return boxVal;
        };
        const TYPES = [
            { field: 'dia', px: 'diameterPx', sym: 'Ø' },
            { field: 'long', px: 'heightPx', sym: 'L' },   // L = sisi panjang
            { field: 'short', px: 'widthPx', sym: 'P' },   // P = sisi pendek
        ];

        if (!mmpp) {
            checks.push({ addon: 'GD&T', pass: true, detail: 'Belum dikalibrasi (mm/piksel)' });
        } else if (!dets.length) {
            checks.push({ addon: 'GD&T', pass: false, detail: 'Tidak ada objek untuk diukur' });
            verdict = 'NG';
        } else {
            const parts = [];
            let anyMeasured = false, rawMeasured = false, allPass = true;
            dets.forEach(d => {
                const cls = d.class_name;
                const pcRaw = perClass && perClass[cls];
                const shape = (pcRaw && pcRaw.shape) || 'rect';   // 'circle' = lingkaran (Ø saja)
                const spec = specFor(cls);
                const labels = [];
                if (spec) {
                    TYPES.forEach(t => {
                        const sp = spec[t.field];
                        if (!sp || !Number.isFinite(Number(sp.nominalMM))) return;
                        anyMeasured = true;
                        const nominal = Number(sp.nominalMM), tol = Number(sp.toleranceMM) || 0;
                        const val = pxOf(d, t.px) * mmpp;
                        const ok = Math.abs(val - nominal) <= tol;
                        if (!ok) { allPass = false; verdict = 'NG'; }
                        labels.push({ text: (t.sym === 'Ø' ? 'Ø' : '') + val.toFixed(2), ok, kind: t.field });
                        parts.push(`${cls} ${t.field}=${val.toFixed(2)}mm${ok ? '' : ` ✗(${nominal}±${tol})`}`);
                    });
                }
                // Tanpa nominal → tampilkan UKURAN MENTAH (netral) sesuai bentuk:
                // lingkaran = Ø diameter saja; persegi = panjang & lebar.
                if (!labels.length) {
                    if (shape === 'circle') {
                        const dia = pxOf(d, 'diameterPx') * mmpp;
                        if (dia) { labels.push({ text: 'Ø' + dia.toFixed(2), ok: null, kind: 'dia' }); rawMeasured = true; }
                    } else {
                        const Lmm = pxOf(d, 'heightPx') * mmpp;   // sisi panjang (vertikal)
                        const Pmm = pxOf(d, 'widthPx') * mmpp;    // sisi pendek (horizontal)
                        if (Lmm) { labels.push({ text: Lmm.toFixed(2), ok: null, kind: 'long' }); rawMeasured = true; }
                        if (Pmm) { labels.push({ text: Pmm.toFixed(2), ok: null, kind: 'short' }); rawMeasured = true; }
                    }
                }
                if (labels.length) d.gdt = labels;   // array → UI gambar semua di fitur
            });
            checks.push(anyMeasured
                ? { addon: 'GD&T', pass: allPass, detail: parts.join(' · ') }
                : rawMeasured
                    ? { addon: 'GD&T', pass: true, detail: 'Ukuran mentah (L×P mm) ditampilkan — isi nominal per kelas untuk pass/fail' }
                    : { addon: 'GD&T', pass: true, detail: 'Tidak ada ukuran (kontur kosong)' });

            // Jumlah (n) per kelas: HANYA informatif — tidak lagi menggagalkan/menahan inspeksi.
            // (Persyaratan n=8 kotak / n=6 lingkaran dihapus agar verdict & sinyal Arduino tidak tertahan.)
            const countMsgs = [];
            Object.keys(perClass || {}).forEach(cls => {
                const need = Number(perClass[cls] && perClass[cls].count);
                if (!Number.isFinite(need) || need <= 0) return;
                const got = dets.filter(d => d.class_name === cls).length;
                countMsgs.push(`${cls} ${got}/${need}`);
            });
            if (countMsgs.length) {
                checks.push({ addon: 'Jumlah', pass: true, detail: countMsgs.join(' · ') + ' (info)' });
            }
        }
    }

    // Tidak ada add-on aktif → default: objek terdeteksi berarti OK.
    if (checks.length === 0) {
        const pass = dets.length >= 1;
        checks.push({ addon: 'Deteksi', pass, detail: pass ? `${dets.length} objek` : 'Tidak ada objek' });
        verdict = pass ? 'OK' : 'NG';
    }

    return { verdict, checks, minConf, incomplete };
}
exports.evaluateAddons = evaluateAddons;

// Jalankan satu step sesuai KATEGORINYA. Mengisi sr (verdict, reason, dll).
// ctx = { cfg, project, base64, arduino, result }.
async function runStep(step, sr, ctx) {
    const { cfg, project, base64, arduino, result } = ctx;
    const conf = Number.isFinite(ctx.conf) ? ctx.conf : cfg.model.confidence;
    const imgsz = Number.isFinite(ctx.imgsz) ? ctx.imgsz : cfg.model.imgsz;
    const cat = step.category;
    const config = step.config || {};

    // Model dipakai oleh Inspection & Positioning.
    const needModel = (cat === 'Inspection' || cat === 'Positioning');
    let m = null;
    if (needModel) {
        m = project.models.find(x => x.name === step.modelName);
        if (!m || !m.trained) {
            sr.verdict = 'ERROR';
            sr.error = `Model ${step.modelName || '(kosong)'} belum trained / tidak ada`;
            return;
        }
    }

    // ---- CAPTURE — sumber & mutu gambar (bukan analisis) ----
    if (cat === 'Capture') {
        const bytes = Math.floor((base64 || '').length * 3 / 4);
        const kb = Math.round(bytes / 1024);
        const minKB = Number(config.minKB) || 0;   // gate opsional: tolak gambar kosong/terlalu kecil
        if (!base64) {
            sr.verdict = 'NG'; sr.reason = 'Tidak ada gambar dari sumber';
        } else if (minKB && kb < minKB) {
            sr.verdict = 'NG'; sr.reason = `Gambar ${kb}KB < minimum ${minKB}KB (kemungkinan gagal capture)`;
        } else {
            sr.verdict = 'OK'; sr.reason = `Sumber: ${config.source || 'kamera'} · gambar ${kb}KB diterima`;
        }
        return;
    }

    // ---- POSITIONING — kunci lokasi part pakai deteksi ----
    if (cat === 'Positioning') {
        const weightsPath = weightsFor(m, step);
        // Positioning (deteksi kehadiran part) pakai confidence PRESENCE yang lebih rendah,
        // supaya konsisten baik di Live maupun Capture manual.
        const pconf = Number.isFinite(ctx.presenceConf) ? ctx.presenceConf : conf;
        const r = await inference.inferOnce(cfg, weightsPath, base64, m.classes, {
            confidence: pconf, iou: cfg.model.iou, imgsz: imgsz,
        });
        const dets = r.detections || [];
        if (!dets.length) {
            sr.detections = [];
            if (config.passOnNoDetect) { sr.verdict = 'OK'; sr.reason = 'Tidak terdeteksi — dianggap OK (lanjut)'; return; }
            sr.verdict = 'NG'; sr.reason = 'Part tidak ditemukan — posisi tidak terkunci';
        } else {
            // Presence = SATU part. Ambil kotak TERBESAR saja (cegah 2 kotak untuk 1 benda).
            const main = dets.reduce((a, d) =>
                ((d.x2 - d.x1) * (d.y2 - d.y1)) > ((a.x2 - a.x1) * (a.y2 - a.y1)) ? d : a, dets[0]);
            sr.detections = [main];
            const cx = Math.round((main.x1 + main.x2) / 2), cy = Math.round((main.y1 + main.y2) / 2);
            result.anchor = { cx, cy, box: main };
            sr.confidence = main.confidence || 0;
            sr.verdict = 'OK'; sr.reason = `Part terkunci di (${cx}, ${cy})`;
        }
        return;
    }

    // ---- INSPECTION — deteksi + add-ons (Presence/Count/GD&T) ----
    if (cat === 'Inspection') {
        const weightsPath = weightsFor(m, step);
        const r = await inference.inferOnce(cfg, weightsPath, base64, m.classes, {
            confidence: conf, iou: cfg.model.iou, imgsz: imgsz,
            analyze: analysisFor(m),
        });
        sr.detections = r.detections || [];
        if (!sr.detections.length && config.passOnNoDetect) {
            sr.verdict = 'OK'; sr.reason = 'Tidak ada objek terdeteksi — dianggap OK (lanjut)';
            return;
        }
        // codes/text bersifat per-frame (bukan per-deteksi), diteruskan terpisah.
        const ev = evaluateAddons(m, sr.detections, ctx.measureFromBox, { codes: r.codes, text: r.text });
        sr.verdict = ev.verdict;
        sr.checks = ev.checks;
        sr.confidence = ev.minConf;
        sr.incomplete = ev.incomplete;   // jumlah fitur (n) belum lengkap → inspeksi menunggu
        sr.reason = ev.checks.filter(c => !c.pass).map(c => `${c.addon}: ${c.detail}`).join('; ')
            || ev.checks.map(c => `${c.addon}: ${c.detail}`).join('; ');
        return;
    }

    // ---- COMMUNICATION — kirim hasil ke luar (Arduino/PLC) ----
    if (cat === 'Communication') {
        if (ctx.noSignal) {   // mode tracking: sinyal dikirim sekali per part oleh renderer
            sr.verdict = 'OK'; sr.reason = 'Sinyal ditangani mode tracking (per part)';
            return;
        }
        const ng = result.finalVerdict === 'NG';
        const onlyOnNG = config.onlyOnNG !== false;   // default: kirim hanya saat NG
        const sig = ng ? (config.signalNG != null ? config.signalNG : cfg.arduino.ng_signal)
                       : (config.signalOK != null ? config.signalOK : cfg.arduino.ok_signal);
        if (ng || !onlyOnNG) {
            try { await arduino.send(String(sig)); sr.reason = `Kirim sinyal '${String(sig).trim()}' ke Arduino`; }
            catch (e) { sr.reason = `Gagal kirim sinyal: ${e.message}`; }
        } else {
            sr.reason = 'Hasil OK — tidak ada sinyal (onlyOnNG)';
        }
        sr.verdict = 'OK';   // komunikasi tidak menilai part
        return;
    }

    // ---- OPTIONS — flag tambahan (simpan gambar, dll) ----
    if (cat === 'Options') {
        if (config.saveOK != null) result.saveOK = !!config.saveOK;
        if (config.saveNG != null) result.saveNG = !!config.saveNG;
        sr.verdict = 'OK';
        sr.reason = `Simpan OK: ${result.saveOK ? 'ya' : 'tidak'} · Simpan NG: ${result.saveNG === false ? 'tidak' : 'ya'}`;
        return;
    }

    // Kategori tak dikenal → lewati tanpa memengaruhi verdict.
    sr.verdict = 'OK';
    sr.reason = '(kategori belum didukung)';
}

exports.execute = async (cfg, project, imageDataUrl, arduino, output, opts = {}) => {
    // Strip data URL prefix
    const base64 = imageDataUrl.replace(/^data:image\/[^;]+;base64,/, '');
    // Confidence bisa di-override dari halaman Run (Live Settings).
    const conf = (opts && Number.isFinite(Number(opts.confidence))) ? Number(opts.confidence) : cfg.model.confidence;
    const imgsz = (opts && Number.isFinite(Number(opts.imgsz))) ? Number(opts.imgsz) : cfg.model.imgsz;
    const presenceConf = (opts && Number.isFinite(Number(opts.presenceConf))) ? Number(opts.presenceConf) : conf;

    if (!project.workflow.steps || project.workflow.steps.length === 0) {
        throw new Error('Workflow kosong. Buat workflow dulu.');
    }

    const start = Date.now();
    const result = {
        timestamp: new Date().toISOString(),
        finalVerdict: 'OK',
        steps: [],
    };

    // Bersihkan buffer serial supaya balasan handshake yang ditunggu adalah milik siklus ini.
    try { if (arduino.flushRx) arduino.flushRx(); } catch (_) { }

    const stopOnFirstNG = project.workflow.onFirstNG === 'stop_and_report';
    const steps = project.workflow.steps;
    const hasCommStep = steps.some(s => s.category === 'Communication');

    // Presence gating: Presence Check jalan dulu. Kalau part TIDAK ada,
    // model deteksi cacat/pengukuran (Inspection) berikutnya DILEWATI (tak buang waktu inferensi).
    const isPresenceModel = (name) => {
        const m = project.models.find(x => x.name === name);
        return !!(m && (m.addons || []).includes('Presence Check'));
    };
    let gateEmpty = false;   // true = presence check terakhir tidak menemukan part

    for (const step of steps) {
        const label = step.modelName || step.label || step.tool || step.category;
        const sr = {
            stepIndex: step.stepIndex,
            category: step.category,
            modelName: step.modelName,
            label,
            verdict: 'OK',
            confidence: 0,
        };
        const stepStart = Date.now();

        // Inspection berat (non-presence) dilewati bila: (a) Live ringan, atau
        // (b) presence sebelumnya kosong. Keduanya → anggap OK, hemat inferensi.
        const heavyInspection = step.category === 'Inspection' && !isPresenceModel(step.modelName);
        if (heavyInspection && (opts.light || gateEmpty)) {
            sr.verdict = 'OK';
            sr.skipped = true;
            sr.reason = opts.light
                ? 'Live ringan — pengukuran dilewati (tekan Capture & Inspect untuk ukur)'
                : 'Dilewati — Presence Check kosong (tidak ada part untuk diperiksa)';
            sr.stepMS = 0;
            result.steps.push(sr);
            continue;
        }

        try {
            await runStep(step, sr, { cfg, project, base64, arduino, result, conf, imgsz, presenceConf, measureFromBox: opts.measureFromBox, noSignal: opts.noSignal });
        } catch (e) {
            sr.verdict = 'ERROR';
            sr.error = e.message;
        }
        sr.stepMS = Date.now() - stepStart;

        // Update gate: model presence yang tidak menemukan objek → lewati inspeksi berikutnya.
        if (step.category === 'Inspection' && isPresenceModel(step.modelName)) {
            gateEmpty = !sr.detections || !sr.detections.length;
        }

        result.steps.push(sr);
        if (sr.verdict === 'NG' || sr.verdict === 'ERROR') {
            result.finalVerdict = 'NG';
            if (stopOnFirstNG) break;
        }
        if (step.continueOn === 'on_ok' && sr.verdict !== 'OK') break;
        if (step.continueOn === 'on_ng' && sr.verdict !== 'NG') break;
    }

    result.totalMS = Date.now() - start;

    // Save output (honor Options step flags saveOK/saveNG).
    // Mode tracking (noSave): renderer yang menyimpan foto BER-OVERLAY setelah verdict.
    try {
        if (!opts.noSave) {
            const saved = output.record(project, base64, result, cfg);
            result.savedTo = saved.imgPath;
        }
    } catch (e) {
        console.warn('save output failed:', e.message);
    }

    // Output: kalau project memilih mode "script", kode milik user yang
    // menentukan apa yang dikirim — bukan sinyal 0/1 bawaan. Kalau tidak,
    // pakai sinyal Arduino default, dan hanya bila TIDAK ada step
    // Communication eksplisit (kalau ada, step itu yang mengatur sinyal —
    // hindari kirim dobel).
    try {
        const outCfg = project.output || {};
        if (outCfg.mode === 'device' && !opts.noSignal) {
            // Pemetaan kelas -> pin. Dikirim untuk SEMUA pin yang terpetakan,
            // termasuk yang padam: tanpa itu keadaan siklus sebelumnya
            // menempel dan mesin membaca kelas yang sudah tidak ada.
            const pinout = require('./pinout');
            result.pinout = await pinout.kirim(arduino, outCfg, result);
        } else if (outCfg.mode === 'script' && !opts.noSignal) {
            // Python dijalankan sebagai proses terpisah, jadi hasilnya
            // ditunggu; versi JavaScript berjalan langsung di dalam aplikasi.
            const r = outCfg.bahasa === 'py'
                ? await require('./pyoutput').run(outCfg.scriptPy, result, arduino, cfg.python)
                : require('./customoutput').run(outCfg.script, result, arduino);
            result.customOutput = { ok: r.ok, error: r.error, logs: r.logs };
        } else if (!hasCommStep && !opts.noSignal) {
            if (result.finalVerdict === 'NG') {
                await arduino.send(cfg.arduino.ng_signal);
            } else if (cfg.arduino.signal_on_ok) {
                await arduino.send(cfg.arduino.ok_signal);
            }
        }
    } catch (e) { /* non-fatal */ }

    // Handshake opsional: tunggu Arduino/PLC memberi tahu output/gerbang sudah MENUTUP
    // lagi sebelum siklus deteksi berikutnya. Diatur di config: arduino.handshake_token
    // (mis. "C"/"READY"/"DONE") + arduino.handshake_timeout_ms. Kalau token kosong → langsung lanjut.
    try {
        const token = cfg.arduino && cfg.arduino.handshake_token;
        if (token && !opts.noSignal) {
            const to = Number(cfg.arduino.handshake_timeout_ms) || 5000;
            const hr = await arduino.waitFor(String(token), to);
            result.arduinoHandshake = hr.ok ? (hr.skipped ? 'skip' : 'ok') : 'timeout';
        }
    } catch (e) { /* non-fatal */ }

    return result;
};
