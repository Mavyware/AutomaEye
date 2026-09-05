"""
Build a classification dataset from existing YOLO annotations.

Why this file exists
---------------------
The whole app stores its dataset in one format: images/<split>/ holds
images, labels/<split>/ holds YOLO .txt files. That format is used by
detection, segmentation, and OCR, and every other tool (split, augmentation,
deleting images, computing statistics) already works on top of it.

Ultralytics doesn't accept that format for classification. For task=classify,
`check_cls_dataset` requires a nested FOLDER structure

    <root>/train/<class-name>/image.jpg
    <root>/val/<class-name>/image.jpg

and infers the class list from folder names - data.yaml isn't even looked
at. That's why training a Classification model used to always fail.

The fix isn't to store the dataset in two formats at once. Two copies means
two sources of truth, and sooner or later they'd drift apart. The folder
structure here is REBUILT every time training runs, from the same labels
used by the other model types. Annotations remain the single source of
truth; this is just one way of presenting them.

An image's class is taken from the first line of its label file. For
classification, an image really does only have one class: the annotator
writes it as a single box spanning the whole image ("<class> 0.5 0.5 1 1").

Images are linked (hard link) when possible, rather than copied. A dataset
of thousands of photos shouldn't have to take up space twice, and linking is
much faster. If the filesystem refuses (e.g. a different drive), it falls
back to copying.
"""
from pathlib import Path
import os
import shutil

IMG_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
SPLITS = ("train", "val", "test")


def _aman(nama):
    """Turn a class name into a folder name. Characters Windows forbids are stripped."""
    bersih = "".join(c for c in str(nama) if c not in r'<>:"/\|?*').strip().rstrip(".")
    return bersih or "kelas"


def _taut(src, dst):
    """Hard link when possible, copy otherwise. Both produce a readable
    file; a hard link is just cheaper."""
    if dst.exists():
        return
    try:
        os.link(src, dst)
    except Exception:
        shutil.copy2(src, dst)


def _kelas_gambar(lbl_path):
    """Class index from the first line of the label file, or None."""
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
    Build the classification folder from <ds_dir>/images + <ds_dir>/labels.

    ds_dir : Path to the dataset root (containing images/, labels/, data.yaml)
    names  : list of class names, ordered to match the label file indices
    out_dir: destination; defaults to <ds_dir>/cls

    Returns (Path to the result root, summary dict).
    Raises RuntimeError if there isn't a single labeled image - better to
    stop with a clear reason than hand ultralytics an empty folder and get
    an error the user can't read.
    """
    ds_dir = Path(ds_dir)
    akar = Path(out_dir) if out_dir else ds_dir / "cls"

    # Rebuilt from scratch every time. Leftovers from a previous build -
    # images that were since deleted, classes that were since renamed - would
    # silently get trained on if not discarded.
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
                # The label points to a class that no longer exists on the
                # model. It's skipped, not forced into class 0 - that would silently corrupt the data.
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

    # Ultralytics always validates during training and always looks for a val
    # folder. If the dataset hasn't been split yet, val doesn't exist. Rather
    # than fail, train is used as val - the numbers will be optimistic, so say so plainly.
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

    # A class with not even one image won't show up as a folder, so the model
    # would silently be trained with fewer classes than the user thinks. That needs to be heard.
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
