// Pangkas berkas yang tidak akan pernah dipakai di komputer target.
//
// Dijalankan electron-builder setelah aplikasi dipaketkan, sebelum installer
// dibuat. Yang dibuang di sini bukan sekadar penghemat tempat: installer ini
// diunduh ke komputer pabrik, kadang lewat jaringan yang lambat, jadi setiap
// puluhan megabyte terasa.
//
// Yang TIDAK disentuh, walau besar:
//   - AutomaEyes.exe (235 MB) itu Chromium; tidak bisa dikecilkan.
//   - LICENSES.chromium.html (19 MB) wajib ikut secara hukum.
//   - dxcompiler.dll + dxil.dll (26 MB) itu compiler shader DirectX, dipakai
//     jalur WebGPU. Aplikasi ini hanya memakai canvas 2D, jadi membuangnya
//     tampak aman - dan memang diuji: aplikasi tetap jalan tanpa keduanya.
//     Tapi setelah dikompresi selisihnya cuma 6,6 MB (108,2 -> 101,6), dan
//     kalau tebakan itu meleset di satu komputer pabrik, gejalanya berupa
//     kegagalan GPU yang sangat sulit dilacak. Tidak sebanding. Diukur, bukan
//     ditebak - jangan diulang tanpa alasan baru.

const fs = require('fs');
const path = require('path');

// Bahasa yang disimpan. en-US wajib: Chromium memakainya sebagai cadangan
// kalau bahasa yang diminta tidak ada.
const BAHASA = new Set(['en-US.pak', 'id.pak']);

// Modul native serialport membawa biner untuk semua platform sekaligus.
// Di installer Windows, hanya satu yang berguna.
const PREBUILD_DIPAKAI = new Set(['win32-x64']);

function ukuran(p) {
    let n = 0;
    for (const f of fs.readdirSync(p, { withFileTypes: true })) {
        const anak = path.join(p, f.name);
        n += f.isDirectory() ? ukuran(anak) : fs.statSync(anak).size;
    }
    return n;
}

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

exports.default = async function (context) {
    const keluar = context.appOutDir;
    let hemat = 0;

    // --- bahasa ---
    const dirBahasa = path.join(keluar, 'locales');
    if (fs.existsSync(dirBahasa)) {
        let dibuang = 0;
        for (const f of fs.readdirSync(dirBahasa)) {
            if (!f.endsWith('.pak') || BAHASA.has(f)) continue;
            const p = path.join(dirBahasa, f);
            hemat += fs.statSync(p).size;
            fs.unlinkSync(p);
            dibuang++;
        }
        console.log(`  • pangkas bahasa      dibuang=${dibuang} disimpan=${[...BAHASA].join(', ')}`);
    }

    // --- prebuild native untuk platform lain ---
    const dirPre = path.join(
        keluar, 'resources', 'app.asar.unpacked', 'node_modules',
        '@serialport', 'bindings-cpp', 'prebuilds'
    );
    if (fs.existsSync(dirPre)) {
        let dibuang = 0;
        for (const d of fs.readdirSync(dirPre)) {
            if (PREBUILD_DIPAKAI.has(d)) continue;
            const p = path.join(dirPre, d);
            hemat += ukuran(p);
            fs.rmSync(p, { recursive: true, force: true });
            dibuang++;
        }
        console.log(`  • pangkas prebuild    dibuang=${dibuang} disimpan=${[...PREBUILD_DIPAKAI].join(', ')}`);
    }

    console.log(`  • total dipangkas     ${mb(hemat)}`);
};
