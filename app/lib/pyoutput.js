// Output buatan pengguna yang ditulis dalam Python.
//
// Pendamping lib/customoutput.js (JavaScript). Python ditawarkan karena
// aplikasi ini memang sudah membutuhkannya untuk pelatihan model, dan karena
// di lini produksi maupun di pekerjaan AI, Python-lah yang paling lazim
// dipakai orang untuk menyambungkan hasil ke sistem lain.
//
// Skripnya dijalankan sebagai proses terpisah, bukan di dalam aplikasi.
// Helper di dalamnya tidak melakukan I/O sendiri: mereka menuliskan perintah,
// dan modul ini yang mengerjakannya. Alasannya port serial hanya bisa dibuka
// satu proses - kalau skrip Python membukanya sendiri, ia bentrok dengan
// aplikasi yang sedang memegang port itu.

const { spawn } = require('child_process');
const { pythonScript, pythonDir } = require('./paths');

const BATAS_MS = 5000;
const PENANDA = '@@CMD@@ ';

exports.DEFAULT_SCRIPT = `# Bahasanya Python, dijalankan oleh aplikasi setiap ada hasil inspeksi.
#
# result = {
#   "verdict": "OK" | "NG",
#   "confidence": 0.93,
#   "totalMS": 123.4,
#   "steps": [{"modelName": ..., "verdict": ..., "confidence": ...,
#              "classes": ["cacat scratch", ...]}]
# }
#
# Helper: serial_write(str), http_post(url, obj), log(str), sleep_ms(n)

def on_result(result):
    kelas = [k for s in result["steps"] for k in s["classes"]]

    if "cacat scratch" in kelas:
        serial_write("S\\n")
    elif "cacat warna" in kelas:
        serial_write("W\\n")
    elif result["verdict"] == "NG":
        serial_write("1\\n")
    else:
        serial_write("0\\n")

    log("kelas terdeteksi: " + (", ".join(kelas) or "tidak ada"))
`;

/** Bentuk hasil yang dilihat skrip — sama persis dengan versi JavaScript. */
function toScriptResult(result) {
    const steps = (result.steps || []).map((s) => ({
        modelName: s.modelName || s.label || s.category || '',
        verdict: s.verdict,
        confidence: s.confidence || 0,
        classes: (s.detections || [])
            .map((d) => d.class_name || d.className || d.name)
            .filter(Boolean),
    }));
    return {
        verdict: result.finalVerdict || 'OK',
        confidence: steps.length ? Math.min(...steps.map((s) => s.confidence || 0)) : 0,
        totalMS: result.totalMS || 0,
        steps,
    };
}

// Kerjakan satu perintah yang diminta skrip.
function jalankanPerintah(cmd, arduino, logs) {
    if (cmd.jenis === 'serial') {
        logs.push(`serial_write(${JSON.stringify(cmd.data)})`);
        try { arduino.send(String(cmd.data)); } catch (e) { logs.push(`serial_write gagal: ${e.message}`); }
    } else if (cmd.jenis === 'http') {
        logs.push(`http_post(${cmd.url})`);
        try {
            fetch(String(cmd.url), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cmd.body == null ? {} : cmd.body),
                signal: AbortSignal.timeout(5000),
            }).catch((e) => logs.push(`http_post gagal: ${e.message}`));
        } catch (e) {
            logs.push(`http_post gagal: ${e.message}`);
        }
    } else if (cmd.jenis === 'log') {
        logs.push(String(cmd.pesan));
    }
}

/**
 * Jalankan skrip Python untuk satu hasil inspeksi.
 * @returns {Promise<{ok:boolean, logs:string[], error?:string}>}
 */
exports.run = (script, result, arduino, pyCfg) => new Promise((selesai) => {
    const logs = [];
    if (!script || !script.trim()) { selesai({ ok: false, logs, error: 'Skrip kosong.' }); return; }

    let anak;
    try {
        anak = spawn((pyCfg && pyCfg.exe) || 'python',
            [pythonScript(null, 'output_runner.py')],
            { cwd: pythonDir() });
    } catch (e) {
        selesai({ ok: false, logs, error: `Python tidak bisa dijalankan: ${e.message}` });
        return;
    }

    let galat = null;
    let sisa = '';
    let stderr = '';
    let sudah = false;

    const tutup = (hasil) => {
        if (sudah) return;
        sudah = true;
        clearTimeout(pewaktu);
        try { anak.kill(); } catch (_) { /* sudah mati */ }
        selesai(hasil);
    };

    // Skrip yang menggantung tidak boleh menahan lini produksi.
    const pewaktu = setTimeout(() => {
        tutup({ ok: false, logs, error: `Skrip melebihi ${BATAS_MS / 1000} detik dan dihentikan.` });
    }, BATAS_MS);

    anak.stdout.on('data', (buf) => {
        sisa += buf.toString();
        const baris = sisa.split('\n');
        sisa = baris.pop();
        for (const b of baris) {
            if (!b.startsWith(PENANDA)) {
                // print() biasa dari skrip pengguna tetap berguna saat mencari
                // kesalahan, jadi ikut ditampilkan alih-alih dibuang.
                if (b.trim()) logs.push(b.trim());
                continue;
            }
            let cmd;
            try { cmd = JSON.parse(b.slice(PENANDA.length)); } catch (_) { continue; }
            if (cmd.jenis === 'error') galat = cmd.pesan;
            else jalankanPerintah(cmd, arduino, logs);
        }
    });

    anak.stderr.on('data', (b) => { stderr += b.toString(); });

    anak.on('error', (e) => {
        tutup({
            ok: false, logs,
            error: e.code === 'ENOENT'
                ? 'Python tidak ditemukan. Periksa Settings → Python.'
                : e.message,
        });
    });

    anak.on('close', () => {
        if (galat) { tutup({ ok: false, logs, error: galat }); return; }
        if (stderr.trim()) { tutup({ ok: false, logs, error: stderr.trim().split('\n').slice(-3).join('\n') }); return; }
        tutup({ ok: true, logs });
    });

    anak.stdin.write(JSON.stringify({ script, result: toScriptResult(result) }));
    anak.stdin.end();
});

/** Uji dengan hasil contoh, tanpa perlu menjalankan inspeksi sungguhan. */
exports.test = (script, arduino, verdict = 'OK', pyCfg) => exports.run(script, {
    finalVerdict: verdict,
    totalMS: 123.4,
    steps: [{
        modelName: 'ContohModel',
        verdict,
        confidence: 0.93,
        detections: verdict === 'NG'
            ? [{ class_name: 'cacat scratch', confidence: 0.93 }]
            : [{ class_name: 'ok', confidence: 0.93 }],
    }],
}, arduino, pyCfg);
