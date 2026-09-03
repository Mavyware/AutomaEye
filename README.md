# AutomaEyes

Sistem Quality Control berbasis computer vision untuk inspeksi part di lini
produksi: mendeteksi cacat, mengukur dimensi (GD&T), dan mengirim hasil
OK/NG ke Arduino/PLC secara otomatis.

## Data Anda milik Anda

AutomaEyes tidak punya server penyimpanan. Tidak ada foto produk, dataset,
atau model Anda yang dikirim ke kami.

- **Project, dataset, dan model** tersimpan di **repositori GitHub milik Anda
  sendiri**. Anda yang memilih repo tujuannya, dan bisa menjadikannya privat.
  Kami tidak punya akses ke sana.
- **Hasil inspeksi dan foto NG** tersimpan di komputer Anda sendiri.
- **Sesi login dan izin akses** disimpan terenkripsi oleh sistem operasi di
  komputer itu, bukan di dalam aplikasi maupun di server kami.
- **Izin GitHub diberikan langsung oleh Anda** lewat halaman resmi GitHub.
  Aplikasi tidak pernah meminta, melihat, atau menyimpan kata sandi GitHub
  Anda. Izin itu bisa Anda cabut kapan saja dari pengaturan akun GitHub.

Kalau Anda berhenti memakai AutomaEyes, seluruh data tetap ada di repo dan
komputer Anda — tidak ada yang perlu ditarik kembali dari mana pun.

## Kemampuan

- **Deteksi cacat** dengan model AI yang Anda latih sendiri dari foto part Anda
- **Pengukuran GD&T** — diameter lubang, panjang/lebar, dengan toleransi
  per kelas dan verifikasi kalibrasi
- **Anotasi di dalam aplikasi** — kotak, poligon, dan lingkaran, sehingga
  bentuk mengikuti tepi benda dan hasil ukur lebih akurat
- **Alur inspeksi bertahap** ala sistem vision industri: Capture → Positioning
  → Inspection → Communication → Options
- **Pembacaan kode** 1D/2D dan verifikasi teks cetak
- **Keluaran fleksibel** — sinyal Arduino/PLC bawaan, atau skrip buatan Anda
  sendiri untuk menghubungkan ke MES/dashboard
- **Laporan harian** dan data pengukuran dalam format Excel

## Menjalankan

Prasyarat: Node.js LTS dan Python 3.10+.

```bash
cd app
npm install
npm start
```

Alur pemakaian: **buat project → buat model → kumpulkan foto → anotasi →
latih → susun alur inspeksi → jalankan**.

## Lisensi & kontribusi

Kode ini terbuka agar bisa diaudit dan disesuaikan. Laporan bug dan usulan
perbaikan dipersilakan lewat Issues.

Menemukan celah keamanan? Mohon laporkan ke **mavyware@automaeyes.my.id**,
jangan melalui Issue publik, agar bisa diperbaiki lebih dulu sebelum
diketahui umum. Lihat [SECURITY.md](SECURITY.md).
