// Menguji logika nav:go yang sudah diperbaiki, disalin apa adanya dari
// main.js aplikasi, terhadap halaman yang benar-benar memasang beforeunload
// pembatal di Chromium sungguhan.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
const tidur = (ms) => new Promise(r => setTimeout(r, ms));

let win = null;
let pindahDisetujui = false;

// --- salinan persis dari main.js ---
async function navGo(halaman) {
    const target = path.join(__dirname, halaman);
    if (!fs.existsSync(target)) return { ok: false, error: 'file not found' };

    let boleh = true;
    try {
        boleh = await win.webContents.executeJavaScript(
            'typeof window.bolehTinggalkanHalaman === "function"'
            + ' ? window.bolehTinggalkanHalaman() : true'
        );
    } catch (err) {
        boleh = true;
    }
    if (!boleh) return { ok: false, error: 'dibatalkan pengguna' };

    pindahDisetujui = true;
    const lepasIzin = () => { pindahDisetujui = false; };
    const jaringPengaman = setTimeout(lepasIzin, 5000);
    win.webContents.once('did-stop-loading', () => { clearTimeout(jaringPengaman); lepasIzin(); });
    win.loadFile(target).catch(() => { clearTimeout(jaringPengaman); lepasIzin(); });
    await tidur(600);
    return { ok: true };
}

// Memberi halaman interaksi pengguna sungguhan; tanpa itu Chromium mengabaikan
// pembatalan beforeunload dan uji ini tidak menguji apa pun.
async function sentuh() {
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 80, y: 60, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 80, y: 60, button: 'left', clickCount: 1 });
    await tidur(250);
}

// Menyiapkan kasus berikutnya. Halaman sebelumnya bisa saja menahan unload,
// jadi loadFile telanjang di sini akan menggantung - persis jebakan yang
// baru saja diperbaiki di kode produksi.
async function paksaMuat(nama) {
    pindahDisetujui = true;
    win.loadFile(path.join(__dirname, nama)).catch(() => {});
    await tidur(700);
    pindahDisetujui = false;
}

const judul = () => win.webContents.executeJavaScript('document.querySelector("h1").innerText');

app.whenReady().then(async () => {
    win = new BrowserWindow({ show: true, width: 500, height: 300 });
    win.webContents.on('will-prevent-unload', (event) => {
        if (pindahDisetujui) { event.preventDefault(); return; }
        // Di aplikasi ini menampilkan dialog sistem; dalam uji cukup ditolak,
        // yang meniru pengguna menekan "Batal".
    });

    const gagal = [];
    const cek = (syarat, pesan) => { if (!syarat) gagal.push(pesan); };

    // --- 1. Penjaga mengizinkan: harus benar-benar pindah ---
    await paksaMuat('kotor-izinkan.html');
    await sentuh();
    let r = await navGo('tujuan.html');
    cek(r.ok === true, '1: nav:go melapor gagal: ' + JSON.stringify(r));
    cek(await judul() === 'TUJUAN', '1: tidak berpindah walau penjaga mengizinkan');

    // --- 2. Penjaga menolak: tetap di halaman, dan dilaporkan ---
    await paksaMuat('kotor-tolak.html');
    await sentuh();
    r = await navGo('tujuan.html');
    cek(r.ok === false, '2: penolakan tidak dilaporkan');
    cek(await judul() === 'TOLAK', '2: berpindah padahal penjaga menolak');

    // --- 3. Halaman tanpa penjaga & tanpa beforeunload: pindah biasa ---
    await paksaMuat('polos.html');
    await sentuh();
    r = await navGo('tujuan.html');
    cek(r.ok === true, '3: halaman polos gagal pindah');
    cek(await judul() === 'TUJUAN', '3: halaman polos tidak berpindah');

    // --- 4. Penjaga yang melempar galat TIDAK BOLEH mengunci aplikasi ---
    await paksaMuat('kotor-rusak.html');
    await sentuh();
    r = await navGo('tujuan.html');
    cek(r.ok === true, '4: penjaga rusak membuat nav:go gagal');
    cek(await judul() === 'TUJUAN', '4: penjaga rusak mengunci halaman');

    // --- 5. Regresi: tanpa penjaga tapi DENGAN beforeunload pembatal,
    //        yaitu keadaan sebelum diperbaiki. pindahDisetujui harus tetap
    //        meloloskannya, supaya halaman lama tidak ikut terkunci. ---
    await paksaMuat('kotor-tanpa-penjaga.html');
    await sentuh();
    r = await navGo('tujuan.html');
    cek(await judul() === 'TUJUAN', '5: halaman dengan beforeunload tanpa penjaga masih terkunci');

    fs.writeFileSync(path.join(__dirname, 'hasil.json'),
        JSON.stringify({ lulus: gagal.length === 0, gagal }, null, 2));
    app.exit(gagal.length ? 1 : 0);
});
