# Security Policy

## Reporting a vulnerability

Email **mavyware@automaeyes.my.id**.

Please do **not** open a public Issue for security problems — a public report
exposes users before a fix is available.

Where you can, include the app version, the steps to reproduce, and the impact
you believe it has. You will get a reply, and you will be told when the fix
ships.

## Scope

In scope:

- The desktop app (`app/`) — including IPC handling, the `automaeye://`
  protocol, and how sessions and tokens are stored
- The website (`web/`) — authentication, the OAuth flow, and how access is
  handed to the desktop app

Out of scope: vulnerabilities in third-party dependencies (please report those
to the projects concerned), and attacks that require the attacker to already
have physical access or an administrator account on the victim's machine.

## How the app protects your data

- **No storage server.** Projects, datasets, and models live in your own
  GitHub repository. Inspection results stay on your computer.
- **Your GitHub password is never requested.** Access is granted through
  GitHub's own authorization page, and can be revoked at any time from your
  account settings.
- **Tokens are stored encrypted** by the operating system (DPAPI on Windows),
  in your user data folder — not inside the application folder, and never
  committed to a repository.
- **Server secrets are not in this repository.** OAuth keys and database
  credentials live in a server configuration file that is never committed.
- **`automaeye://` links must carry a single-use nonce** created when the app
  starts a sign-in. Without it, any web page could push the app into someone
  else's account.
- **Input from the interface is constrained** so it cannot escape the app's
  working folders when reading or writing files.

The source is deliberately open so you can verify these claims yourself.
