// AutomaEyes Electron main process.
//
// Peran:
//   - Buat BrowserWindow + load HTML pages
//   - Handler IPC untuk semua backend calls (project, model, workflow, dll)
//   - Spawn Python sidecar untuk YOLO inference/training
//   - Serial ke Arduino

const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const projects = require('./lib/projects');
const workflow = require('./lib/workflow');
const arduino = require('./lib/arduino');
const inference = require('./lib/inference');
const output = require('./lib/output');
const calibration = require('./lib/calibration');
const gitsync = require('./lib/gitsync');
const userstore = require('./lib/userstore');
const appauth = require('./lib/appauth');
const github = require('./lib/github');
const updater = require('./lib/updater');
const prereq = require('./lib/prereq');

let _autoPullDone = false, _autoPullResult = null;
let _updateInfo = null;   // hasil cek versi terakhir
let _prereqOk = null;    // null = belum diperiksa
let _prereqSkipped = false;

let mainWindow;
let cfg;
let projectsRoot; // absolute path hasil resolve saat runtime (JANGAN disimpan ke config.yaml)

// ---- Config ----
// Saat TERPASANG, kode aplikasi berada di dalam app.asar yang bersifat
// read-only - menulis config.yaml ke sana gagal dengan ENOENT dan membuat
// aplikasi tidak bisa start sama sekali. Maka konfigurasi per-device
// disimpan di folder data pengguna. Saat dev tetap di sebelah kode supaya
// mudah dilihat dan diedit.
const CONFIG_PATH = app.isPackaged
    ? path.join(app.getPath('userData'), 'config.yaml')
    : path.join(__dirname, 'config.yaml');

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        // Template ikut dipaketkan di dalam asar. Membacanya boleh; yang tidak
        // boleh hanya menulis ke sana. Dibaca lalu ditulis ke tujuan yang bisa
        // ditulisi - copyFileSync lintas-asar tidak selalu didukung.
        const example = path.join(__dirname, 'config.example.yaml');
        if (fs.existsSync(example)) {
            fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
            fs.writeFileSync(CONFIG_PATH, fs.readFileSync(example, 'utf8'), 'utf8');
            console.log('[config] config.yaml dibuat dari template di ' + CONFIG_PATH);
        } else {
            throw new Error('config.example.yaml tidak ditemukan di ' + __dirname);
        }
    }
    cfg = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};

    // Config milik user bisa tertinggal versi lama atau kehilangan bagian.
    // Tanpa penambal ini, satu bagian yang hilang (mis. arduino) membuat
    // aplikasi gagal start - kegagalan yang sangat membingungkan user.
    const DEFAULTS = {
        app: { name: 'AutomaEyes', version: app.getVersion() },
        website: { url: 'https://automaeyes.my.id' },
        python: {
            exe: 'python', infer_script: 'infer.py', train_script: 'train.py',
            eval_script: 'evaluate.py', infer_server_script: 'infer_server.py',
        },
        arduino: {
            port: 'COM3', baud: 9600, ok_signal: '0', ng_signal: '1',
            signal_on_ok: false, handshake_token: '', handshake_timeout_ms: 5000,
            open_signal: 'O', close_signal: 'C',
        },
        model: { confidence: 0.35, iou: 0.45, imgsz: 640 },
        auto_calibration: { enabled: false },
        paths: { projects_root: 'projects' },
        output: { save_ok_images: false },
    };
    for (const [bagian, isi] of Object.entries(DEFAULTS)) {
        cfg[bagian] = { ...isi, ...(cfg[bagian] || {}) };
    }
    console.log(`[config] Loaded from ${CONFIG_PATH}`);
    // Resolve projects_root ke path absolut UNTUK RUNTIME saja.
    // PENTING: jangan mutasi cfg.paths.projects_root, karena saveConfig() menulis
    // cfg kembali ke config.yaml. Kalau dimutasi jadi absolut, path mesin ini akan
    // ter-hardcode lagi ke config.yaml dan app tidak portabel saat pindah PC.
    if (!cfg.paths) cfg.paths = {};
    refreshProjectsRoot();
    return cfg;
}

/**
 * Folder projects = repo GitHub milik user yang sedang connect.
 *
 * Dulu ini menunjuk ke <folder app>/projects, yang berarti dataset & model
 * semua user ikut masuk ke repo pengembang. Sekarang tiap akun GitHub punya
 * foldernya sendiri di Documents, dan folder itulah yang jadi git repo dengan
 * remote ke repo milik user.
 */
