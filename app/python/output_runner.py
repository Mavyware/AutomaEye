"""Menjalankan skrip output buatan pengguna yang ditulis dalam Python.

Dipanggil lib/pyoutput.js. Masukan berupa satu baris JSON di stdin:

    {"script": "<kode pengguna>", "result": { ... }}

Skrip pengguna wajib mendefinisikan on_result(result).

Helper (serial_write, http_post, log, sleep_ms) TIDAK melakukan I/O-nya
sendiri. Semuanya menuliskan perintah ke stdout, dan aplikasi yang
mengerjakannya:

    @@CMD@@ {"jenis": "serial", "data": "S\\n"}

Alasannya port serial dan sambungan Modbus dipegang oleh aplikasi, dan port
serial hanya bisa dibuka satu proses. Kalau skrip Python membuka portnya
sendiri, ia akan bentrok dengan aplikasi yang sedang memakainya - kegagalan
yang muncul sebagai "port sedang dipakai" di tengah lini berjalan.
"""

import json
import sys
import time

PENANDA = "@@CMD@@ "


def _kirim(jenis, **isi):
    isi["jenis"] = jenis
    sys.stdout.write(PENANDA + json.dumps(isi, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def serial_write(teks):
    """Kirim teks mentah ke papan / PLC lewat sambungan milik aplikasi."""
    _kirim("serial", data=str(teks))


def http_post(url, body=None):
    """Kirim JSON ke server. Tidak ditunggu, seperti versi JavaScript-nya."""
    _kirim("http", url=str(url), body=body if body is not None else {})


def log(pesan):
    """Muncul di panel hasil uji di aplikasi."""
    _kirim("log", pesan=str(pesan))


def sleep_ms(n):
    """Jeda, dibatasi 5 detik supaya siklus inspeksi tidak menggantung."""
    try:
        ms = float(n)
    except (TypeError, ValueError):
        ms = 0
    time.sleep(max(0.0, min(ms, 5000.0)) / 1000.0)


def main():
    try:
        masuk = json.loads(sys.stdin.read() or "{}")
    except Exception as e:                                  # noqa: BLE001
        _kirim("error", pesan="Masukan tidak terbaca: %s" % e)
        return 1

    kode = masuk.get("script") or ""
    hasil = masuk.get("result") or {}

    lingkup = {
        "serial_write": serial_write,
        "http_post": http_post,
        "log": log,
        "sleep_ms": sleep_ms,
        "__name__": "automaeyes_output",
    }

    try:
        exec(compile(kode, "<output>", "exec"), lingkup)     # noqa: S102
    except Exception as e:                                   # noqa: BLE001
        _kirim("error", pesan="Kesalahan saat membaca skrip: %s" % e)
        return 1

    fungsi = lingkup.get("on_result")
    if not callable(fungsi):
        _kirim("error", pesan="Skrip harus mendefinisikan fungsi on_result(result).")
        return 1

    try:
        fungsi(hasil)
    except Exception as e:                                   # noqa: BLE001
        _kirim("error", pesan="%s: %s" % (type(e).__name__, e))
        return 1

    _kirim("selesai")
    return 0


if __name__ == "__main__":
    sys.exit(main())
