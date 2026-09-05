// Modbus for PLCs — writes coils from inspection results.
//
// Why Modbus, not a brand-specific protocol: nearly every PLC used on
// production lines (Omron, Mitsubishi, Delta, Siemens via a module,
// Schneider, Wecon, and their clones) speaks Modbus. So there's no firmware
// that needs to be uploaded to the PLC - just map its coil addresses.
// Different from Arduino/ESP32, which do need a sketch.
//
// Two ways to connect:
//   RTU  - serial cable / RS-485 via a USB converter
//   TCP  - Ethernet network
//
// Written with no external library. Modbus is a small protocol, and this
// repo is public: one more dependency means one more door to keep watched.

const net = require('net');

let SerialPort = null;
try { ({ SerialPort } = require('serialport')); } catch (_) { /* reported when used */ }

// ---------------------------------------------------------------- CRC & frames

// Modbus CRC16 (polynomial 0xA001, seed 0xFFFF).
function crc16(buf) {
    let crc = 0xFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let b = 0; b < 8; b++) {
            crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
        }
    }
    return crc;
}

// PDU: write a single coil (0x05). ON value = 0xFF00, OFF = 0x0000.
function pduTulisSatu(alamat, nyala) {
    const b = Buffer.alloc(5);
    b[0] = 0x05;
    b.writeUInt16BE(alamat, 1);
    b.writeUInt16BE(nyala ? 0xFF00 : 0x0000, 3);
    return b;
}

// PDU: write multiple consecutive coils (0x0F). The first bit occupies the
// lowest bit of the first byte - this ordering is often mixed up and results
// in the wrong coil lighting up, off by one.
function pduTulisBanyak(alamatAwal, nilai) {
    const jumlahByte = Math.ceil(nilai.length / 8);
    const data = Buffer.alloc(jumlahByte);
    nilai.forEach((n, i) => { if (n) data[i >> 3] |= (1 << (i & 7)); });
    const b = Buffer.alloc(6 + jumlahByte);
    b[0] = 0x0F;
    b.writeUInt16BE(alamatAwal, 1);
    b.writeUInt16BE(nilai.length, 3);
    b[5] = jumlahByte;
    data.copy(b, 6);
    return b;
}

function bingkaiRTU(unit, pdu) {
    const tanpaCrc = Buffer.concat([Buffer.from([unit]), pdu]);
    const crc = crc16(tanpaCrc);
    return Buffer.concat([tanpaCrc, Buffer.from([crc & 0xFF, (crc >> 8) & 0xFF])]);
}

let nomorTransaksi = 0;
function bingkaiTCP(unit, pdu) {
    nomorTransaksi = (nomorTransaksi + 1) & 0xFFFF;
    const kepala = Buffer.alloc(7);
    kepala.writeUInt16BE(nomorTransaksi, 0);   // transaction number
    kepala.writeUInt16BE(0, 2);                // Modbus protocol = 0
    kepala.writeUInt16BE(pdu.length + 1, 4);   // length: unit + pdu
    kepala[6] = unit;
    return Buffer.concat([kepala, pdu]);
}

exports.crc16 = crc16;
exports.pduTulisSatu = pduTulisSatu;
exports.pduTulisBanyak = pduTulisBanyak;
exports.bingkaiRTU = bingkaiRTU;
exports.bingkaiTCP = bingkaiTCP;

// ---------------------------------------------------------------- send plan

// Build the commands for a set of coils.
//
// If the addresses are consecutive with no gaps, they all fit in ONE frame
// (0x0F) - a single round trip, and the PLC applies it all at once.
//
// If there's a gap, each coil is sent on its own (0x05). Writing a single
// block that spans the gap would also change a coil belonging to a different
// program on the same PLC - a silent failure far more costly than a few extra frames.
exports.rencana = (coil) => {
    if (!coil.length) return [];
    const urut = coil.slice().sort((a, b) => a.alamat - b.alamat);
    const berurutan = urut.every((c, i) => i === 0 || c.alamat === urut[i - 1].alamat + 1);
    if (berurutan && urut.length > 1) {
        return [{ jenis: 'banyak', alamat: urut[0].alamat, nilai: urut.map((c) => !!c.nyala) }];
    }
    return urut.map((c) => ({ jenis: 'satu', alamat: c.alamat, nyala: !!c.nyala }));
};