function resolveProjectsRoot() {
    const gh = userstore.getGithub();
    if (gh) {
        return path.join(app.getPath('documents'), 'AutomaEyes', gh.login);
    }
    // Belum connect GitHub — dipakai hanya sebagai placeholder; gate di
    // createWindow() mencegah halaman project dibuka sebelum connect.
    return path.join(app.getPath('userData'), 'projects-unconnected');
}

function refreshProjectsRoot() {
    projectsRoot = resolveProjectsRoot();
    if (!fs.existsSync(projectsRoot)) {
        fs.mkdirSync(projectsRoot, { recursive: true });
    }
    console.log(`[config] projects_root: ${projectsRoot}`);
    return projectsRoot;
}

function saveConfig() {
    try {
        const yamlStr = yaml.dump(cfg, { lineWidth: -1, noRefs: true });
        fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
        console.log(`[config] Saved to ${CONFIG_PATH} (${yamlStr.length} bytes)`);
        return { ok: true, path: CONFIG_PATH };
    } catch (e) {
        console.error(`[config] Save FAILED: ${e.message}`);
        return { ok: false, error: e.message };
    }
}

// ---- Window ----
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: cfg.app.name,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false, // tidak dipakai; mematikannya mengurangi permukaan serangan
            backgroundThrottling: false, // JANGAN throttle loop/kamera saat window tak fokus
        },
    });
    // Log dari halaman diteruskan ke terminal; tanpa ini, kesalahan di
    // renderer tidak terlihat sama sekali saat menjalankan lewat npm start.
    mainWindow.webContents.on('console-message', (_e, level, message) => {
        if (level >= 1) console.log('[renderer]', message);
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.maximize();   // buka dalam keadaan maximized (memenuhi layar, title bar & taskbar tetap ada)
    mainWindow.loadFile(startPage());
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

/**
 * Gate: harus login dulu, lalu connect GitHub, baru boleh masuk ke project.
 * Project disimpan di repo GitHub milik user, jadi tanpa koneksi itu belum
 * ada tempat penyimpanan yang sah untuk dataset/model-nya.
 */
function startPage() {
    // Pembaruan wajib diperiksa paling awal: kalau versi ini sudah tidak
    // didukung, melanjutkan ke login hanya akan menimbulkan kegagalan aneh
    // yang sulit ditelusuri user.
    if (_updateInfo && _updateInfo.mustUpdate) return 'renderer/pages/update.html';
    // Prasyarat Python: ditawarkan lebih dulu, tapi BOLEH dilewati - user
    // masih bisa membuka project dan pengaturan tanpa Python; yang tidak bisa
    // hanya melatih model dan menjalankan inspeksi.
    if (_prereqOk === false && !_prereqSkipped) return 'renderer/pages/setup.html';
    if (!userstore.getSession()) return 'renderer/pages/login.html';
    if (!userstore.getGithub()) return 'renderer/pages/connect-github.html';
    return 'renderer/pages/projects.html';
}

/**
 * Cek versi lalu arahkan ulang bila perlu.
 * Gagal menghubungi situs TIDAK memblokir aplikasi - lini produksi tidak
 * boleh berhenti hanya karena internet mati.
 */
async function checkUpdate(redirect = true) {
    try {
        _updateInfo = await updater.check(cfg);
        if (_updateInfo.offline) {
            console.log('[update] situs tidak terjangkau, aplikasi tetap jalan');
        } else if (_updateInfo.ok) {
            console.log(`[update] terpasang ${_updateInfo.current}, terbaru ${_updateInfo.latest}` +
                (_updateInfo.mustUpdate ? ' - WAJIB diperbarui' : _updateInfo.updateAvailable ? ' - tersedia pembaruan' : ' - sudah terbaru'));
        }
    } catch (e) {
        console.warn('[update] cek gagal:', e.message);
        _updateInfo = { ok: false, offline: true, current: app.getVersion(), error: e.message };
    }
    if (redirect && mainWindow) mainWindow.loadFile(startPage());
    return _updateInfo;
}

// Nonce sekali pakai untuk tiap alur login/otorisasi yang DIMULAI aplikasi.
// Tanpa ini, siapa pun (halaman web mana pun) bisa memanggil
// automaeye://auth?token=<token-milik-penyerang> dan membuat aplikasi korban
// masuk ke akun penyerang. Nonce dibuat sebelum browser dibuka dan wajib
// cocok saat kembali.
const _pendingNonce = { auth: null, github: null };

/** Tangani deep link automaeye://auth?token=... dari browser setelah login. */
async function handleDeepLink(url) {
    if (!url || !url.startsWith('automaeye://')) return;
    console.log('[auth] deep link diterima:', url.replace(/token=[^&]*/, 'token=***'));

    let parsed, token = null, nonce = null;
    try {
        parsed = new URL(url);
        token = parsed.searchParams.get('token');
        nonce = parsed.searchParams.get('n');
    } catch { return; /* URL tidak valid */ }
    if (!token) return;

    const kind = (parsed.host === 'github' || parsed.pathname.startsWith('//github')) ? 'github' : 'auth';
    if (!_pendingNonce[kind] || nonce !== _pendingNonce[kind]) {
        console.warn('[security] deep link ditolak: nonce tidak cocok (alur tidak dimulai dari aplikasi ini)');
        if (mainWindow) {
            mainWindow.webContents.send(kind === 'github' ? 'github:authorized' : 'auth:failed',
                kind === 'github'
                    ? { error: 'Permintaan tidak dikenali. Ulangi dari tombol di aplikasi.' }
                    : 'Permintaan tidak dikenali. Ulangi dari tombol Masuk di aplikasi.');
        }
        return;
    }
    _pendingNonce[kind] = null; // sekali pakai

    // automaeye://github = hasil "Authorize" di GitHub lewat website.
    // Host bisa terbaca sebagai 'github' atau 'auth' tergantung normalisasi URL.
    if (parsed.host === 'github' || parsed.pathname.startsWith('//github')) {
        const gh = await appauth.exchangeGithubHandoff(cfg, token);
        console.log('[github] tukar kode:', gh.ok ? `OK (@${gh.login})` : `GAGAL — ${gh.error}`);
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            if (gh.ok) {
                _pendingToken = gh.token;
                const repos = await github.listRepos(gh.token);
                mainWindow.webContents.send('github:authorized', {
                    login: gh.login,
                    repos: repos.ok ? repos.repos : [],
                    reposError: repos.ok ? null : repos.error,
                });
            } else {
                mainWindow.webContents.send('github:authorized', { error: gh.error });
            }
        }
        return;
    }

    const result = await appauth.completeLogin(cfg, token);
    console.log('[auth] hasil verifikasi:', result.ok ? `OK (${result.user.email})` : `GAGAL — ${result.error}`);
    if (mainWindow) {
        if (result.ok) {
            refreshProjectsRoot();
            mainWindow.loadFile(startPage());
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        } else {
            mainWindow.webContents.send('auth:failed', result.error);
        }
    }
}

// ---- App lifecycle ----

// Deep link automaeye:// hanya bisa ditangani kalau app-nya single instance:
// klik link di browser akan memanggil instance kedua, yang meneruskan URL-nya
// ke instance yang sudah jalan lewat event 'second-instance'.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', (_e, argv) => {
        const url = argv.find((a) => a.startsWith('automaeye://'));
        if (url) handleDeepLink(url);
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
    app.on('open-url', (e, url) => { e.preventDefault(); handleDeepLink(url); }); // macOS
}

