"""
Evaluasi model YOLO pada sebuah split (test/val/train).

Dipanggil oleh Electron (lib/inference.js). Menghasilkan:
  - metrik keseluruhan (mAP50, mAP50-95, precision, recall, F1)
  - metrik per-kelas
  - confusion matrix + kurva PR/F1 (PNG dari ultralytics)
  - prediksi visual per gambar (anotasi tergambar)
Semua disimpan ke <model>/eval/<timestamp>/ dan hasilnya di-print sebagai:
  "EVAL_RESULT { ...json... }"
"""
import argparse
import glob
import json
import statistics
import sys
import time
from pathlib import Path


def stat_block(vals):
    """Ringkasan statistik satu daftar waktu (ms). Dipakai untuk laporan edge computing."""
    vals = [float(v) for v in vals if v is not None]
    if not vals:
        return {"n": 0, "mean": 0.0, "median": 0.0, "min": 0.0, "max": 0.0, "std": 0.0}
    return {
        "n": len(vals),
        "mean": round(statistics.fmean(vals), 2),
        "median": round(statistics.median(vals), 2),
        "min": round(min(vals), 2),
        "max": round(max(vals), 2),
        "std": round(statistics.pstdev(vals), 2) if len(vals) > 1 else 0.0,
    }


def device_info():
    """Spesifikasi perangkat yang menjalankan inferensi (untuk Tabel spesifikasi PC di laporan)."""
    info = {"device": "cpu", "cpu": "", "gpu": "", "ram_gb": None, "torch": ""}
    try:
        import platform
        info["cpu"] = platform.processor() or platform.machine()
    except Exception:
        pass
    try:
        import torch
        info["torch"] = torch.__version__
        if torch.cuda.is_available():
            info["device"] = "cuda"
            info["gpu"] = torch.cuda.get_device_name(0)
    except Exception:
        pass
    try:
        import psutil
        info["ram_gb"] = round(psutil.virtual_memory().total / (1024 ** 3), 1)
    except Exception:
        pass
    return info


def find_plot(d, *patterns):
    for pat in patterns:
        hits = sorted(glob.glob(str(Path(d) / pat)))
        if hits:
            return str(Path(hits[0]).resolve())
    return ""


def has_imgs(d):
    return d.exists() and any(
        p.suffix.lower() in (".jpg", ".jpeg", ".png") for p in d.iterdir()
    )


