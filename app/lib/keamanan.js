// Penjagaan untuk nilai yang datang dari renderer.
//
// Dipisah ke berkas sendiri bukan demi kerapian, melainkan supaya bisa diuji:
// selama aturannya tertanam di dalam handler IPC di main.js, satu-satunya cara
// memeriksanya adalah menjalankan seluruh aplikasi.
//
// Model ancamannya sama dengan yang sudah dijaga di shell:openExternal --
// halaman renderer dianggap BISA disusupi. Dengan contextIsolation dan CSP,
// menyusupinya tidak mudah, tapi kalau berhasil, penyerang mewarisi seluruh
// permukaan window.api. Maka pembatasan tidak boleh bergantung pada asumsi
// "halaman kita sendiri pasti mengirim nilai yang benar".

const path = require('path');

// Jenis berkas yang dijalankan OS begitu dibuka.
//
// shell.openPath MENJALANKAN berkas dengan aplikasi bawaannya; untuk .exe,
// .bat, atau .lnk itu berarti menjalankan program. Daftar ini bukan pertahanan
// utama - pembatasan folder di bawah yang utama - melainkan lapisan kedua untuk
// keadaan di mana berkas berbahaya sempat tertulis ke dalam folder project
// (misalnya lewat repo yang di-pull dari GitHub).
const EKSTENSI_DAPAT_DIEKSEKUSI = new Set([
    '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.msp',
    '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
    '.lnk', '.url', '.hta', '.cpl', '.reg', '.jar',
]);

/**
 * Apakah `target` boleh diserahkan ke shell.openPath?
 *
 * @param {string} target  path dari renderer
 * @param {string[]} akarDiizinkan  folder yang isinya boleh dibuka
 * @param {(pesan: string) => void} [catat]  pencatat penolakan
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

    // Perbandingan dilakukan setelah resolve, sehingga "..", path relatif, dan
    // symlink-nama sudah diratakan. Pemisah path ikut diperiksa supaya
    // "C:\projects-lain" tidak lolos hanya karena diawali "C:\projects".
    const cocok = (akarDiizinkan || []).some((akar) => {
        if (typeof akar !== 'string' || !akar) return false;
        const a = path.resolve(akar);
        return p === a || p.startsWith(a + path.sep);
    });

    if (!cocok) lapor('ditolak, di luar folder yang diizinkan: ' + p);
    return cocok;
}

/**
 * Tanggal laporan.
 *
 * Nilainya dipakai menyusun nama berkas DAN nama folder. Dibiarkan apa adanya,
 * "../.." menulis laporan ke luar folder project dan membaca isi folder lain.
 * Satu-satunya bentuk yang sah adalah YYYY-MM-DD, dan tanggalnya harus benar
 * ada - "2026-02-31" lolos pemeriksaan pola tapi bukan tanggal.
 */
function tanggalSah(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const [th, bl, tg] = d.split('-').map(Number);
    const t = new Date(Date.UTC(th, bl - 1, tg));
    return t.getUTCFullYear() === th && t.getUTCMonth() === bl - 1 && t.getUTCDate() === tg;
}

module.exports = { bolehDibuka, tanggalSah, EKSTENSI_DAPAT_DIEKSEKUSI };
