<?php
require __DIR__ . '/../src/bootstrap.php';

$pageTitle = 'AutomaEyes - AI Quality Control';
$bodyClass = 'has-story-bg';
require __DIR__ . '/../src/includes/header.php';
?>
<canvas id="story-bg"></canvas>

<main class="story">

  <section class="story-section story-hero" data-reveal>
    <div>
      <span class="eyebrow">AI Quality Control</span>
      <h1>See the edge.<br><span class="grad">Automate the eye.</span></h1>
      <p>AutomaEyes inspects your parts as they come off the line: it finds defects, measures dimensions, and drives the machine that sorts them. You train it on photos of your own parts, on your own computer, and your data never leaves your hands.</p>
      <div class="hero-actions">
        <?php if ($user): ?>
          <?php /* Already signed in: sending them to "create an account" is a
                   dead end, and asking them to log in again reads as if the
                   session had been lost. */ ?>
          <a href="<?= e(DOWNLOAD_PAGE) ?>" class="btn btn-primary btn-lg">Download for Windows</a>
          <a href="/welcome.php" class="btn btn-ghost btn-lg">Go to your account</a>
        <?php else: ?>
          <a href="/signup.php" class="btn btn-primary btn-lg">Get started free</a>
          <a href="/login.php" class="btn btn-ghost btn-lg">Log in</a>
        <?php endif; ?>
      </div>
    </div>
    <div class="scroll-cue"><span class="line"></span>[Scroll to continue]</div>
  </section>

  <section class="story3d" id="story3d">
    <div class="story3d-pin">
      <div id="story3d-canvas"></div>

      <div class="story3d-head">
        <span class="eyebrow">How it works</span>
        <h2>From camera feed to output signal</h2>
      </div>

      <div class="story3d-rail">
        <div class="item" data-i="0"><span class="num">01</span><span class="label">Camera input</span></div>
        <div class="item" data-i="1"><span class="num">02</span><span class="label">Detection frame</span></div>
        <div class="item" data-i="2"><span class="num">03</span><span class="label">Live inspection</span></div>
        <div class="item" data-i="3"><span class="num">04</span><span class="label">Defect flagged</span></div>
        <div class="item" data-i="4"><span class="num">05</span><span class="label">Output to the line</span></div>
      </div>

      <div class="story3d-track"><div class="story3d-fill" id="story3d-fill"></div></div>

      <div class="overlay" id="ov-frame"><span class="frame-tag">DETECTION FRAME</span></div>

      <div class="overlay" id="ov-panel">
        <div class="row"><span>Model</span><b>objectv1.pt</b></div>
        <div class="row"><span>Confidence</span><b>0.94</b></div>
        <div class="row"><span>FPS</span><b>41</b></div>
        <div class="row"><span>Status</span><b class="ok">scanning</b></div>
      </div>

      <div class="overlay" id="ov-defect">
        <div class="dot"></div>
        <div class="tag">DEFECT · SPIKE · 0.3mm</div>
      </div>

      <div class="overlay" id="ov-output">
        <div class="tag">OUTPUT PIN 7 &rarr; HIGH · REJECT ACTUATED</div>
      </div>
    </div>
  </section>

  <section class="scrolly" id="scrolly" style="--steps:7">
    <div class="scrolly-inner">
      <div class="scrolly-grid">

        <div class="scrolly-copy">
          <div class="step-rail" id="step-rail" aria-hidden="true"></div>
          <ol class="step-list">

            <li class="step-item" data-step="0" data-label="Connect">
              <div class="step-copy">
                <span class="step-index">[01] Connect</span>
                <h2>Your data, your GitHub</h2>
                <p>Sign in and connect your own GitHub account. Every project, dataset, and trained model lives in a repository you control &mdash; private when the parts are confidential. There is no storage server on our side.</p>
                <ul>
                  <li>Private or public repos, your choice</li>
                  <li>Versioned datasets, not vendor lock-in</li>
                  <li>Revoke our access from GitHub at any time</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="1" data-label="Dataset">
              <div class="step-copy">
                <span class="step-index">[02] Dataset</span>
                <h2>Start with photos of your own parts</h2>
                <p>Create a model &mdash; detection, segmentation, classification, or OCR &mdash; and bring in photos of the parts you actually inspect. A general-purpose model trained on someone else&rsquo;s parts will not find your defects.</p>
                <ul>
                  <li>Detection, segmentation, classification, OCR</li>
                  <li>Name the classes you care about</li>
                  <li>Add more photos at any time</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="2" data-label="Annotate">
              <div class="step-copy">
                <span class="step-index">[03] Annotate</span>
                <h2>Label them without leaving the app</h2>
                <p>Boxes for detection, polygons for segmentation, circles for holes and shafts. Shapes that follow the real edge of a part are what make measurement accurate &mdash; a bounding box cannot describe a round hole.</p>
                <ul>
                  <li>Built in &mdash; no second tool, no second account</li>
                  <li>No export step between labelling and training</li>
                  <li>Keyboard-driven, built for hundreds of images</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="3" data-label="Split">
              <div class="step-copy">
                <span class="step-index">[04] Split &amp; augment</span>
                <h2>Split first, augment second</h2>
                <p>Divide the set into training, validation, and test. Augmentation then applies to the <strong>training set only</strong> &mdash; augmenting the other two leaks information between the halves and quietly inflates your scores.</p>
                <ul>
                  <li>Reproducible split, same result every time</li>
                  <li>Augmentation is optional</li>
                  <li>Leak-prone options are simply not offered</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="4" data-label="Train">
              <div class="step-copy">
                <span class="step-index">[05] Train &amp; test</span>
                <h2>Train it, then check whether it worked</h2>
                <p>Training runs on your machine, and every run is kept as a new version. Then evaluate against the test set the model has never seen: metrics, curves, a confusion matrix, and the actual predictions to look through.</p>
                <ul>
                  <li>Live loss and accuracy while it trains</li>
                  <li>Per-class results, not just one number</li>
                  <li>Every version kept, so you can go back</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="5" data-label="Workflow">
              <div class="step-copy">
                <span class="step-index">[06] Workflow</span>
                <h2>Chain the models into an inspection</h2>
                <p>Position the part, inspect it, decide. Stages modelled on industrial vision systems &mdash; capture, positioning, inspection, communication &mdash; with tolerances, a calibration-drift check, and what should happen on the first NG.</p>
                <ul>
                  <li>GD&amp;T measurement with per-class tolerances</li>
                  <li>1D/2D code reading and printed-text checks</li>
                  <li>Presence, count, colour, and scratch checks</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="6" data-label="Output">
              <div class="step-copy">
                <span class="step-index">[07] Output</span>
                <h2>Reach the machine that sorts the part</h2>
                <p>Every class maps to a real output. Arduino and ESP32 over USB with the sketch included; PLCs over Modbus RTU or TCP with no firmware at all. Each output has a Test button, so you can verify the wiring before the line runs.</p>
                <ul>
                  <li>Arduino, ESP32, and Modbus PLCs</li>
                  <li>Or write the output yourself in JavaScript or Python</li>
                  <li>Daily reports and measurement data to Excel</li>
                </ul>
              </div>
            </li>

          </ol>
        </div>

        <div class="scrolly-stage">
          <div class="stage-frame" id="stage-frame">
            <div id="scene-mount"></div>
            <div class="annotations" id="annotations"></div>
            <div class="stage-fallback" id="stage-fallback">
              <svg viewBox="0 0 240 180" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="45" y="50" width="150" height="95" rx="10" stroke="#00f0c0" stroke-width="2"/>
                <circle cx="120" cy="97" r="28" stroke="#7c5cff" stroke-width="2"/>
                <circle cx="120" cy="97" r="11" fill="#7c5cff"/>
                <rect x="155" y="65" width="14" height="10" rx="3" fill="#00f0c0"/>
                <path d="M100 40h40M120 40v10" stroke="#2b3348" stroke-width="2"/>
              </svg>
            </div>
            <div class="stage-hud">
              <span>AUTOMAEYE // EDGE UNIT</span>
              <span id="hud-step">[01]</span>
            </div>
            <p class="drag-hint" id="drag-hint">Drag to rotate</p>
          </div>
        </div>

      </div>
      <div class="scrolly-progress"><span id="scrolly-bar"></span></div>
    </div>
  </section>

  <section class="story-section story-outro" data-reveal>
    <h2>That's the whole pipeline.<br>Now run it on your machine.</h2>
    <p>AutomaEyes runs locally on Windows, right next to your cameras. The installer sets up everything it needs &mdash; including Python &mdash; so there is nothing else to download. Log in to link your account, then install it.</p>
    <div class="download-panel">
      <a href="<?= e(DOWNLOAD_PAGE) ?>" class="btn btn-primary btn-lg">Download for Windows</a>
      <?php if (!$user): ?>
        <a href="/login.php" class="btn btn-ghost">Already installed? Log in to connect it</a>
      <?php else: ?>
        <a href="/welcome.php" class="btn btn-ghost">Go to your account</a>
      <?php endif; ?>
      <span class="platform-note">WINDOWS · 64-BIT<?php if ($v = Release::version()): ?> · v<?= e($v) ?><?php endif; ?></span>
    </div>
  </section>

</main>

<?php require __DIR__ . '/../src/includes/footer.php'; ?>
<script src="/assets/js/story.js"></script>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
  }
}
</script>
<script type="module" src="/assets/js/scene.js"></script>
<script type="module" src="/assets/js/story3d.js"></script>
