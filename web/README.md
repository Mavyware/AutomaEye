# AutomaEye website

Marketing homepage (storytelling scroll + boot sequence) plus login / sign up /
forgot-password / reset-password for the AutomaEye desktop app. Plain PHP,
no build step, SQLite for storage — deploys to any PHP 8.5 host.

## Structure

- `public/` — **document root**. Point your hosting at this folder.
- `src/` — bootstrap, DB, Auth, OAuth libs, shared header/footer includes.
- `storage/` — SQLite database + app secret key, created automatically on first run. Must be writable by PHP.
- `config.local.php` — real config (URL, download link, OAuth keys). Copy from `config.local.php.example`, keep it out of git.

## Local dev

```
php -S localhost:8000 -t public
```

## Deploying to shared PHP 8.5 hosting

1. Upload everything **except** `storage/*.sqlite` and `config.local.php.example`'s copy — those get created/edited on the server.
2. Set the hosting document root to `public/`. If your host can't change the doc root, upload `src/`, `storage/`, and `config.local.php` one level above `public/`'s public web folder and point the web folder itself at a copy of `public/`.
3. Copy `config.local.php.example` to `config.local.php` in the project root (next to `src/`) and fill in `APP_URL`, `DOWNLOAD_URL`, and OAuth credentials.
4. `chmod 775 storage/` (or ask the host for write permission on that folder) so SQLite and the app-secret key can be created.
5. Visit the site once — the SQLite schema is created automatically on first request.

## How the app <-> website handshake works

The desktop app opens `login.php?redirect=automaeye://auth` (or sign-up) in
the system browser. After a successful login/signup, the site redirects back
to that custom URI with a short-lived signed `token` query param
(`Auth::issueAppToken()` in `src/lib/Auth.php`), which the app exchanges for
its own session. Register the `automaeye://` URI scheme in the Windows app so
it can catch that redirect.

Without a `redirect` param, users land on `welcome.php`, a simple "you're
logged in — download the app" screen.

## Social login

Google and GitHub buttons are wired up but show as disabled until you set
`GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID` (and their secrets) in
`config.local.php`. OAuth callback URL to register with each provider:

- `APP_URL/auth/callback.php?provider=google`
- `APP_URL/auth/callback.php?provider=github`

## Password reset emails

`forgot-password.php` sends the reset link via `src/lib/Mailer.php` (PHPMailer
over SMTP). It uses the same setup as our other client sites: a mailbox
created in cPanel for the domain (e.g. `noreply@automaeyes.com`), sent through
`mail.<domain>:587` with STARTTLS. Set `MAIL_MAILER=smtp` and the `MAIL_*`
constants in `config.local.php` to your mailbox's credentials. Leave
`MAIL_MAILER=log` (the default) to just `error_log()` the reset link instead —
useful for local dev without real credentials.

Requires `composer install` once (vendor/ ships PHPMailer) — run it locally
and upload `vendor/` with the rest of the site if the host has no Composer.
