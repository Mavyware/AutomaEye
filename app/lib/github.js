// lib/github.js — GitHub API calls using the user's access token.
//
// The token is obtained via OAuth on the website (see lib/appauth.js), not
// the device flow: the desktop app doesn't store a Client ID or secret at
// all, and the user doesn't need to type any code — just press Authorize.
//
// The website requests 'repo' scope so the app can push datasets/models to
// the user's own private repo — not to the developer's repo.

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

/** Repos owned by the user (with write access), for the "use an existing repo" dropdown. */
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

/** Create a new repo (private by default — factory datasets shouldn't be public). */
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
