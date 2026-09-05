// Tests the fixed nav:go logic, copied verbatim from the app's main.js,
// against a page that actually installs a canceling beforeunload in real Chromium.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
const tidur = (ms) => new Promise(r => setTimeout(r, ms));

let win = null;
let pindahDisetujui = false;

// --- exact copy from main.js ---
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

// Gives the page a real user interaction; without it Chromium ignores the
// beforeunload cancellation and this test wouldn't test anything.
async function sentuh() {
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 80, y: 60, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 80, y: 60, button: 'left', clickCount: 1 });
    await tidur(250);
}

// Sets up the next case. The previous page might hold up the unload, so a
// bare loadFile here would hang - exactly the trap that was just fixed in the production code.
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
        // In the app this shows a system dialog; in the test it's simply
        // rejected, which mimics the user pressing "Cancel".
    });

    const gagal = [];
    const cek = (syarat, pesan) => { if (!syarat) gagal.push(pesan); };

    // --- 1. Guard allows: must actually navigate ---
    await paksaMuat('kotor-izinkan.html');
    await sentuh();
    let r = await navGo('tujuan.html');
    cek(r.ok === true, '1: nav:go reported failure: ' + JSON.stringify(r));
    cek(await judul() === 'TUJUAN', '1: did not navigate even though the guard allowed it');

    // --- 2. Guard rejects: stays on the page, and it's reported ---
    await paksaMuat('kotor-tolak.html');
    await sentuh();
    r = await navGo('tujuan.html');
    cek(r.ok === false, '2: rejection was not reported');
    cek(await judul() === 'TOLAK', '2: navigated even though the guard rejected it');

    // --- 3. Page with no guard & no beforeunload: navigates normally ---
    await paksaMuat('polos.html');
    await sentuh();
    r = await navGo('tujuan.html');
    cek(r.ok === true, '3: plain page failed to navigate');
    cek(await judul() === 'TUJUAN', '3: plain page did not navigate');

    // --- 4. A guard that throws an error MUST NOT lock up the app ---
    await paksaMuat('kotor-rusak.html');
    await sentuh();
    r = await navGo('tujuan.html');
    cek(r.ok === true, '4: broken guard made nav:go fail');
    cek(await judul() === 'TUJUAN', '4: broken guard locked the page');

    // --- 5. Regression: no guard but WITH a canceling beforeunload,
    //        i.e. the state before the fix. pindahDisetujui must still let
    //        it through, so old pages don't end up locked. ---
    await paksaMuat('kotor-tanpa-penjaga.html');
    await sentuh();
    r = await navGo('tujuan.html');
    cek(await judul() === 'TUJUAN', '5: page with beforeunload and no guard is still locked');

    fs.writeFileSync(path.join(__dirname, 'hasil.json'),
        JSON.stringify({ lulus: gagal.length === 0, gagal }, null, 2));
    app.exit(gagal.length ? 1 : 0);
});