function pduDari(langkah) {
    return langkah.jenis === 'banyak'
        ? pduTulisBanyak(langkah.alamat, langkah.nilai)
        : pduTulisSatu(langkah.alamat, langkah.nyala);
}
exports.pduDari = pduDari;

// ---------------------------------------------------------------- connection

let sambungan = null;   // { jenis:'rtu'|'tcp', unit, tulis(buf), tutup(), info }

exports.status = () => (sambungan
    ? { tersambung: true, jenis: sambungan.jenis, info: sambungan.info }
    : { tersambung: false });

exports.tutup = () => {
    if (!sambungan) return;
    try { sambungan.tutup(); } catch (_) { /* already closed */ }
    sambungan = null;
};

exports.sambung = (dev) => new Promise((selesai) => {
    exports.tutup();
    const unit = parseInt(dev.unit, 10) || 1;

    if (dev.koneksi === 'tcp') {
        const host = String(dev.host || '').trim();
        const porta = parseInt(dev.porta, 10) || 502;
        if (!host) { selesai({ ok: false, error: 'Alamat IP PLC belum diisi.' }); return; }

        const soket = new net.Socket();
        let sudah = false;
        const gagal = (e) => {
            if (sudah) return;
            sudah = true;
            try { soket.destroy(); } catch (_) { }
            selesai({ ok: false, error: e.message || String(e) });
        };
        soket.setTimeout(4000);
        soket.once('error', gagal);
        soket.once('timeout', () => gagal(new Error(`Tidak ada jawaban dari ${host}:${porta} dalam 4 detik.`)));
        soket.connect(porta, host, () => {
            if (sudah) return;
            sudah = true;
            soket.setTimeout(0);
            soket.removeListener('error', gagal);
            soket.on('error', () => { /* dropped mid-way: reported when writing */ });
            sambungan = {
                jenis: 'tcp', unit,
                info: `${host}:${porta} unit ${unit}`,
                tulis: (pdu) => new Promise((r, j) => soket.write(bingkaiTCP(unit, pdu), (e) => (e ? j(e) : r()))),
                tutup: () => soket.destroy(),
            };
            selesai({ ok: true, info: sambungan.info });
        });
        return;
    }

    // RTU over serial
    if (!SerialPort) { selesai({ ok: false, error: 'Modul serialport tidak tersedia.' }); return; }
    const jalur = String(dev.port || '').trim();
    if (!jalur) { selesai({ ok: false, error: 'Port serial belum dipilih.' }); return; }

    const sp = new SerialPort({
        path: jalur,
        baudRate: parseInt(dev.baud, 10) || 9600,
        dataBits: 8,
        parity: dev.paritas === 'even' ? 'even' : (dev.paritas === 'odd' ? 'odd' : 'none'),
        stopBits: parseInt(dev.stopBits, 10) === 2 ? 2 : 1,
    }, (err) => {
        if (err) { selesai({ ok: false, error: `Port ${jalur} tidak bisa dibuka: ${err.message}` }); return; }
        sambungan = {
            jenis: 'rtu', unit,
            info: `${jalur} @ ${dev.baud || 9600} unit ${unit}`,
            tulis: (pdu) => new Promise((r, j) => sp.write(bingkaiRTU(unit, pdu), (e) => (e ? j(e) : sp.drain(() => r())))),
            tutup: () => sp.close(() => { }),
        };
        selesai({ ok: true, info: sambungan.info });
    });
});

// Send the state of a set of coils. Does not wait for a PLC reply: the next
// inspection cycle must not be held up waiting for an answer, and a write
// failure is already detected from the socket/port itself.
exports.tulisCoil = async (coil) => {
    if (!sambungan) return { ok: false, error: 'Belum tersambung ke PLC.' };
    const langkah = exports.rencana(coil);
    if (!langkah.length) return { ok: false, error: 'Tidak ada coil yang dipetakan.' };
    try {
        for (const l of langkah) await sambungan.tulis(pduDari(l));
        return {
            ok: true,
            bingkai: langkah.length,
            cara: langkah[0].jenis === 'banyak' ? 'satu blok (0x0F)' : `${langkah.length} coil terpisah (0x05)`,
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
};
