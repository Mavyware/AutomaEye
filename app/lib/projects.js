// Project + Model domain — CRUD, JSON persistence, dataset ops.
//
// Folder layout for each project:
//   projects/
//     <name>/
//       project.json
//       models/
//         <model>/
//           model.json
//           dataset/
//             images/{train,val}/
//             labels/{train,val}/
//             data.yaml
//           weights/
//           runs/
//       outputs/
//         YYYY-MM-DD/NNN-HHMM.jpg + .json
//         daily_summary.csv

const { pythonScript, pythonDir } = require('./paths');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_FILE = 'project.json';
const MODELS_DIR = 'models';
const OUTPUTS_DIR = 'outputs';
const DATASET_DIR = 'dataset';
const WEIGHTS_DIR = 'weights';

const AI_TYPES = [
    'AI Segmentation', 'AI Detection', 'AI Classification', 'AI OCR',
];
const ADDONS = [
    'Presence Check', 'Scratches', 'GD&T Measurement', 'Positioning',
    'Color Inspection', 'Count', 'Character Recognition',
    '1D Code', '2D Code', 'Calibration',
];
const CATEGORIES = [
    'Capture', 'Positioning', 'Inspection', 'Communication', 'Options',
];

exports.AI_TYPES = AI_TYPES;
exports.ADDONS = ADDONS;
exports.CATEGORIES = CATEGORIES;

