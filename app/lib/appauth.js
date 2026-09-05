// lib/appauth.js — login via the AutomaEyes website.
//
// Flow (the website side already exists, no need to change it):
//   1. The app opens a browser to  <site>/login.php?redirect=automaeye://auth
//   2. The user logs in (email/password, Google, or GitHub) on the website
//   3. The website issues a 5-minute HMAC token then redirects back to
//      automaeye://auth?token=...
//   4. Electron catches that deep link, then POSTs the token to <site>/api/verify.php
//      to exchange it for the user's identity (only the server can verify the HMAC).

const { shell } = require('electron');
const userstore = require('./userstore');

function siteUrl(cfg) {
    return (cfg?.website?.url || 'https://automaeyes.my.id').replace(/\/+$/, '');
}

/** Open the website's login page in the default browser. */
exports.startLogin = async (cfg, nonce) => {
    // The nonce rides along in the redirect; the website appends &token=...
    // after it, so the app can match it up when it comes back.
    const target = `automaeye://auth?n=${encodeURIComponent(nonce || '')}`;
    const url = `${siteUrl(cfg)}/login.php?redirect=${encodeURIComponent(target)}`;
    await shell.openExternal(url);
    return { ok: true, url };
};

/** Exchange the deep-link token for a local session. */
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
 * Open GitHub repo access authorization via the website (OAuth), not the device flow.
 *
 * The benefit: the app doesn't need to store a Client ID at all, the client
 * secret stays safe on the server, and the user doesn't need to type any
 * code — just press Authorize in the browser.
 */
exports.startGithubAuthorize = async (cfg, nonce) => {
    const target = `automaeye://github?n=${encodeURIComponent(nonce || '')}`;
    const url = `${siteUrl(cfg)}/auth/github.php?purpose=repo&redirect=${encodeURIComponent(target)}`;
    await shell.openExternal(url);
    return { ok: true, url };
};

/** Exchange the handoff code for a GitHub access token. */
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