// Content-Security-Policy untuk halaman aplikasi.
//
// Semua aset halaman bersifat lokal - tidak ada satu pun yang diambil dari
// internet - jadi 'self' sudah cukup. Ini menutup jalur paling berbahaya
// kalau suatu saat ada celah XSS: memuat skrip dari luar atau mengirim data
// keluar diam-diam. 'unsafe-inline' terpaksa diizinkan karena halaman
// memakai <script> dan style inline; menghapusnya perlu menulis ulang
// seluruh halaman, sementara pembatasan sumber sudah memberi manfaat besar.
// img-src data: dibutuhkan halaman Anotasi, yang memuat gambar sebagai data URL.
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
].join('; ');

function applyCsp() {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [CSP],
            },
        });
    });
}

app.whenReady().then(() => {
    try {
        loadConfig();
    } catch (e) {
        dialog.showErrorBox('Config error', e.message);
        app.quit();
        return;
    }

    applyCsp();

    // Daftarkan skema automaeye:// ke OS. Saat dev (dijalankan via electron.exe)
    // perlu argv eksplisit supaya Windows tahu cara memanggil balik app-nya.
    if (process.defaultApp && process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('automaeye', process.execPath, [path.resolve(process.argv[1])]);
    } else {
        app.setAsDefaultProtocolClient('automaeye');
    }
    // Init services (non-fatal if fail)
    arduino.init(cfg.arduino).catch(err => console.warn('[arduino]', err.message));

    createWindow();

    // Cek versi di latar; halaman diarahkan ulang begitu hasilnya tiba.
    checkUpdate();

    // Prasyarat Python diperiksa sekali saat start.
    prereq.check(cfg).then((r) => {
        _prereqOk = r.ok;
        console.log('[prereq] python:', r.python.found ? r.python.version : 'tidak ada',
                    '| kurang:', r.missing.length ? r.missing.join(', ') : '-');
        if (!r.ok && mainWindow && !_prereqSkipped) mainWindow.loadFile(startPage());
    }).catch((e) => console.warn('[prereq]', e.message));

    // Cold start lewat deep link: Windows menaruh URL-nya di argv proses ini.
    const coldUrl = process.argv.find((a) => a.startsWith('automaeye://'));
    if (coldUrl) handleDeepLink(coldUrl);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    arduino.close();
    inference.stopInferServer();
    if (process.platform !== 'darwin') app.quit();
});

