# -*- coding: utf-8 -*-
"""Uji jalur runtime (infer.py & infer_server.py) dengan model klasifikasi."""
import base64
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

# Keluaran ultralytics penuh karakter non-ASCII. Konsol Windows memakai cp1252
# secara bawaan dan melempar UnicodeEncodeError di tengah uji - kegagalan yang
# sama sekali tidak berhubungan dengan yang sedang diuji.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from PIL import Image

APP = Path(__file__).resolve().parent.parent
# Memakai bobot hasil cls_pipeline.py - jalankan itu lebih dulu.
BEST = (Path(tempfile.gettempdir()) / 'automaeyes-uji-cls' /
        'ProyekUji' / 'models' / 'ModelUji' / 'weights' / 'best.pt')
if not BEST.exists():
    raise SystemExit('Bobot uji belum ada. Jalankan cls_pipeline.py dulu.')

buf = io.BytesIO()
Image.new('RGB', (64, 64), (30, 30, 200)).save(buf, format='JPEG')
b64 = base64.b64encode(buf.getvalue()).decode()

# Daftar kelas SENGAJA dikirim dalam urutan aplikasi (zebra, apel), yang
# berbeda dari urutan abjad milik model (apel, zebra). Kalau kode runtime
# memakai daftar ini alih-alih model.names, hasilnya akan tertukar.
KELAS_APP = 'zebra,apel'

print('=== infer.py ===')
r = subprocess.run(
    [sys.executable, 'infer.py', '--weights', str(BEST),
     '--classes', KELAS_APP, '--imgsz', '64'],
    cwd=str(APP / 'python'), input=b64 + '\n',
    capture_output=True, text=True, encoding='utf-8', errors='replace')
baris = [l for l in (r.stdout or '').splitlines() if l.startswith('{')]
assert baris, 'tidak ada output JSON:\n' + (r.stdout or '') + (r.stderr or '')
hasil = json.loads(baris[-1])
print(json.dumps(hasil, indent=2)[:600])
assert hasil['detections'], 'model klasifikasi tidak menghasilkan deteksi apa pun'
d = hasil['detections'][0]
assert d['class_name'] in ('apel', 'zebra'), 'nama kelas asing: %r' % d['class_name']
assert (d['x2'], d['y2']) == (64.0, 64.0), 'kotak tidak seluas gambar'
assert hasil['verdict'] == 'NG', 'kelas bukan-OK seharusnya NG, dapat %r' % hasil['verdict']

print('\n=== infer_server.py ===')
req = json.dumps({'id': 1, 'weights': str(BEST), 'classes': KELAS_APP.split(','),
                  'imgsz': 64, 'image': b64})
r2 = subprocess.run([sys.executable, 'infer_server.py'],
                    cwd=str(APP / 'python'), input=req + '\n',
                    capture_output=True, text=True, encoding='utf-8', errors='replace')
# Server membalas dengan awalan @@RESP@@, bukan JSON telanjang.
baris2 = [l[len('@@RESP@@ '):] for l in (r2.stdout or '').splitlines()
          if l.startswith('@@RESP@@ ')]
assert baris2, 'server tidak menjawab:\n' + (r2.stdout or '')[-2000:] + (r2.stderr or '')[-2000:]
h2 = json.loads(baris2[-1])
print(json.dumps(h2, indent=2)[:600])
assert h2['detections'], 'server: tidak ada deteksi'
assert h2['detections'][0]['class_name'] in ('apel', 'zebra')
assert h2['verdict'] == 'NG'
assert h2['detections'][0]['class_name'] == d['class_name'], \
    'infer.py dan infer_server.py tidak sepakat'

print('\nRUNTIME LULUS')