// --- helpers ---
function sanitize(s) {
    return String(s).trim().replace(/[\/\\:*?"<>|]/g, '_');
}
function projectDir(root, name) {
    return safeJoin(root, safeSegment(name, 'project'));
}
function modelDir(root, projectName, modelName) {
    return safeJoin(root, safeSegment(projectName, 'project'), MODELS_DIR, safeSegment(modelName, 'model'));
}
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

// ---- Path guard ----
// Project/model/file names come from the renderer. Without a guard, a name
// containing "../" would escape the app folder: annot:image could read
// any file on disk, and projects:delete could delete some other folder.
// Every path built from external input MUST go through here.
function safeJoin(base, ...parts) {
    const root = path.resolve(base);
    const target = path.resolve(root, ...parts);
    if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error('Ditolak: path di luar folder yang diizinkan');
    }
    return target;
}

/** One name segment (project/model): no path separators, no "..". */
function safeSegment(name, label) {
    const n = String(name == null ? '' : name).trim();
    if (!n || n === '.' || n === '..' || /[\\/]/.test(n) || /\0/.test(n)) {
        throw new Error(`Nama ${label} tidak valid: ${JSON.stringify(name)}`);
    }
    return n;
}

/** File name: forced down to just the basename, so "../x" can't get through. */
function safeFileName(name) {
    const b = path.basename(String(name == null ? '' : name));
    if (!b || b === '.' || b === '..') throw new Error('Nama berkas tidak valid');
    return b;
}

const SPLITS = ['train', 'val', 'test'];
function safeSplit(sp) {
    return SPLITS.includes(sp) ? sp : 'train';
}

exports._safeJoin = safeJoin;   // used by main.js for other handlers

// --- Project CRUD ---
exports.list = (root) => {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
            try { return loadProject(root, d.name); }
            catch (_) { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
};

function loadProject(root, name) {
    const f = safeJoin(root, safeSegment(name, 'project'), PROJECT_FILE);
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    data.dir = path.join(root, name);
    // Inject model dirs
    for (const m of data.models || []) {
        m.dir = modelDir(root, name, m.name);
    }
    return data;
}

function saveProject(root, p) {
    p.updatedAt = new Date().toISOString();
    const dir = projectDir(root, p.name);
    ensureDir(dir);
    const toSave = { ...p };
    delete toSave.dir;
    toSave.models = (p.models || []).map(m => { const c = { ...m }; delete c.dir; return c; });
    fs.writeFileSync(path.join(dir, PROJECT_FILE), JSON.stringify(toSave, null, 2));
}

exports.load = loadProject;

// --- Model versioning (Roboflow-style: every training run produces a new version) ---
// Snapshot the current weights/best.pt → versions/v<N>/best.pt + record it in project.json.
exports.snapshotVersion = (root, projectName, modelName, metrics) => {
    const p = loadProject(root, projectName);
    const m = (p.models || []).find(x => x.name === modelName);
    if (!m) throw new Error('Model tidak ada: ' + modelName);
    const mDir = modelDir(root, projectName, modelName);
    const src = path.join(mDir, 'weights', 'best.pt');
    if (!fs.existsSync(src)) throw new Error('weights/best.pt tidak ada');
    const id = (m.versions && m.versions.length) ? Math.max(...m.versions.map(v => v.id)) + 1 : 1;
    const vdir = path.join(mDir, 'versions', 'v' + id);
    ensureDir(vdir);
    fs.copyFileSync(src, path.join(vdir, 'best.pt'));
    m.versions = m.versions || [];
    m.versions.push({ id, date: new Date().toISOString(), metrics: metrics || {}, classes: (m.classes || []).slice() });
    m.activeVersion = id;
    saveProject(root, p);
    return { id, versions: m.versions, activeVersion: id };
};

// Set the active version (used as default when the workflow doesn't specify a version).
exports.setActiveVersion = (root, projectName, modelName, versionId) => {
    const p = loadProject(root, projectName);
    const m = (p.models || []).find(x => x.name === modelName);
    if (!m) throw new Error('Model tidak ada');
    const vId = Number(versionId);
    // Copy this version's weights to weights/best.pt so it becomes the active default.
    const mDir = modelDir(root, projectName, modelName);
    const vw = path.join(mDir, 'versions', 'v' + vId, 'best.pt');
    if (fs.existsSync(vw)) fs.copyFileSync(vw, path.join(mDir, 'weights', 'best.pt'));
    m.activeVersion = vId;
    saveProject(root, p);
    return { activeVersion: vId };
};

// Resolve the weights path: a specific version → active → weights/best.pt (legacy).
exports.resolveWeights = (root, projectName, modelName, versionId) => {
    const mDir = modelDir(root, projectName, modelName);
    const tryV = (id) => {
        if (!id) return null;
        const w = path.join(mDir, 'versions', 'v' + id, 'best.pt');
        return fs.existsSync(w) ? w : null;
    };
    let w = tryV(versionId);
    if (!w) {
        try {
            const p = loadProject(root, projectName);
            const m = (p.models || []).find(x => x.name === modelName);
            w = tryV(m && m.activeVersion);
        } catch (_) { }
    }
    return w || path.join(mDir, 'weights', 'best.pt');
};

exports.create = (root, name, description) => {
    name = sanitize(name);
    if (!name) throw new Error('Nama project kosong');
    const dir = projectDir(root, name);
    if (fs.existsSync(dir)) throw new Error(`Project "${name}" sudah ada`);
    ensureDir(dir);
    ensureDir(path.join(dir, MODELS_DIR));
    ensureDir(path.join(dir, OUTPUTS_DIR));
    const now = new Date().toISOString();
    const p = {
        name, description: description || '',
        createdAt: now, updatedAt: now,
        models: [],
        workflow: { steps: [], onFirstNG: 'stop_and_report' },
    };
    saveProject(root, p);
    return loadProject(root, name);
};

exports.delete = (root, name) => {
    const dir = projectDir(root, name);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
};

// --- Model CRUD ---
exports.addModel = (root, projectName, { name, aiType, addons, classes, addonConfig }) => {
    const p = loadProject(root, projectName);
    name = sanitize(name);
    if (!name) throw new Error('Nama model kosong');
    if (p.models.find(m => m.name === name)) throw new Error(`Model "${name}" sudah ada`);
    if (!AI_TYPES.includes(aiType)) throw new Error(`AI type "${aiType}" invalid`);
    if (!Array.isArray(classes) || classes.length === 0) throw new Error('Kelas minimal 1');

    const mDir = modelDir(root, projectName, name);
    for (const sub of [
        path.join(DATASET_DIR, 'images/train'),
        path.join(DATASET_DIR, 'images/val'),
        path.join(DATASET_DIR, 'labels/train'),
        path.join(DATASET_DIR, 'labels/val'),
        WEIGHTS_DIR, 'runs',
    ]) ensureDir(path.join(mDir, sub));

    // Write data.yaml for Ultralytics YOLO
    const dataYaml = [
        `# Auto-generated by AutomaEyes (Electron)`,
        `path: ${path.join(mDir, DATASET_DIR).replace(/\\/g, '/')}`,
        `train: images/train`,
        `val: images/val`,
        ``,
        `nc: ${classes.length}`,
        `names:`,
        ...classes.map(c => `  - ${c}`),
    ].join('\n');
    fs.writeFileSync(path.join(mDir, DATASET_DIR, 'data.yaml'), dataYaml);

    const now = new Date().toISOString();
    const m = {
        name, type: aiType,
        addons: addons || [],
        addonConfig: addonConfig || {},
        classes,
        training: {
            epochs: 100, batch: 16, imgsz: 640, lr: 0.01,
            augRotate: true, augFlip: true, augBlur: false, augExposure: true, augNoise: false,
        },
        trained: false,
        createdAt: now, updatedAt: now,
        lastMAP: 0, lastPrecision: 0, lastRecall: 0, lastF1: 0,
    };
    p.models.push(m);
    saveProject(root, p);
    m.dir = mDir;
    return m;
};

exports.updateModel = (root, projectName, modelName, patch) => {
    const p = loadProject(root, projectName);
    const m = p.models.find(x => x.name === modelName);
    if (!m) throw new Error('Model not found');
    Object.assign(m, patch);
    m.updatedAt = new Date().toISOString();
    saveProject(root, p);
    return m;
};

exports.deleteModel = (root, projectName, modelName) => {
    const p = loadProject(root, projectName);
    const idx = p.models.findIndex(x => x.name === modelName);
    if (idx < 0) throw new Error('Model not found');
    const mDir = modelDir(root, projectName, modelName);
    if (fs.existsSync(mDir)) fs.rmSync(mDir, { recursive: true, force: true });
    p.models.splice(idx, 1);
    // Remove Workflow steps that use this model so they don't become dangling references.
    if (p.workflow && Array.isArray(p.workflow.steps)) {
        p.workflow.steps = p.workflow.steps.filter(s => s.modelName !== modelName);
        p.workflow.steps.forEach((s, i) => s.stepIndex = i + 1);
    }
    saveProject(root, p);
    return { ok: true };
};

// --- Dataset ---
exports.listImages = (root, projectName, modelName, split) => {
    const dir = path.join(modelDir(root, projectName, modelName), DATASET_DIR, 'images', split);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
        .map(f => ({ name: f, path: path.join(dir, f) }));
};

// List a split's images + parse bounding boxes from their YOLO labels.
// Used by the gallery preview to draw annotations on top of thumbnails.
exports.listImagesWithLabels = (root, projectName, modelName, split) => {
    split = safeSplit(split);
    const dsDir = safeJoin(modelDir(root, projectName, modelName), DATASET_DIR);
    const imgDir = safeJoin(dsDir, 'images', split);
    const lblDir = safeJoin(dsDir, 'labels', split);
    if (!fs.existsSync(imgDir)) return [];
    return fs.readdirSync(imgDir)
        .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
        .map(f => {
            const stem = path.parse(f).name;
            const lblPath = path.join(lblDir, stem + '.txt');
            let boxes = [];
            if (fs.existsSync(lblPath)) {
                boxes = fs.readFileSync(lblPath, 'utf8').split(/\r?\n/).map(line => {
                    const p = line.trim().split(/\s+/);
                    if (p.length < 5) return null;
                    const cls = parseInt(p[0], 10);
                    const vals = p.slice(1).map(Number);
                    if (vals.some(v => Number.isNaN(v))) return null;
                    if (vals.length === 4) {                       // bbox (detection)
                        const [cx, cy, w, h] = vals;
                        return { cls, cx, cy, w, h };
                    }
                    if (vals.length >= 6 && vals.length % 2 === 0) { // polygon (segmentation)
                        const xs = [], ys = [];
                        for (let i = 0; i < vals.length; i += 2) { xs.push(vals[i]); ys.push(vals[i + 1]); }
                        const minx = Math.min(...xs), maxx = Math.max(...xs);
                        const miny = Math.min(...ys), maxy = Math.max(...ys);
                        return { cls, poly: vals, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, w: maxx - minx, h: maxy - miny };
                    }
                    return null;
                }).filter(Boolean);
            }
            return { name: f, path: path.join(imgDir, f), isAug: f.includes('.aug'), boxes };
        });
};

exports.importImages = (root, projectName, modelName, filePaths) => {
    const dstDir = path.join(modelDir(root, projectName, modelName), DATASET_DIR, 'images', 'train');
    ensureDir(dstDir);
    let saved = 0;
    for (const src of filePaths) {
        try {
            const base = path.basename(src);
            fs.copyFileSync(src, path.join(dstDir, base));
            saved++;
        } catch (e) { console.error('copy failed', src, e.message); }
    }
    return { saved };
};

// Delete images (along with their YOLO labels) from ALL splits. names = list of basenames.
exports.deleteDatasetImages = (root, projectName, modelName, names) => {
    const dsDir = path.join(modelDir(root, projectName, modelName), DATASET_DIR);
    const splits = ['train', 'val', 'test'];
    let deleted = 0;
    for (const name of (names || [])) {
        const base = path.basename(String(name)); // prevent path traversal
        const stem = path.parse(base).name;
        for (const sp of splits) {
            const img = path.join(dsDir, 'images', sp, base);
            const lbl = path.join(dsDir, 'labels', sp, stem + '.txt');
            try { if (fs.existsSync(img)) { fs.unlinkSync(img); deleted++; } } catch (e) { console.error('del img', e.message); }
            try { if (fs.existsSync(lbl)) fs.unlinkSync(lbl); } catch (e) { console.error('del lbl', e.message); }
        }
    }
    return { deleted };
};

// Import existing .pt file → copy ke weights/best.pt, mark trained
exports.importPt = (root, projectName, modelName, srcPath) => {
    const p = loadProject(root, projectName);
    const m = p.models.find(x => x.name === modelName);
    if (!m) throw new Error('Model not found');
    if (!fs.existsSync(srcPath)) throw new Error('File .pt tidak ada: ' + srcPath);
    if (!srcPath.toLowerCase().endsWith('.pt')) {
        throw new Error('Hanya file .pt yang di-support');
    }

    const mDir = modelDir(root, projectName, modelName);
    ensureDir(path.join(mDir, WEIGHTS_DIR));
    const dst = path.join(mDir, WEIGHTS_DIR, 'best.pt');
    fs.copyFileSync(srcPath, dst);

    // Mark model as trained. We don't know the mAP etc, leave it at 0 (user can fill it in manually)
    m.trained = true;
    m.updatedAt = new Date().toISOString();
    // An imported model has never been evaluated here. Leave it null, NOT 0 —
    // "mAP 0.00" reads as a bad model, when it actually just means it hasn't been measured.
    if (m.lastMAP == null) {
        m.lastMAP = null;
        m.lastPrecision = null;
        m.lastRecall = null;
        m.lastF1 = null;
    }
    saveProject(root, p);
    return { imported: true, dst, sizeBytes: fs.statSync(dst).size };
};

exports.modelStats = (root, projectName, modelName) => {
    const mDir = modelDir(root, projectName, modelName);
    const count = (p, exts) => {
        if (!fs.existsSync(p)) return 0;
        return fs.readdirSync(p).filter(f => exts.some(e => f.toLowerCase().endsWith(e))).length;
    };
    return {
        train: count(path.join(mDir, DATASET_DIR, 'images/train'), ['.jpg', '.png', '.jpeg']),
        val: count(path.join(mDir, DATASET_DIR, 'images/val'), ['.jpg', '.png', '.jpeg']),
        test: count(path.join(mDir, DATASET_DIR, 'images/test'), ['.jpg', '.png', '.jpeg']),
        annotated: count(path.join(mDir, DATASET_DIR, 'labels/train'), ['.txt']),
    };
};

// ================= Dataset split & clean-rebuild =================
const IMG_RE = /\.(jpg|jpeg|png)$/i;

// List image files in a folder. augOnly: true=aug only, false=originals only, null=all.
function listImages(dir, augOnly = null) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => {
        if (!IMG_RE.test(f)) return false;
        const isAug = f.includes('.aug');
        if (augOnly === true) return isAug;
        if (augOnly === false) return !isAug;
        return true;
    });
}

