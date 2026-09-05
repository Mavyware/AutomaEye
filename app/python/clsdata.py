"""
Susun dataset klasifikasi dari anotasi YOLO yang sudah ada.

Kenapa ada berkas ini
---------------------
Seluruh aplikasi menyimpan dataset dalam satu bentuk: images/<split>/ berisi
gambar, labels/<split>/ berisi berkas .txt YOLO. Bentuk itu dipakai deteksi,
segmentasi, dan OCR, dan semua alat lain (split, augmentasi, hapus gambar,
hitung statistik) sudah bekerja di atasnya.

Ultralytics tidak menerima bentuk itu untuk klasifikasi. Untuk task=classify,
`check_cls_dataset` menuntut sebuah FOLDER bersusun

    <akar>/train/<nama-kelas>/gambar.jpg
    <akar>/val/<nama-kelas>/gambar.jpg

dan menyimpulkan daftar kelasnya dari nama folder - data.yaml tidak dilirik
sama sekali. Itulah sebabnya melatih model Classification dulu selalu gagal.

Jalan keluarnya bukan menyimpan dataset dalam dua bentuk sekaligus. Dua salinan
berarti dua sumber kebenaran, dan cepat atau lambat keduanya berbeda isi.
Susunan folder di sini dibangun ULANG tiap kali dilatih, dari label yang sama
yang dipakai tipe model lain. Anotasi tetap satu-satunya sumber kebenaran; ini
sekadar cara menyajikannya.

Kelas sebuah gambar diambil dari baris pertama berkas labelnya. Untuk
klasifikasi, satu gambar memang hanya punya satu kelas: anotator menuliskannya
sebagai satu kotak seluas gambar ("<kelas> 0.5 0.5 1 1").

Gambar ditautkan (hard link) bila bisa, bukan disalin. Dataset ribuan foto
tidak perlu memakan tempat dua kali, dan menautkan jauh lebih cepat. Kalau
sistem berkasnya menolak (mis. beda drive), barulah disalin.
"""
from pathlib import Path
import os
import shutil

IMG_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
SPLITS = ("train", "val", "test")


def _aman(nama):
    """Nama kelas jadi nama folder. Karakter yang dilarang Windows dibuang."""
    bersih = "".join(c for c in str(nama) if c not in r'<>:"/\|?*').strip().rstrip(".")
    return bersih or "kelas"


def _taut(src, dst):
    """Hard link kalau bisa, salin kalau tidak. Keduanya menghasilkan berkas
    yang bisa dibaca; hard link hanya lebih murah."""
    if dst.exists():
        return
    try:
        os.link(src, dst)
    except Exception:
        shutil.copy2(src, dst)


def _kelas_gambar(lbl_path):
    """Indeks kelas dari baris pertama berkas label, atau None."""
    try:
        for baris in lbl_path.read_text(encoding="utf-8").splitlines():
            baris = baris.strip()
            if not baris:
                continue
            return int(float(baris.split()[0]))
    except Exception:
        pass
    return None


def build(ds_dir, names, out_dir=None, log=print):
    """
    Bangun folder klasifikasi dari <ds_dir>/images + <ds_dir>/labels.

    ds_dir : Path akar dataset (yang memuat images/, labels/, data.yaml)
    names  : daftar nama kelas, urut sesuai indeks di berkas label
    out_dir: tujuan; default <ds_dir>/cls

    Mengembalikan (Path akar hasil, ringkasan dict).
    Melempar RuntimeError kalau tidak ada satu pun gambar berlabel - lebih baik
    berhenti dengan sebab yang jelas daripada menyerahkan folder kosong ke
    ultralytics dan mendapat galat yang tidak bisa dibaca pengguna.
    """
    ds_dir = Path(ds_dir)
    akar = Path(out_dir) if out_dir else ds_dir / "cls"

    # Dibangun dari nol tiap kali. Sisa build sebelumnya - gambar yang sudah
    # dihapus, kelas yang sudah diganti nama - kalau tidak dibuang akan ikut
    # terlatih tanpa ada yang menyadari.
    if akar.exists():
        shutil.rmtree(akar, ignore_errors=True)

    ringkas = {"perSplit": {}, "perClass": {}, "tanpaLabel": 0, "kelasAsing": 0}
    total = 0

    for split in SPLITS:
        img_dir = ds_dir / "images" / split
        lbl_dir = ds_dir / "labels" / split
        if not img_dir.exists():
            continue

        n = 0
        for img in sorted(img_dir.iterdir()):
            if img.suffix.lower() not in IMG_EXT:
                continue

            ci = _kelas_gambar(lbl_dir / (img.stem + ".txt"))
            if ci is None:
                ringkas["tanpaLabel"] += 1
                continue
            if ci < 0 or ci >= len(names):
                # Label menunjuk kelas yang sudah tidak ada di model. Dilewati,
                # bukan dipaksa masuk ke kelas 0 - itu diam-diam merusak data.
                ringkas["kelasAsing"] += 1
                continue

            nama = _aman(names[ci])
            tujuan = akar / split / nama
            tujuan.mkdir(parents=True, exist_ok=True)
            _taut(img, tujuan / img.name)
            n += 1
            total += 1
            ringkas["perClass"][nama] = ringkas["perClass"].get(nama, 0) + 1

        if n:
            ringkas["perSplit"][split] = n

    if total == 0:
        raise RuntimeError(
            "Tidak ada gambar berlabel untuk klasifikasi. Beri kelas pada "
            "gambar di tab Anotasi, lalu jalankan Split."
        )

    # Ultralytics selalu memvalidasi saat melatih dan selalu mencari folder val.
    # Kalau dataset belum di-split, val belum ada. Daripada gagal, pakai train
    # sebagai val - angkanya optimistis, jadi katakan begitu terang-terangan.
    if "val" not in ringkas["perSplit"]:
        val = akar / "val"
        for kelas_dir in (akar / "train").iterdir():
            tujuan = val / kelas_dir.name
            tujuan.mkdir(parents=True, exist_ok=True)
            for f in kelas_dir.iterdir():
                _taut(f, tujuan / f.name)
        ringkas["valDariTrain"] = True
        log("[!] Belum ada data validasi - train dipakai sekaligus sebagai val. "
            "Akurasi yang muncul akan terlalu bagus; lakukan Split (Langkah 3) "
            "untuk angka yang jujur.")

    # Kelas yang tidak punya satu pun gambar tidak akan muncul sebagai folder,
    # sehingga model diam-diam dilatih dengan kelas lebih sedikit daripada yang
    # dikira pengguna. Itu perlu terdengar.
    kosong = [n for n in names if _aman(n) not in ringkas["perClass"]]
    if kosong:
        ringkas["kelasKosong"] = kosong
        log("[!] Kelas tanpa gambar (tidak ikut dilatih): " + ", ".join(kosong))

    if ringkas["tanpaLabel"]:
        log(f"[!] {ringkas['tanpaLabel']} gambar dilewati karena belum diberi kelas.")
    if ringkas["kelasAsing"]:
        log(f"[!] {ringkas['kelasAsing']} gambar dilewati karena kelasnya sudah "
            "tidak ada pada model.")

    rincian = ", ".join(f"{k} {v}" for k, v in sorted(ringkas["perClass"].items()))
    log(f"Dataset klasifikasi: {total} gambar - {rincian}")
    log("Susunan: " + ", ".join(f"{k}={v}" for k, v in ringkas["perSplit"].items()))

    return akar, ringkas
