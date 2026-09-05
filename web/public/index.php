<?php
require __DIR__ . '/../src/bootstrap.php';

$pageTitle = 'AutomaEyes - AI Quality Control';
$bodyClass = 'has-story-bg';
require __DIR__ . '/../src/includes/header.php';
?>
<div id="boot-sequence">
  <div class="boot-lines">
    <div class="boot-line" data-status="OK"><span class="prompt">&gt;</span>INITIALIZE AUTOMAEYE CORE...<span class="status"></span></div>
    <div class="boot-line" data-status="OK"><span class="prompt">&gt;</span>MOUNTING CAMERA INPUT...<span class="status"></span></div>
    <div class="boot-line" data-status="OK"><span class="prompt">&gt;</span>LOADING INFERENCE ENGINE...<span class="status"></span></div>
    <div class="boot-line" data-status="OK"><span class="prompt">&gt;</span>SYNCING WITH GITHUB...<span class="status"></span></div>
    <div class="boot-line" data-status="READY"><span class="prompt">&gt;</span><span class="status ready"></span></div>
  </div>
  <div class="boot-hint" id="boot-hint">&#9660; SCROLL TO CONTINUE</div>
</div>
<canvas id="story-bg"></canvas>

<main class="story">

  <section class="story-section story-hero" data-reveal>
    <div>
      <span class="eyebrow">AI Quality Control</span>
      <h1>See the edge.<br><span class="grad">Automate the eye.</span></h1>
      <p>AutomaEyes inspects your parts as they come off the line: it finds defects, measures dimensions, and sends the OK/NG result straight to your PLC. You train it on your own parts, and your data stays in your own hands.</p>
      <div class="hero-actions">
        <a href="/signup.php" class="btn btn-primary btn-lg">Get started free</a>
        <a href="/login.php" class="btn btn-ghost btn-lg">Log in</a>
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
        <div class="item" data-i="2"><span class="num">03</span><span class="label">Live interface</span></div>
        <div class="item" data-i="3"><span class="num">04</span><span class="label">Defect flagged</span></div>
        <div class="item" data-i="4"><span class="num">05</span><span class="label">Output to controller</span></div>
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
                <p>Sign in and connect your own GitHub account. Every dataset you build lives in a repo you control - private when it's sensitive, public when you want to share it.</p>
                <ul>
                  <li>Private or public repos, your choice</li>
                  <li>Versioned datasets, not vendor lock-in</li>
                  <li>Full history of every labeled frame</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="1" data-label="Create">
              <div class="step-copy">
                <span class="step-index">[02] Create</span>
                <h2>Create a model</h2>
                <p>Train from your dataset or bring in a pretrained one. AutomaEye handles the annotation-to-weights path so you can focus on what the model should recognize.</p>
                <ul>
                  <li>Guided labeling workflow</li>
                  <li>Train, evaluate, iterate in place</li>
                  <li>Export weights sized for the edge</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="2" data-label="Build">
              <div class="step-copy">
                <span class="step-index">[03] Build</span>
                <h2>Drag, drop, pipeline</h2>
                <p>Assemble the full pipeline visually - no code required. Chain inputs, models, and outputs into a flow that matches exactly what your edge device needs to do.</p>
                <ul>
                  <li>Drag-and-drop pipeline canvas</li>
                  <li>Reusable blocks across projects</li>
                  <li>Live preview as you build</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="3" data-label="Input">
              <div class="step-copy">
                <span class="step-index">[04] Input</span>
                <h2>Choose your camera, set positioning</h2>
                <p>Pick the camera input feeding the pipeline, then set the positioning model so AutomaEye understands where it's looking and what "in frame" means for your use case.</p>
                <ul>
                  <li>USB, IP, and RTSP camera support</li>
                  <li>Positioning and calibration built-in</li>
                  <li>Multiple inputs per pipeline</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="4" data-label="Detect">
              <div class="step-copy">
                <span class="step-index">[05] Detect</span>
                <h2>Run inference in real time</h2>
                <p>The inference model runs right on the edge device - low latency, no round trip to the cloud required for every frame.</p>
                <ul>
                  <li>Optimized for edge hardware</li>
                  <li>Bounding boxes, classes, confidence</li>
                  <li>Swap models without rebuilding the pipeline</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="5" data-label="Act">
              <div class="step-copy">
                <span class="step-index">[06] Act</span>
                <h2>Send it somewhere useful</h2>
                <p>Route results to an output - a webhook, a dashboard, a local trigger. What the pipeline sees becomes what your system does, automatically.</p>
                <ul>
                  <li>Webhooks, MQTT, local automations</li>
                  <li>Structured, queryable event logs</li>
                  <li>Alerts on the conditions you define</li>
                </ul>
              </div>
            </li>

            <li class="step-item" data-step="6" data-label="Manage">
              <div class="step-copy">
                <span class="step-index">[07] Manage</span>
                <h2>Keep every input in order</h2>
                <p>Review captured frames, re-label edge cases, and feed corrections straight back into your dataset - all without leaving the pipeline you built.</p>
                <ul>
                  <li>Frame review and re-labeling</li>
                  <li>Continuous dataset improvement</li>
                  <li>Runs locally, syncs when you're ready</li>
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
    <p>AutomaEye runs locally on Windows, right next to your cameras. Log in to link your account, then download the app.</p>
    <div class="download-panel">
      <a href="<?= e(DOWNLOAD_PAGE) ?>" class="btn btn-primary btn-lg">Download for Windows</a>
      <?php if (!Auth::check()): ?>
        <a href="/login.php" class="btn btn-ghost">Already installed? Log in to connect it</a>
      <?php else: ?>
        <a href="/welcome.php" class="btn btn-ghost">Go to your account</a>
      <?php endif; ?>
      <span class="platform-note">WINDOWS · 64-BIT · v0.1</span>
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
