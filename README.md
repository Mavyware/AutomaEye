# AutomaEyes

Computer-vision quality control for production lines: detect defects, measure
dimensions (GD&T), and send OK/NG results straight to an Arduino or PLC.

## Your data stays yours

AutomaEyes has no storage server. None of your product photos, datasets, or
trained models are sent to us.

- **Projects, datasets, and models** live in **your own GitHub repository**.
  You choose which repo, and you can keep it private. We have no access to it.
- **Inspection results and NG photos** stay on your own computer.
- **Your login session and access grant** are stored encrypted by your
  operating system on that machine — not inside the app, and not on any
  server of ours.
- **You grant GitHub access yourself**, through GitHub's own authorization
  page. The app never asks for, sees, or stores your GitHub password, and you
  can revoke the grant at any time from your GitHub account settings.

If you stop using AutomaEyes, everything remains in your repository and on
your computer. There is nothing to retrieve from us.

## What it does

- **Defect detection** using models you train yourself from photos of your
  own parts
- **GD&T measurement** — hole diameters, lengths and widths, with per-class
  tolerances and a calibration-drift check
- **Built-in annotation** — boxes, polygons, and circles, so shapes follow
  the real edges of a part and measurements stay accurate
- **Staged inspection flow** modelled on industrial vision systems:
  Capture → Positioning → Inspection → Communication → Options
- **1D/2D code reading** and printed-text verification
- **Flexible output** — built-in Arduino/PLC signalling, or your own script
  to push results to an MES or dashboard
- **Daily reports** and measurement data exported to Excel

## Running it

Requires Node.js LTS and Python 3.10+.

```bash
cd app
npm install
npm start
```

On first launch the app checks for Python and the packages it needs, and can
install the missing ones for you.

Typical flow: **create a project → create a model → collect photos → annotate
→ train → build the inspection flow → run**.

## License & contributing

The source is open so it can be audited and adapted. Bug reports and
suggestions are welcome through Issues.

Found a security problem? Please report it to **mavyware@automaeyes.my.id**
rather than opening a public Issue, so it can be fixed before it becomes
widely known. See [SECURITY.md](SECURITY.md).
