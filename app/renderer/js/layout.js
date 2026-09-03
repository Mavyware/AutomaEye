// Layout injector — otomatis pasang menu bar + toolbar + status bar
// pada semua page yang include script ini.
//
// Cara pakai di HTML page:
//   <body>
//     <div id="page-content">...</div>
//     <script src="../js/layout.js"></script>
//   </body>
//
// Options bisa di-set sebelum load layout.js:
//   window.LAYOUT_OPTS = { title: 'Model xyz', showTotalStatus: true, mode: 'setting' };

(function() {
    const opts = window.LAYOUT_OPTS || {};
    const title = opts.title || 'AutomaEyes';
    const subtitle = opts.subtitle || 'Socket Holder Quality Control';
    const mode = opts.mode || 'setting';
    const showTotalStatus = opts.showTotalStatus !== false;
    const showFooter = opts.showFooter !== false;

    // ==== MENU BAR ====
    const menubarHTML = `
        <div class="menubar">
            <div class="menu-item" style="position:relative" onclick="toggleMenu(event,'fileMenu')">File &#9662;
                <div id="fileMenu" class="util-menu" style="display:none">
                    <div class="util-opt" onclick="window.api.goTo('projects.html')">&#127968; Home (Pilih Project)</div>
                    <div class="util-opt" onclick="location.reload()">&#128260; Refresh Halaman</div>
                    <div class="util-opt" onclick="appExit()">&#9211; Keluar</div>
                </div>
            </div>
            <div class="menu-item" style="position:relative" onclick="toggleMenu(event,'execMenu')">Execute &#9662;
                <div id="execMenu" class="util-menu" style="display:none">
                    <div class="util-opt" onclick="switchToRunMode()">&#9654;&#65039; Mode Run (Inspeksi)</div>
                </div>
            </div>
            <div class="menu-item" style="position:relative" onclick="toggleMenu(event,'utilMenu')">Utility &#9662;
                <div id="utilMenu" class="util-menu" style="display:none">
                    <div class="util-opt" onclick="syncSaveToCloud(event)">&#9729;&#65039; Save &amp; Upload ke GitHub</div>
                    <div class="util-opt" onclick="syncLoadFromCloud(event)">&#11015;&#65039; Load versi terbaru</div>
                    <div class="util-opt" onclick="showSyncStatus(event)">&#8505;&#65039; Status sinkronisasi</div>
                </div>
            </div>
            <div class="menu-item" onclick="window.api.goTo('settings.html')">Setting</div>
            <div style="flex:1"></div>
            <div class="menu-item" style="position:relative" onclick="toggleMenu(event,'acctMenu')">
                <span id="acctLabel">Akun</span> &#9662;
                <div id="acctMenu" class="util-menu" style="display:none; left:auto; right:0; min-width:260px">
                    <div class="util-opt" style="pointer-events:none; opacity:.75; white-space:normal"
                         id="acctInfo">Memuat...</div>
                    <div class="util-opt" onclick="changeRepo(event)">&#128193; Ganti repo penyimpanan</div>
                    <div class="util-opt" onclick="window.api.goTo('settings.html')">&#9881;&#65039; Pengaturan</div>
                    <div class="util-opt" style="color:#f87171" onclick="doLogout(event)">&#9211; Keluar akun</div>
                </div>
            </div>
        </div>
    `;

    // ==== TOOLBAR ====
    const toolbarHTML = `
        <div class="toolbar">
            <button class="toolbar-btn" title="Save & Upload ke GitHub" onclick="syncSaveToCloud(event)">💾</button>
            <button class="toolbar-btn" title="Load versi terbaru dari GitHub" onclick="syncLoadFromCloud(event)">📂</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-btn" title="Refresh" onclick="location.reload()">🔄</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-btn" title="Settings" onclick="window.api.goTo('settings.html')">⚙️</button>
        </div>
    `;

    // ==== HEADER ====
    const totalStatusHTML = showTotalStatus ? `
        <div class="total-status-box idle" id="totalStatusBadge">
            <div>
                <div class="label">Total Status</div>
            </div>
            <div class="value" id="totalStatusValue">—</div>
        </div>
    ` : '';

    const modeToggleHTML = `
        <div class="mode-toggle">
            <button class="${mode === 'setting' ? 'active' : ''}" onclick="window.api.goTo('projects.html')">Setting</button>
            <button class="${mode === 'run' ? 'active' : ''}" onclick="switchToRunMode()">Run</button>
        </div>
    `;

    const headerHTML = `
        <div class="header">
            <div class="title-area">
                <h1>${escapeHtml(title)}</h1>
                <div class="subtitle">${escapeHtml(subtitle)}</div>
            </div>
            ${modeToggleHTML}
            ${totalStatusHTML}
        </div>
    `;

    // ==== STATUS BAR ====
    const statusbarHTML = showFooter ? `
        <div class="statusbar">
            <div style="display:flex">
                <span class="status-item">Resource: <strong>OK</strong></span>
                <span class="status-item">Image: <span id="statImg">-</span></span>
                <span class="status-item">Processing: <span id="statProc">-</span></span>
            </div>
            <div style="display:flex">
                <span class="status-item">OK Ratio: <span id="statOk">-</span></span>
                <span class="status-item">Time: <span id="statTime">-</span></span>
            </div>
        </div>
    ` : '';

    // Prepend menu/toolbar/header — TIDAK pakai innerHTML= (bisa hapus event listener
    // yang sudah di-set inline script). Pakai insertAdjacentHTML instead.
    document.body.insertAdjacentHTML('afterbegin', menubarHTML + toolbarHTML + headerHTML);
    if (statusbarHTML) {
        document.body.insertAdjacentHTML('beforeend', statusbarHTML);
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }
})();

