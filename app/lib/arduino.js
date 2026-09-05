// Arduino serial handler. Try to open port on init; expose send() function.
// If it fails (wrong COM port), it's not fatal — the user can fix it in Settings.

let port = null;
let SerialPort = null;
let rxBuffer = '';       // holds incoming data from the Arduino (for the handshake)
let connectedPath = null; // the port that's actually connected (for status)

try {
    ({ SerialPort } = require('serialport'));
} catch (e) {
    console.warn('[arduino] serialport package tidak terinstall:', e.message);
}

// List of COM/serial ports available on the system.
exports.listPorts = async () => {
    if (!SerialPort || !SerialPort.list) return [];
    try { return await SerialPort.list(); } catch (_) { return []; }
};

// Whether this port is likely an Arduino/Wemos board (CH340/CP210x/FTDI/Arduino).
function looksLikeBoard(p) {
    const s = ((p.manufacturer || '') + ' ' + (p.friendlyName || '') + ' ' + (p.pnpId || '')).toLowerCase();
    const vid = (p.vendorId || '').toLowerCase();
    return /wch|ch340|ch910|silabs|cp210|arduino|usb-serial|usb serial|ftdi/.test(s)
        || ['1a86', '10c4', '2341', '0403'].includes(vid);
}

// Determine which port to use: if `preferred` still exists → use it; otherwise
// find the port most likely to be a board; if none, the first available port.
exports.resolvePort = async (preferred) => {
    const ports = await exports.listPorts();
    if (preferred && preferred !== 'auto' && ports.some(p => p.path === preferred)) return preferred;
    const cand = ports.find(looksLikeBoard) || ports[0];
    return cand ? cand.path : null;
};

exports.connectedPort = () => connectedPath;

exports.init = async (arduinoCfg) => {
    if (!SerialPort) return;
    // Auto-detect: if the port is empty/'auto' or the configured COM doesn't exist, find one.
    const path = await exports.resolvePort(arduinoCfg.port);
    if (!path) { console.warn('[arduino] tidak ada COM port tersedia'); return; }
    return new Promise((resolve, reject) => {
        port = new SerialPort({
            path,
            baudRate: arduinoCfg.baud || 9600,
        }, (err) => {
            if (err) {
                console.warn(`[arduino] open ${path} gagal:`, err.message);
                port = null; connectedPath = null;
                reject(err);
                return;
            }
            connectedPath = path;
            console.log(`[arduino] Connected ${path} @ ${arduinoCfg.baud}`);
            // ESP8266/Wemos: release DTR & RTS so the board RUNS its sketch,
            // instead of getting stuck in bootloader mode when the port is opened.
            try {
                port.set({ dtr: false, rts: false }, () => {
                    // A short reset pulse then release → the board boots into its sketch.
                    port.set({ rts: true, dtr: false }, () => {
                        setTimeout(() => port.set({ rts: false, dtr: false }, () => { }), 100);
                    });
                });
            } catch (e) { /* some drivers don't support set() — ignore */ }
            // Swallow serial errors (e.g. cable unplugged, port closed) so they
            // do NOT become an uncaught exception that crashes the app.
            port.on('error', (e) => console.warn('[arduino] serial error:', e && e.message));
            // Buffer incoming data (for the "close/ready" handshake).
            rxBuffer = '';
            port.on('data', (d) => {
                rxBuffer += d.toString();
                if (rxBuffer.length > 4096) rxBuffer = rxBuffer.slice(-1024);
            });
            // Wait ~2.5 seconds for the Wemos to reset & boot before it's ready to send.
            setTimeout(resolve, 2500);
        });
    });
};

exports.send = (data) => {
    return new Promise((resolve, reject) => {
        if (!port) return resolve({ ok: false, reason: 'not connected' });
        port.write(data, (err) => {
            if (err) return reject(err);
            resolve({ ok: true });
        });
    });
};

exports.openGate = () => exports.send('O\n');
exports.closeGate = () => exports.send('C\n');

// Clear the incoming buffer before waiting for a new reply.
exports.flushRx = () => { rxBuffer = ''; };

// Wait for the Arduino to send `token` (e.g. "C" / "READY" / "DONE") signaling
// the output/gate has closed again → safe to move on to the next detection.
// If there's no port / the token is empty → proceed immediately. There's a timeout so it doesn't hang.
exports.waitFor = (token, timeoutMs = 5000) => new Promise((resolve) => {
    if (!port || !token) return resolve({ ok: true, skipped: true });
    const start = Date.now();
    const tick = () => {
        if (rxBuffer.includes(token)) { rxBuffer = ''; return resolve({ ok: true }); }
        if (Date.now() - start > timeoutMs) return resolve({ ok: false, timeout: true });
        setTimeout(tick, 20);
    };
    tick();
});

exports.close = () => {
    const p = port;
    port = null; connectedPath = null; // prevent reuse & double-close
    if (!p) return;
    try {
        if (p.isOpen) p.close(() => { });   // only close if it's actually open; the callback swallows async errors
    } catch (_) { /* "Port is not open" etc. — ignore */ }
};

exports.status = () => ({ connected: !!port });
