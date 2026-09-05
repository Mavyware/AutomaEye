// Workflow executor — chains all models, aggregates verdict, saves output.

const path = require('path');
const fs = require('fs');
const inference = require('./inference');

// Weights path for the model: use the VERSION selected in the workflow step
// if there is one, then the model's active version, finally weights/best.pt (legacy).
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

// ---- Add-on Evaluation (Rule-based Tools) ----
// Determines OK/NG from YOLO detection results based on the add-ons enabled
// per model. All add-ons must pass → OK; even one failing → NG.
/**
 * Pixel analysis that needs to be requested from Python for this model's add-ons.
 * Sent via inferOnce -> infer_server.py.
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
    let incomplete = false;   // true = feature count (n) not yet met → inspection is waiting

    // Presence Check — the part must be PRESENT (at least 1 object detected).
    if (has('Presence Check')) {
        const pass = dets.length >= 1;
        checks.push({ addon: 'Presence Check', pass, detail: pass ? `${dets.length} objek terdeteksi` : 'Tidak ada objek — part hilang' });
        if (!pass) verdict = 'NG';
    }

    // Count — the number of objects must match the target EXACTLY (rule =N).
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

    // Scratches - scratches are detected from thin, elongated edges within the
    // ROI (classic CV in infer_server.py, no extra AI model).
    if (has('Scratches')) {
        const maxAllowed = Number.isFinite(acfg.scratchMax) ? acfg.scratchMax : 0;
        const found = dets.reduce((n, d) => n + ((d.scratch && d.scratch.count) || 0), 0);
        const pass = found <= maxAllowed;
        checks.push({ addon: 'Scratches', pass, detail: `${found} goresan terdeteksi (maks ${maxAllowed})` });
        if (!pass) verdict = 'NG';
    }

    // Color Inspection - the average color of each object must be close to the reference color.
    if (has('Color Inspection')) {
        const cc = acfg.color || {};
        const per = cc.perClass || {};
        const tol = Number.isFinite(cc.tolerance) ? cc.tolerance : 25;
        let bad = 0, checked = 0;
        for (const d of dets) {
            const ref = per[d.class_name];
            if (!ref || !d.color || !Number.isFinite(ref.h)) continue;
            checked++;
            // Hue wraps 0-180 in OpenCV: take the difference via the shortest path.
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

    // 1D / 2D Code - the code must be readable, and if set, must match the expected text.
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

    // Character Recognition - text is assembled from character detections (left->right)
    // by the OCR AI model, then matched against the expected text/pattern.
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

    // Positioning - the part must be near the reference position (detects a shifted/tilted part).
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

    // Calibration - keeps mm/pixel from drifting: measure a reference object of
    // known size, then compare against the calibration value currently in use.
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

    // GD&T Measurement — measures dimensions PER CLASS: each class has its own
    // measurement type, nominal, and tolerance (similar to separate tools in Keyence).
    // The size is taken from the mask contour (segmentation, precise) if available, else the box.
    // mm = pixels × mmPerPixel (global calibration, one for all classes).
    if (has('GD&T Measurement')) {
        const g = acfg.gdt || {};
        const mmpp = Number(g.mmPerPixel) || 0;
        const perClass = g.perClass || null;
        // Per-class spec → normalized to { dia, long, short } (each optional).
        // Supports the old single-config format { measure, nominalMM, toleranceMM }.
        const specFor = (cls) => {
            let s = perClass && perClass[cls];
            if (!s && !perClass && Number.isFinite(Number(g.nominalMM))) s = { measure: g.measure, nominalMM: g.nominalMM, toleranceMM: g.toleranceMM };
            if (!s) return null;
            if (s.dia || s.long || s.short) return s;         // new format
            // convert the old format
            const spec = Number.isFinite(Number(s.nominalMM)) ? { nominalMM: s.nominalMM, toleranceMM: s.toleranceMM } : null;
            if (!spec) return null;
            return s.measure === 'width' ? { short: spec } : s.measure === 'height' ? { long: spec } : { dia: spec };
        };
        // Pixel size per type: diameter / long side (max) / short side (min).
        const pxOf = (d, key) => {
            const w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);   // box (axis-aligned)
            const boxVal = key === 'widthPx' ? Math.min(w, h) : key === 'heightPx' ? Math.max(w, h) : (w + h) / 2;
            if (measureFromBox) return boxVal;                // "measure from box" mode → more stable
            if (d.measure) return d.measure[key] || boxVal;   // from mask contour (segmentation, precise)
            return boxVal;
        };
        const TYPES = [
            { field: 'dia', px: 'diameterPx', sym: 'Ø' },
            { field: 'long', px: 'heightPx', sym: 'L' },   // L = long side
            { field: 'short', px: 'widthPx', sym: 'P' },   // P = short side
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
                const shape = (pcRaw && pcRaw.shape) || 'rect';   // 'circle' = circle (Ø only)
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
                // Without a nominal → show the RAW SIZE (neutral) based on shape:
                // circle = Ø diameter only; rectangle = length & width.
                if (!labels.length) {
                    if (shape === 'circle') {
                        const dia = pxOf(d, 'diameterPx') * mmpp;
                        if (dia) { labels.push({ text: 'Ø' + dia.toFixed(2), ok: null, kind: 'dia' }); rawMeasured = true; }
                    } else {
                        const Lmm = pxOf(d, 'heightPx') * mmpp;   // long side (vertical)
                        const Pmm = pxOf(d, 'widthPx') * mmpp;    // short side (horizontal)
                        if (Lmm) { labels.push({ text: Lmm.toFixed(2), ok: null, kind: 'long' }); rawMeasured = true; }
                        if (Pmm) { labels.push({ text: Pmm.toFixed(2), ok: null, kind: 'short' }); rawMeasured = true; }
                    }
                }
                if (labels.length) d.gdt = labels;   // array → UI draws all of them on the feature
            });
            checks.push(anyMeasured
                ? { addon: 'GD&T', pass: allPass, detail: parts.join(' · ') }
                : rawMeasured
                    ? { addon: 'GD&T', pass: true, detail: 'Ukuran mentah (L×P mm) ditampilkan — isi nominal per kelas untuk pass/fail' }
                    : { addon: 'GD&T', pass: true, detail: 'Tidak ada ukuran (kontur kosong)' });

            // Count (n) per class: informational ONLY — no longer fails/holds up the inspection.
            // (The n=8 boxes / n=6 circles requirement was removed so the verdict & Arduino signal aren't held back.)
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

    // No add-on active → default: a detected object means OK.
    if (checks.length === 0) {
        const pass = dets.length >= 1;
        checks.push({ addon: 'Deteksi', pass, detail: pass ? `${dets.length} objek` : 'Tidak ada objek' });
        verdict = pass ? 'OK' : 'NG';
    }

    return { verdict, checks, minConf, incomplete };
}
exports.evaluateAddons = evaluateAddons;

// Run one step according to its CATEGORY. Fills in sr (verdict, reason, etc).
// ctx = { cfg, project, base64, arduino, result }.
async function runStep(step, sr, ctx) {
    const { cfg, project, base64, arduino, result } = ctx;
    const conf = Number.isFinite(ctx.conf) ? ctx.conf : cfg.model.confidence;
    const imgsz = Number.isFinite(ctx.imgsz) ? ctx.imgsz : cfg.model.imgsz;
    const cat = step.category;
    const config = step.config || {};

    // Model is used by Inspection & Positioning.
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

    // ---- CAPTURE — image source & quality (not analysis) ----
    if (cat === 'Capture') {
        const bytes = Math.floor((base64 || '').length * 3 / 4);
        const kb = Math.round(bytes / 1024);
        const minKB = Number(config.minKB) || 0;   // optional gate: reject an empty/too-small image
        if (!base64) {
            sr.verdict = 'NG'; sr.reason = 'Tidak ada gambar dari sumber';
        } else if (minKB && kb < minKB) {
            sr.verdict = 'NG'; sr.reason = `Gambar ${kb}KB < minimum ${minKB}KB (kemungkinan gagal capture)`;
        } else {
            sr.verdict = 'OK'; sr.reason = `Sumber: ${config.source || 'kamera'} · gambar ${kb}KB diterima`;
        }
        return;
    }

    // ---- POSITIONING — locks the part's location using detection ----
    if (cat === 'Positioning') {
        const weightsPath = weightsFor(m, step);
        // Positioning (part-presence detection) uses the lower PRESENCE confidence,
        // to stay consistent in both Live and manual Capture.
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
            // Presence = ONE part. Take only the LARGEST box (prevents 2 boxes for 1 object).
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

    // ---- INSPECTION — detection + add-ons (Presence/Count/GD&T) ----
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
        // codes/text are per-frame (not per-detection), passed through separately.
        const ev = evaluateAddons(m, sr.detections, ctx.measureFromBox, { codes: r.codes, text: r.text });
        sr.verdict = ev.verdict;
        sr.checks = ev.checks;
        sr.confidence = ev.minConf;
        sr.incomplete = ev.incomplete;   // feature count (n) not yet complete → inspection is waiting
        sr.reason = ev.checks.filter(c => !c.pass).map(c => `${c.addon}: ${c.detail}`).join('; ')
            || ev.checks.map(c => `${c.addon}: ${c.detail}`).join('; ');
        return;
    }

    // ---- COMMUNICATION — sends the result out (Arduino/PLC) ----
    if (cat === 'Communication') {
        if (ctx.noSignal) {   // tracking mode: signal is sent once per part by the renderer
            sr.verdict = 'OK'; sr.reason = 'Sinyal ditangani mode tracking (per part)';
            return;
        }
        const ng = result.finalVerdict === 'NG';
        const onlyOnNG = config.onlyOnNG !== false;   // default: send only when NG
        const sig = ng ? (config.signalNG != null ? config.signalNG : cfg.arduino.ng_signal)
                       : (config.signalOK != null ? config.signalOK : cfg.arduino.ok_signal);
        if (ng || !onlyOnNG) {
            try { await arduino.send(String(sig)); sr.reason = `Kirim sinyal '${String(sig).trim()}' ke Arduino`; }
            catch (e) { sr.reason = `Gagal kirim sinyal: ${e.message}`; }
        } else {
            sr.reason = 'Hasil OK — tidak ada sinyal (onlyOnNG)';
        }
        sr.verdict = 'OK';   // communication doesn't judge the part
        return;
    }

    // ---- OPTIONS — extra flags (save image, etc.) ----
    if (cat === 'Options') {
        if (config.saveOK != null) result.saveOK = !!config.saveOK;
        if (config.saveNG != null) result.saveNG = !!config.saveNG;
        sr.verdict = 'OK';
        sr.reason = `Simpan OK: ${result.saveOK ? 'ya' : 'tidak'} · Simpan NG: ${result.saveNG === false ? 'tidak' : 'ya'}`;
        return;
    }

    // Unknown category → skip without affecting the verdict.
    sr.verdict = 'OK';
    sr.reason = '(kategori belum didukung)';
}

exports.execute = async (cfg, project, imageDataUrl, arduino, output, opts = {}) => {
    // Strip data URL prefix
    const base64 = imageDataUrl.replace(/^data:image\/[^;]+;base64,/, '');
    // Confidence can be overridden from the Run page (Live Settings).
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

    // Clear the serial buffer so the handshake reply being waited on belongs to this cycle.
    try { if (arduino.flushRx) arduino.flushRx(); } catch (_) { }

    const stopOnFirstNG = project.workflow.onFirstNG === 'stop_and_report';
    const steps = project.workflow.steps;
    const hasCommStep = steps.some(s => s.category === 'Communication');

    // Presence gating: Presence Check runs first. If the part is NOT there,
    // the next defect-detection/measurement model (Inspection) is SKIPPED (no wasted inference time).
    const isPresenceModel = (name) => {
        const m = project.models.find(x => x.name === name);
        return !!(m && (m.addons || []).includes('Presence Check'));
    };
    let gateEmpty = false;   // true = the last presence check found no part

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

        // Heavy Inspection (non-presence) is skipped when: (a) Live is lightweight, or
        // (b) the previous presence check was empty. Either way → treat as OK, save inference time.
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

        // Update the gate: a presence model that found no object → skip the next inspection.
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
    // Tracking mode (noSave): the renderer saves the OVERLAID photo after the verdict.
    try {
        if (!opts.noSave) {
            const saved = output.record(project, base64, result, cfg);
            result.savedTo = saved.imgPath;
        }
    } catch (e) {
        console.warn('save output failed:', e.message);
    }

    // Output: if the project selects "script" mode, the user's own code
    // decides what gets sent — not the default 0/1 signal. Otherwise,
    // use the default Arduino signal, and only when there is NO explicit
    // Communication step (if there is one, that step controls the signal —
    // avoids sending it twice).
    try {
        const outCfg = project.output || {};
        if (outCfg.mode === 'device' && !opts.noSignal) {
            // Class -> pin mapping. Sent for ALL mapped pins, including
            // ones that are off: without that, the previous cycle's state
            // would stick and the machine would read a class that no longer exists.
            const pinout = require('./pinout');
            result.pinout = await pinout.kirim(arduino, outCfg, result);
        } else if (outCfg.mode === 'script' && !opts.noSignal) {
            // Python runs as a separate process, so its result is awaited;
            // the JavaScript version runs directly inside the app.
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

    // Optional handshake: wait for the Arduino/PLC to signal the output/gate has CLOSED
    // again before the next detection cycle. Configured via: arduino.handshake_token
    // (e.g. "C"/"READY"/"DONE") + arduino.handshake_timeout_ms. If the token is empty → proceed immediately.
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
