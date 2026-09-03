// lib/gitsync.js — sinkronisasi folder PROJECTS milik user ke repo GitHub-nya sendiri.
//
// Save  = git add -A + commit + push  (unggah dataset, anotasi, model, project)
// Load  = git pull --ff-only          (ambil versi terbaru dari device lain)
//
// PENTING (perubahan dari versi lama): operasi jalan di folder projects milik
// user (di luar folder app), BUKAN di folder app. Versi lama memakai folder app
// sebagai repo, jadi semua dataset user ikut ter-commit ke repo pengembang.
//
// Autentikasi memakai token OAuth user (device flow, scope repo) yang dikirim
// per-perintah lewat http.extraHeader — token TIDAK ditulis ke .git/config
// supaya tidak tertinggal sebagai teks polos di disk.

const { execFile } = require('child_process');

const LFS_PATTERNS = [
    '*.jpg filter=lfs diff=lfs merge=lfs -text',
    '*.jpeg filter=lfs diff=lfs merge=lfs -text',
    '*.png filter=lfs diff=lfs merge=lfs -text',
    '*.onnx filter=lfs diff=lfs merge=lfs -text',
    '*.pt filter=lfs diff=lfs merge=lfs -text',
];

function git(cwd, args, token = null, timeout = 600000) {
    // Kredensial dikirim sebagai header per-invocation, bukan ditanam di URL
    // remote, supaya token tidak tersimpan di .git/config.
    //
    // PENTING: git-over-HTTPS ke GitHub butuh HTTP Basic Auth (username:token),
    // BUKAN header "Authorization: Bearer" — itu cuma berlaku untuk REST API
    // (dipakai lib/github.js). Memakai Bearer di sini bikin git menolaknya
    // dengan "invalid credentials" walau tokennya sendiri valid.
    // Username boleh apa saja yang non-kosong; GitHub memvalidasi dari
    // tokennya, bukan usernamenya.
    const full = token
        ? ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`, ...args]
        : args;

    return new Promise((resolve) => {
        execFile('git', full, {
            cwd,
            timeout,
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 32,
        }, (err, stdout, stderr) => {
            let out = ((stdout || '') + (stderr || '')).trim();
            if (token) out = out.split(token).join('***'); // jangan bocorkan token ke log/UI
            resolve({
                code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
                out,
            });
        });
    });
}

// Info dasar repo: apakah git, ada remote, branch, dan jumlah perubahan lokal.
exports.status = async (cwd) => {
    const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
    if (inside.code !== 0) return { repo: false };
    const remote = await git(cwd, ['remote', 'get-url', 'origin']);
    const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const dirty = await git(cwd, ['status', '--porcelain']);
    const changes = dirty.out ? dirty.out.split(/\r?\n/).filter(Boolean).length : 0;
    return {
        repo: true,
        hasRemote: remote.code === 0,
        remote: remote.out,
        branch: branch.code === 0 ? branch.out : 'main',
        dirty: changes > 0,
        changes,
    };
};

async function ensureLfs(cwd, fs, path) {
    await git(cwd, ['lfs', 'install', '--local']);
    const file = path.join(cwd, '.gitattributes');
    let existing = '';
    try { existing = fs.readFileSync(file, 'utf8'); } catch { /* belum ada */ }
    const missing = LFS_PATTERNS.filter((p) => !existing.includes(p.split(' ')[0]));
    if (missing.length) {
        const body = (existing ? existing.replace(/\s*$/, '\n') : '') + missing.join('\n') + '\n';
        fs.writeFileSync(file, body, 'utf8');
    }
}

/**
 * Sambungkan folder projects ke repo GitHub milik user.
 * Kalau repo remote sudah berisi project (mis. dari PC lain), isinya langsung
 * di-checkout supaya app menampilkan apa yang ada di repo — sesuai desain
 * "app hanya menampilkan isi repo".
 */
exports.connect = async (cwd, repoUrl, token) => {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(cwd, { recursive: true });

    let log = '';
    const st = await exports.status(cwd);
    if (!st.repo) {
        const init = await git(cwd, ['init']);
        log += init.out + '\n';
    }

    // Remote disimpan bersih tanpa token.
    const hasRemote = (await git(cwd, ['remote', 'get-url', 'origin'])).code === 0;
    const setRemote = hasRemote
        ? await git(cwd, ['remote', 'set-url', 'origin', repoUrl])
        : await git(cwd, ['remote', 'add', 'origin', repoUrl]);
    log += setRemote.out + '\n';

    await ensureLfs(cwd, fs, path);

    const fetch = await git(cwd, ['fetch', 'origin'], token);
    log += fetch.out + '\n';
    if (fetch.code !== 0) {
        return { ok: false, log: (log + '\nGagal fetch. Cek koneksi internet dan akses ke repo.').trim() };
    }

    // Tentukan branch default remote (main/master), lalu ikuti.
    const remoteHead = await git(cwd, ['rev-parse', '--verify', '--quiet', 'origin/main'], token);
    const branch = remoteHead.code === 0 ? 'main' : 'master';
    const remoteBranchExists = remoteHead.code === 0
        || (await git(cwd, ['rev-parse', '--verify', '--quiet', 'origin/master'], token)).code === 0;

    const hasCommits = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0;

    if (remoteBranchExists && !hasCommits) {
        // Repo lokal masih kosong: ikut branch remote, isi repo langsung muncul.
        const co = await git(cwd, ['checkout', '-B', branch, '--track', `origin/${branch}`], token);
        log += co.out + '\n';
    } else if (!remoteBranchExists && !hasCommits) {
        // Repo GitHub benar-benar kosong (tanpa auto-init): mulai branch main lokal.
        const co = await git(cwd, ['checkout', '-b', 'main']);
        log += co.out + '\n';
    }

    return { ok: true, branch, log: log.trim() };
};

// Simpan & unggah semua perubahan ke GitHub.
exports.push = async (cwd, message, token) => {
    const st = await exports.status(cwd);
    if (!st.repo) return { ok: false, log: 'Folder projects belum tersambung ke GitHub.' };
    if (!st.hasRemote) {
        return { ok: false, log: 'Belum tersambung ke GitHub. Buka menu Connect GitHub dulu.' };
    }

    let log = '';
    const add = await git(cwd, ['add', '-A']);
    log += add.out;

    const msg = (message && message.trim())
        ? message.trim()
        : 'AutomaEyes sync ' + new Date().toISOString();
    const commit = await git(cwd, ['commit', '-m', msg]);
    log += '\n' + commit.out;
    const nothing = /nothing to commit|nothing added to commit/i.test(commit.out);

    // Branch di-resolve ULANG setelah commit: di repo yang baru dibuat, HEAD
    // masih "unborn" sebelum commit pertama, jadi nama branch sebelum ini bisa
    // salah.
    const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).out || 'main';
    const push = await git(cwd, ['push', '-u', 'origin', `HEAD:${branch}`], token);
    log += '\n' + push.out;

    if (push.code !== 0 && /rejected|fetch first|non-fast-forward|behind/i.test(push.out)) {
        return {
            ok: false, rejected: true, nothing,
            log: 'Versi di GitHub lebih baru dari lokal. Klik "Load" dulu untuk ambil versi terbaru, baru Save lagi.',
        };
    }
    return { ok: push.code === 0, nothing, log: log.trim() };
};

// Ambil versi terbaru dari GitHub (hanya fast-forward supaya aman).
exports.pull = async (cwd, token) => {
    const st = await exports.status(cwd);
    if (!st.repo) return { ok: false, log: 'Folder projects belum tersambung ke GitHub.' };
    if (!st.hasRemote) return { ok: false, log: 'Belum tersambung ke GitHub (origin).' };

    if (st.dirty) {
        return {
            ok: false, dirty: true,
            log: `Ada ${st.changes} perubahan lokal yang belum disimpan. Klik "Save" dulu sebelum Load, supaya tidak tertimpa.`,
        };
    }
    const pull = await git(cwd, ['pull', '--ff-only', 'origin', st.branch], token);
    const upToDate = /up to date|sudah|already up/i.test(pull.out);
    if (pull.code !== 0 && /not possible to fast-forward|diverg/i.test(pull.out)) {
        return {
            ok: false, diverged: true,
            log: 'Ada perubahan lokal yang menyimpang dari GitHub. Perlu diselesaikan manual (git status).',
        };
    }
    return { ok: pull.code === 0, upToDate, log: pull.out };
};
