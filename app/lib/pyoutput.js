// User-authored output written in Python.
//
// Companion to lib/customoutput.js (JavaScript). Python is offered because
// this app already needs it for model training, and because on both
// production lines and AI work, Python is what people most commonly use
// to hook results up to other systems.
//
// The script runs as a separate process, not inside the app. The helpers
// inside it don't do their own I/O: they write out commands, and this
// module is what actually performs them. The reason is that a serial port
// can only be opened by one process - if the Python script opened it itself,
// it would clash with the app that's already holding that port.

const { spawn } = require('child_process');
const { pythonScript, pythonDir } = require('./paths');

const BATAS_MS = 5000;
const PENANDA = '@@CMD@@ ';

exports.DEFAULT_SCRIPT = `# Written in Python, run by the app every time there's an inspection result.
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

/** The result shape seen by the script — exactly the same as the JavaScript version. */
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

// Carry out a single command requested by the script.
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
 * Run the Python script for one inspection result.
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
        try { anak.kill(); } catch (_) { /* already dead */ }
        selesai(hasil);
    };

    // A hung script must not hold up the production line.
    const pewaktu = setTimeout(() => {
        tutup({ ok: false, logs, error: `Skrip melebihi ${BATAS_MS / 1000} detik dan dihentikan.` });
    }, BATAS_MS);

    anak.stdout.on('data', (buf) => {
        sisa += buf.toString();
        const baris = sisa.split('\n');
        sisa = baris.pop();
        for (const b of baris) {
            if (!b.startsWith(PENANDA)) {
                // A plain print() from the user's script is still useful when
                // debugging, so it's shown instead of being discarded.
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

/** Test with a sample result, without needing to run a real inspection. */
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
