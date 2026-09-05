// lib/gitsync.js — syncs the user's PROJECTS folder to their own GitHub repo.
//
// Save  = git add -A + commit + push  (upload dataset, annotations, model, project)
// Load  = git pull --ff-only          (fetch the latest version from another device)
//
// IMPORTANT (change from the old version): operations run in the user's
// projects folder (outside the app folder), NOT in the app folder. The old
// version used the app folder as the repo, so all of the user's datasets
// ended up committed to the developer's repo.
//
// Authentication uses the user's OAuth token (device flow, repo scope), sent
// per-command via http.extraHeader — the token is NOT written to .git/config
// so it isn't left behind as plain text on disk.

const { execFile } = require('child_process');

const LFS_PATTERNS = [
    '*.jpg filter=lfs diff=lfs merge=lfs -text',
    '*.jpeg filter=lfs diff=lfs merge=lfs -text',
    '*.png filter=lfs diff=lfs merge=lfs -text',
    '*.onnx filter=lfs diff=lfs merge=lfs -text',
    '*.pt filter=lfs diff=lfs merge=lfs -text',
];

function git(cwd, args, token = null, timeout = 600000) {
    // Credentials are sent as a per-invocation header, not embedded in the
    // remote URL, so the token isn't stored in .git/config.
    //
    // IMPORTANT: git-over-HTTPS to GitHub needs HTTP Basic Auth (username:token),
    // NOT an "Authorization: Bearer" header — that only applies to the REST API
    // (used by lib/github.js). Using Bearer here makes git reject it with
    // "invalid credentials" even though the token itself is valid.
    // The username can be anything non-empty; GitHub validates based on
    // the token, not the username.
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
            if (token) out = out.split(token).join('***'); // don't leak the token into the log/UI
            resolve({
                code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
                out,
            });
        });
    });
}

// Basic repo info: whether it's git, has a remote, its branch, and the number of local changes.
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
    try { existing = fs.readFileSync(file, 'utf8'); } catch { /* doesn't exist yet */ }
    const missing = LFS_PATTERNS.filter((p) => !existing.includes(p.split(' ')[0]));
    if (missing.length) {
        const body = (existing ? existing.replace(/\s*$/, '\n') : '') + missing.join('\n') + '\n';
        fs.writeFileSync(file, body, 'utf8');
    }
}

/**
 * Connect the projects folder to the user's GitHub repo.
 * If the remote repo already has a project in it (e.g. from another PC), its
 * contents are checked out immediately so the app shows what's in the repo —
 * consistent with the "app only displays repo contents" design.
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

    // The remote is kept clean, with no token in it.
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

    // Determine the remote's default branch (main/master), then follow it.
    const remoteHead = await git(cwd, ['rev-parse', '--verify', '--quiet', 'origin/main'], token);
    const branch = remoteHead.code === 0 ? 'main' : 'master';
    const remoteBranchExists = remoteHead.code === 0
        || (await git(cwd, ['rev-parse', '--verify', '--quiet', 'origin/master'], token)).code === 0;

    const hasCommits = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0;

    if (remoteBranchExists && !hasCommits) {
        // The local repo is still empty: follow the remote branch, repo contents appear immediately.
        const co = await git(cwd, ['checkout', '-B', branch, '--track', `origin/${branch}`], token);
        log += co.out + '\n';
    } else if (!remoteBranchExists && !hasCommits) {
        // The GitHub repo is completely empty (no auto-init): start a local main branch.
        const co = await git(cwd, ['checkout', '-b', 'main']);
        log += co.out + '\n';
    }

    return { ok: true, branch, log: log.trim() };
};

// Save & upload all changes to GitHub.
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

    // The branch is resolved AGAIN after the commit: in a newly created repo,
    // HEAD is still "unborn" before the first commit, so the branch name
    // before this point could be wrong.
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

// Fetch the latest version from GitHub (fast-forward only, to be safe).
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

// ---- Conflict resolution ----
//
// A conflict happens when local and GitHub history have diverged: two devices
// both saved from the same starting point. For data like images and model
// weights, "merging" file contents makes no sense - what makes sense is
// choosing which side to keep.
//
// The principle: the user gets to choose, but the discarded side is ALWAYS
// backed up first to its own branch. A wrong choice can be undone, not lost forever.

/** Summarize the difference between local and GitHub, to show before choosing. */
exports.conflictInfo = async (cwd, token) => {
    const st = await exports.status(cwd);
    if (!st.repo || !st.hasRemote) return { ok: false, log: 'Belum tersambung ke GitHub.' };

    const fetch = await git(cwd, ['fetch', 'origin'], token);
    if (fetch.code !== 0) return { ok: false, log: 'Gagal menghubungi GitHub.\n' + fetch.out };

    const branch = st.branch || 'main';
    const remoteRef = `origin/${branch}`;

    // How many commits exist only on each side.
    const counts = await git(cwd, ['rev-list', '--left-right', '--count', `${remoteRef}...HEAD`]);
    let behind = 0, ahead = 0;
    if (counts.code === 0) {
        const m = counts.out.trim().split(/\s+/);
        behind = parseInt(m[0], 10) || 0;   // only exists on GitHub
        ahead = parseInt(m[1], 10) || 0;    // only exists locally
    }

    const fileList = async (range) => {
        const r = await git(cwd, ['diff', '--name-only', range]);
        return r.code === 0 && r.out ? r.out.split(/\r?\n/).filter(Boolean) : [];
    };
    const localFiles = await fileList(`${remoteRef}...HEAD`);
    const remoteFiles = await fileList(`HEAD...${remoteRef}`);

    // Changes that haven't been committed at all are also important for the user to know about.
    const uncommitted = st.changes;

    return {
        ok: true,
        branch,
        ahead, behind,
        diverged: ahead > 0 && behind > 0,
        uncommitted,
        localFiles: localFiles.slice(0, 200),
        remoteFiles: remoteFiles.slice(0, 200),
        localMore: Math.max(0, localFiles.length - 200),
        remoteMore: Math.max(0, remoteFiles.length - 200),
    };
};

