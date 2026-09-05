// Build Excel table rows from saved detection results (outputs/<date>/*.json).
// Columns: ID · image link · verdict · Box 1..N (Length,Width) · Hole 1..M (Ø) · detection time (ms).
// A feature that was NOT detected → its column slot is left empty (mapped by X position left→right).
const fs = require('fs');
const path = require('path');

function centerX(d) { return (Number(d.x1) + Number(d.x2)) / 2; }

// Get the mm value from gdt (kind: 'long'=length, 'short'=width, 'dia'=diameter).
function gval(d, kind) {
    const g = (d.gdt || []).find(x => x.kind === kind);
    if (!g) return null;
    const n = parseFloat(String(g.text).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : null;
}

// Group detections → the dominant rectangle (rect) & circle (circle) shape classes.
function classify(dets) {
    const byClass = {};
    for (const d of dets) {
        const kinds = (d.gdt || []).map(g => g.kind);
        const shape = kinds.includes('dia') ? 'circle'
            : (kinds.includes('long') || kinds.includes('short')) ? 'rect' : null;
        if (!shape) continue;
        (byClass[d.class_name] = byClass[d.class_name] || { shape, items: [] }).items.push(d);
    }
    let boxCls = null, holeCls = null;
    for (const [c, info] of Object.entries(byClass)) {
        if (info.shape === 'rect' && (!boxCls || info.items.length > byClass[boxCls].items.length)) boxCls = c;
        if (info.shape === 'circle' && (!holeCls || info.items.length > byClass[holeCls].items.length)) holeCls = c;
    }
    return { boxes: boxCls ? byClass[boxCls].items : [], holes: holeCls ? byClass[holeCls].items : [] };
}

// Map features to n slots based on X position (left→right). Empty slot = null.
function assignSlots(items, n) {
    const out = new Array(n).fill(null);
    if (!items.length) return out;
    const xs = items.map(centerX);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const span = (xmax - xmin) || 1;
    for (const it of items.slice().sort((a, b) => centerX(a) - centerX(b))) {
        let slot = Math.round((centerX(it) - xmin) / span * (n - 1));
        slot = Math.max(0, Math.min(n - 1, slot));
        if (out[slot] != null) {              // slot taken → find the nearest empty slot
            let d = 1, placed = false;
            while (d < n && !placed) {
                if (slot - d >= 0 && out[slot - d] == null) { out[slot - d] = it; placed = true; }
                else if (slot + d < n && out[slot + d] == null) { out[slot + d] = it; placed = true; }
                d++;
            }
        } else out[slot] = it;
    }
    return out;
}

// projectDir = project folder; date = 'YYYY-MM-DD'. opts.nBox / opts.nHole.
exports.buildRows = (projectDir, date, opts) => {
    const NBOX = (opts && opts.nBox) || 8;
    const NHOLE = (opts && opts.nHole) || 6;
    const dir = path.join(projectDir, 'outputs', date);

    const header = ['ID', 'Gambar (link)', 'Verdict'];
    for (let i = 1; i <= NBOX; i++) header.push(`Kotak ${i} Panjang (mm)`, `Kotak ${i} Lebar (mm)`);
    for (let i = 1; i <= NHOLE; i++) header.push(`Lubang ${i} Ø (mm)`);
    header.push('Waktu Deteksi (ms)');

    const rows = [header];
    if (!fs.existsSync(dir)) return { rows, count: 0, dir };

    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json')).sort();
    let count = 0;
    for (const f of files) {
        let j;
        try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
        const insp = (j.steps || []).find(s => s.category === 'Inspection' && !s.skipped);
        if (!insp || !Array.isArray(insp.detections)) continue;

        const { boxes, holes } = classify(insp.detections);
        const stem = f.replace(/\.json$/i, '');
        const imgPath = path.join(dir, stem + '.jpg');
        const imgCell = fs.existsSync(imgPath)
            ? { f: `HYPERLINK("${imgPath.replace(/"/g, '')}","${stem}.jpg")` }
            : '';

        const row = [stem, imgCell, j.finalVerdict || ''];
        for (const b of assignSlots(boxes, NBOX)) {
            if (b) row.push(gval(b, 'long'), gval(b, 'short'));
            else row.push('', '');
        }
        for (const h of assignSlots(holes, NHOLE)) {
            row.push(h ? gval(h, 'dia') : '');
        }
        row.push(typeof j.totalMS === 'number' ? Math.round(j.totalMS) : '');
        rows.push(row);
        count++;
    }
    return { rows, count, dir };
};
