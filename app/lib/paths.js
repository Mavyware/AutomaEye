// lib/paths.js — lokasi skrip Python, baik saat dev maupun setelah dipaketkan.
//
// Kenapa perlu:
//   1. Skrip dipanggil lewat path relatif ("python/train.py") dan di-spawn
//      tanpa cwd. Saat dev kebetulan benar karena cwd = folder app, tapi
//      aplikasi terpasang bisa dijalankan dari folder mana saja.
//   2. Setelah dipaketkan, kode aplikasi berada di dalam app.asar. Python
//      TIDAK bisa menjalankan berkas di dalam arsip itu, jadi folder python/
//      sengaja ditaruh di luar asar (extraResources) dan di-resolve ke
//      process.resourcesPath.

const path = require('path');
const { app } = require('electron');

/** Folder berisi skrip Python (train.py, infer_server.py, evaluate.py, ...). */
function pythonDir() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'python')
        : path.join(__dirname, '..', 'python');
}

/**
 * Path absolut sebuah skrip Python.
 * Menerima "train.py" maupun "python/train.py" (bentuk lama di config.yaml),
 * keduanya diselesaikan ke folder python yang benar.
 */
function pythonScript(nameOrRelPath, fallback) {
    const raw = String(nameOrRelPath || fallback || '');
    return path.join(pythonDir(), path.basename(raw));
}

exports.pythonDir = pythonDir;
exports.pythonScript = pythonScript;
