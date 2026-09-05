# Tests

Focused tests for the parts of AutomaEyes that are hard to check by eye, and
that broke silently in the past — producing plausible-looking wrong answers
rather than an error.

Nothing here is installed as a dependency. The Python tests use the same
interpreter the application already needs, and the annotator test runs in the
Electron that is already a dependency of the app. A public repository does not
need a test framework's worth of extra supply chain.

## Running them

From the `app/` directory:

```bash
npm test              # everything
npm run test:cls      # classification training + evaluation
npm run test:runtime  # classification inference (needs test:cls first)
npm run test:annot    # annotation workspace, in a real browser engine
```

The Python tests need `ultralytics` installed. They build a small synthetic
dataset in a temporary folder, train for two epochs on CPU, and delete nothing
of yours — no existing project is touched.

## What each one guards

**`cls_pipeline.py`** — classification training end to end, from YOLO label
files to a trained `best.pt` and an evaluation report.

The class names are deliberately chosen so that their alphabetical order is the
*reverse* of the application's order (`zebra`, `apel`). Ultralytics derives
classification class indices from sorted folder names, so a model's class 0 is
not the application's class 0. Getting that mapping wrong swaps the labels on
every result without raising anything, so the test asserts on the names.

It also asserts that the prediction gallery is actually populated. An earlier
version of the code passed the split folder straight to `predict()`, which does
not recurse into subdirectories — the gallery came back empty and the run still
reported success.

**`cls_runtime.py`** — inference for classification models, through both
`infer.py` and `infer_server.py`.

Classification results arrive in `r.probs`; `r.boxes` is always `None`. Code
written for detection therefore finds nothing and calls every part **OK** — a
silent pass, which is the worst possible failure for a quality-control tool.
The test deliberately passes the class list in the application's order, so that
any code reading it instead of the model's own names produces a swapped result
and fails.

**`annotator/`** — the annotation workspace in classification mode, run in real
Chromium via Electron rather than a DOM simulation.

It checks that assigning a class saves exactly one whole-image label, replaces
the previous class instead of stacking a second one, advances to the next
image, and that mouse drawing produces nothing. It also checks that the class
highlight follows the image being viewed: it previously carried over from the
image before, making an unlabelled image look already labelled.
