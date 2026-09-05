# -*- coding: utf-8 -*-
"""
End-to-end test of the classification pipeline with a synthetic dataset.

Builds a small dataset shaped EXACTLY like what the app produces
(images/<split>/ + labels/<split>/*.txt + data.yaml), then runs the real
train.py and evaluate.py - not mocks of them.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# ultralytics output is full of non-ASCII characters. The Windows console
# defaults to cp1252 and throws UnicodeEncodeError mid-test - a failure that
# has nothing at all to do with what's actually being tested.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

APP = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.gettempdir()) / 'automaeyes-uji-cls'

# Class names are deliberately chosen so the ALPHABETICAL order differs from the app's order:
#   app       : 0=zebra, 1=apel   (order in data.yaml)
#   alphabetical : 0=apel,  1=zebra  (order used by ultralytics)
# If the index mapping is wrong, the test results will be swapped and it'll show.
KELAS = ['zebra', 'apel']

PROJ = TMP / 'ProyekUji'
MODEL_DIR = PROJ / 'models' / 'ModelUji'
DS = MODEL_DIR / 'dataset'


def bikin_gambar(path, warna):
    from PIL import Image
    Image.new('RGB', (64, 64), warna).save(path)


def siapkan():
    if TMP.exists():
        shutil.rmtree(TMP, ignore_errors=True)
    for split in ('train', 'val'):
        (DS / 'images' / split).mkdir(parents=True, exist_ok=True)
        (DS / 'labels' / split).mkdir(parents=True, exist_ok=True)

    # zebra = red (app index 0), apel = blue (app index 1)
    warna = {0: (200, 30, 30), 1: (30, 30, 200)}
    for split, n in (('train', 6), ('val', 2)):
        for ci in (0, 1):
            for k in range(n):
                nm = f'{KELAS[ci]}_{split}_{k}'
                bikin_gambar(DS / 'images' / split / f'{nm}.jpg', warna[ci])
                # Exactly what the annotator writes in class mode.
                (DS / 'labels' / split / f'{nm}.txt').write_text(
                    f'{ci} 0.5 0.5 1 1\n', encoding='utf-8')

    (DS / 'data.yaml').write_text(
        'path: ' + str(DS.resolve()).replace('\\', '/') + '\n'
        'train: images/train\n'
        'val: images/val\n'
        'nc: 2\n'
        'names: [' + ', '.join(KELAS) + ']\n', encoding='utf-8')


def jalankan(nama, args):
    print('\n=== ' + nama + ' ===')
    r = subprocess.run([sys.executable] + args, cwd=str(APP / 'python'),
                       capture_output=True, text=True, encoding='utf-8',
                       errors='replace')
    out = (r.stdout or '') + (r.stderr or '')
    print(out[-3000:])
    print('exit', r.returncode)
    return r.returncode, out


siapkan()
print('synthetic dataset ready at', DS)

kode, out = jalankan('train.py', [
    'train.py',
    '--project', 'ProyekUji', '--project-dir', str(PROJ),
    '--model', 'ModelUji', '--model-dir', str(MODEL_DIR),
    '--data', str(DS / 'data.yaml'),
    '--epochs', '2', '--batch', '4', '--imgsz', '64', '--lr', '0.01',
    '--type', 'AI Classification',
])
assert kode == 0, 'training failed'
assert 'results top1:' in out, 'classification summary line did not appear'

# The folder structure that got built
print('\n=== cls folder structure ===')
for p in sorted((DS / 'cls').rglob('*')):
    if p.is_dir():
        print(' ', p.relative_to(DS / 'cls'), '->', len(list(p.glob('*.jpg'))), 'images')

best = MODEL_DIR / 'weights' / 'best.pt'
assert best.exists(), 'best.pt was not copied'

kode, out = jalankan('evaluate.py', [
    'evaluate.py',
    '--weights', str(best), '--data', str(DS / 'data.yaml'),
    '--split', 'val', '--out', str(MODEL_DIR / 'eval'), '--imgsz', '64',
])
assert kode == 0, 'evaluation failed'
baris = [l for l in out.splitlines() if l.startswith('EVAL_RESULT ')]
assert baris, 'EVAL_RESULT did not appear'
hasil = json.loads(baris[-1][len('EVAL_RESULT '):])
print('\n=== evaluation result ===')
print('task     :', hasil['task'])
print('top1     :', hasil['overall']['top1'])
print('perClass :', [(c['name'], round(c['precision'], 3), round(c['recall'], 3))
                     for c in hasil['perClass']])
print('sample   :', [(p['name'], p['truth'],
                      p['detections'][0]['name'] if p['detections'] else None)
                     for p in hasil['predictions'][:4]])
# The Test tab's prediction gallery must actually be populated - the first
# version passed with an empty list because predict() doesn't walk sub-folders.
assert hasil['predictions'], 'prediction list is empty'
assert hasil['timing']['nImages'] == 4, 'wrong number of predicted images: %r' % hasil['timing']['nImages']
for pr in hasil['predictions']:
    assert pr['truth'] in KELAS, 'true class not read correctly: %r' % pr['truth']
    assert pr['detections'], 'image with no prediction: %r' % pr['name']
    assert pr['detections'][0]['name'] in KELAS, 'unknown predicted class name'
# The reported class names must come from the MODEL's (alphabetical) order,
# and every app class must appear - if the index mapping is swapped, this is what fails.
assert {c['name'] for c in hasil['perClass']} == set(KELAS), 'class list does not match'
print('\nALL TESTS PASSED')
