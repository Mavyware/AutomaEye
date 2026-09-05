// AutomaEyes Electron main process.
//
// Role:
//   - Create the BrowserWindow + load HTML pages
//   - IPC handlers for all backend calls (project, model, workflow, etc.)
//   - Spawn the Python sidecar for YOLO inference/training
//   - Serial connection to the Arduino

const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const projects = require('./lib/projects');
const perangkat = require('./lib/perangkat');
const pyoutput = require('./lib/pyoutput');
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
const keamanan = require('./lib/keamanan');

let _autoPullDone = false, _autoPullResult = null;
let _updateInfo = null;   // result of the last version check
let _prereqOk = null;    // null = not checked yet
let _prereqSkipped = false;

let mainWindow;
// true only during a page transition already approved by the guard,
// so beforeunload doesn't cancel it again.
let pindahDisetujui = false;
let cfg;
let projectsRoot; // absolute path resolved at runtime (do NOT save it to config.yaml)

// ---- Config ----
// Once INSTALLED, the app's code lives inside app.asar, which is read-only -
// writing config.yaml there fails with ENOENT and makes the app unable to
// start at all. So per-device configuration is stored in the user data
// folder. In dev it stays next to the code so it's easy to view and edit.
const CONFIG_PATH = app.isPackaged
    ? path.join(app.getPath('userData'), 'config.yaml')
    : path.join(__dirname, 'config.yaml');

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        // The template is bundled inside the asar. Reading it is fine; what's
        // not allowed is writing to it. It's read then written to a writable
        // destination - copyFileSync across asar isn't always supported.
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

    // The user's config might be an old version or missing a section.
    // Without this patch, one missing section (e.g. arduino) would make the
    // app fail to start - a failure that would be very confusing to the user.
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
    // Resolve projects_root to an absolute path FOR RUNTIME ONLY.
    // IMPORTANT: don't mutate cfg.paths.projects_root, because saveConfig() writes
    // cfg back to config.yaml. If it were mutated to an absolute path, this machine's
    // path would get hardcoded into config.yaml and the app wouldn't be portable across PCs.
    if (!cfg.paths) cfg.paths = {};
    refreshProjectsRoot();
    return cfg;
}

/**
 * Projects folder = the GitHub repo the currently-connected user owns.
 *
 * This used to point to <app folder>/projects, which meant every user's
 * dataset & model ended up in the developer's repo. Now each GitHub account
 * has its own folder under Documents, and that folder is the git repo with
 * a remote pointing to the user's own repo.
 */
