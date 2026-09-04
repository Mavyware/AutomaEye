// Kirim keadaan pin ke papan berdasarkan kelas yang terdeteksi.
//
// Halaman Output memetakan tiap kelas model ke satu pin. Di sini pemetaan itu
// dipakai: setelah satu siklus inspeksi selesai, tiap pin yang terpetakan
// dihitung nyala atau padam, lalu dikirim sekaligus dalam satu baris.
//
// Kenapa satu baris untuk semua pin, bukan satu perintah per pin:
//   - satu penulisan serial per siklus, bukan sepuluh - penting di lini yang
//     berjalan cepat;
//   - papan menerapkan seluruh keadaan sekaligus, jadi tidak ada momen
//     setengah-jadi di mana dua pin menyala bersamaan padahal seharusnya
//     bergantian.
//
// Format yang dikirim:  PINS 7=1,8=0,9=0,10=1\n
// Papan membalas       :  OK\n   (tidak ditunggu; balasan hanya untuk diagnosa)
//
// Pin yang kelasnya TIDAK terdeteksi selalu dikirim padam. Tanpa itu keadaan
// siklus sebelumnya menempel, dan mesin membaca kelas yang sudah tidak ada.

// Kumpulkan nama kelas yang terdeteksi per model dari hasil satu siklus.
function kelasTerdeteksi(result) {
    const peta = new Map();   // modelName -> Set(kelas)
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

// Hitung keadaan tiap pin yang terpetakan.
// Mengembalikan [{ pin, nyala, aktif, model, kelas }]
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

// Susun baris perintah. Nilai di kawat memperhitungkan level aktif: pada
// pin "aktif LOW", nyala berarti menarik pin ke 0.
exports.baris = (keadaan) => {
    if (!keadaan.length) return null;
    const bagian = keadaan.map((k) => {
        const nilai = k.aktif === 'LOW' ? (k.nyala ? 0 : 1) : (k.nyala ? 1 : 0);
        return `${k.pin}=${nilai}`;
    });
    return 'PINS ' + bagian.join(',') + '\n';
};

// Kirim ke papan. Tidak melempar: kegagalan output tidak boleh menghentikan
// siklus inspeksi yang sudah selesai - hasilnya tetap dicatat dan ditampilkan.
exports.kirim = async (arduino, outputCfg, result) => {
    const keadaan = exports.hitung(outputCfg, result);
    const baris = exports.baris(keadaan);
    if (!baris) return { ok: false, alasan: 'tidak ada pin yang dipetakan' };
    try {
        await arduino.send(baris);
        return {
            ok: true,
            baris: baris.trim(),
            nyala: keadaan.filter((k) => k.nyala).map((k) => `${k.model}/${k.kelas}@${k.pin}`),
        };
    } catch (e) {
        return { ok: false, alasan: e.message };
    }
};