// ================================================================
// IPC handlers — dipanggil dari renderer via preload.js
// ================================================================

// ---- Config ----
ipcMain.handle('config:get', () => cfg);
ipcMain.handle('config:set', (_, patch) => {
    // Deep merge: kalau patch berisi nested object (arduino, model, dll),
    // merge per-field bukan replace whole object
    for (const k of Object.keys(patch)) {
        if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && cfg[k]) {
            cfg[k] = { ...cfg[k], ...patch[k] };
        } else {
            cfg[k] = patch[k];
        }
    }
    // Persist ke config.yaml supaya tetap ada di session berikutnya
    const saveResult = saveConfig();
    return { ...cfg, __save: saveResult };
});

// ---- Projects ----
ipcMain.handle('projects:list', () => projects.list(projectsRoot));
ipcMain.handle('projects:create', (_, { name, description }) =>
    projects.create(projectsRoot, name, description));
ipcMain.handle('projects:load', (_, name) =>
    projects.load(projectsRoot, name));
ipcMain.handle('projects:delete', (_, name) =>
    projects.delete(projectsRoot, name));

// ---- Models ----
ipcMain.handle('models:create', (_, { project, name, aiType, addons, classes, addonConfig }) =>
    projects.addModel(projectsRoot, project, { name, aiType, addons, classes, addonConfig }));
ipcMain.handle('models:update', (_, { project, name, patch }) =>
    projects.updateModel(projectsRoot, project, name, patch));
ipcMain.handle('models:delete', (_, { project, name }) =>
    projects.deleteModel(projectsRoot, project, name));
ipcMain.handle('models:listImages', (_, { project, model, split }) =>
    projects.listImages(projectsRoot, project, model, split || 'train'));
ipcMain.handle('models:galleryData', (_, { project, model, split }) =>
    projects.listImagesWithLabels(projectsRoot, project, model, split || 'train'));
ipcMain.handle('models:stats', (_, { project, model }) =>
    projects.modelStats(projectsRoot, project, model));

// Import existing .pt file (file picker + copy)
ipcMain.handle('models:importPt', async (_, { project, model }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Pilih file .pt (YOLO weights)',
        filters: [{ name: 'PyTorch model', extensions: ['pt'] }],
        properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return projects.importPt(projectsRoot, project, model, result.filePaths[0]);
});

// ---- Dataset ops ----
ipcMain.handle('dataset:upload', async (_, { project, model, paths: filePaths }) =>
    projects.importImages(projectsRoot, project, model, filePaths));
ipcMain.handle('dataset:deleteImages', (_, { project, model, names }) =>
    projects.deleteDatasetImages(projectsRoot, project, model, names));
ipcMain.handle('dataset:pickFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Pilih gambar dataset',
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }],
        properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('dataset:augment', (event, { project, model, opts }) =>
    projects.augmentDataset(projectsRoot, project, model, opts, cfg.python,
        (p) => event.sender.send('augment:progress', { project, model, ...p })));
ipcMain.handle('dataset:split', (_, { project, model, ratios }) =>
    projects.splitDataset(projectsRoot, project, model, ratios));
