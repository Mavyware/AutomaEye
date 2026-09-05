// Catalog of output devices (Arduino / ESP32 / PLC) and port scanner.
//
// Used by the Output page: the user picks a device, then maps each model
// class to one output - a pin on the board, or a coil address on the PLC.
// This module only supplies the knowledge; sending the actual signal is
// still handled by lib/arduino.js (board) and lib/modbus.js (PLC).

const arduino = require('./arduino');

// Range of pins that are safe to use as digital outputs.
//
// Deliberately NOT included:
//   - Arduino pins 0 and 1: those are the serial lines this app uses to talk
//     to the board. Using them as outputs breaks its own connection, and the
//     symptom is confusing - the board seems to disappear.
//   - ESP32 GPIO 6-11: wired to internal flash. Toggling them makes the
//     board reboot or fail to boot.
//   - ESP32 GPIO 34-39: input only, cannot drive a voltage out.
const rentang = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const KATALOG = {
    arduino: {
        nama: 'Arduino',
        baudBawaan: 9600,
        papan: {
            uno:      { nama: 'Arduino Uno',        pin: [...rentang(2, 13), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'] },
            nano:     { nama: 'Arduino Nano',       pin: [...rentang(2, 13), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'] },
            mega2560: { nama: 'Arduino Mega 2560',  pin: rentang(2, 53) },
            leonardo: { nama: 'Arduino Leonardo',   pin: [...rentang(2, 13), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'] },
            promicro: { nama: 'Arduino Pro Micro',  pin: [2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16, 18, 19, 20, 21] },
        },
    },
    esp32: {
        nama: 'ESP32',
        baudBawaan: 115200,
        papan: {
            devkitv1: { nama: 'ESP32 DevKit V1',    pin: [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33] },
            nodemcu32: { nama: 'NodeMCU-32S',       pin: [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33] },
            s3:       { nama: 'ESP32-S3',           pin: [...rentang(1, 21), ...rentang(35, 45)] },
            c3:       { nama: 'ESP32-C3',           pin: [...rentang(0, 10), 18, 19, 20, 21] },
        },
    },
    // PLCs don't need firmware: nearly all of them already speak Modbus out
    // of the box. What's mapped isn't a physical pin but a coil address, and
    // that address is determined by the PLC's own program - the list of
    // brands below only gives a common starting point, not a guarantee.
    // Always match it against the mapping in your PLC program.
    plc: {
        nama: 'PLC (Modbus)',
        baudBawaan: 9600,
        alamatCoil: true,                 // mapped by address, not a pin list
        papan: {
            umum:       { nama: 'Modbus umum', basis: 0, catatan: 'Alamat coil apa adanya, sesuai program PLC.' },
            omron:      { nama: 'Omron CP1 / CJ', basis: 0, catatan: 'Coil biasanya dipetakan dari area CIO.' },
            mitsubishi: { nama: 'Mitsubishi FX', basis: 0, catatan: 'Coil umumnya menunjuk keluaran Y.' },
            delta:      { nama: 'Delta DVP / AS', basis: 0, catatan: 'Coil umumnya menunjuk keluaran Y.' },
            siemens:    { nama: 'Siemens S7 (modul Modbus)', basis: 0, catatan: 'Alamat mengikuti blok Modbus yang dikonfigurasi.' },
            schneider:  { nama: 'Schneider M221 / M241', basis: 0, catatan: 'Alamat mengikuti tabel %M / %Q yang dipetakan.' },
            wecon:      { nama: 'Wecon / Xinje', basis: 0, catatan: 'Coil umumnya menunjuk keluaran Y.' },
        },
    },
};

// Connection methods. For now only USB serial actually works;
// the others are listed to be clear they're not yet available, not hidden.
const KONEKSI = {
    usb: { nama: 'Kabel USB (serial)', siap: true, untuk: ['arduino', 'esp32'] },
    rtu: { nama: 'Modbus RTU (serial / RS-485)', siap: true, untuk: ['plc'] },
    tcp: { nama: 'Modbus TCP (Ethernet)', siap: true, untuk: ['plc'] },
    wifi: { nama: 'Wi-Fi (jaringan)', siap: false, catatan: 'Belum tersedia', untuk: ['esp32'] },
};

exports.KATALOG = KATALOG;
exports.KONEKSI = KONEKSI;

// Guess the board type from the USB vendor ID. Not a certainty - one USB
// chip is used by many boards - so the result is only used as a suggestion,
// and the user still makes the final choice.
function tebakDari(p) {
    const vid = String(p.vendorId || '').toLowerCase();
    const teks = ((p.manufacturer || '') + ' ' + (p.friendlyName || '')).toLowerCase();
    if (vid === '303a' || /esp32|espressif/.test(teks)) return 'esp32';
    if (vid === '2341' || vid === '2a03' || /arduino/.test(teks)) return 'arduino';
    if (vid === '10c4') return 'esp32';     // CP210x, common on ESP32 DevKit
    if (vid === '1a86' || vid === '0403') return 'arduino'; // CH340 / FTDI, common on Arduino clones
    return null;
}

function kemungkinanPapan(p) {
    const s = ((p.manufacturer || '') + ' ' + (p.friendlyName || '') + ' ' + (p.pnpId || '')).toLowerCase();
    const vid = String(p.vendorId || '').toLowerCase();
    return /wch|ch340|ch910|silabs|cp210|arduino|espressif|usb-serial|usb serial|ftdi/.test(s)
        || ['1a86', '10c4', '2341', '2a03', '0403', '303a'].includes(vid);
}

// Scan serial ports. Always returns every port, flagging which ones are
// likely a board - unrecognized ports are still shown so an unusual board
// doesn't end up impossible to select.
exports.pindai = async () => {
    const ports = await arduino.listPorts();
    return ports.map((p) => ({
        path: p.path,
        nama: p.friendlyName || p.manufacturer || p.path,
        pabrikan: p.manufacturer || '',
        vendorId: p.vendorId || '',
        productId: p.productId || '',
        kemungkinanPapan: kemungkinanPapan(p),
        tebakan: tebakDari(p),
        dipakaiSekarang: p.path === arduino.connectedPort(),
    }));
};

// List of pins that may be selected for a given board.
exports.pinPapan = (jenis, papan) => {
    const j = KATALOG[jenis];
    if (!j) return [];
    const b = j.papan[papan];
    return b ? b.pin.slice() : [];
};

// Validate the configuration before saving. Returns a list of issues in
// human-readable form - empty means it's safe.
exports.periksa = (cfg) => {
    const masalah = [];
    if (!cfg || !cfg.device) return ['Perangkat belum dipilih.'];
    const { jenis, papan, port } = cfg.device;

    if (!KATALOG[jenis]) masalah.push('Jenis perangkat tidak dikenal.');
    else if (!KATALOG[jenis].papan[papan]) masalah.push('Seri papan belum dipilih.');

    if (jenis === 'plc' && cfg.device.koneksi === 'tcp') {
        if (!String(cfg.device.host || '').trim()) masalah.push('Alamat IP PLC belum diisi.');
    } else if (!port) {
        masalah.push('Port belum dipilih. Tekan Pindai untuk mencarinya.');
    }

    const pakaiAlamat = !!(KATALOG[jenis] && KATALOG[jenis].alamatCoil);
    const sah = pakaiAlamat ? new Set() : new Set(exports.pinPapan(jenis, papan).map(String));
    const terpakai = new Map();
    for (const m of (cfg.pinKelas || [])) {
        if (m.pin === '' || m.pin == null) continue;      // not set yet, not an error
        const pin = String(m.pin);
        if (pakaiAlamat && !/^\d+$/.test(pin)) {
            masalah.push(`Alamat coil "${pin}" bukan angka.`);
            continue;
        }
        if (sah.size && !sah.has(pin)) {
            masalah.push(`Pin ${pin} tidak ada pada ${KATALOG[jenis] && KATALOG[jenis].papan[papan] ? KATALOG[jenis].papan[papan].nama : papan}.`);
            continue;
        }
        // One pin for two classes means they can't be told apart on the
        // machine side - a silent mistake that gets expensive if it's only
        // noticed once the production line is already running.
        const label = `${m.model} / ${m.kelas}`;
        if (terpakai.has(pin)) masalah.push(`Pin ${pin} dipakai dua kali: ${terpakai.get(pin)} dan ${label}.`);
        else terpakai.set(pin, label);
    }
    return masalah;
};
