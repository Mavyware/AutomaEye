# AutomaEyes

AI quality control for production lines. Train a model on photos of your own
parts, inspect them as they come down the line, measure dimensions, and drive
the machine that sorts them — all from one desktop application.

**[Download for Windows](https://automaeyes.my.id)** · [Releases](https://github.com/Mavyware/AutomaEyes/releases)

Nothing else to install. The installer sets up everything the application
needs, including Python, without asking you to download anything yourself.

---

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

---

## How the work is organised

The application walks you through a fixed order, and shows where you are in it
at all times.

**Inside a model — from photos to a tested model:**

| | Step | What happens |
|---|---|---|
| 1 | **Dataset** | Collect photos of the parts you want to inspect |
| 2 | **Annotation** | Label them — boxes, polygons, or circles |
| 3 | **Split** | Divide into training, validation, and test sets |
| 4 | **Augmentation** | *Optional.* Generate variations to enlarge the training set |
| 5 | **Train** | Train the model; every run is kept as a new version |
| 6 | **Test** | Evaluate against the test set — metrics, curves, predictions |

**Then at project level:** build the **Workflow**, choose the **Output**, and
**Run** the line.

Steps are ticked off from the actual state of your data, not from buttons you
pressed — so the chain stays honest if you continue on another machine or come
back days later.

---

## What it does

### Annotation, built in

Boxes for detection, polygons for segmentation, circles for holes and shafts.
Shapes follow the real edges of a part, which is what makes GD&T measurement
accurate — a bounding box cannot describe a round hole.

For **classification**, where the class describes the whole image rather than a
region of it, the workspace switches to a single class picker — press 1-9, and
it saves and moves to the next image. There is nothing to draw.

Annotation happens inside the model workspace, not in a separate tool. There is
no second account to create and no export step.

Augmentation applies to the **training set only**. Augmenting validation or
test data leaks information between the two halves and inflates the scores.

### Inspection

- **Defect detection** with models trained on your own parts
- **GD&T measurement** — hole diameters, lengths and widths, with per-class
  tolerances and a calibration-drift check
- **1D/2D code reading** and printed-text verification
- **Presence, count, colour, scratch, and positioning** checks as add-ons
- **Staged flow** modelled on industrial vision systems:
  Capture → Positioning → Inspection → Communication → Options

The camera and the model only run when you start an inspection. This is edge
software: it does not sit there consuming the machine it runs on.

### Output — reaching the machine

Every class in every model maps to one output. A positioning model detecting
`move` and `stop`, an inspection model detecting `cacat scratch` and
`cacat warna` — each gets its own pin or coil.

| Device | Connection | Firmware needed |
|---|---|---|
| **Arduino** — Uno, Nano, Mega, Leonardo, Pro Micro | USB serial | Included sketch |
| **ESP32** — DevKit V1, NodeMCU-32S, S3, C3 | USB serial | Same sketch |
| **PLC** — Omron, Mitsubishi, Delta, Siemens, Schneider, Wecon | Modbus RTU or TCP | **None** |
| **OK/NG signal** | Serial | — |
| **Your own code** | JavaScript or Python | — |

Unsafe pins are never offered. Arduino pins 0 and 1 carry the serial link the
application itself uses; ESP32 GPIO 6–11 are wired to internal flash, and
34–39 cannot output at all. Assigning any of them fails in ways that look like
a hardware fault.

PLCs need no firmware — they speak Modbus out of the box. You map coil
addresses to match your PLC program.

Each output has a **Test** button that pulses it briefly, so wiring can be
verified before the line runs.

### Custom output code

When the built-in devices are not enough, write the output yourself in
**JavaScript** or **Python**. Python uses the same interpreter the application
already needs for training, so any library you `pip install` is available —
database clients, MES SDKs, pandas.

Scripts receive the verdict, timings, and the class names that were detected,
so per-class logic is straightforward. A **Help** dialog inside the app holds
the full reference and worked examples for both languages, plus the board side.

### Reports

Daily summaries and per-detection measurement data, exported to Excel.

---

## Running from source

Only needed if you are working on AutomaEyes itself. To *use* the application,
download the installer above — it needs none of this.

Requires **Node.js LTS** and **Python 3.12+** (numpy 2.5+ no longer supports
older Python versions).

```bash
cd app
npm install
npm start
```

Build the Windows installer:

```bash
npm run dist
```

Run the tests:

```bash
npm test
```

They cover the parts that have failed silently in the past — see
[`app/tests/README.md`](app/tests/README.md). No test framework is installed;
they use the Python and Electron the app already depends on.

The repository holds the desktop application (`app/`) and the account website
(`web/`).

---

## Contributing

Pull requests are welcome, and are how changes to AutomaEyes are made. Bug
fixes and well-made features are reviewed by the Mavyware development team.
See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up, test, and submit one.

Bug reports and suggestions are welcome through Issues.

**Contributors:** [Code8Byte](https://github.com/Code8Byte) (CEO, Mavyware) ·
[CodeVouz](https://github.com/CodeVouz) (Founder, AutomaEyes) ·
[Claude](https://github.com/claude) (AI Development Team) ·
[ChatGPT](https://chatgpt.com) (AI Development Team) ·
[Dependabot](https://github.com/dependabot[bot]) (dependency updates).

---

## Security

Found a security problem? Please report it to **mavyware@automaeyes.my.id**
rather than opening a public Issue, so it can be fixed before it becomes
widely known. See [SECURITY.md](SECURITY.md).

---

## License

Copyright © 2026 Mavyware. All rights reserved.

The source is published so anyone can read it and verify how the software
handles their data. You may **read**, **use**, and **redistribute** it freely,
including in commercial production. You may **not** modify or resell it —
changes are made through pull requests reviewed by the Mavyware team.

See [LICENSE](LICENSE) for the full terms. This is a source-available license,
not an open source one.