ipcMain.handle('dataset:cleanRebuild', (_, { project, model, ratios }) =>
    projects.cleanRebuildDataset(projectsRoot, project, model, ratios));

// ---- Anotasi bawaan ----
//
// Anotasi dikerjakan sendiri di renderer/js/annotator.js: tidak ada
// server, tidak ada token, tidak ada langkah export/sync — label langsung
// ditulis ke dataset/labels/ dalam format YOLO yang dibaca train.py.

ipcMain.handle('annot:list', (_, { project, model, split }) =>
    projects.listImagesWithLabels(projectsRoot, project, model, split || 'train'));

ipcMain.handle('annot:image', (_, { project, model, split, name }) => {
    try {
        return { ok: true, dataUrl: projects.readImageDataUrl(projectsRoot, project, model, split || 'train', name) };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('annot:save', (_, { project, model, split, name, shapes }) => {
    try {
        return projects.saveLabels(projectsRoot, project, model, split || 'train', name, shapes);
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('dataset:openFolder', (_, { project, model }) =>
    shell.openPath(projects.datasetPath(projectsRoot, project, model)));

// ---- Training ----
ipcMain.handle('training:start', async (event, { project, model, resume }) => {
    let lastMetrics = {};
    return inference.startTraining(cfg, projectsRoot, project, model, (progress) => {
        if (progress.finalMAP != null) lastMetrics = { mAP: progress.finalMAP, P: progress.finalP, R: progress.finalR };
        // Training sukses → snapshot jadi VERSI baru (v1, v2, ...).
        if (progress.done && progress.exitCode === 0) {
            try { progress.version = projects.snapshotVersion(projectsRoot, project, model, lastMetrics); }
            catch (e) { console.warn('[version] snapshot gagal:', e.message); }
        }
        event.sender.send('training:progress', { project, model, progress });
    }, { resume: !!resume });
});
// Set versi aktif model (default kalau workflow tak pilih versi).
ipcMain.handle('models:setActiveVersion', (_e, { project, model, versionId }) =>
    projects.setActiveVersion(projectsRoot, project, model, versionId));
ipcMain.handle('training:cancel', () => inference.cancelTraining());
ipcMain.handle('training:loadHistory', (_e, { project, model }) =>
    inference.loadTrainHistory(projectsRoot, project, model));

// ---- Sinkronisasi GitHub (Save/Load) ----
// Sinkronisasi jalan di folder projects milik user + token GitHub-nya sendiri.
const ghToken = () => (userstore.getGithub() || {}).token || null;

ipcMain.handle('git:status', () => gitsync.status(projectsRoot));
ipcMain.handle('git:push', (_e, { message } = {}) => gitsync.push(projectsRoot, message, ghToken()));
ipcMain.handle('git:pull', () => gitsync.pull(projectsRoot, ghToken()));
ipcMain.handle('git:conflictInfo', () => gitsync.conflictInfo(projectsRoot, ghToken()));
ipcMain.handle('git:resolveConflict', (_e, { choice, branchName }) =>
    gitsync.resolveConflict(projectsRoot, ghToken(), choice, branchName));
ipcMain.handle('app:quit', () => { app.quit(); });
// Auto-load versi terbaru sekali saja saat app pertama dibuka.
ipcMain.handle('git:autoPullOnce', async () => {
    if (_autoPullDone) return { skipped: true, result: _autoPullResult };
    if (!userstore.getGithub()) return { skipped: true, result: null };
    _autoPullDone = true;
    try {
        _autoPullResult = await gitsync.pull(projectsRoot, ghToken());
    } catch (e) {
        _autoPullResult = { ok: false, log: String(e && e.message || e) };
    }
    return { skipped: false, result: _autoPullResult };
});

// ---- Prasyarat Python ----
ipcMain.handle('prereq:check', async () => {
    const r = await prereq.check(cfg);
    _prereqOk = r.ok;
    return { ...r, pythonUrl: prereq.pythonDownloadUrl() };
});
ipcMain.handle('prereq:install', async (event) => {
    const r = await prereq.installPackages(cfg, (line) => {
        if (!event.sender.isDestroyed()) event.sender.send('prereq:log', line);
    });
    if (r.ok) _prereqOk = (await prereq.check(cfg)).ok;
    return r;
});
ipcMain.handle('prereq:done', () => {
    _prereqOk = true;
    if (mainWindow) mainWindow.loadFile(startPage());
    return { ok: true };
});
ipcMain.handle('prereq:skip', () => {
    // Hanya untuk sesi ini: kalau aplikasi dibuka lagi dan prasyarat masih
    // kurang, tawarannya muncul lagi - bukan didiamkan selamanya.
    _prereqSkipped = true;
    if (mainWindow) mainWindow.loadFile(startPage());
    return { ok: true };
});

// ---- Pembaruan aplikasi ----
ipcMain.handle('update:info', () => _updateInfo || { ok: false, current: app.getVersion() });
ipcMain.handle('update:recheck', () => checkUpdate(true));

// ---- Login website ----
ipcMain.handle('auth:status', () => ({
    session: userstore.getSession(),
    github: (() => {
        const gh = userstore.getGithub();
        return gh ? { login: gh.login, repo: gh.repo, repoUrl: gh.repoUrl } : null;
    })(),
    projectsRoot,
}));
ipcMain.handle('auth:login', () => {
    _pendingNonce.auth = require('crypto').randomBytes(16).toString('hex');
    return appauth.startLogin(cfg, _pendingNonce.auth);
});
ipcMain.handle('auth:logout', () => {
    appauth.logout();
    refreshProjectsRoot();
    _autoPullDone = false;
    if (mainWindow) mainWindow.loadFile(startPage());
    return { ok: true };
});

// ---- Koneksi GitHub (OAuth lewat website) ----
let _pendingToken = null; // token GitHub hasil Authorize, sebelum user memilih repo

// Otorisasi GitHub lewat website (OAuth). Tidak butuh Client ID di aplikasi.
ipcMain.handle('github:authorize', () => {
    _pendingNonce.github = require('crypto').randomBytes(16).toString('hex');
    return appauth.startGithubAuthorize(cfg, _pendingNonce.github);
});

/** Simpan koneksi + siapkan folder projects sebagai git repo ke repo pilihan user. */
ipcMain.handle('github:connect', async (_e, { repoName, createNew, isPrivate }) => {
    const token = _pendingToken || ghToken();
    console.log('[github:connect] _pendingToken:', _pendingToken ? `ada (${_pendingToken.length} char)` : 'null',
                '| ghToken():', ghToken() ? 'ada' : 'null');
    if (!token) return { ok: false, error: 'Belum ada token GitHub. Ulangi Connect.' };

    const user = await github.getUser(token);
    if (!user.ok) return { ok: false, error: user.error };

    let repoUrl, finalName;
    if (createNew) {
        const created = await github.createRepo(token, repoName, isPrivate !== false);
        if (!created.ok) return { ok: false, error: created.error };
        repoUrl = created.repo.cloneUrl;
        finalName = created.repo.fullName;
    } else {
        const repos = await github.listRepos(token);
        if (!repos.ok) return { ok: false, error: repos.error };
        const match = repos.repos.find((r) => r.name === repoName || r.fullName === repoName);
        if (!match) return { ok: false, error: `Repo "${repoName}" tidak ditemukan di akun ${user.login}.` };
        repoUrl = match.cloneUrl;
        finalName = match.fullName;
    }

    userstore.setGithub({ login: user.login, repo: finalName, repoUrl, token });
    _pendingToken = null;
    refreshProjectsRoot();

    const conn = await gitsync.connect(projectsRoot, repoUrl, token);
    if (!conn.ok) {
        userstore.clearGithub();
        refreshProjectsRoot();
        return { ok: false, error: conn.log };
    }
    return { ok: true, login: user.login, repo: finalName, projectsRoot, log: conn.log };
});

// Daftar repo memakai token yang SUDAH tersimpan - dipakai fitur "Ganti repo"
// supaya user tidak perlu Authorize ulang hanya untuk pindah tempat simpan.
ipcMain.handle('github:repos', async () => {
    const t = ghToken();
    if (!t) return { ok: false, error: 'Belum tersambung ke GitHub.' };
    return github.listRepos(t);
});

ipcMain.handle('github:disconnect', () => {
    userstore.clearGithub();
    refreshProjectsRoot();
    _autoPullDone = false;
    return { ok: true };
});

// ---- Evaluasi / Test model ----
ipcMain.handle('eval:run', async (event, { project, model, split }) =>
    inference.evaluate(cfg, projectsRoot, project, model, split, (p) =>
        event.sender.send('eval:progress', { project, model, ...p })));
ipcMain.handle('eval:openDir', (_, { dir }) => shell.openPath(dir));

// ---- Workflow ----
ipcMain.handle('workflow:save', (_, { project, steps, onFirstNG }) =>
    projects.saveWorkflow(projectsRoot, project, steps, onFirstNG));

// ---- Run / Inference ----
ipcMain.handle('run:inspect', async (_, { project, imageDataUrl, opts }) => {
    // imageDataUrl = "data:image/jpeg;base64,..."
    const proj = projects.load(projectsRoot, project);
    return workflow.execute(cfg, proj, imageDataUrl, arduino, output, opts || {});
});

// Kirim satu sinyal Arduino/PLC untuk SATU part (dipakai mode tracking:
// verdict dikirim sekali per part, bukan tiap frame).
ipcMain.handle('arduino:signal', async (_, { verdict }) => {
    try {
        const ng = verdict === 'NG';
        const sig = ng ? cfg.arduino.ng_signal : cfg.arduino.ok_signal;
        if (ng || cfg.arduino.signal_on_ok) await arduino.send(String(sig));
        return { ok: true, sent: ng || cfg.arduino.signal_on_ok };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// Simpan foto BER-OVERLAY (measurement + verdict) dari renderer, mode tracking.
ipcMain.handle('run:saveAnnotated', (_, { project, imageDataUrl, result }) => {
    try {
        const proj = projects.load(projectsRoot, project);
        const base64 = String(imageDataUrl || '').replace(/^data:image\/[^;]+;base64,/, '');
        const saved = output.record(proj, base64, result || { finalVerdict: 'NG', steps: [] }, cfg);
        return { ok: true, imgPath: saved.imgPath };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// Gate open/close (mode tracking): 'O' saat part terdeteksi+diukur, 'C' saat part keluar frame.
ipcMain.handle('arduino:gate', async (_, { kind }) => {
    try {
        let sig = kind === 'open' ? (cfg.arduino.open_signal || 'O') : (cfg.arduino.close_signal || 'C');
        sig = String(sig);
        if (!sig.endsWith('\n')) sig += '\n';
        const r = await arduino.send(sig);
        return { ok: !!(r && r.ok), sig: sig.trim(), reason: r && r.reason };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// Status koneksi Arduino/Wemos (untuk indikator di halaman Run).
ipcMain.handle('arduino:status', () => {
    try {
        const conn = arduino.connectedPort ? arduino.connectedPort() : null;
        return { ...arduino.status(), port: conn || (cfg.arduino && cfg.arduino.port), baud: cfg.arduino && cfg.arduino.baud };
    } catch (e) { return { connected: false, error: e.message }; }
});

// Daftar COM port yang tersedia (untuk dropdown pemilihan).
ipcMain.handle('arduino:listPorts', async () => {
    try { return await arduino.listPorts(); } catch (e) { return []; }
});

// Set COM port (mis. dari dropdown) → simpan ke config & reconnect.
ipcMain.handle('arduino:setPort', async (_, { port }) => {
    try {
        cfg.arduino.port = port || 'auto';
        saveConfig();
        arduino.close();
        await arduino.init(cfg.arduino);
        const conn = arduino.connectedPort ? arduino.connectedPort() : null;
        return { ok: true, ...arduino.status(), port: conn || cfg.arduino.port, baud: cfg.arduino.baud };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// Buka ulang port serial (auto-deteksi COM). Dipakai setelah Serial Monitor ditutup / ganti kabel.
ipcMain.handle('arduino:reconnect', async () => {
    try {
        arduino.close();
        await arduino.init(cfg.arduino);
        const conn = arduino.connectedPort ? arduino.connectedPort() : null;
        return { ok: true, ...arduino.status(), port: conn || cfg.arduino.port, baud: cfg.arduino.baud };
    } catch (e) {
        return { ok: false, error: e.message, port: cfg.arduino && cfg.arduino.port };
    }
});

// ---- Auto-Calibration ----
ipcMain.handle('calibration:run', async (event, { project, model }) => {
    if (!cfg.auto_calibration || !cfg.auto_calibration.enabled) {
        throw new Error('Auto-Calibration belum diaktifkan. Buka Settings → aktifkan.');
    }
    const proj = projects.load(projectsRoot, project);
    const m = proj.models.find(x => x.name === model);
    if (!m) throw new Error('Model tidak ditemukan: ' + model);
    const res = await calibration.calibrate(cfg, m.dir, m.classes, (p) => {
        event.sender.send('calibration:progress', { project, model, ...p });
    });
    // Terapkan hasil kalibrasi ke config & simpan.
    cfg.model = { ...cfg.model, confidence: res.bestConf };
    saveConfig();
    return res;
});

// Laporan harian (statistik murni, tanpa LLM) — dipakai tombol di halaman project.
ipcMain.handle('report:dailyXlsx', (_, { project, date }) => {
    try {
        const xlsxlite = require('./lib/xlsxlite');
        const p = projects.load(projectsRoot, project);
        const s = output.dailySummary(p.dir, date) || {};
        const outDir = path.join(p.dir, 'outputs');
        fs.mkdirSync(outDir, { recursive: true });
        const xlsxPath = path.join(outDir, `laporan_${date}.xlsx`);
        const rows = [
            [`Laporan Inspeksi — ${project}`],
            ['Tanggal', date],
            [],
            ['Metrik', 'Nilai'],
            ['Total unit', s.total || 0],
            ['OK', s.ok || 0],
            ['NG', s.ng || 0],
            ['Success rate (%)', s.total ? Number((s.ok / s.total * 100).toFixed(2)) : 0],
            ['Waktu siklus rata-rata (ms)', Number((s.avgCycleMS || 0).toFixed(1))],
            [],
            ['NG per step', 'Jumlah'],
            ...Object.entries(s.byStep || {}).map(([k, v]) => [k, v]),
        ];
        xlsxlite.write(xlsxPath, 'Laporan', rows);
        return { ok: true, xlsxPath, summary: s };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});
ipcMain.handle('file:open', (_, p) => shell.openPath(p));
// openPath() hanya untuk file lokal; URL harus lewat openExternal().
// Dibatasi http/https: tanpa ini, renderer yang disusupi bisa meminta OS
// membuka skema lain (file:, ms-msdt:, dsb) — jalur eksekusi kode klasik.
ipcMain.handle('shell:openExternal', (_, url) => {
    let u;
    try { u = new URL(String(url)); } catch { return { ok: false, error: 'URL tidak valid' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        console.warn('[security] openExternal ditolak untuk skema:', u.protocol);
        return { ok: false, error: 'Hanya http/https yang diizinkan' };
    }
    shell.openExternal(u.href);
    return { ok: true };
});

// Excel data deteksi: 1 baris/part (ID, link gambar, Kotak 1-8 P×L, Lubang 1-6 Ø, waktu deteksi).
ipcMain.handle('report:detectionXlsx', (_, { project, date }) => {
    try {
        const xlsxlite = require('./lib/xlsxlite');
        const detreport = require('./lib/detreport');
        const p = projects.load(projectsRoot, project);
        const { rows, count, dir } = detreport.buildRows(p.dir, date, { nBox: 8, nHole: 6 });
        const outDir = path.join(p.dir, 'outputs');
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, `deteksi_${date}.xlsx`);
        xlsxlite.write(outPath, 'Deteksi', rows);
        return { ok: true, xlsxPath: outPath, count, dir };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});
// ---- Output kustom (kode buatan user) ----
const customoutput = require('./lib/customoutput');
ipcMain.handle('output:get', (_, { project }) => {
    const p = projects.load(projectsRoot, project);
    const out = p.output || {};
    return { mode: out.mode || 'signal', script: out.script || customoutput.DEFAULT_SCRIPT };
});
ipcMain.handle('output:save', (_, { project, mode, script }) =>
    projects.saveOutputConfig(projectsRoot, project, mode, script));
ipcMain.handle('output:test', (_, { script, verdict }) =>
    customoutput.test(script, arduino, verdict));

// ---- Navigation ----
ipcMain.handle('nav:go', (_, page) => {
    // page bisa berisi query string, contoh: "project.html?name=Foo"
    const [filePart, queryPart] = String(page).split('?');
    const target = path.join(__dirname, 'renderer/pages', filePart);
    if (!fs.existsSync(target)) {
        console.warn(`[nav:go] File tidak ada: ${target}`);
        return { ok: false, error: 'file not found' };
    }
    const opts = {};
    if (queryPart) {
        const params = new URLSearchParams(queryPart);
        const query = {};
        for (const [k, v] of params) query[k] = v;
        opts.query = query;
    }
    mainWindow.loadFile(target, opts);
    return { ok: true };
});