function resolveProjectsRoot() {
    const gh = userstore.getGithub();
    if (gh) {
        return path.join(app.getPath('documents'), 'AutomaEyes', gh.login);
    }
    // GitHub isn't connected yet — used only as a placeholder; the gate in
    // createWindow() prevents the project page from opening before it's connected.
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
            webviewTag: false, // not used; disabling it reduces the attack surface
            backgroundThrottling: false, // do NOT throttle the loop/camera when the window is unfocused
        },
    });

    // A page with unsaved changes installs a canceling beforeunload. In
    // Electron, that cancellation stops loadFile and the window closing WITH
    // NO indication at all: the app appears to freeze on the same page.
    // (Chromium only honors it after there's been a user interaction, so the
    // symptom only shows up after the user touches the page - which makes it
    // look random.)
    //
    // Transitions between pages are already confirmed beforehand by nav:go
    // with an in-page dialog, so it's fine to just allow it here. What
    // remains is closing the window, and that has to use the system dialog -
    // there's no page left to host its own dialog.
    mainWindow.webContents.on('will-prevent-unload', (event) => {
        if (pindahDisetujui) {
            event.preventDefault();   // abaikan beforeunload, lanjutkan
            return;
        }
        const pilih = dialog.showMessageBoxSync(mainWindow, {
            type: 'warning',
            buttons: ['Tutup tanpa menyimpan', 'Batal'],
            defaultId: 1,
            cancelId: 1,
            title: 'Perubahan belum disimpan',
            message: 'Ada perubahan yang belum disimpan.',
            detail: 'Menutup sekarang akan membuang perubahan itu.',
        });
        if (pilih === 0) event.preventDefault();
    });
    // Logs from the page are forwarded to the terminal; without this,
    // renderer errors are completely invisible when running via npm start.
    mainWindow.webContents.on('console-message', (_e, level, message) => {
        if (level >= 1) console.log('[renderer]', message);
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.maximize();   // open maximized (fills the screen, title bar & taskbar remain)
    mainWindow.loadFile(startPage());
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

/**
 * Gate: must log in first, then connect GitHub, before entering the project.
 * Projects are stored in the user's own GitHub repo, so without that
 * connection there's no valid place to store their dataset/model yet.
 */
function startPage() {
    // The mandatory update is checked first: if this version is no longer
    // supported, proceeding to login would only produce strange failures
    // that are hard for the user to trace.
    if (_updateInfo && _updateInfo.mustUpdate) return 'renderer/pages/update.html';
    // Python prerequisites: offered first, but CAN be skipped - the user can
    // still open projects and settings without Python; what they can't do is
    // train a model or run inspections.
    if (_prereqOk === false && !_prereqSkipped) return 'renderer/pages/setup.html';
    if (!userstore.getSession()) return 'renderer/pages/login.html';
    if (!userstore.getGithub()) return 'renderer/pages/connect-github.html';
    return 'renderer/pages/projects.html';
}

/**
 * Check the version then redirect if needed.
 * Failing to reach the site does NOT block the app - a production line
 * shouldn't stop just because the internet is down.
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

// A one-time nonce for every login/authorization flow STARTED by the app.
// Without this, anyone (any web page) could call
// automaeye://auth?token=<attacker-owned-token> and make the victim's app
// log into the attacker's account. The nonce is generated before the browser
// opens and must match when it comes back.
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
    } catch { return; /* invalid URL */ }
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
    _pendingNonce[kind] = null; // one-time use

    // automaeye://github = the result of "Authorize" on GitHub via the website.
    // The host may read as 'github' or 'auth' depending on URL normalization.
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

// The automaeye:// deep link can only be handled if the app is single-instance:
// clicking a link in the browser launches a second instance, which forwards
// its URL to the already-running instance via the 'second-instance' event.
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

// Content-Security-Policy for the app's pages.
//
// All page assets are local - not one of them is fetched from the internet -
// so 'self' is enough. This closes off the most dangerous path if there's
// ever an XSS hole: loading a script from outside or silently exfiltrating
// data. 'unsafe-inline' has to be allowed because the pages use inline
// <script> and style; removing it would require rewriting every page, while
// the source restriction already provides most of the benefit.
// img-src data: is needed by the Annotation page, which loads images as data URLs.
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

    // Register the automaeye:// scheme with the OS. In dev (run via electron.exe)
    // an explicit argv is needed so Windows knows how to call the app back.
    if (process.defaultApp && process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('automaeye', process.execPath, [path.resolve(process.argv[1])]);
    } else {
        app.setAsDefaultProtocolClient('automaeye');
    }
    // Init services (non-fatal if fail)
    arduino.init(cfg.arduino).catch(err => console.warn('[arduino]', err.message));

    createWindow();

    // Check the version in the background; the page redirects as soon as the result arrives.
    checkUpdate();

    // Python prerequisites are checked once at startup.
    prereq.check(cfg).then((r) => {
        _prereqOk = r.ok;
        console.log('[prereq] python:', r.python.found ? r.python.version : 'tidak ada',
                    '| kurang:', r.missing.length ? r.missing.join(', ') : '-');
        if (!r.ok && mainWindow && !_prereqSkipped) mainWindow.loadFile(startPage());
    }).catch((e) => console.warn('[prereq]', e.message));

    // Cold start via deep link: Windows puts its URL in this process's argv.
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
// IPC handlers — called from the renderer via preload.js
// ================================================================

// ---- Config ----
ipcMain.handle('config:get', () => ({
    ...cfg,
    // The version is always read from the app that's actually running, not
    // from config.yaml. The user's config is stored in the data folder and is
    // NOT updated when the app itself is updated, so its number would keep
    // falling behind - "About" once showed 0.1.1 while 0.1.2 was actually running.
    app: { ...(cfg.app || {}), version: app.getVersion() },
}));
ipcMain.handle('config:set', (_, patch) => {
    // Deep merge: if the patch contains a nested object (arduino, model, etc.),
    // merge it per-field instead of replacing the whole object
    for (const k of Object.keys(patch)) {
        if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && cfg[k]) {
            cfg[k] = { ...cfg[k], ...patch[k] };
        } else {
            cfg[k] = patch[k];
        }
    }
    // Persist to config.yaml so it survives into the next session
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

// ---- Built-in annotation ----
//
// Annotation is done entirely in renderer/js/annotator.js: no server, no
// token, no export/sync step — labels are written directly to
// dataset/labels/ in the YOLO format that train.py reads.

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
        if (progress.finalTop1 != null) lastMetrics = { top1: progress.finalTop1, top5: progress.finalTop5 };
        // Training succeeded → snapshot becomes a new VERSION (v1, v2, ...).
        if (progress.done && progress.exitCode === 0) {
            try { progress.version = projects.snapshotVersion(projectsRoot, project, model, lastMetrics); }
            catch (e) { console.warn('[version] snapshot gagal:', e.message); }
        }
        event.sender.send('training:progress', { project, model, progress });
    }, { resume: !!resume });
});
// Set the model's active version (used as default when the workflow doesn't pick one).
ipcMain.handle('models:setActiveVersion', (_e, { project, model, versionId }) =>
    projects.setActiveVersion(projectsRoot, project, model, versionId));