def eval_classify(a, model, names, kelas_app, ds_dir, split, run_dir, stamp):
    """
    Evaluasi model klasifikasi.

    Dipisah dari jalur deteksi karena hampir tidak ada yang sama: metriknya
    akurasi top-1/top-5 (bukan mAP), hasil prediksinya ada di r.probs (r.boxes
    selalu None), dan datanya berupa folder per-kelas, bukan data.yaml.
    """
    import clsdata

    # DUA urutan kelas yang berbeda, dan menukarnya menghasilkan hasil yang
    # salah tanpa satu pun galat:
    #   kelas_app  - urutan di data.yaml. Angka di berkas label menunjuk ke sini,
    #                jadi inilah yang dipakai untuk menamai folder.
    #   urut_model - urutan milik model terlatih. check_cls_dataset mengurutkan
    #                nama folder secara ABJAD, jadi indeks model belum tentu sama
    #                dengan indeks aplikasi. Confusion matrix memakai urutan ini.
    if isinstance(kelas_app, dict):
        kelas_app = [kelas_app[k] for k in sorted(kelas_app, key=lambda x: int(x))]
    kelas_app = list(kelas_app)
    if not kelas_app:
        print("[X] Daftar kelas tidak ditemukan di data.yaml.", flush=True)
        sys.exit(1)

    urut_model = [names[k] for k in sorted(names)] if isinstance(names, dict) else list(names)

    akar, _ = clsdata.build(ds_dir, kelas_app, log=lambda m: print(m, flush=True))

    # Split yang diminta mungkin kosong (belum di-split). Turun ke yang ada.
    if not (akar / split).exists():
        for alt in ("test", "val", "train"):
            if (akar / alt).exists():
                split = alt
                break

    val = model.val(data=str(akar), split=split, imgsz=a.imgsz,
                    project=str(run_dir), name="val", plots=True, verbose=False)

    top1 = float(getattr(val, "top1", 0) or 0)
    top5 = float(getattr(val, "top5", 0) or 0)

    # Untuk klasifikasi, "precision/recall" yang bermakna adalah per-kelas dan
    # harus dihitung dari confusion matrix - ultralytics tidak menyediakannya
    # jadi. Kolom map50/map5095 sengaja dibiarkan kosong daripada diisi angka
    # yang kelihatan seperti mAP padahal bukan.
    per_class = []
    try:
        cm = val.confusion_matrix.matrix  # baris = prediksi, kolom = kebenaran
        for i, nama in enumerate(urut_model):
            tp = float(cm[i][i])
            pred = float(sum(cm[i][j] for j in range(len(urut_model))))
            asli = float(sum(cm[j][i] for j in range(len(urut_model))))
            per_class.append({
                "name": nama,
                "precision": tp / pred if pred else 0.0,
                "recall": tp / asli if asli else 0.0,
                "map50": None, "map5095": None,
            })
    except Exception as e:
        print(f"[!] Confusion matrix tidak terbaca: {e}", flush=True)

    mp = sum(c["precision"] for c in per_class) / len(per_class) if per_class else 0.0
    mr = sum(c["recall"] for c in per_class) / len(per_class) if per_class else 0.0
    overall = {
        "top1": top1, "top5": top5,
        "accuracy": top1,
        "precision": mp, "recall": mr,
        "f1": (2 * mp * mr / (mp + mr)) if (mp + mr) > 0 else 0.0,
        "map50": None, "map5095": None,
    }

    val_dir = getattr(val, "save_dir", run_dir / "val")
    plots = {
        "confusionMatrix": find_plot(val_dir, "confusion_matrix.png"),
        "confusionMatrixNorm": find_plot(val_dir, "confusion_matrix_normalized.png"),
        "prCurve": "", "f1Curve": "", "pCurve": "", "rCurve": "",
    }

    print("PROGRESS 2/3 prediksi gambar", flush=True)
    preds = []
    t_pre, t_inf, t_post, t_tot = [], [], [], []
    coldstart_ms = 0.0
    # Sumbernya folder per-kelas, jadi daftar berkasnya dikumpulkan sendiri.
    # predict(source=<folder>) TIDAK menelusuri sub-folder - kalau folder split
    # diserahkan apa adanya, ultralytics melaporkan "no images found" dan
    # galeri prediksi diam-diam kosong. Diserahkan sebagai daftar path, kelas
    # sebenarnya tiap gambar tetap terbaca dari nama folder induknya.
    src_dir = akar / split
    berkas = sorted(
        str(f) for f in src_dir.rglob("*")
        if f.is_file() and f.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp", ".webp")
    )
    try:
        if not berkas:
            raise RuntimeError(f"tidak ada gambar di {src_dir}")
        results = model.predict(source=berkas, save=False, imgsz=a.imgsz,
                                verbose=False, stream=True)
        # r.path TIDAK bisa dipakai di sini. Saat source berupa daftar,
        # ultralytics menamai ulang hasilnya jadi "image0.jpg", "image1.jpg",
        # ... - path aslinya hilang, sehingga kelas sebenarnya (dari nama folder
        # induk) ikut hilang dan gambar di galeri menunjuk berkas yang tidak
        # ada. Urutan hasil sama dengan urutan yang dikirim, jadi daftar
        # berkasnya sendiri yang dipakai sebagai sumber kebenaran.
        for idx, r in enumerate(results):
            src = Path(berkas[idx])
            dets = []
            probs = getattr(r, "probs", None)
            if probs is not None:
                ci = int(probs.top1)
                dets.append({"name": names.get(ci, str(ci)) if isinstance(names, dict)
                             else urut_model[ci],
                             "conf": float(probs.top1conf)})
            sp = getattr(r, "speed", None) or {}
            pre = float(sp.get("preprocess", 0) or 0)
            inf = float(sp.get("inference", 0) or 0)
            post = float(sp.get("postprocess", 0) or 0)
            tot = pre + inf + post
            if idx == 0:
                coldstart_ms = round(tot, 2)
            else:
                t_pre.append(pre); t_inf.append(inf); t_post.append(post); t_tot.append(tot)
            preds.append({
                "name": src.name,
                "image": str(src.resolve()),
                "truth": src.parent.name,
                "detections": dets,
                "correct": bool(dets and dets[0]["name"] == src.parent.name),
                "ms": {"preprocess": round(pre, 2), "inference": round(inf, 2),
                       "postprocess": round(post, 2), "total": round(tot, 2)},
            })
    except Exception as e:
        print(f"[!] predict gagal: {e}", flush=True)

    if not t_tot and preds:
        m = preds[0]["ms"]
        t_pre, t_inf, t_post, t_tot = [m["preprocess"]], [m["inference"]], [m["postprocess"]], [m["total"]]

    tot_stat = stat_block(t_tot)
    timing = {
        "device": device_info(), "imgsz": a.imgsz, "conf": a.conf, "iou": a.iou,
        "nImages": len(preds), "nMeasured": tot_stat["n"], "coldStartMs": coldstart_ms,
        "note": "Gambar pertama (cold-start pemuatan model) dikeluarkan dari statistik.",
        "perStage": {"preprocess": stat_block(t_pre), "inference": stat_block(t_inf),
                     "postprocess": stat_block(t_post), "total": tot_stat},
        "throughputPerMinute": round(60000.0 / tot_stat["mean"], 1) if tot_stat["mean"] > 0 else 0.0,
        "fps": round(1000.0 / tot_stat["mean"], 2) if tot_stat["mean"] > 0 else 0.0,
        "valSpeed": {k: round(float(v), 2) for k, v in (getattr(val, "speed", None) or {}).items()},
    }

    result = {
        "task": "classify",
        "split": split,
        "savedDir": str(run_dir.resolve()),
        "overall": overall,
        "perClass": per_class,
        "plots": plots,
        "timing": timing,
        "predictions": preds,
        "generatedAt": stamp,
    }
    (run_dir / "results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print("PROGRESS 3/3 selesai", flush=True)
    print("EVAL_RESULT " + json.dumps(result), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--split", default="test")
    ap.add_argument("--out", required=True)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--iou", type=float, default=0.45)
    a = ap.parse_args()

    stamp = time.strftime("%Y%m%d-%H%M%S")
    run_dir = Path(a.out) / stamp
    run_dir.mkdir(parents=True, exist_ok=True)

    # --- Self-heal path + pastikan key split ada di data.yaml ---
    import yaml
    data_file = Path(a.data)
    ds_dir = data_file.parent
    try:
        cfg = yaml.safe_load(data_file.read_text(encoding="utf-8")) or {}
    except Exception:
        cfg = {}
    cfg["path"] = str(ds_dir.resolve()).replace("\\", "/")

    split = a.split
    if not has_imgs(ds_dir / "images" / split):
        if has_imgs(ds_dir / "images" / "val"):
            split = "val"
        elif has_imgs(ds_dir / "images" / "train"):
            split = "train"
    cfg[split] = f"images/{split}"
    if "train" not in cfg:
        cfg["train"] = "images/train"
    if "val" not in cfg:
        cfg["val"] = "images/val" if has_imgs(ds_dir / "images" / "val") else "images/train"
    data_file.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")

    print(f"PROGRESS 1/3 validasi split={split}", flush=True)
    try:
        from ultralytics import YOLO
    except ImportError:
        print("[X] ultralytics belum ter-install.", flush=True)
        sys.exit(1)

    model = YOLO(a.weights)
    names = model.names if isinstance(model.names, dict) else {i: n for i, n in enumerate(model.names)}

    if getattr(model, "task", "") == "classify":
        eval_classify(a, model, names, cfg.get("names") or [], ds_dir, split, run_dir, stamp)
        return

    val = model.val(
        data=str(data_file), split=split, imgsz=a.imgsz, conf=a.conf, iou=a.iou,
        project=str(run_dir), name="val", plots=True, save_json=False, verbose=False,
    )
    b = val.box

    def at(x, i, d=0.0):
        try:
            return float(x[i])
        except Exception:
            return d

    per_class = []
    try:
        idxs = list(b.ap_class_index)
    except Exception:
        idxs = []
    for i, ci in enumerate(idxs):
        per_class.append({
            "name": names.get(int(ci), str(ci)),
            "precision": at(b.p, i), "recall": at(b.r, i),
            "map50": at(b.ap50, i), "map5095": at(b.ap, i),
        })

    mp = float(getattr(b, "mp", 0) or 0)
    mr = float(getattr(b, "mr", 0) or 0)
    overall = {
        "map50": float(getattr(b, "map50", 0) or 0),
        "map5095": float(getattr(b, "map", 0) or 0),
        "precision": mp, "recall": mr,
        "f1": (2 * mp * mr / (mp + mr)) if (mp + mr) > 0 else 0.0,
    }

    val_dir = getattr(val, "save_dir", run_dir / "val")
    plots = {
        "confusionMatrix": find_plot(val_dir, "confusion_matrix.png"),
        "confusionMatrixNorm": find_plot(val_dir, "confusion_matrix_normalized.png"),
        "prCurve": find_plot(val_dir, "*PR_curve.png", "PR_curve.png"),
        "f1Curve": find_plot(val_dir, "*F1_curve.png", "F1_curve.png"),
        "pCurve": find_plot(val_dir, "*P_curve.png", "P_curve.png"),
        "rCurve": find_plot(val_dir, "*R_curve.png", "R_curve.png"),
    }

    print("PROGRESS 2/3 prediksi gambar", flush=True)
    preds = []
    src_dir = ds_dir / "images" / split
    t_pre, t_inf, t_post, t_tot, t_wall = [], [], [], [], []
    coldstart_ms = 0.0
    try:
        results = model.predict(
            source=str(src_dir), save=True, project=str(run_dir), name="pred",
            conf=a.conf, iou=a.iou, imgsz=a.imgsz, verbose=False, exist_ok=True,
        )
        for idx, r in enumerate(results):
            dets = []
            if r.boxes is not None:
                for bx in r.boxes:
                    ci = int(bx.cls[0])
                    dets.append({"name": names.get(ci, str(ci)), "conf": float(bx.conf[0])})
            # --- waktu proses per gambar (ms) dari ultralytics ---
            sp = getattr(r, "speed", None) or {}
            pre = float(sp.get("preprocess", 0) or 0)
            inf = float(sp.get("inference", 0) or 0)
            post = float(sp.get("postprocess", 0) or 0)
            tot = pre + inf + post
            if idx == 0:
                coldstart_ms = round(tot, 2)
            else:
                t_pre.append(pre); t_inf.append(inf); t_post.append(post); t_tot.append(tot)
            src = Path(r.path)
            saved = Path(r.save_dir) / src.name
            preds.append({
                "name": src.name,
                "image": str(saved.resolve()) if saved.exists() else str(src.resolve()),
                "detections": dets,
                "ms": {"preprocess": round(pre, 2), "inference": round(inf, 2),
                       "postprocess": round(post, 2), "total": round(tot, 2)},
            })
    except Exception as e:
        print(f"[!] predict gagal: {e}", flush=True)

    # Bila hanya ada 1 gambar, jangan sampai statistik kosong.
    if not t_tot and preds:
        m = preds[0]["ms"]
        t_pre, t_inf, t_post, t_tot = [m["preprocess"]], [m["inference"]], [m["postprocess"]], [m["total"]]

    tot_stat = stat_block(t_tot)
    timing = {
        "device": device_info(),
        "imgsz": a.imgsz,
        "conf": a.conf,
        "iou": a.iou,
        "nImages": len(preds),
        "nMeasured": tot_stat["n"],
        "coldStartMs": coldstart_ms,
        "note": "Gambar pertama (cold-start pemuatan model) dikeluarkan dari statistik.",
        "perStage": {
            "preprocess": stat_block(t_pre),
            "inference": stat_block(t_inf),
            "postprocess": stat_block(t_post),
            "total": tot_stat,
        },
        "throughputPerMinute": round(60000.0 / tot_stat["mean"], 1) if tot_stat["mean"] > 0 else 0.0,
        "fps": round(1000.0 / tot_stat["mean"], 2) if tot_stat["mean"] > 0 else 0.0,
        "valSpeed": {k: round(float(v), 2) for k, v in (getattr(val, "speed", None) or {}).items()},
    }

    result = {
        "split": split,
        "savedDir": str(run_dir.resolve()),
        "overall": overall,
        "perClass": per_class,
        "plots": plots,
        "timing": timing,
        "predictions": preds,
        "generatedAt": stamp,
    }
    (run_dir / "results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print("PROGRESS 3/3 selesai", flush=True)
    print("EVAL_RESULT " + json.dumps(result), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[X] Evaluasi gagal: {e}", flush=True)
        sys.exit(1)
