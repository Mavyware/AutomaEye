# Kebijakan Keamanan

## Melaporkan celah keamanan

Kirim ke **mavyware@automaeyes.my.id**.

Mohon **jangan** membuka Issue publik untuk celah keamanan — laporan publik
membuat pengguna terekspos sebelum perbaikannya tersedia.

Sertakan bila memungkinkan: versi aplikasi, langkah untuk memunculkan
masalahnya, dan dampak yang Anda perkirakan. Laporan akan dibalas, dan Anda
akan dikabari saat perbaikannya dirilis.

## Cakupan

Yang termasuk:

- Aplikasi desktop (`app/`) — termasuk penanganan IPC, protokol `automaeye://`,
  dan penyimpanan sesi/token
- Situs (`web/`) — autentikasi, alur OAuth, dan penyerahan izin ke aplikasi

Yang **tidak** termasuk: kerentanan pada dependensi pihak ketiga (laporkan ke
proyek terkait), serta serangan yang mensyaratkan penyerang sudah memegang
akses fisik atau akun administrator di komputer korban.

## Cara aplikasi menjaga data Anda

- **Tidak ada server penyimpanan.** Project, dataset, dan model tersimpan di
  repositori GitHub milik Anda sendiri. Hasil inspeksi tersimpan di komputer
  Anda.
- **Kata sandi GitHub tidak pernah diminta.** Izin diberikan lewat halaman
  resmi GitHub (OAuth), dan bisa dicabut kapan saja dari pengaturan akun Anda.
- **Token disimpan terenkripsi** oleh sistem operasi (DPAPI di Windows), di
  folder data pengguna — bukan di dalam folder aplikasi, dan tidak pernah
  ikut masuk ke repositori.
- **Rahasia server tidak ada di repo ini.** Kunci OAuth dan kredensial
  database berada di berkas konfigurasi server yang tidak pernah di-commit.
- **Tautan `automaeye://` wajib membawa nonce sekali pakai** yang dibuat saat
  aplikasi memulai proses login. Tanpa itu, halaman web mana pun bisa memaksa
  aplikasi masuk ke akun orang lain.
- **Masukan dari antarmuka dibatasi** agar tidak bisa keluar dari folder kerja
  aplikasi saat membaca atau menulis berkas.

Kode ini sengaja dibuka agar klaim-klaim di atas bisa Anda periksa sendiri.
