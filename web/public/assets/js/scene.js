import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ACCENT = 0x00f0c0;
const ACCENT_2 = 0x7c5cff;

const mount = document.getElementById('scene-mount');
const annoRoot = document.getElementById('annotations');
const stage = document.getElementById('stage-frame');
const dragHint = document.getElementById('drag-hint');

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(pointer: coarse)').matches;

if (mount && annoRoot && stage) {
  try {
    init();
  } catch (err) {
    console.warn('AutomaEye: 3D scene unavailable', err);
  }
}

function init() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight, false);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.1, 100);
  camera.position.set(0.4, 0.9, 5.6);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.minPolarAngle = Math.PI * 0.22;
  controls.maxPolarAngle = Math.PI * 0.74;
  // Touch drag would swallow page scroll inside a sticky panel, so on touch
  // devices the object is driven by scroll alone.
  controls.enabled = !coarse;
  if (coarse && dragHint) dragHint.remove();

  /* ---------------- Lighting ---------------- */
  scene.add(new THREE.AmbientLight(0x7b86a4, 1.5));

  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(3.5, 4.5, 2.5);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xc8d4ff, 0.6);
  fill.position.set(-3, 1, 3);
  scene.add(fill);

  // Keeps the far side readable once the user orbits around the unit.
  const back = new THREE.DirectionalLight(0x9fb4ff, 1.0);
  back.position.set(-2.5, 1.5, -3.5);
  scene.add(back);

  const rimA = new THREE.PointLight(ACCENT, 24, 16);
  rimA.position.set(-2.8, 1.4, 2.6);
  scene.add(rimA);

  const rimB = new THREE.PointLight(ACCENT_2, 20, 16);
  rimB.position.set(2.8, -1.6, -2.2);
  scene.add(rimB);

  /* ---------------- The edge unit ---------------- */
  // Lifted so the unit reads as optically centred in the frame (its geometry
  // hangs below the origin because of the stand).
  const BASE_Y = 0.42;
  const unit = new THREE.Group();
  unit.position.y = BASE_Y;
  scene.add(unit);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x161b28, metalness: 0.62, roughness: 0.38 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0b0e16, metalness: 0.5, roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 1, roughness: 0.08, emissive: 0x00120f });

  function addEdges(mesh, color = 0x4a5570) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 30),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 })
    );
    mesh.add(edges);
    return edges;
  }

  // Housing
  const housing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.35, 1.25), bodyMat);
  addEdges(housing);
  unit.add(housing);

  // Front plate + lens assembly
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.15, 0.12), darkMat);
  plate.position.z = 0.66;
  unit.add(plate);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.55, 48), bodyMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.95;
  addEdges(barrel, 0x39415a);
  unit.add(barrel);

  const lensRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.035, 14, 56),
    new THREE.MeshStandardMaterial({ color: 0x222a3c, metalness: 0.9, roughness: 0.25 })
  );
  lensRing.position.z = 1.22;
  unit.add(lensRing);

  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.36, 40, 28), glassMat);
  glass.position.z = 1.16;
  glass.scale.z = 0.55;
  unit.add(glass);

  const iris = new THREE.Mesh(
    new THREE.TorusGeometry(0.26, 0.015, 12, 48),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 })
  );
  iris.position.z = 1.28;
  unit.add(iris);

  // Heatsink fins on top
  for (let i = 0; i < 7; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 1.0), darkMat);
    fin.position.set(-0.7 + i * 0.23, 0.755, -0.1);
    unit.add(fin);
  }

  // Rear ports
  const portPlate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.08), darkMat);
  portPlate.position.z = -0.65;
  unit.add(portPlate);

  const portMat = new THREE.MeshStandardMaterial({ color: 0x2b3348, metalness: 0.8, roughness: 0.3 });
  for (let i = 0; i < 3; i++) {
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.1), portMat);
    port.position.set(-0.45 + i * 0.45, -0.15, -0.7);
    unit.add(port);
  }

  // Status LEDs
  const ledColors = [ACCENT, ACCENT_2, 0xff7a59];
  const leds = ledColors.map((c, i) => {
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 16, 12),
      new THREE.MeshBasicMaterial({ color: c })
    );
    led.position.set(0.62, 0.42 - i * 0.16, 0.72);
    unit.add(led);
    return led;
  });

  // Mount / stand
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.85, 20), bodyMat);
  neck.position.y = -1.1;
  unit.add(neck);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.11, 40), bodyMat);
  base.position.y = -1.58;
  addEdges(base, 0x39415a);
  unit.add(base);

  // Scan ring around the unit
  const scanRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.75, 0.008, 8, 96),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35 })
  );
  scanRing.rotation.x = Math.PI / 2;
  unit.add(scanRing);

  /* --------- Step-specific extras --------- */

  // Pipeline nodes (step 03)
  const nodes = new THREE.Group();
  const nodePositions = [
    [-1.9, 1.35, 0.2], [-0.7, 1.85, -0.3], [0.7, 1.85, 0.3], [1.9, 1.35, -0.2],
  ];
  nodePositions.forEach((p, i) => {
    const node = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.15),
      new THREE.MeshStandardMaterial({
        color: i % 2 ? ACCENT_2 : ACCENT, emissive: i % 2 ? ACCENT_2 : ACCENT,
        emissiveIntensity: 0.4, metalness: 0.4, roughness: 0.4,
      })
    );
    node.position.set(p[0], p[1], p[2]);
    nodes.add(node);
  });
  const linkPoints = nodePositions.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  nodes.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(linkPoints),
    new THREE.LineBasicMaterial({ color: 0x39415a, transparent: true })
  ));
  unit.add(nodes);

  // Detection boxes (steps 05, 06)
  const detections = new THREE.Group();
  const detSpecs = [
    { pos: [-1.15, 0.35, 2.1], size: [0.85, 1.15, 0.02], color: ACCENT },
    { pos: [0.95, -0.15, 2.35], size: [0.7, 0.7, 0.02], color: ACCENT_2 },
    { pos: [0.15, 0.95, 2.6], size: [0.5, 0.4, 0.02], color: 0xff7a59 },
  ];
  detSpecs.forEach((spec) => {
    const box = new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]);
    const line = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: spec.color, transparent: true })
    );
    line.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    detections.add(line);
  });
  unit.add(detections);

  // Dataset particle shell (steps 01, 07)
  const particleCount = 320;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const r = 2.4 + Math.random() * 1.5;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.6;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(
    particleGeo,
    new THREE.PointsMaterial({ color: ACCENT, size: 0.035, transparent: true, opacity: 0.7 })
  );
  unit.add(particles);

  /* ---------------- Annotation anchors ---------------- */
  const anchors = {};
  function anchor(name, x, y, z) {
    const obj = new THREE.Object3D();
    obj.position.set(x, y, z);
    unit.add(obj);
    anchors[name] = obj;
  }
  anchor('lens', 0, 0, 1.32);
  anchor('top', 0, 0.85, -0.1);
  anchor('port', -0.45, -0.15, -0.78);
  anchor('core', -1.0, 0.1, 0.3);
  anchor('bus', 0.95, -0.35, -0.5);
  anchor('storage', -0.9, -0.5, 0.55);
  anchor('mount', 0, -1.62, 0);
  anchor('detect', -1.15, 0.95, 2.1);

  /* ---------------- Per-step configuration ----------------
   * `rot` is the Y rotation that turns the anchors this step talks about
   * toward the camera, so the unit presents the part being described.
   * Angles are unwrapped (not normalised) so the interpolation between
   * consecutive steps turns the short, intentional way.
   */
  const STEP_CONFIG = [
    { // 01 Connect - rear data ports
      rot: 2.1,
      labels: [['port', 'Dataset repo'], ['storage', 'Private or public']],
      show: { particles: 1, nodes: 0, detections: 0 },
    },
    { // 02 Create - compute side
      rot: 1.2,
      labels: [['core', 'Model weights'], ['top', 'Train / evaluate']],
      show: { particles: 0.5, nodes: 0, detections: 0 },
    },
    { // 03 Build - pipeline nodes above the unit
      rot: 0.9,
      labels: [['core', 'Pipeline blocks'], ['top', 'Live preview']],
      show: { particles: 0, nodes: 1, detections: 0 },
    },
    { // 04 Input - lens straight on
      rot: -0.12,
      labels: [['lens', 'Camera input'], ['mount', 'Positioning'], ['top', 'Field of view']],
      show: { particles: 0, nodes: 0, detections: 0 },
    },
    { // 05 Detect - lens plus compute
      rot: 0.4,
      labels: [['lens', 'Inference · 0.94'], ['core', 'Edge NPU']],
      show: { particles: 0, nodes: 0, detections: 1 },
    },
    { // 06 Act - turn around to the output bus and ports
      rot: 3.43,
      labels: [['bus', 'Webhook / MQTT'], ['port', 'Event log']],
      show: { particles: 0, nodes: 0, detections: 1 },
    },
    { // 07 Manage - back to the storage side
      rot: 1.15,
      labels: [['storage', 'Frame buffer'], ['core', 'Re-label queue']],
      show: { particles: 1, nodes: 0, detections: 0 },
    },
  ];

  // One DOM label per (step, anchor) pair, created up front and reused.
  const labelEls = STEP_CONFIG.map((cfg) =>
    cfg.labels.map(([anchorName, text]) => {
      const el = document.createElement('div');
      el.className = 'annotation';
      el.innerHTML = '<span class="dot"></span><span class="text"></span>';
      el.querySelector('.text').textContent = text;
      annoRoot.appendChild(el);
      return { el, anchor: anchors[anchorName] };
    })
  );

  /* ---------------- Scroll wiring ---------------- */
  let targetRotation = 0;
  let activeStep = 0;
  const opacity = { particles: 0, nodes: 0, detections: 0 };
  const targetOpacity = { particles: 1, nodes: 0, detections: 0 };

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function applyScroll(state) {
    activeStep = state.step;
    // Turn continuously between this step's pose and the next one, so the unit
    // keeps moving with the scroll instead of snapping at step boundaries.
    const from = STEP_CONFIG[state.step].rot;
    const next = STEP_CONFIG[Math.min(state.step + 1, STEP_CONFIG.length - 1)];
    targetRotation = from + (next.rot - from) * easeInOut(state.stepProgress);
    const show = STEP_CONFIG[state.step].show;
    targetOpacity.particles = show.particles;
    targetOpacity.nodes = show.nodes;
    targetOpacity.detections = show.detections;
  }

  if (window.AutomaEyeScrolly) {
    window.AutomaEyeScrolly.subscribe(applyScroll);
    applyScroll(window.AutomaEyeScrolly);
  }

  /* ---------------- Resize ---------------- */
  let width = mount.clientWidth;
  let height = mount.clientHeight;

  function onResize() {
    width = mount.clientWidth;
    height = mount.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  window.addEventListener('resize', onResize);
  onResize();

  /* ---------------- Render loop ---------------- */
  const projected = new THREE.Vector3();
  const worldPos = new THREE.Vector3();
  const unitCenter = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const clock = new THREE.Clock();

  function setGroupOpacity(group, value) {
    group.visible = value > 0.01;
    group.traverse((child) => {
      if (child.material) {
        child.material.transparent = true;
        child.material.opacity = value * (child.material.userData.baseOpacity ?? 1);
      }
    });
  }
  // Remember authored opacities so fades scale rather than overwrite them.
  [particles, ...detections.children, ...nodes.children].forEach((obj) => {
    if (obj.material) obj.material.userData.baseOpacity = obj.material.opacity;
  });

  let running = false;

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);

    const t = clock.getElapsedTime();

    if (!reduced) {
      unit.rotation.y += (targetRotation - unit.rotation.y) * 0.07;
      unit.position.y = BASE_Y + Math.sin(t * 0.8) * 0.04;
      scanRing.rotation.z = t * 0.35;
      iris.scale.setScalar(1 + Math.sin(t * 2.2) * 0.06);
      leds.forEach((led, i) => {
        led.material.opacity = 0.45 + 0.55 * Math.abs(Math.sin(t * (1.4 + i * 0.5)));
        led.material.transparent = true;
      });
      detections.children.forEach((box, i) => {
        box.position.y += Math.sin(t * 1.2 + i) * 0.0012;
      });
      particles.rotation.y = t * 0.06;
    } else {
      unit.rotation.y = targetRotation;
    }

    for (const key of ['particles', 'nodes', 'detections']) {
      opacity[key] += (targetOpacity[key] - opacity[key]) * 0.08;
    }
    setGroupOpacity(particles, opacity.particles);
    setGroupOpacity(nodes, opacity.nodes);
    setGroupOpacity(detections, opacity.detections);

    controls.update();
    renderer.render(scene, camera);
    updateAnnotations();
  }

  function updateAnnotations() {
    if (!width || !height) return;
    unit.getWorldPosition(unitCenter);
    toCamera.copy(camera.position).sub(unitCenter).normalize();

    labelEls.forEach((group, stepIndex) => {
      const stepActive = stepIndex === activeStep;
      group.forEach(({ el, anchor }) => {
        if (!stepActive) {
          el.classList.remove('is-visible');
          return;
        }
        anchor.getWorldPosition(worldPos);
        projected.copy(worldPos).project(camera);

        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;

        const onScreen = projected.z < 1 && x > 0 && x < width && y > 0 && y < height;

        // Hide labels whose anchor has rotated to the far side of the unit.
        // Occlusion here is a question of azimuth only, so compare direction in
        // the XZ plane; anchors sitting near the vertical axis (the top vent,
        // the stand) are never hidden by the body and always show.
        const dx = worldPos.x - unitCenter.x;
        const dz = worldPos.z - unitCenter.z;
        const radial = Math.hypot(dx, dz);
        let facing = 1;
        if (radial > 0.3) {
          const camDx = camera.position.x - unitCenter.x;
          const camDz = camera.position.z - unitCenter.z;
          const camLen = Math.hypot(camDx, camDz) || 1;
          facing = (dx * camDx + dz * camDz) / (radial * camLen);
        }

        el.style.setProperty('--x', x + 'px');
        el.style.setProperty('--y', y + 'px');
        el.classList.toggle('is-left', x < width * 0.45);
        el.classList.toggle('is-visible', onScreen && facing > -0.15);
      });
    });
  }

  // Render only while the panel is on screen.
  const io = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible && !running) {
      running = true;
      clock.getDelta();
      tick();
    } else if (!visible) {
      running = false;
    }
  }, { threshold: 0 });
  io.observe(stage);

  stage.classList.add('is-ready');
}
