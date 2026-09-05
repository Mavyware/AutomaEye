// lib/customoutput.js — user-authored custom output.
//
// This is where this app's real power lies: if the default Arduino 0/1
// signal isn't enough, the user can write exactly what happens on every
// inspection result — send a different byte to the PLC, fire an HTTP
// request to an MES/dashboard, write a log, etc.
// (Equivalent to the "Custom code" feature in the C# version, which used Jint.)
//
// Contract: the script MUST define a function onResult(result).
//   result = { verdict:'OK'|'NG', confidence, totalMS,
//               steps:[{ modelName, verdict, confidence, classes:[...] }] }
//
// Helpers available inside the script:
//   serial_write(str)        — send a raw string to the Arduino/PLC
//   http_post(url, bodyObj)  — POST JSON (fire-and-forget, 5 second timeout)
//   log(msg)                 — shows up in the app's log
//   sleep_ms(n)              — pause (max 5 seconds, so the cycle doesn't hang)
//
// Note: vm is not a full security sandbox — this runs the user's own code on
// their own machine, the same trust model as an Excel macro.

const vm = require('node:vm');

const SCRIPT_TIMEOUT_MS = 5000;

function buildSandbox(arduino, logs) {
    return {
        serial_write: (str) => {
            logs.push(`serial_write(${JSON.stringify(String(str))})`);
            // Deliberately not awaited: output must not hold up the inspection cycle.
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
            while (Date.now() < end) { /* deliberately blocking: the user script is synchronous */ }
        },
        console: { log: (...a) => logs.push(a.join(' ')) },
    };
}

/** The result shape seen by the script — deliberately flattened for ease of use. */
function toScriptResult(result) {
    const steps = (result.steps || []).map((s) => ({
        modelName: s.modelName || s.label || s.category || '',
        verdict: s.verdict,
        confidence: s.confidence || 0,
        // The names of classes detected in this step. Without this the script
        // couldn't tell "cacat scratch" apart from "cacat warna" - and that's
        // exactly why people write their own output in the first place.
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

/**
 * Run the user's script for one inspection result.
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

/** Test the script with a sample result, without needing to run a real inspection. */
exports.test = (script, arduino, verdict = 'OK') => exports.run(script, {
    finalVerdict: verdict,
    totalMS: 123.4,
    steps: [{
        modelName: 'ContohModel',
        verdict,
        confidence: 0.93,
        // The sample also carries a class, so a script that uses
        // result.steps[].classes can be tested without a real inspection.
        detections: verdict === 'NG'
            ? [{ class_name: 'cacat scratch', confidence: 0.93 }]
            : [{ class_name: 'ok', confidence: 0.93 }],
    }],
}, arduino);

exports.DEFAULT_SCRIPT = `// Written in JavaScript, run inside the app
// (not on the board). Called once for every inspection result.
//
// result = {
//   verdict: "OK" | "NG",
//   confidence, totalMS,
//   steps: [{ modelName, verdict, confidence, classes: ["cacat scratch", ...] }]
// }
//
// Helper: serial_write(str), http_post(url, body), log(str), sleep_ms(n)

function onResult(result) {
  // Example: send a different signal depending on the detected class.
  const kelas = result.steps.flatMap(s => s.classes);

  if (kelas.includes("cacat scratch")) {
    serial_write("S\\n");
  } else if (kelas.includes("cacat warna")) {
    serial_write("W\\n");
  } else if (result.verdict === "NG") {
    serial_write("1\\n");
  } else {
    serial_write("0\\n");
  }

  log("kelas terdeteksi: " + (kelas.join(", ") || "tidak ada"));
}
`;