// Helper functions for pages to update total status
window.setTotalStatus = function(verdict) {
    const badge = document.getElementById('totalStatusBadge');
    const value = document.getElementById('totalStatusValue');
    if (!badge || !value) return;
    badge.classList.remove('pass', 'fail', 'idle');
    if (verdict === 'OK') {
        badge.classList.add('pass');
        value.textContent = 'PASS';
    } else if (verdict === 'NG') {
        badge.classList.add('fail');
        value.textContent = 'FAIL';
    } else {
        badge.classList.add('idle');
        value.textContent = '—';
    }
};

window.switchToRunMode = function() {
    // Nav to Run page for current project kalau ada
    const p = new URLSearchParams(location.search).get('name')
        || new URLSearchParams(location.search).get('project');
    if (p) window.api.goTo(`run.html?project=${encodeURIComponent(p)}`);
    else alert('Pilih project dulu');
};

// ===================== GitHub Sync (Save / Load) =====================
(function () {
    const style = document.createElement('style');
    style.textContent = `
        .util-menu{position:absolute;top:100%;left:0;margin-top:2px;background:#1e2128;
            border:1px solid #3a3f4b;border-radius:5px;min-width:240px;z-index:2000;
            box-shadow:0 6px 18px rgba(0,0,0,.45);overflow:hidden}
        .util-opt{padding:9px 13px;font-size:13px;white-space:nowrap;cursor:pointer;color:#e6e7ea}
        .util-opt:hover{background:#2a2e37}
        #syncToast{position:fixed;right:16px;bottom:44px;z-index:5000;display:flex;flex-direction:column;gap:8px}
        .sync-toast{background:#1e2128;border:1px solid #3a3f4b;border-left-width:4px;border-radius:6px;
            padding:10px 14px;font-size:13px;color:#e6e7ea;max-width:360px;box-shadow:0 6px 18px rgba(0,0,0,.4);
            animation:syncIn .18s ease}
        .sync-toast.ok{border-left-color:#22c55e}
        .sync-toast.err{border-left-color:#ef4444}
        .sync-toast.info{border-left-color:#7c3aed}
        @keyframes syncIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    `;
    document.head.appendChild(style);

    // Tutup semua dropdown menubar saat klik di luar
    document.addEventListener('click', (e) => {
        if (e.target.closest('.menu-item')) return;
        document.querySelectorAll('.util-menu').forEach(m => { m.style.display = 'none'; });
    });

    // Auto-load versi terbaru sekali saat app pertama dibuka
    if (window.api && window.api.gitAutoPullOnce) {
        window.api.gitAutoPullOnce().then((r) => {
            if (!r || r.skipped || !r.result) return;
            const res = r.result;
            if (res.ok && !res.upToDate) _syncToast('⬇️ Versi terbaru dimuat dari GitHub. Refresh bila perlu.', 'ok', 6000);
            else if (!res.ok && (res.dirty || res.diverged)) _syncToast('ℹ️ ' + res.log, 'info', 8000);
            else if (!res.ok) _syncToast('⚠️ Auto-load gagal: ' + _syncShort(res.log), 'err', 8000);
        }).catch(() => {});
    }
})();

