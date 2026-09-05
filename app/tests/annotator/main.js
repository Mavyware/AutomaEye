// Harness Electron minimal: memuat annotator.js yang asli di dalam Chromium
// sungguhan, memasangnya dalam mode klasifikasi, lalu memeriksa hasilnya.
// Memakai Electron yang memang sudah jadi dependensi aplikasi - tidak ada
// paket uji baru yang ditambahkan ke repo publik.
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
    // Hasil ditulis ke berkas, bukan hanya stdout: stdout Electron di Windows
    // tidak selalu ikut ter-flush sebelum proses keluar.
    const fs = require('fs');
    const tujuan = path.join(__dirname, 'hasil.json');
    const tulis = (o) => { try { fs.writeFileSync(tujuan, JSON.stringify(o, null, 2)); } catch (_) {} };

    // Jangan pernah menggantung: kalau halaman tidak selesai, laporkan itu.
    const batas = setTimeout(() => { tulis({ lulus: false, gagal: ['waktu habis'] }); app.exit(1); }, 30000);

    try {
        await win.loadFile(path.join(__dirname, 'uji.html'));
        let hasil = null;
        for (let i = 0; i < 60 && !hasil; i++) {
            hasil = await win.webContents.executeJavaScript('window.__hasilUji || null');
            if (!hasil) await new Promise(r => setTimeout(r, 250));
        }
        tulis(hasil || { lulus: false, gagal: ['uji tidak menghasilkan apa pun'] });
        keluar = hasil && hasil.lulus ? 0 : 1;
    } catch (err) {
        tulis({ lulus: false, gagal: ['galat harness: ' + err.message] });
    }
    clearTimeout(batas);
    app.exit(keluar);
});