ipcMain.handle('training:cancel', () => inference.cancelTraining());
ipcMain.handle('training:loadHistory', (_e, { project, model }) =>
    inference.loadTrainHistory(projectsRoot, project, model));

// ---- GitHub sync (Save/Load) ----
// Sync operates on the user's own projects folder + their own GitHub token.
const ghToken = () => (userstore.getGithub() || {}).token || null;

ipcMain.handle('git:status', () => gitsync.status(projectsRoot));
ipcMain.handle('git:push', (_e, { message } = {}) => gitsync.push(projectsRoot, message, ghToken()));
ipcMain.handle('git:pull', () => gitsync.pull(projectsRoot, ghToken()));
ipcMain.handle('git:conflictInfo', () => gitsync.conflictInfo(projectsRoot, ghToken()));
ipcMain.handle('git:resolveConflict', (_e, { choice, branchName }) =>
    gitsync.resolveConflict(projectsRoot, ghToken(), choice, branchName));
ipcMain.handle('app:quit', () => { app.quit(); });
// Auto-load the latest version once only, the first time the app is opened.
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

// ---- Python prerequisites ----
ipcMain.handle('prereq:check', async () => {
    const r = await prereq.check(cfg);
    _prereqOk = r.ok;
    return { ...r, pythonUrl: prereq.pythonDownloadUrl() };
});
// One button handles everything: Python first if missing, then the packages.
// Split into two steps because their sizes are so different - Python is
// ~25 MB and fast, the packages are over 1 GB - so the user needs to know
// which one they're waiting on.
ipcMain.handle('prereq:install', async (event) => {
    const kirim = (line) => { if (!event.sender.isDestroyed()) event.sender.send('prereq:log', line); };

    let awal = await prereq.check(cfg);
    if (!awal.python.found || awal.python.tooOld) {
        kirim('== Langkah 1 dari 2: memasang Python ==');
        const rp = await prereq.installPython(kirim);
        if (!rp.ok) return { ok: false, error: `Gagal memasang Python: ${rp.error}` };

        // This process's PATH was already formed before Python was installed,
        // so "python" isn't necessarily recognized right away. The default
        // per-user install location is added manually so the next step works
        // without waiting for the app to be closed and reopened.
        const tambahan = prereq.pythonUserPaths();
        process.env.PATH = tambahan.join(path.delimiter) + path.delimiter + process.env.PATH;

        awal = await prereq.check(cfg);
        if (!awal.python.found) {
            return { ok: false, error: 'Python terpasang, tapi belum terbaca. Tutup lalu buka lagi AutomaEyes.' };
        }
        kirim(`Python siap: ${awal.python.version}`);
    }

    kirim('== Langkah 2 dari 2: memasang paket Python ==');
    const r = await prereq.installPackages(cfg, kirim);
    if (r.ok) _prereqOk = (await prereq.check(cfg)).ok;
    return r;
});
ipcMain.handle('prereq:done', () => {
    _prereqOk = true;
    if (mainWindow) mainWindow.loadFile(startPage());
    return { ok: true };
});
ipcMain.handle('prereq:skip', () => {
    // For this session only: if the app is reopened and prerequisites are
    // still missing, the prompt appears again - it's not silenced forever.
    _prereqSkipped = true;
    if (mainWindow) mainWindow.loadFile(startPage());
    return { ok: true };
});

