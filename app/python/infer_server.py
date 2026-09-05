"""
YOLO inference SERVER (persistent) — loads the model & torch ONCE, then serves
many requests with no reload. This removes the ~6s/frame lag caused by
importing torch + loading the model on every single call.

Protocol (line by line via stdin/stdout):
  - When ready:  stdout -> "@@READY@@"
  - Request   :  stdin  <- {"id":1,"weights":"...best.pt","conf":0.35,"iou":0.45,
                            "imgsz":640,"classes":["a","b"],"image":"<base64 jpg>"}
  - Response  :  stdout -> "@@RESP@@ {json}"  (with the same "id" field)

Models are cached per weights path → switching models (Object Detector /
Socket Measurement) doesn't reload.
"""
import sys
import io
import json
import base64
import time


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


def main():
    # Heavy import ONCE at startup (not per request).
    try:
        from ultralytics import YOLO
        from PIL import Image
        import numpy as np
    except ImportError as e:
        print("@@RESP@@ " + json.dumps({"error": f"deps missing: {e}. Run: pip install ultralytics pillow"}), flush=True)
        return
    try:
        import cv2  # for GD&T measurement from the mask contour (segmentation)
    except Exception:
        cv2 = None

    models = {}   # weights_path -> YOLO (cache)

    def measure_from_contour(contour):
        if cv2 is None or contour is None or len(contour) < 3:
            return None
        try:
            cnt = np.array(contour, dtype=np.float32).reshape(-1, 1, 2)
            # Smooth the contour: remove small spikes/noise on the mask edge so
            # the measurement is more stable (reduces minAreaRect jitter from glare/reflection).
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.008 * peri, True)
            if approx is not None and len(approx) >= 3:
                cnt = approx.astype(np.float32)
            (_, _), radius = cv2.minEnclosingCircle(cnt)
            (_, _), (w, h), _ = cv2.minAreaRect(cnt)
            return {
                "diameterPx": float(radius * 2.0),
                "widthPx": float(min(w, h)),
                "heightPx": float(max(w, h)),
                "areaPx": float(cv2.contourArea(cnt)),
            }
        except Exception:
            return None

    # ---- Extra analysis for add-ons (used by lib/workflow.js) ----
    # Everything here is pure classic CV on the frame's pixels; no extra AI model added.

    def crop(arr_bgr, det, pad=0):
        h, w = arr_bgr.shape[:2]
        x1 = max(0, int(det["x1"]) - pad); y1 = max(0, int(det["y1"]) - pad)
        x2 = min(w, int(det["x2"]) + pad); y2 = min(h, int(det["y2"]) + pad)
        if x2 <= x1 or y2 <= y1:
            return None
        return arr_bgr[y1:y2, x1:x2]

    def analyze_color(arr_bgr, det):
        """Average HSV + RGB inside the detection box (Color Inspection)."""
        roi = crop(arr_bgr, det)
        if roi is None or cv2 is None:
            return None
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        mh, ms, mv = [float(x) for x in cv2.mean(hsv)[:3]]
        mb, mg, mr = [float(x) for x in cv2.mean(roi)[:3]]
        return {"h": mh, "s": ms, "v": mv, "r": mr, "g": mg, "b": mb}

    def analyze_scratch(arr_bgr, det):
        """
        Scratch detection without AI: thin, elongated edges within the ROI.
        A scratch = a contour with a large length:width ratio but small area.
        """
        roi = crop(arr_bgr, det)
        if roi is None or cv2 is None:
            return None
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
        edges = cv2.Canny(gray, 50, 150)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE,
                                 cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
        cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        area_roi = float(roi.shape[0] * roi.shape[1]) or 1.0
        worst, count = 0.0, 0
        for c in cnts:
            if len(c) < 5 or cv2.contourArea(c) < 8:
                continue
            (_, _), (w, h), _ = cv2.minAreaRect(c)
            if min(w, h) < 1e-3:
                continue
            elong = max(w, h) / max(min(w, h), 1e-3)
            length_ratio = max(w, h) / max(roi.shape[0], roi.shape[1])
            # Long & very thin = the signature of a scratch, not an ordinary object edge.
            if elong >= 6 and length_ratio >= 0.15:
                count += 1
                worst = max(worst, elong)
        return {"count": count, "worstElongation": worst,
                "edgeRatio": float(cv2.countNonZero(edges)) / area_roi}

    def analyze_codes(arr_bgr):
        """Decode QR (2D Code) and barcode (1D Code) from the whole frame."""
        out = {"qr": [], "barcode": []}
        if cv2 is None:
            return out
        try:
            qr = cv2.QRCodeDetector()
            ok, texts, _, _ = qr.detectAndDecodeMulti(arr_bgr)
            if ok:
                out["qr"] = [t for t in texts if t]
        except Exception:
            pass
        try:
            if hasattr(cv2, "barcode"):
                bd = cv2.barcode.BarcodeDetector()
                ok, texts, _, _ = bd.detectAndDecodeWithType(arr_bgr)
                if ok:
                    out["barcode"] = [t for t in texts if t]
        except Exception:
            pass
        return out

    def read_text(detections):
        """
        OCR based on the AI OCR model: each character is one detection, so
        the text is assembled by sorting detections left to right.
        No separate OCR engine needed.
        """
        chars = [d for d in detections if d.get("class_name")]
        if not chars:
            return ""
        chars = sorted(chars, key=lambda d: d["x1"])
        return "".join(str(d["class_name"]) for d in chars)

    def handle(req):
        rid = req.get("id")
        weights = req["weights"]
        classes = req.get("classes", [])
        conf = float(req.get("conf", 0.35))
        iou = float(req.get("iou", 0.45))
        imgsz = int(req.get("imgsz", 640))
        img = Image.open(io.BytesIO(base64.b64decode(req["image"]))).convert("RGB")
        arr = np.array(img)

        model = models.get(weights)
        if model is None:
            model = YOLO(weights)
            models[weights] = model

        t0 = time.time()
        results = model.predict(source=arr, conf=conf, iou=iou, imgsz=imgsz, verbose=False)
        infer_ms = (time.time() - t0) * 1000

        detections = []
        min_conf = 1.0
        verdict = "OK"

        # --- Classification model ---
        # No boxes at all: r.boxes is always None, the answer is in r.probs.
        # Without this branch the loop below finds nothing and every object
        # gets marked OK - a silent pass-through, the most dangerous kind of
        # failure for a quality control tool.
        #
        # The class name is taken from the model, not from the "classes" list
        # sent by the app: during training, ultralytics sorts class folder
        # names alphabetically, so the index order isn't necessarily the same.
        is_cls = bool(results) and getattr(results[0], "probs", None) is not None
        if is_cls:
            r = results[0]
            mnames = r.names if isinstance(r.names, dict) else dict(enumerate(r.names))
            ci = int(r.probs.top1)
            c = float(r.probs.top1conf)
            cls_name = mnames.get(ci, str(ci))
            h, w = arr.shape[:2]
            # The class applies to the whole image, so the box spans the whole
            # image. The result shape is made exactly identical to a detection
            # result, so the workflow, pin output, and reports don't need to
            # know the model's type - including the color/scratch add-ons that read the box.
            detections.append({
                "x1": 0.0, "y1": 0.0, "x2": float(w), "y2": float(h),
                "confidence": c, "class_id": ci, "class_name": cls_name,
            })
            if cls_name != "OK":
                verdict = "NG"
                min_conf = c

        for r in ([] if is_cls else results):
            if r.boxes is None:
                continue
            masks_xy = None
            if getattr(r, "masks", None) is not None:
                try:
                    masks_xy = r.masks.xy
                except Exception:
                    masks_xy = None
            for j, box in enumerate(r.boxes):
                cls_id = int(box.cls[0])
                c = float(box.conf[0])
                xyxy = box.xyxy[0].tolist()
                cls_name = classes[cls_id] if cls_id < len(classes) else str(cls_id)
                det = {
                    "x1": xyxy[0], "y1": xyxy[1], "x2": xyxy[2], "y2": xyxy[3],
                    "confidence": c, "class_id": cls_id, "class_name": cls_name,
                }
                if masks_xy is not None and j < len(masks_xy):
                    meas = measure_from_contour(masks_xy[j])
                    if meas:
                        det["measure"] = meas
                detections.append(det)
                if cls_name != "OK":
                    verdict = "NG"
                    if c < min_conf:
                        min_conf = c
        # Extra analysis only runs when its add-on is actually in use, so a
        # frame that doesn't need it doesn't pay the CV cost.
        want = set(req.get("analyze") or [])
        extra = {}
        if want:
            arr_bgr = arr[:, :, ::-1].copy() if cv2 is not None else None
            if "color" in want and arr_bgr is not None:
                for d in detections:
                    c = analyze_color(arr_bgr, d)
                    if c:
                        d["color"] = c
            if "scratch" in want and arr_bgr is not None:
                for d in detections:
                    sc = analyze_scratch(arr_bgr, d)
                    if sc:
                        d["scratch"] = sc
            if "codes" in want and arr_bgr is not None:
                extra["codes"] = analyze_codes(arr_bgr)
            if "text" in want:
                extra["text"] = read_text(detections)

        return {
            "id": rid,
            "verdict": verdict,
            "minConfidence": min_conf if verdict == "NG" else 1.0,
            "inferenceMS": infer_ms,
            "detections": detections,
            **extra,
        }

    eprint("[infer_server] deps loaded, ready")
    print("@@READY@@", flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            print("@@RESP@@ " + json.dumps({"error": f"bad request: {e}"}), flush=True)
            continue
        try:
            out = handle(req)
            print("@@RESP@@ " + json.dumps(out), flush=True)
        except Exception as e:
            print("@@RESP@@ " + json.dumps({"id": req.get("id"), "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