/**
 * Resolve a conflict by choosing one side.
 * @param {'local'|'remote'|'branch'} pilihan
 *   'local'  : this computer's content is used, GitHub is overwritten
 *   'remote' : GitHub's content is used, local changes are discarded
 *   'branch' : both are kept - this side's own copy is pushed to a new branch
 */
exports.resolveConflict = async (cwd, token, pilihan, namaCabang) => {
    const st = await exports.status(cwd);
    if (!st.repo || !st.hasRemote) return { ok: false, log: 'Belum tersambung ke GitHub.' };

    const branch = st.branch || 'main';
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    let log = '';

    if (pilihan === 'local') {
        // Commit any local changes first, so they get carried along.
        if (st.dirty) {
            await git(cwd, ['add', '-A']);
            const c = await git(cwd, ['commit', '-m', `AutomaEyes: simpan sebelum selesaikan konflik ${stamp}`]);
            log += c.out + '\n';
        }

        // Back up the GitHub version to another branch BEFORE overwriting it,
        // so this choice can still be undone.
        const backup = `cadangan-github-${stamp}`;
        const bk = await git(cwd, ['push', 'origin', `origin/${branch}:refs/heads/${backup}`], token);
        log += bk.out + '\n';
        if (bk.code !== 0) {
            return { ok: false, log: 'Gagal mencadangkan versi GitHub, jadi penimpaan dibatalkan.\n' + bk.out };
        }

        const push = await git(cwd, ['push', '--force-with-lease', 'origin', `HEAD:${branch}`], token);
        log += push.out;
        return {
            ok: push.code === 0,
            backupBranch: backup,
            log: (push.code === 0
                ? `Versi komputer ini sekarang dipakai di GitHub.\nVersi GitHub sebelumnya disimpan di branch "${backup}".`
                : 'Gagal menimpa GitHub.\n') + '\n' + log.trim(),
        };
    }

    if (pilihan === 'branch') {
        // The safest choice: nothing gets overwritten or discarded.
        // Local work is pushed to a new branch on GitHub, then this
        // computer follows the shared version. Both remain, and merging
        // can be done later via a Pull Request.
        if (st.dirty) {
            await git(cwd, ['add', '-A']);
            const c = await git(cwd, ['commit', '-m', `AutomaEyes: simpan sebelum pisah cabang ${stamp}`]);
            log += c.out + '\n';
        }

        const nama = (namaCabang && namaCabang.trim())
            ? namaCabang.trim().replace(/[^\w.\-\/]/g, '-')
            : `cabang-${stamp}`;

        const push = await git(cwd, ['push', 'origin', `HEAD:refs/heads/${nama}`], token);
        log += push.out + '\n';
        if (push.code !== 0) {
            return { ok: false, log: 'Gagal membuat cabang baru di GitHub.\n' + log.trim() };
        }

        const fetch = await git(cwd, ['fetch', 'origin'], token);
        log += fetch.out + '\n';
        const reset = await git(cwd, ['reset', '--hard', `origin/${branch}`]);
        log += reset.out;
        return {
            ok: reset.code === 0,
            backupBranch: nama,
            log: (reset.code === 0
                ? `Pekerjaan Anda tersimpan di cabang "${nama}" di GitHub, dan komputer ini sekarang mengikuti "${branch}".\nTidak ada yang hilang - keduanya bisa digabung lewat Pull Request.`
                : `Cabang "${nama}" berhasil dibuat, tapi gagal mengikuti "${branch}".\n`) + '\n' + log.trim(),
        };
    }

    if (pilihan === 'remote') {
        // Back up the local state (including uncommitted changes) to a local branch.
        const backup = `cadangan-lokal-${stamp}`;
        if (st.dirty) {
            await git(cwd, ['add', '-A']);
            const c = await git(cwd, ['commit', '-m', `AutomaEyes: cadangan sebelum ambil versi GitHub ${stamp}`]);
            log += c.out + '\n';
        }
        const br = await git(cwd, ['branch', backup]);
        log += br.out + '\n';

        const fetch = await git(cwd, ['fetch', 'origin'], token);
        log += fetch.out + '\n';
        const reset = await git(cwd, ['reset', '--hard', `origin/${branch}`]);
        log += reset.out;
        return {
            ok: reset.code === 0,
            backupBranch: backup,
            log: (reset.code === 0
                ? `Versi GitHub sekarang dipakai.\nKeadaan lokal sebelumnya disimpan di branch "${backup}" (masih di komputer ini).`
                : 'Gagal mengambil versi GitHub.\n') + '\n' + log.trim(),
        };
    }

    return { ok: false, log: 'Pilihan tidak dikenal.' };
};
