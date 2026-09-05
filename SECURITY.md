# Security Policy

## Reporting a vulnerability

Email **mavyware@automaeyes.my.id**, or use GitHub's
[private vulnerability reporting](https://github.com/Mavyware/AutomaEyes/security/advisories/new).

Please do **not** open a public Issue for security problems — a public report
exposes users before a fix is available.

Where you can, include the app version, the steps to reproduce, and the impact
you believe it has. You will get a reply, and you will be told when the fix
ships.

## Supported versions

| Version | Supported |
|---|---|
| 0.3.x | Yes |
| 0.2.x and earlier | No — please update |

Only the latest release receives security fixes. The application checks for
updates on start and will tell you when a newer version is available.

## Scope

In scope:

- The desktop app (`app/`) — IPC handling, the `automaeye://` protocol, how
  sessions and tokens are stored, and the sandbox around user-written output
  scripts
- The website (`web/`) — authentication, the OAuth flow, and how access is
  handed to the desktop app
- The installer — how prerequisites are fetched and installed

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
- **The renderer is locked down** — context isolation on, Node integration off,
  and a Content-Security-Policy that blocks remote scripts, frames, and
  network calls the app does not make itself.

## A note on custom output code

AutomaEyes lets you write your own output logic in JavaScript or Python. That
code runs with your own privileges, on your own machine — the same trust model
as an Excel macro. It is deliberately not a security sandbox, and it is not
treated as one.

Consequently, **only run output scripts you wrote or reviewed yourself**. A
script pasted from an untrusted source can do anything you can do. Reports of
"custom scripts can access the filesystem" are working as designed and are out
of scope; reports of a script escaping the 5-second execution limit, or
affecting the app when the project is merely opened rather than run, are in
scope.

## Safety

AutomaEyes drives equipment on a production line. It is a tool that assists an
operator, not a certified safety system. It must not be the sole means of
ensuring product safety or machine safety, and its outputs should be treated
as advisory by any interlock that protects people.

The source is deliberately open so you can verify these claims yourself.
