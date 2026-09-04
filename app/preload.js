// Preload bridge — expose backend API ke renderer secara aman
// (contextIsolation on, tidak expose Node native langsung).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Config
    getConfig: () => ipcRenderer.invoke('config:get'),
    setConfig: (patch) => ipcRenderer.invoke('config:set', patch),

    // Projects
    listProjects: () => ipcRenderer.invoke('projects:list'),
    createProject: (name, description) => ipcRenderer.invoke('projects:create', { name, description }),
    loadProject: (name) => ipcRenderer.invoke('projects:load', name),
    deleteProject: (name) => ipcRenderer.invoke('projects:delete', name),

    // Models
    createModel: (project, model) => ipcRenderer.invoke('models:create', { project, ...model }),
    updateModel: (project, name, patch) => ipcRenderer.invoke('models:update', { project, name, patch }),
    deleteModel: (project, name) => ipcRenderer.invoke('models:delete', { project, name }),
    listImages: (project, model, split) => ipcRenderer.invoke('models:listImages', { project, model, split }),
    galleryData: (project, model, split) => ipcRenderer.invoke('models:galleryData', { project, model, split }),
    modelStats: (project, model) => ipcRenderer.invoke('models:stats', { project, model }),
    importPtModel: (project, model) => ipcRenderer.invoke('models:importPt', { project, model }),
    setActiveVersion: (project, model, versionId) => ipcRenderer.invoke('models:setActiveVersion', { project, model, versionId }),

    // Dataset
    pickImageFiles: () => ipcRenderer.invoke('dataset:pickFiles'),
    uploadImages: (project, model, paths) => ipcRenderer.invoke('dataset:upload', { project, model, paths }),
    deleteImages: (project, model, names) => ipcRenderer.invoke('dataset:deleteImages', { project, model, names }),
    evaluateModel: (project, model, split) => ipcRenderer.invoke('eval:run', { project, model, split }),
    openEvalDir: (dir) => ipcRenderer.invoke('eval:openDir', { dir }),
    onEvalProgress: (cb) => ipcRenderer.on('eval:progress', (_, d) => cb(d)),
    augmentDataset: (project, model, opts) => ipcRenderer.invoke('dataset:augment', { project, model, opts }),
    onAugmentProgress: (cb) => ipcRenderer.on('augment:progress', (_, data) => cb(data)),
    splitDataset: (project, model, ratios) => ipcRenderer.invoke('dataset:split', { project, model, ratios }),
    cleanRebuildDataset: (project, model, ratios) => ipcRenderer.invoke('dataset:cleanRebuild', { project, model, ratios }),

    // Anotasi bawaan (tanpa pihak ketiga)
    annotList: (project, model, split) => ipcRenderer.invoke('annot:list', { project, model, split }),
    annotImage: (project, model, split, name) => ipcRenderer.invoke('annot:image', { project, model, split, name }),
    annotSave: (project, model, split, name, shapes) => ipcRenderer.invoke('annot:save', { project, model, split, name, shapes }),
    openDatasetFolder: (project, model) => ipcRenderer.invoke('dataset:openFolder', { project, model }),

    // Training
    startTraining: (project, model, resume) => ipcRenderer.invoke('training:start', { project, model, resume: !!resume }),
    cancelTraining: () => ipcRenderer.invoke('training:cancel'),
    loadTrainHistory: (project, model) => ipcRenderer.invoke('training:loadHistory', { project, model }),
    onTrainingProgress: (cb) => ipcRenderer.on('training:progress', (_, data) => cb(data)),

    // Sinkronisasi GitHub (Save/Load)
    gitStatus: () => ipcRenderer.invoke('git:status'),
    gitPush: (message) => ipcRenderer.invoke('git:push', { message }),
    gitPull: () => ipcRenderer.invoke('git:pull'),
    gitAutoPullOnce: () => ipcRenderer.invoke('git:autoPullOnce'),
    gitConflictInfo: () => ipcRenderer.invoke('git:conflictInfo'),
    gitResolveConflict: (choice, branchName) => ipcRenderer.invoke('git:resolveConflict', { choice, branchName }),
    quitApp: () => ipcRenderer.invoke('app:quit'),

    // Workflow
    saveWorkflow: (project, steps, onFirstNG) => ipcRenderer.invoke('workflow:save', { project, steps, onFirstNG }),

    // Run
    inspect: (project, imageDataUrl, opts) => ipcRenderer.invoke('run:inspect', { project, imageDataUrl, opts }),
    saveAnnotated: (project, imageDataUrl, result) => ipcRenderer.invoke('run:saveAnnotated', { project, imageDataUrl, result }),
    arduinoSignal: (verdict) => ipcRenderer.invoke('arduino:signal', { verdict }),
    arduinoGate: (kind) => ipcRenderer.invoke('arduino:gate', { kind }),
    arduinoStatus: () => ipcRenderer.invoke('arduino:status'),
    arduinoReconnect: () => ipcRenderer.invoke('arduino:reconnect'),
    arduinoListPorts: () => ipcRenderer.invoke('arduino:listPorts'),
    arduinoSetPort: (port) => ipcRenderer.invoke('arduino:setPort', { port }),

    // Auto-Calibration
    runCalibration: (project, model) => ipcRenderer.invoke('calibration:run', { project, model }),
    onCalibrationProgress: (cb) => ipcRenderer.on('calibration:progress', (_, data) => cb(data)),

    // Laporan (statistik murni, tanpa LLM)
    reportDetectionXlsx: (project, date) => ipcRenderer.invoke('report:detectionXlsx', { project, date }),
    reportDailyXlsx: (project, date) => ipcRenderer.invoke('report:dailyXlsx', { project, date }),
    openPath: (p) => ipcRenderer.invoke('file:open', p),

    // Prasyarat Python
    prereqCheck: () => ipcRenderer.invoke('prereq:check'),
    prereqInstall: () => ipcRenderer.invoke('prereq:install'),
    prereqDone: () => ipcRenderer.invoke('prereq:done'),
    prereqSkip: () => ipcRenderer.invoke('prereq:skip'),
    onPrereqLog: (cb) => ipcRenderer.on('prereq:log', (_, line) => cb(line)),

    // Pembaruan aplikasi
    updateInfo: () => ipcRenderer.invoke('update:info'),
    updateRecheck: () => ipcRenderer.invoke('update:recheck'),

    // Login website + koneksi GitHub milik user
    authStatus: () => ipcRenderer.invoke('auth:status'),
    authLogin: () => ipcRenderer.invoke('auth:login'),
    authLogout: () => ipcRenderer.invoke('auth:logout'),
    onAuthFailed: (cb) => ipcRenderer.on('auth:failed', (_, msg) => cb(msg)),

    githubAuthorize: () => ipcRenderer.invoke('github:authorize'),
    onGithubAuthorized: (cb) => ipcRenderer.on('github:authorized', (_, d) => cb(d)),
    githubConnect: (repoName, createNew, isPrivate) =>
        ipcRenderer.invoke('github:connect', { repoName, createNew, isPrivate }),
    githubRepos: () => ipcRenderer.invoke('github:repos'),
    githubDisconnect: () => ipcRenderer.invoke('github:disconnect'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

    // Output kustom
    getOutputConfig: (project) => ipcRenderer.invoke('output:get', { project }),
    saveOutputConfig: (project, mode, script) => ipcRenderer.invoke('output:save', { project, mode, script }),
    testOutputScript: (script, verdict) => ipcRenderer.invoke('output:test', { script, verdict }),

    // Navigation
    goTo: (page) => ipcRenderer.invoke('nav:go', page),
});
