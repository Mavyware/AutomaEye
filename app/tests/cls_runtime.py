# -*- coding: utf-8 -*-
"""Tests the runtime path (infer.py & infer_server.py) with a classification model."""
import base64
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

# ultralytics output is full of non-ASCII characters. The Windows console
# defaults to cp1252 and throws UnicodeEncodeError mid-test - a failure that
# has nothing at all to do with what's actually being tested.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from PIL import Image

APP = Path(__file__).resolve().parent.parent
# Uses the weights produced by cls_pipeline.py - run that one first.
BEST = (Path(tempfile.gettempdir()) / 'automaeyes-uji-cls' /
        'ProyekUji' / 'models' / 'ModelUji' / 'weights' / 'best.pt')
if not BEST.exists():
    raise SystemExit('Test weights not found. Run cls_pipeline.py first.')

buf = io.BytesIO()
Image.new('RGB', (64, 64), (30, 30, 200)).save(buf, format='JPEG')
b64 = base64.b64encode(buf.getvalue()).decode()

# The class list is DELIBERATELY sent in the app's order (zebra, apel), which
# differs from the model's alphabetical order (apel, zebra). If the runtime
# code uses this list instead of model.names, the result will be swapped.
KELAS_APP = 'zebra,apel'

print('=== infer.py ===')
r = subprocess.run(
    [sys.executable, 'infer.py', '--weights', str(BEST),
     '--classes', KELAS_APP, '--imgsz', '64'],
    cwd=str(APP / 'python'), input=b64 + '\n',
    capture_output=True, text=True, encoding='utf-8', errors='replace')
baris = [l for l in (r.stdout or '').splitlines() if l.startswith('{')]
assert baris, 'no JSON output:\n' + (r.stdout or '') + (r.stderr or '')
hasil = json.loads(baris[-1])
print(json.dumps(hasil, indent=2)[:600])
assert hasil['detections'], 'classification model produced no detections at all'
d = hasil['detections'][0]
assert d['class_name'] in ('apel', 'zebra'), 'unknown class name: %r' % d['class_name']
assert (d['x2'], d['y2']) == (64.0, 64.0), 'box does not span the whole image'
assert hasil['verdict'] == 'NG', 'a non-OK class should be NG, got %r' % hasil['verdict']

print('\n=== infer_server.py ===')
req = json.dumps({'id': 1, 'weights': str(BEST), 'classes': KELAS_APP.split(','),
                  'imgsz': 64, 'image': b64})
r2 = subprocess.run([sys.executable, 'infer_server.py'],
                    cwd=str(APP / 'python'), input=req + '\n',
                    capture_output=True, text=True, encoding='utf-8', errors='replace')
# The server replies with an @@RESP@@ prefix, not bare JSON.
baris2 = [l[len('@@RESP@@ '):] for l in (r2.stdout or '').splitlines()
          if l.startswith('@@RESP@@ ')]
assert baris2, 'server did not respond:\n' + (r2.stdout or '')[-2000:] + (r2.stderr or '')[-2000:]
h2 = json.loads(baris2[-1])
print(json.dumps(h2, indent=2)[:600])
assert h2['detections'], 'server: no detections'
assert h2['detections'][0]['class_name'] in ('apel', 'zebra')
assert h2['verdict'] == 'NG'
assert h2['detections'][0]['class_name'] == d['class_name'], \
    'infer.py and infer_server.py disagree'

print('\nRUNTIME PASSED')
