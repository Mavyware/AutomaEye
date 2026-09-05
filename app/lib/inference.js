// Inference & training orchestrator — spawn Python subprocess.
// Communication:
//   - Inference: 1-shot HTTP request to the Python sidecar (auto-started on demand)
//   - Training: streaming stdout parse progress

const { pythonScript, pythonDir } = require('./paths');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

let currentTraining = null;
let inferServer = null; // { child, port }

// Cross-device portability: data.yaml often stores an absolute `path:` from
// the machine the dataset was created on (e.g. C:/Users/LAB-AI-05/...). If the
// project is pulled to another device, that path is invalid → training/evaluation
// errors out and the charts don't show up. This function rewrites the `path:`
// line to the dataset location on the CURRENT device, without touching the
// other lines (train/val/test/nc/names). Called before training & eval.
function syncDataYamlPath(dataYaml, datasetDir) {
    try {
        if (!fs.existsSync(dataYaml)) return;
        const local = datasetDir.replace(/\\/g, '/');
        const lines = fs.readFileSync(dataYaml, 'utf8').split(/\r?\n/);
        let found = false;
        const fixed = lines.map(l => {
            if (/^\s*path\s*:/.test(l)) { found = true; return `path: ${local}`; }
            return l;
        });
        if (!found) fixed.unshift(`path: ${local}`);
        fs.writeFileSync(dataYaml, fixed.join('\n'));
    } catch (_) { /* non-fatal: let Python report it if it's actually broken */ }
}

// ---- Persistent YOLO inference SERVER ----
// Model & torch are loaded ONCE and stay alive → eliminates the ~6s/frame lag
// that used to happen from reloading torch+model on every call.
// inferServer = { child, pending: Map<id,{resolve,reject}>, nextId, buffer, ready: Promise }

function startInferServer(cfg) {
    if (inferServer && inferServer.child && !inferServer.child.killed) return inferServer.ready;

    const script = pythonScript((cfg.python && cfg.python.infer_server_script), 'infer_server.py');
    const child = spawn((cfg.python && cfg.python.exe) || 'python', [script], { cwd: pythonDir() });
    const srv = { child, pending: new Map(), nextId: 1, buffer: '' };

    srv.ready = new Promise((resolve, reject) => {
        let readied = false;
        child.stdout.on('data', d => {
            srv.buffer += d.toString();
            let idx;
            while ((idx = srv.buffer.indexOf('\n')) >= 0) {
                const line = srv.buffer.slice(0, idx).trim();
                srv.buffer = srv.buffer.slice(idx + 1);
                if (!line) continue;
                if (line.startsWith('@@READY@@')) { readied = true; resolve(); continue; }
                if (line.startsWith('@@RESP@@')) {
                    try {
                        const obj = JSON.parse(line.slice(8).trim());
                        const p = srv.pending.get(obj.id);
                        if (p) {
                            srv.pending.delete(obj.id);
                            if (obj.error) p.reject(new Error(obj.error)); else p.resolve(obj);
                        } else if (obj.error && !readied) {
                            reject(new Error(obj.error));   // dependency load failed at startup
                        }
                    } catch (_) { /* non-JSON lines are ignored */ }
                }
            }
        });
        child.stderr.on('data', () => { /* ultralytics/torch logs — ignore */ });
        child.on('close', code => {
            inferServer = null;
            const err = new Error(`infer server berhenti (code ${code})`);
            srv.pending.forEach(p => p.reject(err));
            srv.pending.clear();
            if (!readied) reject(err);
        });
        child.on('error', err => { inferServer = null; if (!readied) reject(err); });
    });

    inferServer = srv;
    return srv.ready;
}

// image = base64 JPEG string, weightsPath = path to best.pt
// returns { detections: [...], verdict: 'OK'|'NG', inferenceMS }
exports.inferOnce = async (cfg, weightsPath, imageBase64, classes, thresholds) => {
    await startInferServer(cfg);
    const srv = inferServer;
    if (!srv || !srv.child || srv.child.killed) throw new Error('infer server tidak tersedia');

    const id = srv.nextId++;
    const req = {
        id, weights: weightsPath,
        conf: thresholds.confidence || 0.35,
        iou: thresholds.iou || 0.45,
        imgsz: thresholds.imgsz || 640,
        classes: classes || [],
        image: imageBase64,
        // Extra CV analysis (color/scratches/codes/text) is only requested when
        // its add-on is actually used - other frames don't pay its cost.
        analyze: thresholds.analyze || [],
    };
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            srv.pending.delete(id);
            reject(new Error('infer timeout (60s)'));
        }, 60000);
        srv.pending.set(id, {
            resolve: v => { clearTimeout(timer); resolve(v); },
            reject: e => { clearTimeout(timer); reject(e); },
        });
        try { srv.child.stdin.write(JSON.stringify(req) + '\n'); }
        catch (e) { clearTimeout(timer); srv.pending.delete(id); reject(e); }
    });
};

