// lib/appauth.js — login lewat website AutomaEyes.
//
// Alur (sisi website sudah ada, tidak perlu diubah):
//   1. App buka browser ke  <site>/login.php?redirect=automaeye://auth
//   2. User login (email/password, Google, atau GitHub) di website
//   3. Website terbitkan token HMAC berumur 5 menit lalu redirect balik ke
//      automaeye://auth?token=...
//   4. Electron menangkap deep link itu, lalu POST token ke <site>/api/verify.php
//      untuk ditukar jadi identitas user (hanya server yang bisa cek HMAC-nya).

const { shell } = require('electron');
const userstore = require('./userstore');

function siteUrl(cfg) {
    return (cfg?.website?.url || 'https://automaeyes.my.id').replace(/\/+$/, '');
}

/** Buka halaman login website di browser default. */
exports.startLogin = async (cfg, nonce) => {
    // Nonce ikut di dalam redirect; website menambahkan &token=... di
    // belakangnya, jadi aplikasi bisa mencocokkan saat kembali.
    const target = `automaeye://auth?n=${encodeURIComponent(nonce || '')}`;
    const url = `${siteUrl(cfg)}/login.php?redirect=${encodeURIComponent(target)}`;
    await shell.openExternal(url);
    return { ok: true, url };
};

/** Tukar token deep-link jadi sesi lokal. */
exports.completeLogin = async (cfg, token) => {
    if (!token) return { ok: false, error: 'Token kosong.' };

    let res;
    try {
        res = await fetch(`${siteUrl(cfg)}/api/verify.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
        });
    } catch (e) {
        return { ok: false, error: `Tidak bisa menghubungi server: ${e.message}` };
    }

    let data;
    try {
        data = await res.json();
    } catch {
        return { ok: false, error: `Balasan server tidak valid (HTTP ${res.status}).` };
    }

    if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || `Verifikasi gagal (HTTP ${res.status}).` };
    }

    const session = userstore.setSession(data.user);
    return { ok: true, user: session.user };
};

/**
 * Buka izin akses repo GitHub lewat website (OAuth), bukan device flow.
 *
 * Keuntungannya: aplikasi tidak perlu menyimpan Client ID sama sekali, client
 * secret tetap aman di server, dan user tidak perlu mengetik kode apa pun —
 * cukup menekan Authorize di browser.
 */
exports.startGithubAuthorize = async (cfg, nonce) => {
    const target = `automaeye://github?n=${encodeURIComponent(nonce || '')}`;
    const url = `${siteUrl(cfg)}/auth/github.php?purpose=repo&redirect=${encodeURIComponent(target)}`;
    await shell.openExternal(url);
    return { ok: true, url };
};

/** Tukar kode serah-terima jadi access token GitHub. */
exports.exchangeGithubHandoff = async (cfg, handoff) => {
    if (!handoff) return { ok: false, error: 'Kode kosong.' };

    let res;
    try {
        res = await fetch(`${siteUrl(cfg)}/api/github-token.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ handoff }).toString(),
        });
    } catch (e) {
        return { ok: false, error: `Tidak bisa menghubungi server: ${e.message}` };
    }

    let data;
    try {
        data = await res.json();
    } catch {
        return { ok: false, error: `Balasan server tidak valid (HTTP ${res.status}).` };
    }
    if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || `Gagal menukar kode (HTTP ${res.status}).` };
    }
    return { ok: true, token: data.token, login: data.login };
};

exports.getSession = () => userstore.getSession();

exports.logout = () => {
    userstore.clearSession();
    return { ok: true };
};
