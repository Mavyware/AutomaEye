// lib/updater.js — pemeriksaan versi aplikasi.
//
// Aplikasi menanyakan versi terbaru ke situs saat start. Kalau versi yang
// terpasang lebih lama dari minVersion, pemakaian diblokir sampai user
// memperbarui — ini untuk perubahan yang membuat versi lama tidak lagi
// kompatibel (mis. alur login atau format label berubah), supaya user tidak
// mengalami kegagalan aneh yang sulit ditelusuri.
//
// Kalau situs tidak bisa dihubungi, aplikasi TETAP boleh dipakai. Lini
// produksi tidak boleh berhenti hanya karena internet mati.

const { app } = require('electron');

function siteUrl(cfg) {
    return (cfg?.website?.url || 'https://automaeyes.my.id').replace(/\/+$/, '');
}

/**
 * Bandingkan versi semantik "1.2.3".
 * @returns -1 kalau a < b, 0 kalau sama, 1 kalau a > b
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
        // Tidak bisa menghubungi situs bukan alasan menghentikan produksi.
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
