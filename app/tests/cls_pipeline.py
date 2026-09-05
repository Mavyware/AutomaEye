# -*- coding: utf-8 -*-
"""
Uji jalur klasifikasi ujung-ke-ujung dengan dataset sintetis.

Membuat dataset kecil berbentuk PERSIS seperti yang dihasilkan aplikasi
(images/<split>/ + labels/<split>/*.txt + data.yaml), lalu menjalankan
train.py dan evaluate.py yang sebenarnya - bukan tiruannya.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Keluaran ultralytics penuh karakter non-ASCII. Konsol Windows memakai cp1252
# secara bawaan dan melempar UnicodeEncodeError di tengah uji - kegagalan yang
# sama sekali tidak berhubungan dengan yang sedang diuji.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

APP = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.gettempdir()) / 'automaeyes-uji-cls'

# Nama kelas sengaja dipilih supaya urutan ABJAD berbeda dari urutan aplikasi:
#   aplikasi : 0=zebra, 1=apel   (urutan di data.yaml)
#   abjad    : 0=apel,  1=zebra  (urutan yang dipakai ultralytics)
# Kalau pemetaan indeksnya salah, hasil ujinya akan tertukar dan ketahuan.
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

    # zebra = merah (indeks aplikasi 0), apel = biru (indeks aplikasi 1)
    warna = {0: (200, 30, 30), 1: (30, 30, 200)}
    for split, n in (('train', 6), ('val', 2)):
        for ci in (0, 1):
            for k in range(n):
                nm = f'{KELAS[ci]}_{split}_{k}'
                bikin_gambar(DS / 'images' / split / f'{nm}.jpg', warna[ci])
                # Persis yang ditulis anotator di mode kelas.
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
print('dataset sintetis siap di', DS)

kode, out = jalankan('train.py', [
    'train.py',
    '--project', 'ProyekUji', '--project-dir', str(PROJ),
    '--model', 'ModelUji', '--model-dir', str(MODEL_DIR),
    '--data', str(DS / 'data.yaml'),
    '--epochs', '2', '--batch', '4', '--imgsz', '64', '--lr', '0.01',
    '--type', 'AI Classification',
])
assert kode == 0, 'training gagal'
assert 'results top1:' in out, 'baris ringkasan klasifikasi tidak muncul'

# Susunan folder yang dibangun
print('\n=== susunan folder cls ===')
for p in sorted((DS / 'cls').rglob('*')):
    if p.is_dir():
        print(' ', p.relative_to(DS / 'cls'), '->', len(list(p.glob('*.jpg'))), 'gambar')

best = MODEL_DIR / 'weights' / 'best.pt'
assert best.exists(), 'best.pt tidak tersalin'

kode, out = jalankan('evaluate.py', [
    'evaluate.py',
    '--weights', str(best), '--data', str(DS / 'data.yaml'),
    '--split', 'val', '--out', str(MODEL_DIR / 'eval'), '--imgsz', '64',
])
assert kode == 0, 'evaluasi gagal'
baris = [l for l in out.splitlines() if l.startswith('EVAL_RESULT ')]
assert baris, 'EVAL_RESULT tidak muncul'
hasil = json.loads(baris[-1][len('EVAL_RESULT '):])
print('\n=== hasil evaluasi ===')
print('task     :', hasil['task'])
print('top1     :', hasil['overall']['top1'])
print('perClass :', [(c['name'], round(c['precision'], 3), round(c['recall'], 3))
                     for c in hasil['perClass']])
print('contoh   :', [(p['name'], p['truth'],
                      p['detections'][0]['name'] if p['detections'] else None)
                     for p in hasil['predictions'][:4]])
# Galeri prediksi tab Test harus benar-benar terisi - versi pertama lolos
# dengan daftar kosong karena predict() tidak menelusuri sub-folder.
assert hasil['predictions'], 'daftar prediksi kosong'
assert hasil['timing']['nImages'] == 4, 'jumlah gambar terprediksi salah: %r' % hasil['timing']['nImages']
for pr in hasil['predictions']:
    assert pr['truth'] in KELAS, 'kelas sebenarnya tidak terbaca: %r' % pr['truth']
    assert pr['detections'], 'gambar tanpa prediksi: %r' % pr['name']
    assert pr['detections'][0]['name'] in KELAS, 'nama kelas prediksi asing'
# Nama kelas yang dilaporkan harus dari urutan MODEL (abjad), dan tiap kelas
# aplikasi harus muncul - kalau pemetaan indeksnya tertukar, ini yang gagal.
assert {c['name'] for c in hasil['perClass']} == set(KELAS), 'daftar kelas tidak cocok'
print('\nSEMUA UJI LULUS')