// Shut down the inference server (called when the app quits).
exports.stopInferServer = () => {
    if (inferServer && inferServer.child) {
        try { inferServer.child.kill(); } catch (_) { }
    }
    inferServer = null;
};

// ---- Training ----
exports.startTraining = (cfg, root, projectName, modelName, onProgress, opts = {}) => {
    if (currentTraining) throw new Error(`Training ${currentTraining.model} masih berjalan`);

    const modelDir = path.join(root, projectName, 'models', modelName);
    const dataYaml = path.join(modelDir, 'dataset', 'data.yaml');
    // Auto-fix the dataset path for this device (portable across PCs/laptops).
    syncDataYamlPath(dataYaml, path.join(modelDir, 'dataset'));
    const project = JSON.parse(fs.readFileSync(path.join(root, projectName, 'project.json'), 'utf8'));
    const m = project.models.find(x => x.name === modelName);
    if (!m) throw new Error('Model not found');

    const args = [
        pythonScript(cfg.python.train_script, 'train.py'),
        '--project', projectName,
        '--project-dir', path.join(root, projectName),
        '--model', modelName,
        '--model-dir', modelDir,
        '--data', dataYaml,
        '--epochs', String(m.training.epochs),
        '--batch', String(m.training.batch),
        '--imgsz', String(m.training.imgsz),
        '--lr', String(m.training.lr),
        '--type', m.type,
    ];
    if (opts && opts.resume) args.push('--resume');
    const py = spawn(cfg.python.exe || 'python', args, { cwd: pythonDir() });
    currentTraining = { model: modelName, py };

    let logBuf = '';                       // save the log to show if there's an error
    let curEpoch = 0, totEpoch = 0, curBatch = 0, totBatch = 0;
    // Ultralytics updates lines using carriage-return (\r), so split on \r too.
    const handle = (text) => {
        onProgress({ log: text });
        logBuf = (logBuf + text).slice(-4000);
        text.split(/[\r\n]+/).forEach(line => {
            // Per-epoch metrics (JSON) for the dashboard: "EPOCH_METRICS {...}"
            const jm = line.match(/EPOCH_METRICS\s+(\{.*\})/);
            if (jm) { try { onProgress({ epochMetrics: JSON.parse(jm[1]) }); } catch (_) {} }

            // Per-epoch progress from train.py: "PROGRESS_EPOCH 5/100"
            const pe = line.match(/PROGRESS_EPOCH\s+(\d+)\/(\d+)/i);
            if (pe) { curEpoch = +pe[1]; totEpoch = +pe[2]; onProgress({ epoch: curEpoch, total: totEpoch, batch: 0, nb: totBatch }); }

            // Ultralytics progress line: "  1/100   0G  1.58 ... 640:  58% ...  7/12  1.5s/it"
            const em = line.match(/(\d+)\/(\d+)\s+[\d.]+G\b/);              // epoch/total + GPU_mem
            const bm = line.match(/(\d+)\/(\d+)\s+[\d.]+\s*(?:s\/it|it\/s)/); // batch/total + speed
            if (em) { curEpoch = +em[1]; totEpoch = +em[2]; }
            if (bm) { curBatch = +bm[1]; totBatch = +bm[2]; }
            if (em || bm) onProgress({ epoch: curEpoch, total: totEpoch, batch: curBatch, nb: totBatch });

            const m2 = line.match(/results mAP50:\s*([\d.]+)\s+P:\s*([\d.]+)\s+R:\s*([\d.]+)/i);
            if (m2) onProgress({ finalMAP: +m2[1], finalP: +m2[2], finalR: +m2[3] });

            // Classification has no mAP/precision/recall. Its summary is
            // reported as top-1/top-5 accuracy, and deliberately sent
            // under its own name so no number ends up stored under the
            // wrong label.
            const m3 = line.match(/results top1:\s*([\d.]+)\s+top5:\s*([\d.]+)/i);
            if (m3) onProgress({ finalTop1: +m3[1], finalTop5: +m3[2] });
        });
    };

    py.stdout.on('data', d => handle(d.toString()));
    py.stderr.on('data', d => handle(d.toString()));
    py.on('error', err => {
        currentTraining = null;
        onProgress({ done: true, exitCode: -1, errorLog: `Gagal jalankan python: ${err.message}` });
    });
    py.on('close', code => {
        currentTraining = null;
        onProgress({ done: true, exitCode: code, errorLog: code === 0 ? '' : logBuf.slice(-1800) });
    });

    return { status: 'started', model: modelName };
};

exports.cancelTraining = () => {
    if (!currentTraining) return { status: 'idle' };
    currentTraining.py.kill();
    currentTraining = null;
    return { status: 'cancelled' };
};

exports.trainingStatus = () =>
    currentTraining ? { running: true, model: currentTraining.model } : { running: false };

