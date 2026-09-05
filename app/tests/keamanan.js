// Tests for the guards on values coming from the renderer (lib/keamanan.js).
//
// Run with plain node - no Electron needed. What's tested here are the rules
// that, if wrong, would give a compromised renderer page the ability to run
// any program or write a file anywhere.
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

// Roots that mimic real conditions: the project folder and the firmware folder.
const AKAR_PROJECT = path.join(os.tmpdir(), 'automaeyes-uji', 'projects');
const AKAR_FIRMWARE = path.join(os.tmpdir(), 'automaeyes-uji', 'firmware');
const AKAR = [AKAR_PROJECT, AKAR_FIRMWARE];
const di = (...bagian) => path.join(AKAR_PROJECT, ...bagian);

console.log('bolehDibuka');

uji('allows a report inside the project folder', () => {
    assert.strictEqual(bolehDibuka(di('P1', 'outputs', 'laporan_2026-09-05.xlsx'), AKAR), true);
});

uji('allows the guide in the firmware folder', () => {
    assert.strictEqual(bolehDibuka(path.join(AKAR_FIRMWARE, 'BACA-SAYA.md'), AKAR), true);
});

uji('allows the root folder itself', () => {
    assert.strictEqual(bolehDibuka(AKAR_PROJECT, AKAR), true);
});

uji('rejects a path outside the allowed folders', () => {
    assert.strictEqual(bolehDibuka(path.join(os.tmpdir(), 'lain', 'a.xlsx'), AKAR), false);
});

uji('rejects escaping via ".."', () => {
    assert.strictEqual(bolehDibuka(di('..', '..', 'Windows', 'notepad.txt'), AKAR), false);
});

uji('rejects a sibling folder whose name starts the same way', () => {
    // Without a path-separator check, "projects-lain" would pass just
    // because it starts with "projects".
    assert.strictEqual(bolehDibuka(AKAR_PROJECT + '-lain', AKAR), false);
});

uji('rejects an executable file even INSIDE the project folder', () => {
    // The project folder is synced from a GitHub repo too, so a foreign
    // file could well end up landing there.
    for (const ext of ['.exe', '.bat', '.cmd', '.ps1', '.lnk', '.vbs', '.hta', '.reg']) {
        assert.strictEqual(bolehDibuka(di('P1', 'jahat' + ext), AKAR), false, ext + ' passed');
    }
});

uji('ignores case in the extension', () => {
    assert.strictEqual(bolehDibuka(di('P1', 'jahat.ExE'), AKAR), false);
});

uji('rejects empty and non-string values', () => {
    for (const nilai of ['', '   ', null, undefined, 42, {}, []]) {
        assert.strictEqual(bolehDibuka(nilai, AKAR), false, JSON.stringify(nilai) + ' passed');
    }
});

uji('rejects everything when the root list is empty', () => {
    assert.strictEqual(bolehDibuka(di('P1', 'a.xlsx'), []), false);
    assert.strictEqual(bolehDibuka(di('P1', 'a.xlsx'), undefined), false);
});

console.log('tanggalSah');

uji('accepts a valid date', () => {
    for (const d of ['2026-09-05', '2024-02-29', '1999-12-31']) {
        assert.strictEqual(tanggalSah(d), true, d + ' rejected');
    }
});

uji('rejects folder escapes', () => {
    for (const d of ['../../etc', '..', '2026-09-05/../..', '2026-09-05\\..\\..']) {
        assert.strictEqual(tanggalSah(d), false, JSON.stringify(d) + ' passed');
    }
});

uji('rejects a date with a valid shape but that does not exist', () => {
    for (const d of ['2026-02-31', '2026-13-01', '2026-00-10', '2023-02-29']) {
        assert.strictEqual(tanggalSah(d), false, d + ' passed');
    }
});

uji('rejects other shapes', () => {
    for (const d of ['2026-9-5', '20260905', '', null, undefined, 20260905, {}]) {
        assert.strictEqual(tanggalSah(d), false, JSON.stringify(d) + ' passed');
    }
});

console.log(gagal ? `\n${gagal} uji GAGAL` : '\nKEAMANAN LULUS');
process.exit(gagal ? 1 : 0);
