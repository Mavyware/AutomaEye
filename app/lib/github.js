// lib/github.js — panggilan GitHub API memakai access token milik user.
//
// Tokennya didapat lewat OAuth di website (lihat lib/appauth.js), bukan device
// flow: aplikasi desktop tidak menyimpan Client ID maupun secret sama sekali,
// dan user tidak perlu mengetik kode apa pun — cukup menekan Authorize.
//
// Scope 'repo' diminta website supaya app bisa push dataset/model ke repo
// privat milik user sendiri — bukan ke repo pengembang.

const GH_API = 'https://api.github.com';

async function ghJson(url, opts = {}) {
    const res = await fetch(url, {
        ...opts,
        headers: {
            Accept: 'application/json',
            'User-Agent': 'AutomaEyes',
            ...(opts.headers || {}),
        },
    });
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { raw: text };
    }
    return { status: res.status, ok: res.ok, data };
}

exports.getUser = async (token) => {
    const r = await ghJson(`${GH_API}/user`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return { ok: false, error: r.data.message || `HTTP ${r.status}` };
    return { ok: true, login: r.data.login, name: r.data.name, avatar: r.data.avatar_url };
};

/** Repo milik user (yang dia punya akses tulis), untuk dropdown "pakai repo yang ada". */
exports.listRepos = async (token) => {
    const r = await ghJson(`${GH_API}/user/repos?per_page=100&affiliation=owner&sort=updated`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { ok: false, error: r.data.message || `HTTP ${r.status}` };
    return {
        ok: true,
        repos: (r.data || []).map((x) => ({
            name: x.name,
            fullName: x.full_name,
            private: x.private,
            cloneUrl: x.clone_url,
        })),
    };
};

/** Buat repo baru (default privat — dataset pabrik tidak seharusnya publik). */
exports.createRepo = async (token, name, isPrivate = true) => {
    const r = await ghJson(`${GH_API}/user/repos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name,
            private: isPrivate,
            description: 'AutomaEyes projects (dataset, model, workflow)',
            auto_init: true,
        }),
    });
    if (!r.ok) {
        return { ok: false, error: r.data.message || `HTTP ${r.status}` };
    }
    return { ok: true, repo: { name: r.data.name, fullName: r.data.full_name, cloneUrl: r.data.clone_url } };
};
