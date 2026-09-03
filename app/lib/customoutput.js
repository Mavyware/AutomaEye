// lib/customoutput.js — output buatan user sendiri.
//
// Kekuatan app ini ada di sini: kalau sinyal Arduino 0/1 bawaan tidak cukup,
// user bisa menulis sendiri apa yang terjadi setiap kali ada hasil inspeksi —
// kirim byte lain ke PLC, tembak HTTP ke MES/dashboard, tulis log, dsb.
// (Setara fitur "Custom code" di versi C# yang memakai Jint.)
//
// Kontrak: script WAJIB mendefinisikan fungsi onResult(result).
//   result = { verdict:'OK'|'NG', confidence, totalMS, steps:[{modelName,verdict,confidence}] }
//
// Helper yang tersedia di dalam script:
//   serial_write(str)        — kirim string mentah ke Arduino/PLC
//   http_post(url, bodyObj)  — POST JSON (fire-and-forget, timeout 5 detik)
//   log(msg)                 — muncul di log aplikasi
//   sleep_ms(n)              — jeda (maks 5 detik, supaya siklus tak menggantung)
//
// Catatan: vm bukan sandbox keamanan penuh — ini menjalankan kode milik user
// sendiri di mesinnya sendiri, model kepercayaan yang sama seperti makro Excel.

const vm = require('node:vm');

const SCRIPT_TIMEOUT_MS = 5000;

function buildSandbox(arduino, logs) {
    return {
        serial_write: (str) => {
            logs.push(`serial_write(${JSON.stringify(String(str))})`);
            // Sengaja tidak di-await: output tidak boleh menahan siklus inspeksi.
            try { arduino.send(String(str)); } catch (e) { logs.push(`serial_write gagal: ${e.message}`); }
        },
        http_post: (url, body) => {
            logs.push(`http_post(${url})`);
            try {
                fetch(String(url), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body == null ? {} : body),
                    signal: AbortSignal.timeout(5000),
                }).catch((e) => logs.push(`http_post gagal: ${e.message}`));
            } catch (e) {
                logs.push(`http_post gagal: ${e.message}`);
            }
        },
        log: (msg) => logs.push(String(msg)),
        sleep_ms: (n) => {
            const ms = Math.min(Math.max(Number(n) || 0, 0), 5000);
            const end = Date.now() + ms;
            while (Date.now() < end) { /* blocking sengaja: script user bersifat sinkron */ }
        },
        console: { log: (...a) => logs.push(a.join(' ')) },
    };
}

/** Bentuk hasil yang dilihat script — sengaja diratakan supaya mudah dipakai. */
function toScriptResult(result) {
    const steps = (result.steps || []).map((s) => ({
        modelName: s.modelName || s.label || s.category || '',
        verdict: s.verdict,
        confidence: s.confidence || 0,
    }));
    return {
        verdict: result.finalVerdict || 'OK',
        confidence: steps.length ? Math.min(...steps.map((s) => s.confidence || 0)) : 0,
        totalMS: result.totalMS || 0,
        steps,
    };
}

/**
 * Jalankan script user untuk satu hasil inspeksi.
 * @returns {{ok:boolean, logs:string[], error?:string}}
 */
exports.run = (script, result, arduino) => {
    const logs = [];
    if (!script || !script.trim()) return { ok: false, logs, error: 'Script kosong.' };

    try {
        const context = vm.createContext(buildSandbox(arduino, logs));
        vm.runInContext(script, context, { timeout: SCRIPT_TIMEOUT_MS });
        if (typeof context.onResult !== 'function') {
            return { ok: false, logs, error: 'Script harus mendefinisikan fungsi onResult(result).' };
        }
        context.__result = toScriptResult(result);
        vm.runInContext('onResult(__result)', context, { timeout: SCRIPT_TIMEOUT_MS });
        return { ok: true, logs };
    } catch (e) {
        return { ok: false, logs, error: e.message };
    }
};

/** Uji script dengan hasil contoh, tanpa perlu menjalankan inspeksi sungguhan. */
exports.test = (script, arduino, verdict = 'OK') => exports.run(script, {
    finalVerdict: verdict,
    totalMS: 123.4,
    steps: [{ modelName: 'ContohModel', verdict, confidence: 0.93 }],
}, arduino);

exports.DEFAULT_SCRIPT = `// Dipanggil sekali setiap ada hasil inspeksi.
// result = { verdict: "OK"|"NG", confidence, totalMS, steps: [...] }
// Helper: serial_write(str), http_post(url, body), log(str), sleep_ms(n)

function onResult(result) {
  if (result.verdict === "NG") {
    serial_write("1\\n");
  } else {
    serial_write("0\\n");
  }
}
`;
