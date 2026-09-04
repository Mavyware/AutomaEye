// lib/prereq.js — pemeriksaan & pemasangan prasyarat Python.
//
// Pembagian tugas dengan installer:
//   installer : memasang Python sendiri kalau belum ada (~25 MB, senyap)
//   aplikasi  : memasang paket Python (ultralytics menarik torch, >1 GB),
//               dan bisa memasang Python juga kalau installer dilewati
//
// Paket sengaja TIDAK dipaketkan ke installer maupun dipasang dari NSIS:
// ukurannya membengkakkan installer dari 89 MB jadi lebih dari 1 GB, dan
// unduhan sebesar itu tanpa indikator progres akan terlihat menggantung
// lalu gagal tanpa penjelasan. Di aplikasi, prosesnya bisa ditampilkan,
// diulang, dan dibatalkan.

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

/**
 * Unduh lalu pasang Python tanpa campur tangan pengguna.
 *
 * Dipasang untuk pengguna saat ini (InstallAllUsers=0) supaya tidak menuntut
 * hak administrator - installer AutomaEyes sendiri juga per-pengguna, jadi
 * meminta UAC di sini hanya akan menambah satu dinding lagi.
 *
 * PrependPath=1 supaya "python" langsung dikenali; tanpa itu aplikasi harus
 * menebak lokasinya, dan tebakan yang salah muncul sebagai "Python tidak
 * ditemukan" padahal baru saja dipasang.
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
            // python.org memakai CDN yang mengarahkan ulang; tanpa ini
            // yang tersimpan hanya halaman pengalihan, dan pemasangnya
            // gagal dengan pesan yang tidak masuk akal.
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
                // spawn melempar SINKRON kalau berkasnya tidak bisa dieksekusi -
                // unduhan rusak, terpotong, atau diblokir antivirus. Tanpa
                // penjagaan ini, kesalahan itu lolos dan mematikan aplikasi
                // alih-alih dilaporkan sebagai kegagalan pemasangan.
                let anak;
                try {
                    anak = spawn(berkas, args, { windowsHide: true });
                } catch (e) {
                    try { fs.unlinkSync(berkas); } catch (_) { /* biarkan */ }
                    resolve({ ok: false, error: `Berkas pemasang Python tidak bisa dijalankan (${e.code || e.message}). Kemungkinan unduhannya rusak atau diblokir antivirus.` });
                    return;
                }
                anak.on('error', (e) => resolve({ ok: false, error: e.message }));
                anak.on('close', (code) => {
                    try { fs.unlinkSync(berkas); } catch (_) { /* biarkan */ }
                    if (code === 0) { onLine('Python terpasang.'); resolve({ ok: true }); return; }
                    // 1602 = dibatalkan pengguna, 3010 = perlu restart.
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
 * Lokasi Python hasil pemasangan per-pengguna.
 *
 * Diperlukan karena PATH sebuah proses dibekukan saat proses itu dimulai:
 * Python yang baru dipasang tidak akan terlihat sampai aplikasi ditutup dan
 * dibuka lagi. Menambahkan jalurnya sendiri menghindarkan langkah itu.
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
    } catch (_) { /* belum ada foldernya */ }
    // py launcher dipasang ke folder Windows, sudah ada di PATH baku.
    return hasil;
};

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
