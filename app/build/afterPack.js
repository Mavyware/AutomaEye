// Trim files that will never be used on the target computer.
//
// Run by electron-builder after the app is packaged, before the installer is
// built. What gets removed here isn't just about saving space: this
// installer gets downloaded to factory computers, sometimes over a slow
// network, so every few dozen megabytes matters.
//
// What is NOT touched, even though it's large:
//   - AutomaEyes.exe (235 MB) is Chromium; it can't be shrunk.
//   - LICENSES.chromium.html (19 MB) is legally required to be included.
//   - dxcompiler.dll + dxil.dll (26 MB) are the DirectX shader compiler,
//     used by the WebGPU path. This app only uses 2D canvas, so removing
//     them looks safe - and it was in fact tested: the app still runs
//     without them. But after compression the difference is only 6.6 MB
//     (108.2 -> 101.6), and if that guess turns out wrong on one factory
//     computer, the symptom is a GPU failure that's extremely hard to trace.
//     Not worth it. Measured, not guessed - don't repeat this without a new reason.

const fs = require('fs');
const path = require('path');

// Languages kept. en-US is required: Chromium uses it as a fallback
// when the requested language isn't available.
const BAHASA = new Set(['en-US.pak', 'id.pak']);

// The native serialport module ships binaries for every platform at once.
// In the Windows installer, only one of them is useful.
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

    // --- languages ---
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

    // --- native prebuilds for other platforms ---
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
