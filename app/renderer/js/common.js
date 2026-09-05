// Common helpers for every page

// URL query param
function param(k) {
    return new URLSearchParams(location.search).get(k);
}

// Navigation
function goTo(page, params) {
    let target = page;
    if (params) target += '?' + new URLSearchParams(params).toString();
    window.api.goTo(page + (params ? '?' + new URLSearchParams(params).toString() : ''));
}

// Format helpers
function humanTime(iso) {
    const t = new Date(iso);
    const d = (Date.now() - t.getTime()) / 1000;
    if (d < 60) return 'baru saja';
    if (d < 3600) return Math.floor(d / 60) + ' menit lalu';
    if (d < 86400) return Math.floor(d / 3600) + ' jam lalu';
    return t.toISOString().slice(0, 10);
}

function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// ===================== In-page messages =====================
// Replacement for window.alert. alert halts the whole window until closed,
// and its box covers up whatever was just done - which is exactly what you
// want to see. This message appears in a corner, blocking nothing.
//
//   pesan('Tersimpan', 'ok');
//   pesan('Gagal: ' + e.message, 'err');
//
// Type: 'ok' | 'err' | 'warn' | 'info' (default). An error message doesn't
// disappear on its own - an error message that vanishes on its own is the
// same as never appearing; the others disappear after a few seconds.
function pesan(teks, jenis, ms) {
    jenis = jenis || 'info';
    let kotak = document.getElementById('pesanBox');
    if (!kotak) {
        kotak = document.createElement('div');
        kotak.id = 'pesanBox';
        kotak.className = 'pesan-box';
        document.body.appendChild(kotak);
    }

    const p = document.createElement('div');
    p.className = 'pesan ' + jenis;
    p.setAttribute('role', jenis === 'err' ? 'alert' : 'status');

    const isi = document.createElement('span');
    isi.textContent = teks;          // text as-is, never becomes HTML
    p.appendChild(isi);

    const tutup = document.createElement('button');
    tutup.className = 'pesan-x';
    tutup.type = 'button';
    tutup.textContent = '\u2715';
    tutup.title = 'Tutup';
    tutup.onclick = () => p.remove();
    p.appendChild(tutup);

    kotak.appendChild(p);

    const lama = ms != null ? ms : (jenis === 'err' ? 0 : 4000);
    if (lama > 0) setTimeout(() => { p.remove(); }, lama);
    return p;
}

// ===================== Yes / no question =====================
// Replacement for window.confirm. Unlike pesan(), this one really does
// demand an answer, so it still blocks - but it appears as an in-app
// dialog, not a system box, and its text can be longer without getting cut off.
//
//   if (!await tanya('Hapus project ini?', { bahaya: true })) return;
//
// Returns Promise<boolean>. Enter answers yes, Esc answers no, and clicking
// the background outside the box also means no.
//
// For destructive actions, initial focus lands on the Cancel button: a
// reflexive Enter press must not end up deleting something.
function tanya(teks, opsi) {
    opsi = opsi || {};
    const labelYa = opsi.ya || 'Lanjutkan';
    const labelTidak = opsi.tidak || 'Batal';
    const bahaya = !!opsi.bahaya;

    return new Promise((jawab) => {
        const bekas = document.getElementById('dlgTanya');
        if (bekas) bekas.remove();

        const latar = document.createElement('div');
        latar.id = 'dlgTanya';
        latar.className = 'tanya-latar';

        const kotak = document.createElement('div');
        kotak.className = 'tanya-kotak';
        kotak.setAttribute('role', 'dialog');
        kotak.setAttribute('aria-modal', 'true');

        if (opsi.judul) {
            const h = document.createElement('h3');
            h.className = 'tanya-judul';
            h.textContent = opsi.judul;
            kotak.appendChild(h);
        }

        const p = document.createElement('p');
        p.className = 'tanya-teks';
        p.textContent = teks;          // text as-is, never becomes HTML
        kotak.appendChild(p);

        const baris = document.createElement('div');
        baris.className = 'tanya-tombol';
        const btnTidak = document.createElement('button');
        btnTidak.className = 'btn';
        btnTidak.type = 'button';
        btnTidak.textContent = labelTidak;
        const btnYa = document.createElement('button');
        btnYa.className = 'btn ' + (bahaya ? 'danger' : 'primary');
        btnYa.type = 'button';
        btnYa.textContent = labelYa;
        baris.appendChild(btnTidak);
        baris.appendChild(btnYa);
        kotak.appendChild(baris);
        latar.appendChild(kotak);
        document.body.appendChild(latar);

        const selesai = (hasil) => {
            document.removeEventListener('keydown', kunci, true);
            latar.remove();
            jawab(hasil);
        };
        const kunci = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); selesai(false); }
            else if (e.key === 'Enter') { e.preventDefault(); selesai(document.activeElement === btnYa); }
        };
        document.addEventListener('keydown', kunci, true);
        btnTidak.onclick = () => selesai(false);
        btnYa.onclick = () => selesai(true);
        latar.onclick = (e) => { if (e.target === latar) selesai(false); };

        (bahaya ? btnTidak : btnYa).focus();
    });
}
