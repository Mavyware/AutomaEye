// Uji penjagaan nilai yang datang dari renderer (lib/keamanan.js).
//
// Dijalankan dengan node biasa - tidak perlu Electron. Yang diuji di sini
// adalah aturan yang, kalau salah, memberi halaman renderer yang disusupi
// kemampuan menjalankan program apa pun atau menulis berkas ke mana pun.
//
//   node tests/keamanan.js

const assert = require('assert');
const path = require('path');
const os = require('os');
const { bolehDibuka, tanggalSah } = require('../lib/keamanan');

let gagal = 0;
function uji(nama, fn) {
    try {
        fn();
        console.log('  ok   ' + nama);
    } catch (e) {
        gagal++;
        console.log('  GAGAL ' + nama + '\n        ' + e.message);
    }
}

// Akar yang meniru keadaan sebenarnya: folder project dan folder firmware.
const AKAR_PROJECT = path.join(os.tmpdir(), 'automaeyes-uji', 'projects');
const AKAR_FIRMWARE = path.join(os.tmpdir(), 'automaeyes-uji', 'firmware');
const AKAR = [AKAR_PROJECT, AKAR_FIRMWARE];
const di = (...bagian) => path.join(AKAR_PROJECT, ...bagian);

console.log('bolehDibuka');

uji('mengizinkan laporan di dalam folder project', () => {
    assert.strictEqual(bolehDibuka(di('P1', 'outputs', 'laporan_2026-09-05.xlsx'), AKAR), true);
});

uji('mengizinkan panduan di folder firmware', () => {
    assert.strictEqual(bolehDibuka(path.join(AKAR_FIRMWARE, 'BACA-SAYA.md'), AKAR), true);
});

uji('mengizinkan folder akarnya sendiri', () => {
    assert.strictEqual(bolehDibuka(AKAR_PROJECT, AKAR), true);
});

uji('menolak path di luar folder yang diizinkan', () => {
    assert.strictEqual(bolehDibuka(path.join(os.tmpdir(), 'lain', 'a.xlsx'), AKAR), false);
});

uji('menolak jalan keluar lewat ".."', () => {
    assert.strictEqual(bolehDibuka(di('..', '..', 'Windows', 'notepad.txt'), AKAR), false);
});

uji('menolak folder bersaudara yang namanya berawalan sama', () => {
    // Tanpa pemeriksaan pemisah path, "projects-lain" lolos hanya karena
    // diawali "projects".
    assert.strictEqual(bolehDibuka(AKAR_PROJECT + '-lain', AKAR), false);
});

uji('menolak berkas yang dapat dieksekusi walau ada DI DALAM folder project', () => {
    // Folder project ikut disinkronkan dari repo GitHub, jadi berkas asing
    // bisa saja mendarat di sana.
    for (const ext of ['.exe', '.bat', '.cmd', '.ps1', '.lnk', '.vbs', '.hta', '.reg']) {
        assert.strictEqual(bolehDibuka(di('P1', 'jahat' + ext), AKAR), false, ext + ' lolos');
    }
});

uji('tidak peduli huruf besar-kecil pada ekstensi', () => {
    assert.strictEqual(bolehDibuka(di('P1', 'jahat.ExE'), AKAR), false);
});

uji('menolak nilai kosong dan bukan-teks', () => {
    for (const nilai of ['', '   ', null, undefined, 42, {}, []]) {
        assert.strictEqual(bolehDibuka(nilai, AKAR), false, JSON.stringify(nilai) + ' lolos');
    }
});

uji('menolak apa pun kalau daftar akar kosong', () => {
    assert.strictEqual(bolehDibuka(di('P1', 'a.xlsx'), []), false);
    assert.strictEqual(bolehDibuka(di('P1', 'a.xlsx'), undefined), false);
});

console.log('tanggalSah');

uji('menerima tanggal yang benar', () => {
    for (const d of ['2026-09-05', '2024-02-29', '1999-12-31']) {
        assert.strictEqual(tanggalSah(d), true, d + ' ditolak');
    }
});

uji('menolak jalan keluar folder', () => {
    for (const d of ['../../etc', '..', '2026-09-05/../..', '2026-09-05\\..\\..']) {
        assert.strictEqual(tanggalSah(d), false, JSON.stringify(d) + ' lolos');
    }
});

uji('menolak tanggal yang bentuknya benar tapi tidak ada', () => {
    for (const d of ['2026-02-31', '2026-13-01', '2026-00-10', '2023-02-29']) {
        assert.strictEqual(tanggalSah(d), false, d + ' lolos');
    }
});

uji('menolak bentuk lain', () => {
    for (const d of ['2026-9-5', '20260905', '', null, undefined, 20260905, {}]) {
        assert.strictEqual(tanggalSah(d), false, JSON.stringify(d) + ' lolos');
    }
});

console.log(gagal ? `\n${gagal} uji GAGAL` : '\nKEAMANAN LULUS');
process.exit(gagal ? 1 : 0);
