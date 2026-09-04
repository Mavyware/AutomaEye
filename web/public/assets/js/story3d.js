/* Scroll-driven 3D story: camera keyframes tied to scroll progress, the
 * inspected part cross-fading into a controller board, and DOM overlays
 * toggled by discrete stage index. Plain ES module - no framework - but the
 * renderer and listeners are torn down together in destroy() so this can be
 * dropped into a component lifecycle later without leaking a WebGL context.
 *
 * The object never spins on its own - its orientation is a pure function of
 * scroll progress (the camera orbits it via keyframes instead). That's what
 * lets the defect tag track a fixed point on the part: its screen position
 * is a live projection of a 3D anchor, not a hardcoded CSS coordinate.
 */
import * as THREE from 'three';

const ACCENT = 0x00f0c0;
const ACCENT_2 = 0x7c5cff;
const DANGER = 0xff5d6c;

const mount = document.getElementById('story3d-canvas');
const storyEl = document.getElementById('story3d');

if (mount && storyEl) {
  try {
    init();
  } catch (err) {
    console.warn('AutomaEye: story 3D unavailable', err);
  }
}

function init() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight, false);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 100);

  scene.add(new THREE.AmbientLight(0x6d7893, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(4, 5, 4);
  scene.add(key);
  const fillLight = new THREE.DirectionalLight(0xc8d4ff, 0.5);
  fillLight.position.set(-3, 1, 3);
  scene.add(fillLight);
  const rimA = new THREE.PointLight(ACCENT, 26, 22);
  rimA.position.set(-4, 2, 4);
  scene.add(rimA);
  const rimB = new THREE.PointLight(ACCENT_2, 20, 22);
  rimB.position.set(4, -2, -4);
  scene.add(rimB);

  /* ---------- Object A: the inspected part - a socket/connector housing ----------
   * Reads as the thing being QC'd: a dark connector block with a grid of
   * terminal sockets on its face, matching the socket-holder inspection
   * shown on the AutomaEye run screen (green box + confidence readout).
   */
  const partGroup = new THREE.Group();
  const partMaterials = [];
  function partMat(options) {
    const mat = new THREE.MeshStandardMaterial(Object.assign({ transparent: true }, options));
    partMaterials.push(mat);
    return mat;
  }

  const housingMat = partMat({ color: 0x1c2130, metalness: 0.35, roughness: 0.55 });
  const housing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 1.1), housingMat);
  partGroup.add(housing);

  const housingEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2.6, 1.0, 1.1)),
    new THREE.LineBasicMaterial({ color: 0x4a5570, transparent: true })
  );
  partMaterials.push(housingEdges.material);
  partGroup.add(housingEdges);

  // Raised front lip (like a connector shroud).
  const lipMat = partMat({ color: 0x11141d, metalness: 0.3, roughness: 0.6 });
  const lip = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.08, 0.08), lipMat);
  lip.position.z = 0.59;
  partGroup.add(lip);

  // Grid of terminal sockets on the front face - 3 rows x 6 columns.
  const socketRingMat = partMat({ color: 0x2b3348, metalness: 0.7, roughness: 0.3 });
  const pinMat = partMat({ color: 0xc9a24a, metalness: 0.9, roughness: 0.25 }); // gold-plated contact
  const cols = 6;
  const rows = 3;
  const spacingX = 2.15 / (cols - 1);
  const spacingY = 0.62 / (rows - 1);
  const socketAnchors = []; // {mesh, row, col}

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -1.075 + c * spacingX;
      const y = 0.31 - r * spacingY;

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 10, 20), socketRingMat);
      ring.position.set(x, y, 0.64);
      partGroup.add(ring);

      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.1, 12), pinMat);
      pin.rotation.x = Math.PI / 2;
      pin.position.set(x, y, 0.6);
      partGroup.add(pin);

      socketAnchors.push({ pin, ring, row: r, col: c });
    }
  }

  // The flagged defect: one socket's contact is bent/discoloured. Its anchor
  // point (not a separate floating shape) is what the DOM tag tracks.
  const defectSocket = socketAnchors[Math.floor(rows / 2) * cols + (cols - 2)];
  const defectMat = partMat({ color: 0xc9a24a, emissive: 0x000000, metalness: 0.6, roughness: 0.4 });
  defectSocket.pin.material = defectMat;
  defectSocket.pin.rotation.z = 0.35; // visibly bent contact
  const defectAnchor = new THREE.Object3D();
  defectAnchor.position.copy(defectSocket.pin.position);
  defectAnchor.position.z += 0.06;
  partGroup.add(defectAnchor);

  // A general "framing" anchor at the housing's front-centre, for the
  // detection-frame overlay in earlier stages.
  const frameAnchor = new THREE.Object3D();
  frameAnchor.position.set(0, 0, 0.6);
  partGroup.add(frameAnchor);

  scene.add(partGroup);

  /* ---------- Object B: PLC / Arduino-style controller ---------- */
  const boardGroup = new THREE.Group();
  const boardMaterials = [];
  function boardMat(options) {
    const mat = new THREE.MeshStandardMaterial(Object.assign({ transparent: true, opacity: 0 }, options));
    boardMaterials.push(mat);
    return mat;
  }

  const pcb = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.1, 1.5),
    boardMat({ color: 0x0e5c46, metalness: 0.2, roughness: 0.6 })
  );
  boardGroup.add(pcb);

  const chip = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.16, 0.55),
    boardMat({ color: 0x0a0a0a, metalness: 0.3, roughness: 0.4 })
  );
  chip.position.set(-0.45, 0.13, 0);
  boardGroup.add(chip);

  const pinMatBoard = boardMat({ color: 0xc0c0c0, metalness: 0.85, roughness: 0.28 });
  for (let i = 0; i < 8; i++) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), pinMatBoard);
    pin.position.set(-1.05 + i * 0.28, 0.13, 0.8);
    boardGroup.add(pin);
  }

  const capMat = boardMat({ color: 0x1d2740, metalness: 0.5, roughness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 16), capMat);
    cap.position.set(0.35 + i * 0.28, 0.16, -0.42);
    boardGroup.add(cap);
  }

  // The output LED - emissive turns on when the reject signal fires.
  const ledMat = boardMat({ color: 0x113322, emissive: 0x000000 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 16), ledMat);
  led.position.set(0.85, 0.16, 0.55);
  boardGroup.add(led);

  const ledGlow = new THREE.PointLight(ACCENT, 0, 3);
  ledGlow.position.copy(led.position);
  boardGroup.add(ledGlow);

  const outputAnchor = new THREE.Object3D();
  outputAnchor.position.copy(led.position);
  boardGroup.add(outputAnchor);

  scene.add(boardGroup);

  /* ---------- Camera + object-orientation keyframes, one per stage ---------- */
  const camKeys = [
    new THREE.Vector3(0, 0.2, 5.6),    // 01 camera input - frontal
    new THREE.Vector3(1.8, 0.6, 4.3),  // 02 detection frame - slight turn
    new THREE.Vector3(-2.0, 1.0, 3.8), // 03 live interface - orbit further
    new THREE.Vector3(0.6, 0.35, 2.1), // 04 defect - push in close on the socket grid
    new THREE.Vector3(0, 1.8, 6.6),    // 05 output - pull back to reveal the board
  ];
  // The part itself turns slightly toward camera-relevant angles per stage so
  // the socket grid (and the flagged one specifically) stays presentable.
  const partYaw = [0, -0.18, 0.22, -0.28, 0];
  const lookTarget = new THREE.Vector3(0, 0, 0);

  const railItems = Array.prototype.slice.call(document.querySelectorAll('.story3d-rail .item'));
  const allOverlays = Array.prototype.slice.call(document.querySelectorAll('.story3d .overlay'));
  const overlaysByStage = {
    0: [],
    1: ['ov-frame'],
    2: ['ov-frame', 'ov-panel'],
    3: ['ov-frame', 'ov-panel', 'ov-defect'],
    4: ['ov-output'],
  };
  const fill = document.getElementById('story3d-fill');
  const ovFrame = document.getElementById('ov-frame');
  const ovDefect = document.getElementById('ov-defect');
  const ovOutput = document.getElementById('ov-output');

  let lastStage = -1;
  let currentStage = 0;

  function setStageVisuals(stageIndex) {
    railItems.forEach((item) => {
      item.classList.toggle('active', Number(item.dataset.i) === stageIndex);
    });
    const ids = overlaysByStage[stageIndex] || [];
    allOverlays.forEach((el) => {
        const on = ids.indexOf(el.id) !== -1;
        el.classList.toggle('active', on);
        // projectTo() menulis opacity inline, dan inline mengalahkan CSS.
        // Tanpa dibersihkan, label stage sebelumnya tetap terlihat karena
        // nilai inline-nya tertinggal saat kelas .active dilepas.
        if (!on) el.style.opacity = '';
    });
  }

  /* ---------- Project a 3D anchor to CSS coordinates within the stage ---------- */
  const projected = new THREE.Vector3();
  const _worldPos = new THREE.Vector3();
  const _normal = new THREE.Vector3();
  const _toCamera = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const FRONT = new THREE.Vector3(0, 0, 1);

  // Tags are pinned to a point ON the part, and the part turns as the story
  // scrolls. Projecting the anchor alone is not enough: once the part rotates
  // far enough, a tag anchored to the far side still projects onto the screen
  // and reads as if it were stuck to the near face. So each tag also knows
  // which way its surface points, and fades out once that surface turns away.
  function projectTo(el, anchor, width, height, localNormal) {
    anchor.getWorldPosition(_worldPos);

    anchor.getWorldQuaternion(_quat);
    _normal.copy(localNormal || FRONT).applyQuaternion(_quat).normalize();
    _toCamera.copy(camera.position).sub(_worldPos).normalize();
    const facing = _normal.dot(_toCamera);

    projected.copy(_worldPos).project(camera);
    const behindCamera = projected.z > 1;

    // Fade across a band rather than snapping, so a tag easing around the
    // silhouette does not pop in and out.
    const opacity = behindCamera ? 0 : Math.max(0, Math.min(1, (facing - 0.12) / 0.28));
    el.style.opacity = String(opacity);
    el.style.pointerEvents = opacity > 0.5 ? '' : 'none';
    if (opacity <= 0) return;

    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.transform = 'translate(-50%, -50%)';
  }

  /* ---------- Scroll -> camera, crossfade, overlays ---------- */
  let scale = 1;

  function update() {
    const rect = storyEl.getBoundingClientRect();
    const total = storyEl.offsetHeight - window.innerHeight;
    const p = total > 0 ? Math.max(0, Math.min(1, -rect.top / total)) : 0;

    if (fill) fill.style.height = (p * 100) + '%';

    const raw = p * (camKeys.length - 1);
    const segIndex = Math.min(camKeys.length - 2, Math.floor(raw));
    const frac = raw - segIndex;
    const stageIndex = Math.min(camKeys.length - 1, Math.floor(p * camKeys.length));
    currentStage = stageIndex;

    camera.position.lerpVectors(camKeys[segIndex], camKeys[segIndex + 1], frac);
    camera.lookAt(lookTarget);

    partGroup.rotation.y = partYaw[segIndex] + (partYaw[segIndex + 1] - partYaw[segIndex]) * frac;

    // Cross-fade the part into the controller board across the final segment.
    let partOpacity = 1;
    let boardOpacity = 0;
    if (segIndex === camKeys.length - 2) {
      partOpacity = 1 - frac;
      boardOpacity = frac;
    }
    partMaterials.forEach((mat) => { mat.opacity = partOpacity; });
    boardMaterials.forEach((mat) => { mat.opacity = boardOpacity; });
    partGroup.visible = partOpacity > 0.01;
    boardGroup.visible = boardOpacity > 0.01;

    // Defect highlight during stage 04.
    const flagged = stageIndex === 3;
    defectMat.emissive.setHex(flagged ? DANGER : 0x000000);
    defectMat.color.setHex(flagged ? DANGER : 0xc9a24a);

    // Output fires near the end of the final segment.
    const ledOn = segIndex === camKeys.length - 2 && frac > 0.6;
    ledMat.emissive.setHex(ledOn ? ACCENT : 0x000000);
    ledMat.color.setHex(ledOn ? ACCENT : 0x113322);
    ledGlow.intensity = ledOn ? 6 : 0;

    // Project overlay anchors onto the DOM every frame, so they track the
    // actual object surface as the camera orbits and the part turns.
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    // Ketiga titik menempel di permukaan depan bendanya masing-masing (+Z lokal),
    // jadi arah permukaannya ikut berputar bersama benda.
    if (ovFrame && ovFrame.classList.contains('active')) projectTo(ovFrame, frameAnchor, w, h, FRONT);
    if (ovDefect && ovDefect.classList.contains('active')) projectTo(ovDefect, defectAnchor, w, h, FRONT);
    if (ovOutput && ovOutput.classList.contains('active')) projectTo(ovOutput, outputAnchor, w, h, FRONT);

    if (stageIndex !== lastStage) {
      setStageVisuals(stageIndex);
      lastStage = stageIndex;
    }
  }

  function onResize() {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    update();
  }

  /* ---------- Render loop, paused while off-screen ----------
   * Driving `update()` from the rAF loop (rather than only the scroll event)
   * keeps the camera/overlay projection in lockstep with rendering, so
   * projected DOM tags never lag a frame behind the object's position.
   */
  let running = false;

  function frameLoop() {
    if (!running) return;
    requestAnimationFrame(frameLoop);
    update();
    renderer.render(scene, camera);
  }

  const io = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible && !running) {
      running = true;
      frameLoop();
    } else if (!visible) {
      running = false;
    }
  }, { threshold: 0 });
  io.observe(storyEl);

  window.addEventListener('resize', onResize);

  onResize();
  update();
  setStageVisuals(0);

  // Exposed so a future component wrapper can tear everything down.
  window.AutomaEyeStory3D = {
    destroy() {
      running = false;
      io.disconnect();
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
        }
      });
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
}