function moveAllFiles(srcDir, dstDir) {
    if (!fs.existsSync(srcDir)) return;
    ensureDir(dstDir);
    for (const f of fs.readdirSync(srcDir)) {
        const s = path.join(srcDir, f);
        if (fs.statSync(s).isFile()) fs.renameSync(s, path.join(dstDir, f));
    }
}

// Fixed PRNG seed (mulberry32) → split is reproducible every time.
function seededShuffle(arr, seed) {
    let t = seed >>> 0;
    const rnd = () => {
        t += 0x6D2B79F5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Rewrite data.yaml. val falls back to images/train if val is empty (YOLO requires val).
function writeDataYaml(root, projectName, modelName) {
    const mDir = modelDir(root, projectName, modelName);
    const dsDir = path.join(mDir, DATASET_DIR);
    const p = loadProject(root, projectName);
    const m = (p.models || []).find(x => x.name === modelName);
    const classes = (m && Array.isArray(m.classes) && m.classes.length) ? m.classes : ['object'];
    const hasImgs = sub => listImages(path.join(dsDir, 'images', sub)).length > 0;
    const hasVal = hasImgs('val');
    const hasTest = hasImgs('test');
    const lines = [
        `# Auto-generated by AutomaEyes (Electron)`,
        `path: ${dsDir.replace(/\\/g, '/')}`,
        `train: images/train`,
        `val: images/${hasVal ? 'val' : 'train'}`,
    ];
    if (hasTest) lines.push(`test: images/test`);
    lines.push('', `nc: ${classes.length}`, `names:`, ...classes.map(c => `  - ${c}`));
    fs.writeFileSync(path.join(dsDir, 'data.yaml'), lines.join('\n'));
    return { hasVal, hasTest };
}

// Delete all augmented files (*.aug*) from every split. Returns the number of images deleted.
function deleteAugmented(dsDir) {
    let removed = 0;
    for (const sub of ['train', 'val', 'test']) {
        for (const kind of ['images', 'labels']) {
            const d = path.join(dsDir, kind, sub);
            if (!fs.existsSync(d)) continue;
            for (const f of fs.readdirSync(d)) {
                if (f.includes('.aug')) {
                    fs.unlinkSync(path.join(d, f));
                    if (kind === 'images') removed++;
                }
            }
        }
    }
    return removed;
}

// Rename labels whose names don't match an image (leftovers from an external
// annotation tool) to match the image's stem. Returns the number fixed.
function fixLabelNames(dsDir) {
    let fixed = 0;
    for (const sub of ['train', 'val', 'test']) {
        const imgD = path.join(dsDir, 'images', sub);
        const lblD = path.join(dsDir, 'labels', sub);
        if (!fs.existsSync(lblD) || !fs.existsSync(imgD)) continue;
        const stems = new Set(listImages(imgD).map(f => path.parse(f).name));
        for (const f of fs.readdirSync(lblD)) {
            if (!f.toLowerCase().endsWith('.txt')) continue;
            const stem = f.replace(/\.txt$/i, '');
            if (stems.has(stem)) continue;
            let target = stem.replace(/^[0-9a-fA-F]{6,}-/, '');
            if (!stems.has(target)) {
                const hit = [...stems].find(s => stem.endsWith('-' + s) || stem.endsWith('_' + s));
                if (hit) target = hit;
            }
            if (stems.has(target)) {
                const src = path.join(lblD, f);
                const dst = path.join(lblD, target + '.txt');
                if (src !== dst) { fs.renameSync(src, dst); fixed++; }
            }
        }
    }
    return fixed;
}

// Split ORIGINAL labeled images into train/val/test. Augmented (*.aug*) always
// stays in train. Idempotent: val/test are consolidated back into train first, every call.
exports.splitDataset = (root, projectName, modelName, ratios = {}) => {
    const mDir = modelDir(root, projectName, modelName);
    const dsDir = path.join(mDir, DATASET_DIR);
    const rVal = ratios.val != null ? ratios.val : 0.2;
    const rTest = ratios.test != null ? ratios.test : 0.1;

    for (const sub of ['train', 'val', 'test'])
        for (const kind of ['images', 'labels']) ensureDir(path.join(dsDir, kind, sub));

    // 1. Consolidate val/test back into train (so re-splitting is idempotent)
    for (const sub of ['val', 'test']) {
        moveAllFiles(path.join(dsDir, 'images', sub), path.join(dsDir, 'images', 'train'));
        moveAllFiles(path.join(dsDir, 'labels', sub), path.join(dsDir, 'labels', 'train'));
    }

    const imgTrain = path.join(dsDir, 'images', 'train');
    const lblTrain = path.join(dsDir, 'labels', 'train');

    // 2. Pool = original (non-aug) images that have a label
    const pool = listImages(imgTrain, false).filter(f =>
        fs.existsSync(path.join(lblTrain, path.parse(f).name + '.txt')));
    seededShuffle(pool, 1337);

    const n = pool.length;
    let nVal = Math.round(n * rVal);
    let nTest = Math.round(n * rTest);
    if (n >= 3 && nVal === 0) nVal = 1;               // ensure val >=1 when possible
    if (nVal + nTest > n - 1) nTest = Math.max(0, n - nVal - 1); // leave >=1 for train

    const valSet = pool.slice(0, nVal);
    const testSet = pool.slice(nVal, nVal + nTest);

    const moveOne = (file, destSub) => {
        const stem = path.parse(file).name;
        fs.renameSync(path.join(imgTrain, file), path.join(dsDir, 'images', destSub, file));
        const lblSrc = path.join(lblTrain, stem + '.txt');
        if (fs.existsSync(lblSrc))
            fs.renameSync(lblSrc, path.join(dsDir, 'labels', destSub, stem + '.txt'));
    };
    valSet.forEach(f => moveOne(f, 'val'));
    testSet.forEach(f => moveOne(f, 'test'));

    // 3. Prevent data leakage: if the user augments FIRST then splits, augmented
    // images whose originals ended up in val/test are still sitting in train. That
    // lets the model "peek" at the evaluation data. Remove augmentations whose source is in val/test.
    const heldOutStems = new Set([...valSet, ...testSet].map(f => path.parse(f).name));
    const AUG_SUFFIX = /\.(rotate|fliph|flipv|blur|exposure|noise)\.aug\d+$/i;
    let leakRemoved = 0;
    for (const f of listImages(imgTrain, true)) {          // *.aug* files only
        const src = path.parse(f).name.replace(AUG_SUFFIX, '');
        if (heldOutStems.has(src)) {
            fs.unlinkSync(path.join(imgTrain, f));
            const lbl = path.join(lblTrain, path.parse(f).name + '.txt');
            if (fs.existsSync(lbl)) fs.unlinkSync(lbl);
            leakRemoved++;
        }
    }

    const yaml = writeDataYaml(root, projectName, modelName);
    return {
        originals: n,
        train: listImages(imgTrain).length,
        val: valSet.length,
        test: testSet.length,
        leakRemoved,
        ...yaml,
    };
};

// Remove ORIGINAL (non-aug) images that have no label — e.g. images that were
// skipped during annotation but whose file is still in the dataset. Returns the number removed.
function deleteUnlabeledOriginals(dsDir) {
    let removed = 0;
    for (const sub of ['train', 'val', 'test']) {
        const imgD = path.join(dsDir, 'images', sub);
        const lblD = path.join(dsDir, 'labels', sub);
        if (!fs.existsSync(imgD)) continue;
        for (const f of listImages(imgD, false)) {   // originals only (non-aug)
            const lbl = path.join(lblD, path.parse(f).name + '.txt');
            if (!fs.existsSync(lbl)) { fs.unlinkSync(path.join(imgD, f)); removed++; }
        }
    }
    return removed;
}

// Clean the dataset then re-split: remove augmented files, fix label names,
// remove unlabeled originals, then split. For datasets that already got
// messed up, or that contain empty images (skipped during annotation).
exports.cleanRebuildDataset = (root, projectName, modelName, ratios) => {
    const mDir = modelDir(root, projectName, modelName);
    const dsDir = path.join(mDir, DATASET_DIR);
    const removedAug = deleteAugmented(dsDir);
    const fixedNames = fixLabelNames(dsDir);
    const removedEmpty = deleteUnlabeledOriginals(dsDir);
    const split = exports.splitDataset(root, projectName, modelName, ratios);
    return { removedAug, fixedNames, removedEmpty, ...split };
};

// --- Augmentation via Python subprocess ---
exports.augmentDataset = (root, projectName, modelName, opts, pyCfg, onProgress) => {
    return new Promise((resolve, reject) => {
        const mDir = modelDir(root, projectName, modelName);
        // splits: default is just 'train'. Can be ['train','val','test'] if requested
        // (e.g. an advisor's requirement). Each split is augmented into its own folder.
        const splits = Array.isArray(opts.splits) && opts.splits.length
            ? opts.splits.filter(s => ['train', 'val', 'test'].includes(s))
            : ['train'];
        const args = [pythonScript(null, 'augment.py'),
            '--dir', path.join(mDir, DATASET_DIR),
            '--multiplier', String(opts.multiplier || 2),
            '--splits', splits.join(','),
        ];
        // Default: clean regeneration (delete old aug files first) unless stacking is requested.
        if (opts.clean !== false) args.push('--clean');
        if (opts.rotate) {
            args.push('--rotate', '--rotate-max', String(opts.rotateMax || 15));
        }
        if (opts.flipH) args.push('--flip-h');
        if (opts.flipV) args.push('--flip-v');
        if (opts.blur) {
            args.push('--blur', '--blur-sigma', String(opts.blurSigma || 2.0));
        }
        if (opts.exposure) {
            args.push('--exposure', '--exposure-alpha', String(opts.exposureAlpha || 1.2));
        }
        if (opts.noise) {
            args.push('--noise', '--noise-sigma', String(opts.noiseSigma || 8));
        }

        const py = spawn(pyCfg.exe || 'python', args, { cwd: pythonDir() });
        let stdout = '', stderr = '';
        py.stdout.on('data', d => {
            const s = d.toString();
            stdout += s;
            // Stream progress "PROGRESS done/total" to the UI
            s.split(/\r?\n/).forEach(line => {
                const pm = line.match(/PROGRESS (\d+)\/(\d+)/);
                if (pm && onProgress) onProgress({ done: +pm[1], total: +pm[2] });
            });
        });
        py.stderr.on('data', d => stderr += d);
        py.on('close', code => {
            if (code !== 0) return reject(new Error(`augment gagal: ${stderr || stdout}`));
            const match = stdout.match(/generated: (\d+)/);
            resolve({ generated: match ? parseInt(match[1]) : 0, log: stdout });
        });
    });
};

exports.datasetPath = (root, projectName, modelName) =>
    path.join(modelDir(root, projectName, modelName), DATASET_DIR);

// ---- Built-in annotation ----
//
// Labels are saved directly in YOLO format in dataset/labels/<split>/, the
// exact same format train.py reads — so no "sync/export" step from an
// external tool is needed; as soon as it's saved, the dataset is ready to train.

/** The image is sent as a data URL because the renderer has no fs access (contextIsolation). */
exports.readImageDataUrl = (root, projectName, modelName, split, name) => {
    const imgPath = safeJoin(modelDir(root, projectName, modelName),
                             DATASET_DIR, 'images', safeSplit(split), safeFileName(name));
    if (!fs.existsSync(imgPath)) throw new Error('Gambar tidak ditemukan: ' + name);
    const ext = path.extname(name).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,` + fs.readFileSync(imgPath).toString('base64');
};

/**
 * Write the label for one image.
 * @param {Array} shapes bbox {cls,cx,cy,w,h} or polygon {cls,poly:[x1,y1,...]}
 */
exports.saveLabels = (root, projectName, modelName, split, name, shapes) => {
    const lblDir = safeJoin(modelDir(root, projectName, modelName), DATASET_DIR, 'labels', safeSplit(split));
    ensureDir(lblDir);
    const lblPath = safeJoin(lblDir, path.parse(safeFileName(name)).name + '.txt');

    const clamp = (v) => Math.min(1, Math.max(0, v));
    const lines = (shapes || []).map((s) => {
        if (Array.isArray(s.poly) && s.poly.length >= 6) {
            return [s.cls, ...s.poly.map((v) => clamp(v).toFixed(6))].join(' ');
        }
        return [s.cls, clamp(s.cx), clamp(s.cy), clamp(s.w), clamp(s.h)]
            .map((v, i) => (i === 0 ? v : Number(v).toFixed(6))).join(' ');
    });

    // No shapes at all = the image is deliberately marked "no object".
    // The file is still written (empty) so it counts as annotated, not skipped.
    fs.writeFileSync(lblPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    return { ok: true, path: lblPath, count: lines.length };
};

// Output configuration. Besides custom code, it now also stores the device
// in use (Arduino/ESP32) and the mapping of each model class to one pin.
// The old shape { mode:'signal', script } still loads fine: mode 'signal'
// means the default OK/NG signal, with no pin mapping.
exports.saveOutputConfig = (root, projectName, cfg) => {
    const p = loadProject(root, projectName);
    const mode = ['signal', 'device', 'script'].includes(cfg && cfg.mode) ? cfg.mode : 'signal';

    const dev = (cfg && cfg.device) || {};
    const pinKelas = Array.isArray(cfg && cfg.pinKelas) ? cfg.pinKelas : [];

    p.output = {
        mode,
        // The two scripts are stored separately so switching language doesn't
        // erase the code already written in the other one.
        bahasa: (cfg && cfg.bahasa) === 'py' ? 'py' : 'js',
        script: String((cfg && cfg.script) || ''),
        scriptPy: String((cfg && cfg.scriptPy) || ''),
        device: {
            jenis: String(dev.jenis || 'arduino'),
            papan: String(dev.papan || ''),
            koneksi: String(dev.koneksi || 'usb'),
            port: String(dev.port || ''),
            baud: parseInt(dev.baud, 10) || 9600,
            // PLC-only (Modbus). Ignored for Arduino/ESP32.
            host: String(dev.host || ''),
            porta: parseInt(dev.porta, 10) || 502,
            unit: parseInt(dev.unit, 10) || 1,
            paritas: ['none', 'even', 'odd'].includes(dev.paritas) ? dev.paritas : 'none',
            stopBits: parseInt(dev.stopBits, 10) === 2 ? 2 : 1,
        },
        // Only the shape is enforced here; pin validity is checked by
        // lib/perangkat.js before it gets here.
        pinKelas: pinKelas.map((m) => ({
            model: String(m.model || ''),
            kelas: String(m.kelas || ''),
            pin: m.pin === '' || m.pin == null ? '' : String(m.pin),
            aktif: m.aktif === 'LOW' ? 'LOW' : 'HIGH',
        })).filter((m) => m.model && m.kelas),
    };
    saveProject(root, p);
    return p.output;
};

exports.saveWorkflow = (root, projectName, steps, onFirstNG) => {
    const p = loadProject(root, projectName);
    steps.forEach((s, i) => s.stepIndex = i + 1);
    p.workflow = { steps, onFirstNG: onFirstNG || 'stop_and_report' };
    saveProject(root, p);
    return p.workflow;
};
