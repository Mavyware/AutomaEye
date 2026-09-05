// lib/paths.js — location of the Python scripts, both in dev and once packaged.
//
// Why this is needed:
//   1. Scripts are invoked via a relative path ("python/train.py") and spawned
//      with no cwd. In dev this happens to work because cwd = the app folder,
//      but an installed app can be run from any folder.
//   2. Once packaged, the app's code lives inside app.asar. Python CANNOT
//      run a file that's inside that archive, so the python/ folder is
//      deliberately kept outside asar (extraResources) and resolved to
//      process.resourcesPath.

const path = require('path');
const { app } = require('electron');

/** Folder containing the Python scripts (train.py, infer_server.py, evaluate.py, ...). */
function pythonDir() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'python')
        : path.join(__dirname, '..', 'python');
}

/**
 * Absolute path of a Python script.
 * Accepts both "train.py" and "python/train.py" (the old form in config.yaml),
 * both are resolved to the correct python folder.
 */
function pythonScript(nameOrRelPath, fallback) {
    const raw = String(nameOrRelPath || fallback || '');
    return path.join(pythonDir(), path.basename(raw));
}

exports.pythonDir = pythonDir;
exports.pythonScript = pythonScript;
