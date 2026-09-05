// lib/prereq.js — checking & installing Python prerequisites.
//
// Division of labor with the installer:
//   installer : installs Python itself if missing (~25 MB, silent)
//   the app   : installs Python packages (ultralytics pulls in torch, >1 GB),
//               and can also install Python if the installer step was skipped
//
// Packages are deliberately NOT bundled into the installer or installed from
// NSIS: their size would balloon the installer from 89 MB to over 1 GB, and
// a download that big with no progress indicator would look like it's hung
// and then fail with no explanation. In the app, the process can be shown,
// retried, and canceled.

const { spawn, execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
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

    // Without Python, checking modules is pointless.
    if (!python.found || python.tooOld) {
        return {
            ok: false, python,
            modules: MODULES.map((name) => ({ name, found: false })),
            missing: MODULES.slice(),
        };
    }

    // Each module is checked separately so it's possible to report which
    // one is missing, instead of just "failed".
    const modules = [];
    for (const name of MODULES) {
        const r = await run(exe, ['-c', `import ${name}`]);
        modules.push({ name, found: r.ok });
    }
    const missing = modules.filter((x) => !x.found).map((x) => x.name);
    return { ok: missing.length === 0, python, modules, missing };
};

/** URL of the official Python installer for Windows 64-bit. */
exports.pythonDownloadUrl = () =>
    'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe';

/**
 * Download then install Python with no user interaction.
 *
 * Installed for the current user (InstallAllUsers=0) so it doesn't require
 * administrator rights - AutomaEyes's own installer is also per-user, so
 * asking for UAC here would just add one more wall.
 *
 * PrependPath=1 so "python" is recognized right away; without it the app
 * would have to guess its location, and a wrong guess shows up as "Python
 * not found" even though it was just installed.
 *
 * @param {(line:string)=>void} onLine
 */
exports.installPython = (onLine) => new Promise((resolve) => {
    const url = exports.pythonDownloadUrl();
    const berkas = path.join(os.tmpdir(), 'automaeyes-python-setup.exe');

    onLine(`Mengunduh Python dari ${url}`);
    const file = fs.createWriteStream(berkas);

    const unduh = (alamat, sisaRedirect = 5) => {
        https.get(alamat, (res) => {
            // python.org uses a CDN that redirects; without this, only the
            // redirect page would get saved, and the installer would fail
            // with a nonsensical error message.
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (!sisaRedirect) { file.close(); resolve({ ok: false, error: 'Terlalu banyak pengalihan saat mengunduh.' }); return; }
                res.resume();
                unduh(res.headers.location, sisaRedirect - 1);
                return;
            }
            if (res.statusCode !== 200) {
                file.close();
                resolve({ ok: false, error: `Unduhan gagal (HTTP ${res.statusCode}).` });
                return;
            }

            const total = parseInt(res.headers['content-length'], 10) || 0;
            let terunduh = 0;
            let persenTerakhir = -1;
            res.on('data', (c) => {
                terunduh += c.length;
                if (!total) return;
                const persen = Math.floor((terunduh / total) * 100);
                if (persen !== persenTerakhir && persen % 5 === 0) {
                    persenTerakhir = persen;
                    onLine(`Mengunduh Python... ${persen}%`);
                }
            });
            res.pipe(file);
            file.on('finish', () => file.close(() => {
                onLine('Unduhan selesai. Memasang Python (tanpa jendela tambahan)...');
                const args = ['/quiet', 'InstallAllUsers=0', 'PrependPath=1',
                    'Include_pip=1', 'Include_launcher=1', 'AssociateFiles=0', 'Shortcuts=0'];
                // spawn throws SYNCHRONOUSLY if the file can't be executed -
                // a corrupted or truncated download, or one blocked by
                // antivirus. Without this guard, that error would slip through
                // and crash the app instead of being reported as an install failure.
                let anak;
                try {
                    anak = spawn(berkas, args, { windowsHide: true });
                } catch (e) {
                    try { fs.unlinkSync(berkas); } catch (_) { /* leave it */ }
                    resolve({ ok: false, error: `Berkas pemasang Python tidak bisa dijalankan (${e.code || e.message}). Kemungkinan unduhannya rusak atau diblokir antivirus.` });
                    return;
                }
                anak.on('error', (e) => resolve({ ok: false, error: e.message }));
                anak.on('close', (code) => {
                    try { fs.unlinkSync(berkas); } catch (_) { /* leave it */ }
                    if (code === 0) { onLine('Python terpasang.'); resolve({ ok: true }); return; }
                    // 1602 = user canceled, 3010 = restart needed.
                    if (code === 3010) { onLine('Python terpasang (komputer perlu di-restart).'); resolve({ ok: true, restart: true }); return; }
                    resolve({ ok: false, error: `Pemasang Python berhenti dengan kode ${code}.` });
                });
            }));
        }).on('error', (e) => {
            file.close();
            resolve({ ok: false, error: `Tidak bisa mengunduh: ${e.message}` });
        });
    };

    unduh(url);
});

/**
 * Location of a per-user Python install.
 *
 * Needed because a process's PATH is frozen when that process starts: a
 * freshly-installed Python won't be visible until the app is closed and
 * reopened. Adding its path directly avoids that step.
 */
exports.pythonUserPaths = () => {
    const dasar = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python');
    const hasil = [];
    try {
        for (const nama of fs.readdirSync(dasar)) {
            if (!/^Python3\d+$/i.test(nama)) continue;
            hasil.push(path.join(dasar, nama));
            hasil.push(path.join(dasar, nama, 'Scripts'));
        }
    } catch (_) { /* the folder doesn't exist yet */ }
    // The py launcher is installed to the Windows folder, already on the default PATH.
    return hasil;
};

let installProc = null;
exports.isInstalling = () => !!installProc && !installProc.killed;

/**
 * Install Python packages from requirements.txt, streaming its progress.
 * @param {(line:string)=>void} onLine
 */
exports.installPackages = (cfg, onLine) => new Promise((resolve) => {
    if (installProc) return resolve({ ok: false, error: 'Pemasangan sedang berjalan.' });

    const req = path.join(pythonDir(), 'requirements.txt');
    const args = ['-m', 'pip', 'install', '-r', req,
        '--disable-pip-version-check',
        '--progress-bar', 'off'];   // the ANSI bar doesn't render cleanly in the UI

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
        try { installProc.kill(); } catch { /* already stopped */ }
        installProc = null;
        return { ok: true };
    }
    return { ok: false };
};