function _syncShort(s) { s = String(s || ''); return s.length > 200 ? s.slice(-200) : s; }

function _syncToast(msg, kind, ms) {
    let box = document.getElementById('syncToast');
    if (!box) { box = document.createElement('div'); box.id = 'syncToast'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'sync-toast ' + (kind || 'info');
    t.textContent = msg;
    box.appendChild(t);
    if (ms !== 0) setTimeout(() => { t.remove(); }, ms || 4000);
    return t;
}

// Buka/tutup satu dropdown menubar; tutup yang lain.
function toggleMenu(e, id) {
    if (e) e.stopPropagation();
    const target = document.getElementById(id);
    document.querySelectorAll('.util-menu').forEach(m => { if (m !== target) m.style.display = 'none'; });
    if (target) target.style.display = (target.style.display === 'none' || !target.style.display) ? 'block' : 'none';
}
function _closeUtilMenu() { document.querySelectorAll('.util-menu').forEach(m => { m.style.display = 'none'; }); }

// File → Keluar
function appExit() {
    _closeUtilMenu();
    if (window.api && window.api.quitApp) window.api.quitApp();
    else window.close();
}

// Help → Tentang AutomaEyes (nama + versi dari config)
async function showAbout() {
    _closeUtilMenu();
    try {
        const cfg = await window.api.getConfig();
        const name = (cfg && cfg.app && cfg.app.name) || 'AutomaEyes';
        const ver = (cfg && cfg.app && cfg.app.version) || '';
        _syncToast(`${name}${ver ? ' — v' + ver : ''}\nSistem Quality Control berbasis YOLOv11.`, 'info', 7000);
    } catch (_) {
        _syncToast('AutomaEyes — Sistem Quality Control berbasis YOLOv11.', 'info', 6000);
    }
}

async function syncSaveToCloud(e) {
    if (e) e.stopPropagation();
    _closeUtilMenu();
    const t = _syncToast('☁️ Menyimpan & mengunggah ke GitHub… jangan tutup app.', 'info', 0);
    try {
        const r = await window.api.gitPush();
        t.remove();
        if (r.ok) _syncToast(r.nothing ? '✓ Sudah terbaru — tidak ada perubahan untuk diunggah.' : '✓ Tersimpan & terunggah ke GitHub.', 'ok', 5000);
        else _syncToast('⚠️ ' + _syncShort(r.log), 'err', 9000);
    } catch (err) { t.remove(); _syncToast('⚠️ Error: ' + err.message, 'err', 9000); }
}

async function syncLoadFromCloud(e) {
    if (e) e.stopPropagation();
    _closeUtilMenu();
    const t = _syncToast('⬇️ Mengambil versi terbaru dari GitHub…', 'info', 0);
    try {
        const r = await window.api.gitPull();
        t.remove();
        if (r.ok) _syncToast(r.upToDate ? '✓ Sudah versi terbaru.' : '✓ Versi terbaru dimuat. Refresh halaman bila perlu.', 'ok', 6000);
        else _syncToast('⚠️ ' + _syncShort(r.log), 'err', 9000);
    } catch (err) { t.remove(); _syncToast('⚠️ Error: ' + err.message, 'err', 9000); }
}

async function showSyncStatus(e) {
    if (e) e.stopPropagation();
    _closeUtilMenu();
    try {
        const s = await window.api.gitStatus();
        if (!s.repo) return _syncToast('Folder projects belum tersambung ke GitHub. Buka Connect GitHub dulu.', 'err', 7000);
        if (!s.hasRemote) return _syncToast('Belum tersambung ke GitHub (belum ada remote origin).', 'err', 7000);
        _syncToast(`Branch: ${s.branch} · ${s.dirty ? s.changes + ' perubahan belum disimpan' : 'bersih (sudah tersimpan)'}\n${s.remote}`, 'info', 8000);
    } catch (err) { _syncToast('⚠️ ' + err.message, 'err', 7000); }
}


// ==== Menu Akun ====
// Identitas user + repo tujuan sengaja ditaruh di menu bar, bukan hanya di
// Settings: user perlu tahu "menyimpan ke repo siapa" tanpa berpindah halaman.
async function _loadAccount() {
    if (!window.api || !window.api.authStatus) return;
    try {
        const st = await window.api.authStatus();
        const lbl = document.getElementById('acctLabel');
        const info = document.getElementById('acctInfo');
        if (!lbl || !info) return;

        if (st.session) {
            const nm = (st.session.user.name || st.session.user.email || 'Akun').split(' ')[0];
            lbl.textContent = st.github ? `${nm} - ${st.github.repo}` : nm;
            info.innerHTML = `<strong>${_esc(st.session.user.name || '')}</strong><br>` +
                `<span style="font-size:11px">${_esc(st.session.user.email || '')}</span><br>` +
                (st.github
                    ? `<span style="font-size:11px">Repo: ${_esc(st.github.repo)}</span>`
                    : `<span style="font-size:11px;color:#f59e0b">GitHub belum tersambung</span>`);
        } else {
            lbl.textContent = 'Belum login';
            info.textContent = 'Belum login';
        }
    } catch (_) { /* halaman gate tidak punya menu bar */ }
}

function _esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function doLogout(e) {
    if (e) e.stopPropagation();
    _closeUtilMenu();
    if (!confirm('Keluar dari akun? Koneksi GitHub juga dilepas, tapi project yang sudah ter-push tetap aman di repo Anda.')) return;
    await window.api.authLogout();
}

// Ganti repo tanpa Authorize ulang: token yang tersimpan dipakai lagi.
async function changeRepo(e) {
    if (e) e.stopPropagation();
    _closeUtilMenu();

    const res = await window.api.githubRepos();
    if (!res.ok) { _syncToast('&#9888;&#65039; ' + res.error, 'err', 7000); return; }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:4000;display:flex;align-items:center;justify-content:center;padding:16px';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;color:#222;border-radius:8px;padding:20px;max-width:460px;width:100%';
    box.innerHTML = `
        <h3 style="margin:0 0 4px">Ganti repo penyimpanan</h3>
        <p style="font-size:12px;color:#666;margin:0 0 14px">
            Project berikutnya akan disimpan &amp; di-push ke repo yang dipilih.
            Project yang sudah ada di repo lama tidak ikut berpindah.
        </p>
        <label style="font-size:12px;display:block;margin-bottom:6px">
            <input type="radio" name="rmode" value="existing" checked> Pakai repo yang sudah ada
        </label>
        <select id="crSel" style="width:100%;margin-bottom:12px">
            ${res.repos.map((r) => `<option value="${_esc(r.name)}">${_esc(r.fullName)}${r.private ? ' (privat)' : ''}</option>`).join('')}
        </select>
        <label style="font-size:12px;display:block;margin-bottom:6px">
            <input type="radio" name="rmode" value="new"> Buat repo baru (privat)
        </label>
        <input type="text" id="crNew" value="automaeyes-projects" style="width:100%;margin-bottom:14px">
        <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" id="crCancel">Batal</button>
            <button class="btn primary" id="crOk">Sambungkan</button>
        </div>
        <p id="crMsg" style="font-size:12px;margin:10px 0 0"></p>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
    box.querySelector('#crCancel').onclick = () => overlay.remove();

    box.querySelector('#crOk').onclick = async () => {
        const isNew = box.querySelector('input[name=rmode]:checked').value === 'new';
        const name = isNew ? box.querySelector('#crNew').value.trim() : box.querySelector('#crSel').value;
        if (!name) return;
        const msg = box.querySelector('#crMsg');
        box.querySelector('#crOk').disabled = true;
        msg.textContent = 'Menyiapkan repo...';
        const r = await window.api.githubConnect(name, isNew, true);
        if (!r.ok) { msg.textContent = r.error; msg.style.color = '#dc2626'; box.querySelector('#crOk').disabled = false; return; }
        msg.textContent = `Tersambung ke ${r.repo}.`; msg.style.color = '#22a34c';
        setTimeout(() => { overlay.remove(); window.api.goTo('projects.html'); }, 900);
    };
}

_loadAccount();
