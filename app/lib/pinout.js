// Send pin states to the board based on the detected class.
//
// The Output page maps each model class to one pin. That mapping is used
// here: once one inspection cycle finishes, every mapped pin is computed as
// on or off, then sent all at once in a single line.
//
// Why one line for all pins, instead of one command per pin:
//   - a single serial write per cycle, not ten - important on a fast-moving
//     line;
//   - the board applies the whole state at once, so there's no half-done
//     moment where two pins that should alternate end up on at the same time.
//
// Format sent:   PINS 7=1,8=0,9=0,10=1\n
// Board replies:  OK\n   (not waited on; the reply is only for diagnostics)
//
// A pin whose class is NOT detected is always sent as off. Without that, the
// previous cycle's state would stick, and the machine would read a class
// that's no longer there.

// Collect the detected class names per model from one cycle's result.
function kelasTerdeteksi(result) {
    const peta = new Map();   // modelName -> Set(class)
    for (const sr of (result.steps || [])) {
        if (!sr.modelName) continue;
        const set = peta.get(sr.modelName) || new Set();
        for (const d of (sr.detections || [])) {
            const nama = d.class_name || d.className || d.name;
            if (nama) set.add(String(nama));
        }
        peta.set(sr.modelName, set);
    }
    return peta;
}

// Compute the state of every mapped pin.
// Returns [{ pin, nyala, aktif, model, kelas }]
exports.hitung = (outputCfg, result) => {
    const daftar = (outputCfg && outputCfg.pinKelas) || [];
    const terdeteksi = kelasTerdeteksi(result);
    return daftar
        .filter((m) => m.pin !== '' && m.pin != null)
        .map((m) => {
            const set = terdeteksi.get(m.model);
            return {
                pin: String(m.pin),
                model: m.model,
                kelas: m.kelas,
                aktif: m.aktif === 'LOW' ? 'LOW' : 'HIGH',
                nyala: !!(set && set.has(m.kelas)),
            };
        });
};

// Build the command line. The value on the wire accounts for the active
// level: for an "active LOW" pin, on means pulling the pin to 0.
exports.baris = (keadaan) => {
    if (!keadaan.length) return null;
    const bagian = keadaan.map((k) => {
        const nilai = k.aktif === 'LOW' ? (k.nyala ? 0 : 1) : (k.nyala ? 1 : 0);
        return `${k.pin}=${nilai}`;
    });
    return 'PINS ' + bagian.join(',') + '\n';
};

// Send to the board. Does not throw: an output failure must not stop an
// inspection cycle that already finished - the result is still logged and shown.
exports.kirim = async (arduino, outputCfg, result) => {
    const keadaan = exports.hitung(outputCfg, result);
    if (!keadaan.length) return { ok: false, alasan: 'tidak ada keluaran yang dipetakan' };

    // A PLC speaks Modbus, not a text line to a board. What's computed is the
    // same - which class is on - only the way it's sent differs.
    const dev = (outputCfg && outputCfg.device) || {};
    if (dev.jenis === 'plc') {
        const modbus = require('./modbus');
        const coil = keadaan.map((k) => ({
            alamat: parseInt(k.pin, 10),
            nyala: k.aktif === 'LOW' ? !k.nyala : k.nyala,
        })).filter((c) => Number.isFinite(c.alamat));
        const r = await modbus.tulisCoil(coil);
        return r.ok
            ? { ok: true, baris: r.cara, nyala: keadaan.filter((k) => k.nyala).map((k) => `${k.model}/${k.kelas}@${k.pin}`) }
            : { ok: false, alasan: r.error };
    }

    const baris = exports.baris(keadaan);
    if (!baris) return { ok: false, alasan: 'tidak ada pin yang dipetakan' };
    try {
        // arduino.send does NOT throw when the port isn't open yet - it
        // replies { ok:false, reason:'not connected' }. If that reply is
        // ignored, the app reports a pin as on even though nothing is
        // connected, and that's only noticed when the machine at the end of
        // the line just sits there doing nothing.
        const r = await arduino.send(baris);
        if (r && r.ok === false) {
            return { ok: false, alasan: r.reason === 'not connected' ? 'papan belum tersambung' : String(r.reason || 'gagal') };
        }
        return {
            ok: true,
            baris: baris.trim(),
            nyala: keadaan.filter((k) => k.nyala).map((k) => `${k.model}/${k.kelas}@${k.pin}`),
        };
    } catch (e) {
        return { ok: false, alasan: e.message };
    }
};