// ---- App updates ----
ipcMain.handle('update:info', () => _updateInfo || { ok: false, current: app.getVersion() });
ipcMain.handle('update:recheck', () => checkUpdate(true));

// ---- Website login ----
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

// ---- GitHub connection (OAuth via the website) ----
let _pendingToken = null; // GitHub token from Authorize, before the user picks a repo

// GitHub authorization via the website (OAuth). No Client ID needed in the app.
ipcMain.handle('github:authorize', () => {
    _pendingNonce.github = require('crypto').randomBytes(16).toString('hex');
    return appauth.startGithubAuthorize(cfg, _pendingNonce.github);
});

/** Save the connection + set up the projects folder as a git repo pointing to the user's chosen repo. */
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

// List repos using the ALREADY-stored token - used by the "Change repo"
// feature so the user doesn't need to re-Authorize just to change where things are saved.
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

// ---- Model Evaluation / Test ----
ipcMain.handle('eval:run', async (event, { project, model, split }) =>
    inference.evaluate(cfg, projectsRoot, project, model, split, (p) =>
        event.sender.send('eval:progress', { project, model, ...p })));
ipcMain.handle('eval:openDir', (_, { dir }) => {
    // The path comes from the renderer, same as file:open - see the note there.
    if (!bolehDibuka(dir)) return { ok: false, error: 'Folder ini tidak boleh dibuka dari aplikasi.' };
    shell.openPath(dir);
    return { ok: true };
});

// ---- Workflow ----
ipcMain.handle('workflow:save', (_, { project, steps, onFirstNG }) =>
    projects.saveWorkflow(projectsRoot, project, steps, onFirstNG));

// ---- Run / Inference ----
ipcMain.handle('run:inspect', async (_, { project, imageDataUrl, opts }) => {
    // imageDataUrl = "data:image/jpeg;base64,..."
    const proj = projects.load(projectsRoot, project);
    return workflow.execute(cfg, proj, imageDataUrl, arduino, output, opts || {});
});

// Send a single Arduino/PLC signal for ONE part (used by tracking mode:
// the verdict is sent once per part, not per frame).
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

// Save an OVERLAID photo (measurement + verdict) from the renderer, tracking mode.
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

// Gate open/close (tracking mode): 'O' when a part is detected+measured, 'C' when it leaves the frame.
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

// Arduino/Wemos connection status (for the indicator on the Run page).
ipcMain.handle('arduino:status', () => {
    try {
        const conn = arduino.connectedPort ? arduino.connectedPort() : null;
        return { ...arduino.status(), port: conn || (cfg.arduino && cfg.arduino.port), baud: cfg.arduino && cfg.arduino.baud };
    } catch (e) { return { connected: false, error: e.message }; }
});

// List of available COM ports (for the selection dropdown).
ipcMain.handle('arduino:listPorts', async () => {
    try { return await arduino.listPorts(); } catch (e) { return []; }
});

// Set the COM port (e.g. from a dropdown) → save to config & reconnect.
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

// Reopen the serial port (auto-detect COM). Used after closing Serial Monitor / swapping the cable.
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
    // Apply the calibration result to the config & save.
    cfg.model = { ...cfg.model, confidence: res.bestConf };
    saveConfig();
    return res;
});

// Daily report (pure statistics, no LLM) — used by a button on the project page.
const tanggalSah = keamanan.tanggalSah;

