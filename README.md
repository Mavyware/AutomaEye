<p align="center">
  <img src="assets/automaeyes-profile-square-black.png" width="120" alt="AutomaEyes">
</p>

# AutomaEyes

Sistem Quality Control berbasis computer vision (YOLOv11) untuk inspeksi part
di lini produksi — deteksi cacat, pengukuran dimensi (GD&T), dan pengiriman
sinyal OK/NG ke Arduino/PLC.

```
AutomaEyes/
├── app/      Aplikasi desktop (Electron + Python sidecar)
├── web/      Situs automaeyes.my.id (PHP) — akun & unduhan
└── assets/   Logo dan aset bersama
```

## Cara kerja penyimpanan

Project, dataset, dan model **tidak disimpan di repo ini**. Setiap user
menyambungkan akun GitHub-nya sendiri lewat aplikasi, lalu semua datanya
tersimpan di repo miliknya (`Documents/AutomaEyes/<akun-github>`) dan
di-push ke sana. Repo ini hanya berisi kode.

Alurnya: **login akun → sambungkan GitHub → pilih repo penyimpanan → buat project**.

## Aplikasi desktop (`app/`)

Electron dipilih karena `electron.exe`, `node.exe`, dan `python.exe`
sudah bertanda tangan digital, sehingga lolos WDAC/AppLocker/Smart App
Control yang memblokir executable hasil kompilasi sendiri — kendala nyata
di laptop yang dikelola kampus/perusahaan.

Prasyarat: Node.js LTS dan Python 3.10+.

```bash
cd app
npm install
npm start
```

Alur pemakaian: **New Project → New Model → Dataset → Anotasi → Train → Workflow → Run**.

- **Anotasi** dikerjakan langsung di aplikasi (kotak untuk deteksi, poligon
  untuk segmentasi). Label ditulis dalam format YOLO ke `dataset/labels/`,
  jadi langsung siap dilatih tanpa langkah ekspor.
- **Workflow** memakai 5 kategori berurutan ala Keyence CV-X: Capture →
  Positioning → Inspection → Communication → Options.
- **Output** bisa memakai sinyal Arduino bawaan, atau kode JavaScript buatan
  sendiri (`onResult(result)`) untuk mengirim ke PLC/MES/HTTP sesuai kebutuhan.

## Situs (`web/`)

PHP tanpa framework. Menangani pendaftaran akun, login (email/Google/GitHub),
dan menyerahkan izin akses repo ke aplikasi desktop lewat OAuth.

```bash
cd web
cp config.local.php.example config.local.php   # lalu isi kredensialnya
php -S localhost:8000 -t public
```

## Konfigurasi

Berkas yang berisi kunci **tidak pernah masuk repo** (lihat `.gitignore`):

| Berkas | Isi | Template |
|---|---|---|
| `app/config.yaml` | pengaturan per-device | `app/config.example.yaml` |
| `web/config.local.php` | DB, SMTP, OAuth secret | `web/config.local.php.example` |
| `web/deploy/.env.deploy` | kredensial FTP | `web/deploy/env.deploy.contoh` |

Sesi login dan token GitHub disimpan terenkripsi di folder data OS
(`userData`), bukan di dalam repo.
