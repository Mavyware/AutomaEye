// lib/prereq.js — pemeriksaan & pemasangan prasyarat Python.
//
// Pembagian tugas dengan installer:
//   installer : memastikan Python ADA (unduhannya kecil, ~25 MB)
//   aplikasi  : memasang paket Python (ultralytics menarik torch, >1 GB)
//
// Paket sengaja TIDAK dipaketkan ke installer maupun dipasang dari NSIS:
// ukurannya membengkakkan installer dari 89 MB jadi lebih dari 1 GB, dan
// unduhan sebesar itu tanpa indikator progres akan terlihat menggantung
// lalu gagal tanpa penjelasan. Di aplikasi, prosesnya bisa ditampilkan,
// diulang, dan dibatalkan.

const { spawn, execFile } = require('child_process');
const path = require('path');
const { pythonDir } = require('./paths');

const MIN_PYTHON = [3, 10];
const MODULES = ['ultralytics', 'cv2', 'PIL', 'numpy'];

function pyExe(cfg) {
    return (cfg && cfg.python && cfg.python.exe) || 'python';
}

function run(exe, args, timeout = 20000) {
    return new Promise((resolve) => {
        execFile(exe, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
            resolve({ ok: !err, out: ((stdout || '') + (stderr || '')).trim() });
        });
    });
}

/**
 * @returns {{
 *   ok: boolean, python: {found:boolean, version?:string, tooOld?:boolean},
 *   modules: {name:string, found:boolean}[], missing: string[]
 * }}
 */
exports.check = async (cfg) => {
    const exe = pyExe(cfg);

    const ver = await run(exe, ['--version']);
    const m = ver.out.match(/Python\s+(\d+)\.(\d+)\.?(\d+)?/i);
    const python = { found: ver.ok && !!m };
    if (m) {
        python.version = `${m[1]}.${m[2]}${m[3] ? '.' + m[3] : ''}`;
        const major = parseInt(m[1], 10), minor = parseInt(m[2], 10);
        python.tooOld = major < MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor < MIN_PYTHON[1]);
    }

    // Tanpa Python, memeriksa modul tidak ada gunanya.
    if (!python.found || python.tooOld) {
        return {
            ok: false, python,
            modules: MODULES.map((name) => ({ name, found: false })),
            missing: MODULES.slice(),
        };
    }

    // Tiap modul dicek terpisah supaya bisa dilaporkan mana yang kurang,
    // bukan sekadar "gagal".
    const modules = [];
    for (const name of MODULES) {
        const r = await run(exe, ['-c', `import ${name}`]);
        modules.push({ name, found: r.ok });
    }
    const missing = modules.filter((x) => !x.found).map((x) => x.name);
    return { ok: missing.length === 0, python, modules, missing };
};

/** URL installer Python resmi untuk Windows 64-bit. */
exports.pythonDownloadUrl = () =>
    'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe';

let installProc = null;
exports.isInstalling = () => !!installProc && !installProc.killed;

/**
 * Pasang paket Python dari requirements.txt, streaming progresnya.
 * @param {(line:string)=>void} onLine
 */
exports.installPackages = (cfg, onLine) => new Promise((resolve) => {
    if (installProc) return resolve({ ok: false, error: 'Pemasangan sedang berjalan.' });

    const req = path.join(pythonDir(), 'requirements.txt');
    const args = ['-m', 'pip', 'install', '-r', req,
        '--disable-pip-version-check',
        '--progress-bar', 'off'];   // bar ANSI tidak terbaca rapi di UI

    onLine(`> ${pyExe(cfg)} ${args.join(' ')}\n`);
    installProc = spawn(pyExe(cfg), args, { windowsHide: true, cwd: pythonDir() });

    const feed = (buf) => String(buf).split(/\r?\n/).filter(Boolean).forEach((l) => onLine(l));
    installProc.stdout.on('data', feed);
    installProc.stderr.on('data', feed);

    installProc.on('error', (e) => {
        installProc = null;
        resolve({ ok: false, error: e.message });
    });
    installProc.on('close', (code) => {
        installProc = null;
        resolve(code === 0
            ? { ok: true }
            : { ok: false, error: `pip berhenti dengan kode ${code}.` });
    });
});

exports.cancelInstall = () => {
    if (installProc) {
        try { installProc.kill(); } catch { /* sudah berhenti */ }
        installProc = null;
        return { ok: true };
    }
    return { ok: false };
};
