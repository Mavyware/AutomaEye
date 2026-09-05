// Guards for values coming from the renderer.
//
// Split into its own file not for tidiness, but so it can be tested:
// as long as the rules are embedded inside the IPC handler in main.js, the
// only way to check them is to run the whole app.
//
// The threat model is the same one already guarded at shell:openExternal --
// the renderer page is assumed to be COMPROMISABLE. With contextIsolation and
// CSP, compromising it isn't easy, but if it happens, the attacker inherits
// the whole window.api surface. So restrictions must not rely on the
// assumption "our own page will surely send correct values".

const path = require('path');

// File types the OS executes as soon as they're opened.
//
// shell.openPath RUNS the file with its default app; for .exe, .bat, or .lnk
// that means running a program. This list isn't the primary defense - the
// folder restriction below is - it's a second layer for cases where a
// malicious file has been written into the project folder (e.g. via a repo
// pulled from GitHub).
const EKSTENSI_DAPAT_DIEKSEKUSI = new Set([
    '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.msp',
    '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
    '.lnk', '.url', '.hta', '.cpl', '.reg', '.jar',
]);

/**
 * Is `target` allowed to be passed to shell.openPath?
 *
 * @param {string} target  path from the renderer
 * @param {string[]} akarDiizinkan  folders whose contents may be opened
 * @param {(pesan: string) => void} [catat]  rejection logger
 */
function bolehDibuka(target, akarDiizinkan, catat) {
    const lapor = (m) => { if (catat) catat(m); };

    if (typeof target !== 'string' || !target.trim()) return false;

    let p;
    try {
        p = path.resolve(target);
    } catch {
        return false;
    }

    if (EKSTENSI_DAPAT_DIEKSEKUSI.has(path.extname(p).toLowerCase())) {
        lapor('ditolak, jenis berkas dapat dieksekusi: ' + p);
        return false;
    }

    // The comparison happens after resolve, so "..", relative paths, and
    // symlink-names are already flattened. The path separator is checked too
    // so "C:\other-projects" doesn't pass just because it starts with "C:\projects".
    const cocok = (akarDiizinkan || []).some((akar) => {
        if (typeof akar !== 'string' || !akar) return false;
        const a = path.resolve(akar);
        return p === a || p.startsWith(a + path.sep);
    });

    if (!cocok) lapor('ditolak, di luar folder yang diizinkan: ' + p);
    return cocok;
}

/**
 * Report date.
 *
 * The value is used to build both the file name AND the folder name. Left
 * unchecked, "../.." would write the report outside the project folder and
 * read the contents of another folder. The only valid form is YYYY-MM-DD, and
 * the date must actually exist - "2026-02-31" passes the pattern check but
 * isn't a real date.
 */
function tanggalSah(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const [th, bl, tg] = d.split('-').map(Number);
    const t = new Date(Date.UTC(th, bl - 1, tg));
    return t.getUTCFullYear() === th && t.getUTCMonth() === bl - 1 && t.getUTCDate() === tg;
}

module.exports = { bolehDibuka, tanggalSah, EKSTENSI_DAPAT_DIEKSEKUSI };
