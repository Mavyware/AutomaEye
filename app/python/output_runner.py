"""Runs a user-authored output script written in Python.

Invoked by lib/pyoutput.js. The input is a single JSON line on stdin:

    {"script": "<user code>", "result": { ... }}

The user's script must define on_result(result).

The helpers (serial_write, http_post, log, sleep_ms) do NOT perform their own
I/O. They all just write a command to stdout, and the app is what actually
carries it out:

    @@CMD@@ {"jenis": "serial", "data": "S\\n"}

The reason is that the serial port and Modbus connection are held by the app,
and a serial port can only be opened by one process. If the Python script
opened its own port, it would clash with the app that's already using it - a
failure that shows up as "port already in use" in the middle of a running line.
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
    """Send raw text to the board / PLC via the app's own connection."""
    _kirim("serial", data=str(teks))


def http_post(url, body=None):
    """Send JSON to a server. Not awaited, same as the JavaScript version."""
    _kirim("http", url=str(url), body=body if body is not None else {})


def log(pesan):
    """Shows up in the app's test result panel."""
    _kirim("log", pesan=str(pesan))


def sleep_ms(n):
    """Pause, capped at 5 seconds so the inspection cycle doesn't hang."""
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
