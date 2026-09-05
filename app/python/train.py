"""
Training script per-model, dipanggil oleh Electron.
Streaming stdout → Node parse progress via regex.

Progress format yang di-parse Node:
  "PROGRESS_EPOCH <e>/<total>"        → update bar per epoch
  "results mAP50: .. P: .. R: .."     → metrik final
Semua error di-print jelas lalu exit 1 supaya UI bisa menampilkannya.
"""
import argparse
import shutil
import sys
import traceback
from pathlib import Path

BASE_BY_TYPE = {
    "AI Segmentation": "yolo11n-seg.pt",
    "AI Detection": "yolo11n.pt",
    "AI Classification": "yolo11n-cls.pt",
    "AI OCR": "yolo11n.pt",
}


def count_labeled(images_dir, labels_dir):
    if not images_dir.exists():
        return 0, 0
    imgs = [p for p in images_dir.iterdir()
            if p.suffix.lower() in (".jpg", ".jpeg", ".png")]
    labeled = sum(1 for p in imgs if (labels_dir / (p.stem + ".txt")).exists())
    return len(imgs), labeled


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--project-dir", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--lr", type=float, default=0.01)
    ap.add_argument("--type", required=True)
    ap.add_argument("--resume", action="store_true",
                    help="Lanjutkan training dari runs/train/weights/last.pt")
    args = ap.parse_args()

    # Klasifikasi memakai jalur dataset yang sama sekali berbeda di ultralytics
    # (folder per-kelas, bukan data.yaml). Ditentukan sekali di sini supaya
    # cabangnya jelas, bukan tersebar sebagai perbandingan string.
    is_cls = args.type == "AI Classification"

    # ---- Validasi dataset SEBELUM training (biar error jelas, bukan exit 1 misterius) ----
    ds = Path(args.data).parent

    # ---- Self-heal path portabel ----
    # data.yaml menyimpan baris "path:" absolut. Kalau project dipindah ke PC/folder
    # lain, baris itu jadi salah (mis. masih menunjuk ke laptop lama) dan training
    # gagal. Tulis ulang "path:" ke lokasi dataset yang sebenarnya saat ini.
    try:
        data_file = Path(args.data)
        if data_file.exists():
            correct_path = str(ds.resolve()).replace("\\", "/")
            lines = data_file.read_text(encoding="utf-8").splitlines()
            new_lines, patched = [], False
            for ln in lines:
                if ln.strip().lower().startswith("path:"):
                    new_lines.append(f"path: {correct_path}")
                    patched = True
                else:
                    new_lines.append(ln)
            if not patched:
                new_lines.insert(0, f"path: {correct_path}")
            data_file.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
            print(f"data.yaml path -> {correct_path}", flush=True)
    except Exception as e:
        print(f"[!] Gagal auto-fix path data.yaml: {e}", flush=True)

    n_img, n_lbl = count_labeled(ds / "images" / "train", ds / "labels" / "train")
    n_val, n_val_lbl = count_labeled(ds / "images" / "val", ds / "labels" / "val")
    print(f"Dataset: train {n_img} gambar ({n_lbl} ber-label), val {n_val} gambar", flush=True)

    if n_img == 0:
        print("[X] Tidak ada gambar training. Import/split dataset dulu.", flush=True)
        sys.exit(1)
    if n_lbl == 0:
        if is_cls:
            print("[X] Belum ada gambar yang diberi kelas.", flush=True)
            print("    Buka tab Anotasi, pilih kelas untuk tiap gambar "
                  "(tekan angka 1-9), lalu jalankan Split.", flush=True)
        else:
            print("[X] Tidak ada label yang COCOK dengan gambar training.", flush=True)
            print("    Nama file label harus sama dengan nama gambar. "
                  "Beri label lewat tab Anotasi, lalu 'Clean & Rebuild + Split'.", flush=True)
        sys.exit(1)

    # ---- Bentuk dataset yang diminta ultralytics ----
    # Deteksi/segmentasi/OCR: data.yaml.
    # Klasifikasi: sebuah FOLDER train/<kelas>/*.jpg - check_cls_dataset menolak
    # data.yaml dan menyimpulkan kelas dari nama folder. Folder itu dibangun
    # ulang dari label yang sama, jadi tidak ada salinan dataset kedua yang
    # harus dijaga tetap sinkron.
    data_arg = args.data
    if is_cls:
        try:
            import yaml
            cfg = yaml.safe_load(Path(args.data).read_text(encoding="utf-8")) or {}
            names = cfg.get("names") or []
            if isinstance(names, dict):
                names = [names[k] for k in sorted(names, key=lambda x: int(x))]
        except Exception as e:
            print(f"[X] Gagal membaca daftar kelas dari data.yaml: {e}", flush=True)
            sys.exit(1)
        if not names:
            print("[X] Model ini belum punya kelas. Tambahkan kelas dulu.", flush=True)
            sys.exit(1)
        try:
            import clsdata
            akar, _ = clsdata.build(ds, names,
                                    log=lambda m: print(m, flush=True))
            data_arg = str(akar)
        except Exception as e:
            print(f"[X] {e}", flush=True)
            sys.exit(1)

    try:
        from ultralytics import YOLO
    except ImportError:
        print("[X] ultralytics belum ter-install. Jalankan: pip install ultralytics",
              flush=True)
        sys.exit(1)

    # ---- Cegah PC nge-freeze saat training (terutama kalau di CPU) ----
    # 1) Turunkan prioritas proses (Windows) supaya UI/mouse tetap dapat jatah CPU.
    # 2) Batasi jumlah thread PyTorch → sisakan 1-2 core untuk sistem.
    try:
        import ctypes
        # BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), 0x00004000)
        print("Prioritas proses training: BelowNormal (UI tetap responsif).", flush=True)
    except Exception:
        pass
    try:
        import os as _os
        import torch as _torch
        total = _os.cpu_count() or 4
        if _torch.cuda.is_available():
            print(f"Device: GPU {_torch.cuda.get_device_name(0)}", flush=True)
        else:
            keep = 2 if total > 4 else 1
            use = max(1, total - keep)
            _torch.set_num_threads(use)
            print(f"Device: CPU — pakai {use}/{total} thread CPU (sisakan {keep} untuk UI). "
                  "Training di CPU lambat; kalau punya GPU NVIDIA, pasang PyTorch versi CUDA.",
                  flush=True)
    except Exception as _e:
        print(f"[!] Gagal atur thread/prioritas: {_e}", flush=True)

    model_dir = Path(args.model_dir)
    weights_dir = model_dir / "weights"
    runs_dir = model_dir / "runs"
    weights_dir.mkdir(parents=True, exist_ok=True)

    last_ckpt = runs_dir / "train" / "weights" / "last.pt"
    do_resume = bool(args.resume) and last_ckpt.exists()
    if do_resume:
        base = str(last_ckpt)
        print(f"Resume: melanjutkan training dari {last_ckpt}", flush=True)
    else:
        existing = weights_dir / "best.pt"
        base = str(existing) if existing.exists() else BASE_BY_TYPE.get(args.type, "yolo11n.pt")
        print(f"Base: {base}", flush=True)

    try:
        model = YOLO(base)

        # Callback: print progress tiap epoch selesai
        def on_epoch_end(trainer):
            try:
                e = int(getattr(trainer, "epoch", 0)) + 1
                print(f"PROGRESS_EPOCH {e}/{args.epochs}", flush=True)
            except Exception:
                pass
        model.add_callback("on_train_epoch_end", on_epoch_end)

        # Callback: kirim metrik per-epoch (setelah validasi) untuk dashboard UI.
        # Formatnya satu baris JSON: "EPOCH_METRICS {...}" — di-parse oleh Node.
        def on_fit_epoch_end(trainer):
            try:
                import json as _json
                e = int(getattr(trainer, "epoch", 0)) + 1
                mt = getattr(trainer, "metrics", None) or {}

                def _g(*keys):
                    for k in keys:
                        if k in mt:
                            try:
                                return float(mt[k])
                            except Exception:
                                pass
                    return 0.0

                if is_cls:
                    # Klasifikasi tidak punya mAP/precision/recall - yang ada
                    # akurasi top-1 dan top-5, dan satu angka loss (bukan tiga).
                    # Dikirim di slot mAP50/mAP50-95 supaya grafik yang sudah
                    # ada tetap terpakai; UI menamainya ulang lewat "task".
                    top1 = _g("metrics/accuracy_top1")
                    top5 = _g("metrics/accuracy_top5")
                    loss = 0.0
                    try:
                        li = trainer.label_loss_items(trainer.tloss, prefix="train")
                        loss = float(next(iter(li.values()), 0.0))
                    except Exception:
                        loss = _g("train/loss")
                    print("EPOCH_METRICS " + _json.dumps({
                        "task": "classify",
                        "epoch": e, "total": args.epochs,
                        "mAP50": top1, "mAP5095": top5,
                        "top1": top1, "top5": top5,
                        "precision": 0.0, "recall": 0.0, "f1": 0.0,
                        "boxLoss": 0.0, "clsLoss": loss, "dflLoss": 0.0,
                        "valBox": 0.0, "valCls": _g("val/loss"), "valDfl": 0.0,
                    }), flush=True)
                    return

                prec = _g("metrics/precision(B)")
                rec = _g("metrics/recall(B)")
                map50 = _g("metrics/mAP50(B)")
                map5095 = _g("metrics/mAP50-95(B)")

                # Loss training per-epoch
                box = cls = dfl = 0.0
                try:
                    li = trainer.label_loss_items(trainer.tloss, prefix="train")
                    box = float(li.get("train/box_loss", 0.0))
                    cls = float(li.get("train/cls_loss", 0.0))
                    dfl = float(li.get("train/dfl_loss", 0.0))
                except Exception:
                    box = _g("val/box_loss")
                    cls = _g("val/cls_loss")
                    dfl = _g("val/dfl_loss")

                # Validation loss per-epoch (untuk deteksi overfitting/underfitting)
                valBox = _g("val/box_loss")
                valCls = _g("val/cls_loss")
                valDfl = _g("val/dfl_loss")

                f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
                print("EPOCH_METRICS " + _json.dumps({
                    "epoch": e, "total": args.epochs,
                    "precision": prec, "recall": rec,
                    "mAP50": map50, "mAP5095": map5095,
                    "boxLoss": box, "clsLoss": cls, "dflLoss": dfl, "f1": f1,
                    "valBox": valBox, "valCls": valCls, "valDfl": valDfl,
                }), flush=True)
            except Exception:
                pass
        model.add_callback("on_fit_epoch_end", on_fit_epoch_end)

        if do_resume:
            # resume=True: ultralytics memakai argumen & jumlah epoch yang
            # tersimpan di checkpoint, lalu menyambung dari epoch terakhir.
            results = model.train(resume=True)
        else:
            results = model.train(
                data=data_arg,
                epochs=args.epochs,
                batch=args.batch,
                imgsz=args.imgsz,
                lr0=args.lr,
                project=str(runs_dir),
                name="train",
                exist_ok=True,
                verbose=True,
            )
    except Exception as e:
        print(f"[X] Training gagal: {e}", flush=True)
        traceback.print_exc()
        sys.exit(1)

    # Copy best.pt hasil training ke weights folder
    best = Path(results.save_dir) / "weights" / "best.pt"
    if best.exists():
        target = weights_dir / "best.pt"
        shutil.copy2(best, target)
        print(f"Saved: {target}", flush=True)

    m = results.results_dict if hasattr(results, "results_dict") else {}
    if is_cls:
        top1 = float(m.get("metrics/accuracy_top1", 0.0) or 0.0)
        top5 = float(m.get("metrics/accuracy_top5", 0.0) or 0.0)
        print(f"results top1: {top1:.4f} top5: {top5:.4f}", flush=True)
    else:
        mAP = m.get("metrics/mAP50(B)", 0.0)
        P = m.get("metrics/precision(B)", 0.0)
        R = m.get("metrics/recall(B)", 0.0)
        print(f"results mAP50: {mAP:.4f} P: {P:.4f} R: {R:.4f}", flush=True)


if __name__ == "__main__":
    main()
