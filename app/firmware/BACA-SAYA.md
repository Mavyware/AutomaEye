# Firmware AutomaEyes

Berkas di folder ini diunggah ke perangkat keluaran yang Anda pilih di
halaman **Output**. Semuanya sudah jadi — tidak ada yang perlu ditulis
sendiri kecuali Anda memang menginginkannya.

| Perangkat | Perlu diunggah? | Berkas |
|---|---|---|
| Arduino (Uno, Nano, Mega, Leonardo, Pro Micro) | Ya | `automaeyes_pinout.ino` |
| ESP32 (DevKit V1, NodeMCU-32S, S3, C3) | Ya | `automaeyes_pinout.ino` (sketsa yang sama) |
| PLC (Omron, Mitsubishi, Delta, Siemens, Schneider, Wecon) | **Tidak** | — |

PLC tidak perlu firmware apa pun. Hampir semua PLC sudah bicara Modbus dari
pabrik, jadi aplikasi menulis langsung ke alamat coil-nya. Yang perlu Anda
lakukan hanya mencocokkan alamat coil di halaman Output dengan pemetaan di
program PLC Anda.

---

## Arduino & ESP32

### Cara mengunggah

1. Buka `automaeyes_pinout.ino` di Arduino IDE.
2. Pilih papan dan port yang benar di menu **Tools**.
3. Tekan Upload.
4. Buka **Serial Monitor** sekali — harus muncul `AutomaEyes pinout siap`.
   Kalau baris itu tidak muncul, unggahannya belum berhasil.
5. **Tutup Serial Monitor** sebelum menekan Sambungkan di aplikasi. Windows
   mengunci port secara eksklusif; kalau IDE masih memegangnya, aplikasi akan
   melaporkan port tidak bisa dibuka padahal papannya sehat.

Baud sudah disetel sendiri oleh sketsa: **9600** untuk Arduino, **115200**
untuk ESP32. Pastikan angkanya sama dengan yang dipilih di halaman Output.

### Yang dikirim aplikasi

Satu baris per siklus inspeksi:

```
PINS 7=1,8=0,9=0,10=1
```

Artinya pin 7 dan 10 dinyalakan, pin 8 dan 9 dipadamkan. **Seluruh** pin yang
Anda petakan selalu ikut dikirim, termasuk yang padam — tanpa itu keadaan
siklus sebelumnya akan menempel dan mesin membaca kelas yang sudah tidak
terdeteksi lagi.

Papan membalas `OK <jumlah>` atau `ERR <alasan>`. Balasan ini tidak ditunggu
aplikasi, jadi tidak memperlambat lini; gunanya hanya untuk diagnosa lewat
Serial Monitor.

Pin analog Arduino ditulis `A0`..`A7` dan tetap dipakai sebagai keluaran
digital biasa.

### Pin yang tidak boleh dipakai

Aplikasi sudah tidak menawarkannya, tapi ini alasannya:

- **Arduino pin 0 dan 1** — jalur serial yang dipakai aplikasi untuk bicara
  ke papan. Memakainya sebagai keluaran memutus koneksinya sendiri, dan
  gejalanya membingungkan: papan seolah hilang.
- **ESP32 GPIO 6–11** — tersambung ke flash internal. Menggerakkannya membuat
  papan reboot atau gagal boot.
- **ESP32 GPIO 34–39** — hanya bisa membaca, tidak bisa mengeluarkan tegangan.
  Tidak ada pesan kesalahan; pinnya diam saja.

### Kalau pemetaan pin diubah

Tidak perlu mengunggah ulang. Sketsa memanggil `pinMode` setiap kali menerima
perintah, jadi pin baru langsung bekerja.

---

## PLC (Modbus)

Aplikasi menulis coil lewat Modbus, dengan dua cara sambung:

- **Modbus RTU** — kabel serial atau RS-485 lewat konverter USB
- **Modbus TCP** — jaringan Ethernet, umumnya port 502

Kalau alamat coil yang Anda petakan berurutan tanpa lubang, semuanya dikirim
dalam **satu bingkai** (fungsi `0x0F`) — satu perjalanan bolak-balik, dan PLC
menerapkannya sekaligus. Kalau ada lubang, tiap coil dikirim sendiri-sendiri
(fungsi `0x05`). Menulis satu blok yang mencakup lubangnya akan ikut mengubah
coil milik program lain di PLC yang sama.

Merek PLC yang terdaftar di halaman Output hanya memberi catatan konvensi yang
lazim, bukan pemetaan otomatis. **Alamat coil ditentukan program PLC Anda
sendiri** — selalu cocokkan dengan tabel di program itu, lalu pastikan dengan
tombol **Uji** di tiap baris sebelum lini dijalankan.

---

## Menulis output sendiri

Kalau ketiga perangkat di atas tidak cukup, pilih **Kode sendiri** di halaman
Output. Bahasanya JavaScript dan berjalan di dalam aplikasi — bukan di papan.
Penjelasan lengkap beserta contohnya ada langsung di halaman itu.
