// Minimal Electron harness: loads the real annotator.js inside actual
// Chromium, mounts it in classification mode, then checks the result.
// Uses Electron, which is already an app dependency - no new test package
// added to the public repo.
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: false },
    });
    let keluar = 1;
    win.webContents.on('console-message', (e) => {
        const teks = typeof e === 'string' ? e : (e && e.message) || '';
        if (teks) console.log(teks);
    });
    // The result is written to a file, not just stdout: Electron's stdout on
    // Windows doesn't always get flushed before the process exits.
    const fs = require('fs');
    const tujuan = path.join(__dirname, 'hasil.json');
    const tulis = (o) => { try { fs.writeFileSync(tujuan, JSON.stringify(o, null, 2)); } catch (_) {} };

    // Never hang: if the page doesn't finish, report that.
    const batas = setTimeout(() => { tulis({ lulus: false, gagal: ['timed out'] }); app.exit(1); }, 30000);

    try {
        await win.loadFile(path.join(__dirname, 'uji.html'));
        let hasil = null;
        for (let i = 0; i < 60 && !hasil; i++) {
            hasil = await win.webContents.executeJavaScript('window.__hasilUji || null');
            if (!hasil) await new Promise(r => setTimeout(r, 250));
        }
        tulis(hasil || { lulus: false, gagal: ['test produced nothing'] });
        keluar = hasil && hasil.lulus ? 0 : 1;
    } catch (err) {
        tulis({ lulus: false, gagal: ['harness error: ' + err.message] });
    }
    clearTimeout(batas);
    app.exit(keluar);
});
