// lib/updater.js — app version check.
//
// The app asks the site for the latest version at startup. If the installed
// version is older than minVersion, usage is blocked until the user
// updates — this is for changes that make the old version no longer
// compatible (e.g. the login flow or label format changed), so the user
// doesn't run into strange, hard-to-trace failures.
//
// If the site can't be reached, the app can STILL be used. A production
// line shouldn't stop just because the internet is down.

const { app } = require('electron');

function siteUrl(cfg) {
    return (cfg?.website?.url || 'https://automaeyes.my.id').replace(/\/+$/, '');
}

/**
 * Compare semantic versions "1.2.3".
 * @returns -1 if a < b, 0 if equal, 1 if a > b
 */
function compareVersions(a, b) {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x < y) return -1;
        if (x > y) return 1;
    }
    return 0;
}
exports.compareVersions = compareVersions;

/**
 * @returns {{
 *   ok: boolean, current: string, latest?: string, url?: string,
 *   notes?: string, updateAvailable?: boolean, mustUpdate?: boolean,
 *   offline?: boolean, error?: string
 * }}
 */
exports.check = async (cfg) => {
    const current = app.getVersion();

    let res;
    try {
        res = await fetch(`${siteUrl(cfg)}/api/version.php`, {
            signal: AbortSignal.timeout(8000),
        });
    } catch (e) {
        // Not being able to reach the site is not a reason to halt production.
        return { ok: false, offline: true, current, error: e.message };
    }

    let data;
    try {
        data = await res.json();
    } catch {
        return { ok: false, offline: true, current, error: 'Balasan server tidak valid.' };
    }
    if (!data.ok) {
        return { ok: false, current, error: data.error || 'Informasi rilis tidak tersedia.' };
    }

    const latest = String(data.version);
    const minVersion = String(data.minVersion || latest);

    return {
        ok: true,
        current,
        latest,
        url: data.url || '',
        notes: data.notes || '',
        updateAvailable: compareVersions(current, latest) < 0,
        mustUpdate: compareVersions(current, minVersion) < 0,
    };
};