// Read results.csv from the last run → an array of per-epoch metrics to pre-fill the chart,
// plus whether a checkpoint (last.pt) exists that can be resumed, and up to which epoch.
exports.loadTrainHistory = (root, projectName, modelName) => {
    const modelDir = path.join(root, projectName, 'models', modelName);
    const csv = path.join(modelDir, 'runs', 'train', 'results.csv');
    const lastPt = path.join(modelDir, 'runs', 'train', 'weights', 'last.pt');
    const out = { rows: [], hasCheckpoint: fs.existsSync(lastPt), lastEpoch: 0, totalEpochs: 0 };

    try {
        const project = JSON.parse(fs.readFileSync(path.join(root, projectName, 'project.json'), 'utf8'));
        const m = project.models.find(x => x.name === modelName);
        if (m && m.training) out.totalEpochs = m.training.epochs || 0;
    } catch (_) {}

    if (!fs.existsSync(csv)) return out;
    try {
        const lines = fs.readFileSync(csv, 'utf8').trim().split(/\r?\n/);
        const header = lines[0].split(',').map(s => s.trim());
        const idx = (name) => header.indexOf(name);
        const iEp = idx('epoch');
        const iP = idx('metrics/precision(B)'), iR = idx('metrics/recall(B)');
        const iMap = idx('metrics/mAP50(B)'), iMap95 = idx('metrics/mAP50-95(B)');
        const iBox = idx('train/box_loss'), iCls = idx('train/cls_loss'), iDfl = idx('train/dfl_loss');
        const iVBox = idx('val/box_loss'), iVCls = idx('val/cls_loss'), iVDfl = idx('val/dfl_loss');
        for (let i = 1; i < lines.length; i++) {
            const c = lines[i].split(',');
            if (c.length < header.length) continue;
            const num = j => (j >= 0 ? (parseFloat(c[j]) || 0) : 0);
            const prec = num(iP), rec = num(iR);
            const f1 = (prec + rec) ? (2 * prec * rec) / (prec + rec) : 0;
            out.rows.push({
                epoch: num(iEp), precision: prec, recall: rec,
                mAP50: num(iMap), mAP5095: num(iMap95),
                boxLoss: num(iBox), clsLoss: num(iCls), dflLoss: num(iDfl), f1,
                valBox: num(iVBox), valCls: num(iVCls), valDfl: num(iVDfl),
            });
        }
        if (out.rows.length) out.lastEpoch = out.rows[out.rows.length - 1].epoch;
    } catch (_) {}
    return out;
};


// ---- Evaluate a model on a split (Test tab) ----
// Spawn python/evaluate.py, parse "EVAL_RESULT {json}" from stdout.
exports.evaluate = (cfg, root, projectName, modelName, split, onProgress) => new Promise((resolve, reject) => {
    const modelDir = path.join(root, projectName, 'models', modelName);
    const weights = path.join(modelDir, 'weights', 'best.pt');
    if (!fs.existsSync(weights)) {
        return reject(new Error('Model belum punya weights/best.pt. Train atau import model dulu.'));
    }
    const dataYaml = path.join(modelDir, 'dataset', 'data.yaml');
    if (!fs.existsSync(dataYaml)) {
        return reject(new Error('data.yaml tidak ada. Buat/annotate dataset dulu.'));
    }
    // Auto-fix the dataset path for this device (portable across PCs/laptops).
    syncDataYamlPath(dataYaml, path.join(modelDir, 'dataset'));
    const outDir = path.join(modelDir, 'eval');
    const args = [
        pythonScript(cfg.python.eval_script, 'evaluate.py'),
        '--weights', weights,
        '--data', dataYaml,
        '--split', split || 'test',
        '--out', outDir,
        '--imgsz', String((cfg.model && cfg.model.imgsz) || 640),
        '--conf', String((cfg.model && cfg.model.confidence) || 0.25),
        '--iou', String((cfg.model && cfg.model.iou) || 0.45),
    ];
    const py = spawn(cfg.python.exe || 'python', args, { cwd: pythonDir() });
    let out = '', err = '', result = null;
    py.stdout.on('data', d => {
        const t = d.toString(); out += t;
        t.split(/\r?\n/).forEach(line => {
            const m = line.match(/EVAL_RESULT\s+(\{.*\})/);
            if (m) { try { result = JSON.parse(m[1]); } catch (_) {} }
            else if (line.trim() && onProgress) onProgress({ log: line });
        });
    });
    py.stderr.on('data', d => { const t = d.toString(); err += t; if (onProgress) onProgress({ log: t }); });
    py.on('error', e => reject(new Error('Gagal jalankan python: ' + e.message)));
    py.on('close', code => {
        if (result) resolve(result);
        else reject(new Error(`Evaluasi gagal (exit ${code}): ${(err.slice(-800) || out.slice(-800) || 'no output')}`));
    });
});
