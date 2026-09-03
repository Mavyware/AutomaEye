// lib/userstore.js — state milik user (sesi login + koneksi GitHub).
//
// PENTING: disimpan di app.getPath('userData'), BUKAN di folder app.
// Folder app adalah git repo milik pengembang; kalau state user ditulis di
// situ, token dan sesi ikut ter-commit dan ter-push ke repo orang lain.
//
// Token GitHub dienkripsi pakai Electron safeStorage (DPAPI di Windows),
// jadi tidak tersimpan sebagai teks polos di disk.

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

function statePath() {
    return path.join(app.getPath('userData'), 'state.json');
}

function readRaw() {
    try {
        const p = statePath();
        if (!fs.existsSync(p)) return {};
        return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    } catch {
        // State rusak bukan alasan app gagal start — mulai dari kosong saja.
        return {};
    }
}

function writeRaw(state) {
    const p = statePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

// ---- Sesi login website ----

exports.getSession = () => readRaw().session || null;

exports.setSession = (user) => {
    const state = readRaw();
    state.session = { user, loggedInAt: new Date().toISOString() };
    writeRaw(state);
    return state.session;
};

exports.clearSession = () => {
    const state = readRaw();
    delete state.session;
    // Koneksi GitHub ikut dilepas: token repo milik user yang login,
    // tidak boleh ikut terbawa ke user berikutnya di PC yang sama.
    delete state.github;
    writeRaw(state);
};

// ---- Koneksi GitHub ----

/** @returns {{login:string, repo:string, repoUrl:string, token:string}|null} */
exports.getGithub = () => {
    const gh = readRaw().github;
    if (!gh) return null;

    let token = '';
    try {
        if (gh.tokenEncrypted && safeStorage.isEncryptionAvailable()) {
            token = safeStorage.decryptString(Buffer.from(gh.tokenEncrypted, 'base64'));
        } else if (gh.tokenPlain) {
            token = gh.tokenPlain;
        }
    } catch {
        return null; // token tidak bisa dibuka (mis. profil Windows pindah) → anggap belum connect
    }
    if (!token) return null;
    return { login: gh.login, repo: gh.repo, repoUrl: gh.repoUrl, token };
};

exports.setGithub = ({ login, repo, repoUrl, token }) => {
    const state = readRaw();
    const entry = { login, repo, repoUrl, connectedAt: new Date().toISOString() };
    if (safeStorage.isEncryptionAvailable()) {
        entry.tokenEncrypted = safeStorage.encryptString(token).toString('base64');
    } else {
        // Linux tanpa keyring, dsb. Tetap jalan, tapi jujur soal risikonya.
        entry.tokenPlain = token;
        console.warn('[userstore] safeStorage tidak tersedia — token GitHub disimpan tanpa enkripsi.');
    }
    state.github = entry;
    writeRaw(state);
};

exports.clearGithub = () => {
    const state = readRaw();
    delete state.github;
    writeRaw(state);
};