ipcMain.handle('report:dailyXlsx', (_, { project, date }) => {
    if (!tanggalSah(date)) return { ok: false, error: 'Tanggal tidak valid.' };
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
// Folders that are allowed to be opened via shell.openPath.
//
// openPath RUNS the file with its default app - for .exe, .bat, or .lnk that
// means running a program. This handler receives a path from the renderer,
// so without a restriction, one XSS hole on any page would be enough to run
// any program on the user's computer. That's the exact same threat already
// guarded at shell:openExternal right below.
//
// What the app actually opens is only .xlsx reports, evaluation result
// folders, dataset folders, and guide/sketch files - all inside the project
// folder or the bundled firmware folder.
function akarBolehDibuka() {
    const akar = [projectsRoot, app.getPath('userData')];
    akar.push(app.isPackaged
        ? path.join(process.resourcesPath, 'firmware')
        : path.join(__dirname, 'firmware'));
    return akar.filter(Boolean).map((a) => path.resolve(a));
}

// The actual rules live in lib/keamanan.js so they can be tested without
// running the whole app - see tests/keamanan.js.
const bolehDibuka = (target) =>
    keamanan.bolehDibuka(target, akarBolehDibuka(),
        (m) => console.warn('[security] openPath ' + m));

ipcMain.handle('file:open', (_, p) => {
    if (!bolehDibuka(p)) return { ok: false, error: 'Berkas ini tidak boleh dibuka dari aplikasi.' };
    shell.openPath(p);
    return { ok: true };
});
// openPath() is for local files only; URLs must go through openExternal().
// Restricted to http/https: without this, a compromised renderer could ask
// the OS to open another scheme (file:, ms-msdt:, etc.) — a classic code execution path.
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

// Detection data Excel: 1 row/part (ID, image link, Box 1-8 L×W, Hole 1-6 Ø, detection time).
ipcMain.handle('report:detectionXlsx', (_, { project, date }) => {
    if (!tanggalSah(date)) return { ok: false, error: 'Tanggal tidak valid.' };
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
// ---- Custom output (user-authored code) ----
const customoutput = require('./lib/customoutput');
ipcMain.handle('output:get', (_, { project }) => {
    const p = projects.load(projectsRoot, project);
    const out = p.output || {};
    const dev = out.device || {};
    return {
        mode: out.mode || 'signal',
        bahasa: out.bahasa === 'py' ? 'py' : 'js',
        script: out.script || customoutput.DEFAULT_SCRIPT,
        scriptPy: out.scriptPy || pyoutput.DEFAULT_SCRIPT,
        device: {
            jenis: dev.jenis || 'arduino',
            papan: dev.papan || '',
            koneksi: dev.koneksi || 'usb',
            port: dev.port || '',
            baud: dev.baud || 9600,
            host: dev.host || '',
            porta: dev.porta || 502,
            unit: dev.unit || 1,
            paritas: dev.paritas || 'none',
            stopBits: dev.stopBits || 1,
        },
        pinKelas: out.pinKelas || [],
        // Classes are pulled from the project's model, not stored redundantly:
        // if the model's classes change, the Output page updates on its own.
        model: (p.models || []).map((m) => ({ nama: m.name, jenis: m.type, kelas: m.classes || [] })),
    };
});
ipcMain.handle('output:save', (_, { project, config }) => {
    const masalah = perangkat.periksa(config);
    if (config && config.mode === 'device' && masalah.length) {
        return { ok: false, masalah };
    }
    return { ok: true, output: projects.saveOutputConfig(projectsRoot, project, config) };
});

// ---- Output device ----
// Connects using the port & baud rate selected on this project's Output
// page, not the global setting in Settings: one computer can serve several
// projects with different boards.
ipcMain.handle('device:sambung', async (_, { project }) => {
    try {
        const p = projects.load(projectsRoot, project);
        const dev = (p.output || {}).device || {};
        // A PLC uses Modbus, not a board sketch - its connection path is different.
        if (dev.jenis === 'plc') {
            const modbus = require('./lib/modbus');
            const r = await modbus.sambung(dev);
            return r.ok ? { ok: true, port: r.info, baud: dev.baud || 9600 } : r;
        }
        if (!dev.port) return { ok: false, error: 'Port belum dipilih di halaman Output.' };
        arduino.close();
        await arduino.init({ port: dev.port, baud: dev.baud || 9600 });
        const conn = arduino.connectedPort ? arduino.connectedPort() : null;
        if (!conn) return { ok: false, error: `Port ${dev.port} tidak bisa dibuka.` };
        return { ok: true, port: conn, baud: dev.baud || 9600 };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// Test a single pin: turn it on briefly then off again. Used to
// verify the wiring is correct before the line is run.
ipcMain.handle('device:ujiPin', async (_, { pin, aktif, jenis }) => {
    try {
        if (jenis === 'plc') {
            const modbus = require('./lib/modbus');
            const nyalaKe = aktif === 'LOW' ? false : true;
            let r = await modbus.tulisCoil([{ alamat: parseInt(pin, 10), nyala: nyalaKe }]);
            if (!r.ok) return { ok: false, error: r.error };
            await new Promise((x) => setTimeout(x, 600));
            await modbus.tulisCoil([{ alamat: parseInt(pin, 10), nyala: !nyalaKe }]);
            return { ok: true, dikirim: [`coil ${pin}`] };
        }
        const pinout = require('./lib/pinout');
        const nyala = pinout.baris([{ pin: String(pin), aktif: aktif === 'LOW' ? 'LOW' : 'HIGH', nyala: true }]);
        const padam = pinout.baris([{ pin: String(pin), aktif: aktif === 'LOW' ? 'LOW' : 'HIGH', nyala: false }]);
        const r1 = await arduino.send(nyala);
        if (r1 && r1.ok === false) {
            return { ok: false, error: r1.reason === 'not connected' ? 'papan belum tersambung' : String(r1.reason) };
        }
        await new Promise((r) => setTimeout(r, 600));
        await arduino.send(padam);
        return { ok: true, dikirim: [nyala.trim(), padam.trim()] };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('device:katalog', () => ({
    katalog: perangkat.KATALOG,
    koneksi: perangkat.KONEKSI,
}));
ipcMain.handle('device:pindai', () => perangkat.pindai());
ipcMain.handle('device:pin', (_, { jenis, papan }) => perangkat.pinPapan(jenis, papan));

// Firmware sketch. Once installed the file lives in resources, not next to
// main.js - app.asar can't be opened by external apps.
ipcMain.handle('device:sketsa', (_, mana) => {
    const dir = app.isPackaged
        ? path.join(process.resourcesPath, 'firmware')
        : path.join(__dirname, 'firmware');
    const berkas = path.join(dir, mana === 'panduan' ? 'BACA-SAYA.md' : 'automaeyes_pinout.ino');
    return { berkas, ada: fs.existsSync(berkas) };
});
ipcMain.handle('output:test', (_, { script, verdict, bahasa }) =>
    (bahasa === 'py'
        ? pyoutput.test(script, arduino, verdict, cfg.python)
        : customoutput.test(script, arduino, verdict)));

// ---- Navigation ----
ipcMain.handle('nav:go', async (_, page) => {
    // page may contain a query string, e.g. "project.html?name=Foo"
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

    // A page with unsaved changes gets a chance to hold up the navigation
    // and ask first. It's asked HERE, not at every button: there are twenty-
    // plus places that navigate to another page, and missing even one would
    // discard the user's work without a word.
    //
    // A page with no guard answers true, so nothing needs to change on ordinary pages.
    let boleh = true;
    try {
        boleh = await mainWindow.webContents.executeJavaScript(
            'typeof window.bolehTinggalkanHalaman === "function"'
            + ' ? window.bolehTinggalkanHalaman() : true'
        );
    } catch (err) {
        // A broken guard must not lock up the app. Log it, then proceed.
        console.warn('[nav:go] penjaga halaman gagal:', err.message);
        boleh = true;
    }
    if (!boleh) return { ok: false, error: 'dibatalkan pengguna' };

    // The guard already agreed, so this page's beforeunload must not
    // cancel again - see will-prevent-unload below.
    pindahDisetujui = true;

    // The Promise from loadFile does NOT always resolve: if the unload stays
    // stuck, it hangs forever. Awaiting it would mean nav:go hangs too AND
    // pindahDisetujui stays on forever - which silently disables the
    // "unsaved changes" confirmation when the window is closed. So the flag
    // is released by the load-finished event instead, with a safety-net
    // timer as backup, rather than by awaiting it.
    const lepasIzin = () => { pindahDisetujui = false; };
    const jaringPengaman = setTimeout(lepasIzin, 5000);
    mainWindow.webContents.once('did-stop-loading', () => {
        clearTimeout(jaringPengaman);
        lepasIzin();
    });
    mainWindow.loadFile(target, opts).catch((err) => {
        console.warn('[nav:go] gagal memuat halaman:', err.message);
        clearTimeout(jaringPengaman);
        lepasIzin();
    });

    return { ok: true };
});
