// Katalog perangkat keluaran (Arduino / ESP32) dan pemindai port.
//
// Dipakai halaman Output: pengguna memilih perangkat, lalu memetakan tiap
// kelas model ke satu pin. Modul ini hanya menyediakan pengetahuan tentang
// papannya - membuka port dan mengirim sinyal tetap urusan lib/arduino.js.

const arduino = require('./arduino');

// Rentang pin yang aman dipakai sebagai keluaran digital.
//
// Yang sengaja TIDAK dimasukkan:
//   - Arduino pin 0 dan 1: itu jalur serial yang dipakai aplikasi ini untuk
//     bicara ke papannya. Memakainya sebagai keluaran memutus koneksinya
//     sendiri, dan gejalanya membingungkan - papan seolah hilang.
//   - ESP32 GPIO 6-11: tersambung ke flash internal. Menggerakkannya membuat
//     papan reboot atau gagal boot.
//   - ESP32 GPIO 34-39: hanya bisa membaca, tidak bisa mengeluarkan tegangan.
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
};

// Cara sambungnya. Untuk sekarang hanya USB serial yang benar-benar jalan;
// yang lain disebut supaya jelas belum tersedia, bukan disembunyikan.
const KONEKSI = {
    usb: { nama: 'Kabel USB (serial)', siap: true },
    wifi: { nama: 'Wi-Fi (jaringan)', siap: false, catatan: 'Belum tersedia' },
};

exports.KATALOG = KATALOG;
exports.KONEKSI = KONEKSI;

// Tebak jenis papan dari vendor ID USB. Bukan kepastian - satu chip USB
// dipakai banyak papan - jadi hasilnya hanya dipakai sebagai saran, dan
// pengguna tetap yang memilih.
function tebakDari(p) {
    const vid = String(p.vendorId || '').toLowerCase();
    const teks = ((p.manufacturer || '') + ' ' + (p.friendlyName || '')).toLowerCase();
    if (vid === '303a' || /esp32|espressif/.test(teks)) return 'esp32';
    if (vid === '2341' || vid === '2a03' || /arduino/.test(teks)) return 'arduino';
    if (vid === '10c4') return 'esp32';     // CP210x, lazim pada DevKit ESP32
    if (vid === '1a86' || vid === '0403') return 'arduino'; // CH340 / FTDI, lazim pada klon Arduino
    return null;
}

function kemungkinanPapan(p) {
    const s = ((p.manufacturer || '') + ' ' + (p.friendlyName || '') + ' ' + (p.pnpId || '')).toLowerCase();
    const vid = String(p.vendorId || '').toLowerCase();
    return /wch|ch340|ch910|silabs|cp210|arduino|espressif|usb-serial|usb serial|ftdi/.test(s)
        || ['1a86', '10c4', '2341', '2a03', '0403', '303a'].includes(vid);
}

// Pindai port serial. Selalu mengembalikan seluruh port, dengan penanda mana
// yang kemungkinan papan - port yang tidak dikenali tetap ditampilkan supaya
// papan tak lazim tidak jadi tak terpilih sama sekali.
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

// Daftar pin yang boleh dipilih untuk satu papan.
exports.pinPapan = (jenis, papan) => {
    const j = KATALOG[jenis];
    if (!j) return [];
    const b = j.papan[papan];
    return b ? b.pin.slice() : [];
};

// Periksa konfigurasi sebelum disimpan. Mengembalikan daftar masalah dalam
// bahasa manusia - kosong berarti aman.
exports.periksa = (cfg) => {
    const masalah = [];
    if (!cfg || !cfg.device) return ['Perangkat belum dipilih.'];
    const { jenis, papan, port } = cfg.device;

    if (!KATALOG[jenis]) masalah.push('Jenis perangkat tidak dikenal.');
    else if (!KATALOG[jenis].papan[papan]) masalah.push('Seri papan belum dipilih.');
    if (!port) masalah.push('Port belum dipilih. Tekan Pindai untuk mencarinya.');

    const sah = new Set(exports.pinPapan(jenis, papan).map(String));
    const terpakai = new Map();
    for (const m of (cfg.pinKelas || [])) {
        if (m.pin === '' || m.pin == null) continue;      // belum diatur, bukan kesalahan
        const pin = String(m.pin);
        if (sah.size && !sah.has(pin)) {
            masalah.push(`Pin ${pin} tidak ada pada ${KATALOG[jenis] && KATALOG[jenis].papan[papan] ? KATALOG[jenis].papan[papan].nama : papan}.`);
            continue;
        }
        // Satu pin untuk dua kelas berarti keduanya tidak bisa dibedakan
        // di sisi mesin - ini kesalahan diam yang mahal kalau baru ketahuan
        // saat lini produksi berjalan.
        const label = `${m.model} / ${m.kelas}`;
        if (terpakai.has(pin)) masalah.push(`Pin ${pin} dipakai dua kali: ${terpakai.get(pin)} dan ${label}.`);
        else terpakai.set(pin, label);
    }
    return masalah;
};
