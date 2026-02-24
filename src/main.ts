import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AmbientSound } from './audio.ts';

// ─── Performance Detection ───────────────────────────────
const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
const COUNT = isMobile ? 30_000 : 75_000;
const BOUNDS = 40;
const CAMERA_Z = 60;
const DEFAULT_MODE = 4; // void

// ─── Mode Definitions ────────────────────────────────────
interface Mode {
  name: string;
  desc: string;
  hueRange: [number, number];
  satRange: [number, number];
  lightRange: [number, number];
  damping: number;
  mouseForce: number;
  drift: number;
  centerPull: number;
  equilibrium: number;
  swirl: number;
  sizeRange: [number, number];
  bloom: number;
  depthRange: number;
}

const MODES: Mode[] = [
  {
    name: 'nebula',
    desc: 'gentle drift through deep space clouds',
    hueRange: [0.58, 0.82],
    satRange: [0.5, 1.0],
    lightRange: [0.3, 0.75],
    damping: 0.988,
    mouseForce: 12,
    drift: 0.02,
    centerPull: 0.0008,
    equilibrium: 12,
    swirl: 0.0,
    sizeRange: [0.4, 2.8],
    bloom: 1.5,
    depthRange: 25,
  },
  {
    name: 'solar',
    desc: 'the heart of a burning star',
    hueRange: [0.0, 0.1],
    satRange: [0.7, 1.0],
    lightRange: [0.45, 0.9],
    damping: 0.982,
    mouseForce: 18,
    drift: 0.04,
    centerPull: 0.002,
    equilibrium: 8,
    swirl: 0.0,
    sizeRange: [0.3, 3.5],
    bloom: 2.2,
    depthRange: 18,
  },
  {
    name: 'aurora',
    desc: 'flowing curtains of light',
    hueRange: [0.28, 0.52],
    satRange: [0.6, 1.0],
    lightRange: [0.3, 0.7],
    damping: 0.993,
    mouseForce: 6,
    drift: 0.012,
    centerPull: 0.0004,
    equilibrium: 15,
    swirl: 0.002,
    sizeRange: [0.3, 2.2],
    bloom: 1.2,
    depthRange: 30,
  },
  {
    name: 'vortex',
    desc: 'spiral into the infinite',
    hueRange: [0.0, 1.0],
    satRange: [0.8, 1.0],
    lightRange: [0.4, 0.7],
    damping: 0.984,
    mouseForce: 10,
    drift: 0.01,
    centerPull: 0.003,
    equilibrium: 10,
    swirl: 0.02,
    sizeRange: [0.2, 2.0],
    bloom: 1.8,
    depthRange: 12,
  },
  {
    name: 'void',
    desc: 'silence between the stars',
    hueRange: [0.55, 0.68],
    satRange: [0.03, 0.15],
    lightRange: [0.5, 0.95],
    damping: 0.996,
    mouseForce: 4,
    drift: 0.005,
    centerPull: 0.0002,
    equilibrium: 18,
    swirl: 0.0,
    sizeRange: [0.15, 1.2],
    bloom: 2.8,
    depthRange: 40,
  },
];

// ─── Shaders ──────────────────────────────────────────────
const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uTime;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;

  void main() {
    vColor = color;
    vAlpha = aAlpha;

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = -mv.z;
    vDepth = clamp(depth / 110.0, 0.0, 1.0);

    float breath = 1.0 + 0.12 * sin(uTime * 1.5 + position.x * 0.3 + position.y * 0.25);
    gl_PointSize = aSize * breath * (250.0 / depth);
    gl_PointSize = clamp(gl_PointSize, 0.5, 48.0);

    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;

  void main() {
    vec2 center = gl_PointCoord - 0.5;
    float d = length(center);
    if (d > 0.5) discard;

    float core = exp(-d * d * 28.0);
    float glow = exp(-d * d * 8.0);
    float strength = mix(glow, core, 0.35);

    vec3 fog = vec3(0.008, 0.008, 0.03);
    vec3 col = mix(vColor, fog, vDepth * 0.55);

    gl_FragColor = vec4(col * strength, vAlpha * strength);
  }
`;

// ─── State ────────────────────────────────────────────────
let currentMode = DEFAULT_MODE;
let targetMode = DEFAULT_MODE;
let modeBlend = 1.0;
let mouseDown = false;
let mouseActive = false;
let repelling = false;
let colorOverride: number | null = null; // null = mode default, number = hue (0-1)
const mouseNDC = new THREE.Vector2(9999, 9999);
const mouseWorld = new THREE.Vector3();
const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const raycaster = new THREE.Raycaster();

// ─── Audio ────────────────────────────────────────────────
const audio = new AmbientSound();

// ─── Renderer ─────────────────────────────────────────────
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 0, CAMERA_Z);
camera.lookAt(0, 0, 0);

// ─── Post Processing ──────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  MODES[DEFAULT_MODE].bloom,
  0.5,
  0.15
);
composer.addPass(bloomPass);

// ─── Particle Data ────────────────────────────────────────
const positions = new Float32Array(COUNT * 3);
const velocities = new Float32Array(COUNT * 3);
const colors = new Float32Array(COUNT * 3);
const sizes = new Float32Array(COUNT);
const alphas = new Float32Array(COUNT);
const targetColors = new Float32Array(COUNT * 3);
const targetSizes = new Float32Array(COUNT);

const tmpColor = new THREE.Color();

function getHueRange(m: Mode): [number, number] {
  if (colorOverride === null) return m.hueRange;
  return [colorOverride - 0.06, colorOverride + 0.06];
}

function getSatRange(m: Mode): [number, number] {
  if (colorOverride === null) return m.satRange;
  // Boost saturation so custom colors are visible even on desaturated modes like void
  return [Math.max(m.satRange[0], 0.5), Math.max(m.satRange[1], 0.9)];
}

function randomizeParticle(i: number, m: Mode, scatter = 1.0) {
  const i3 = i * 3;

  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = Math.pow(Math.random(), 0.6) * BOUNDS * scatter;

  positions[i3] = r * Math.sin(phi) * Math.cos(theta);
  positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  positions[i3 + 2] = (Math.random() - 0.5) * m.depthRange * 2;

  velocities[i3] = (Math.random() - 0.5) * 0.3;
  velocities[i3 + 1] = (Math.random() - 0.5) * 0.3;
  velocities[i3 + 2] = (Math.random() - 0.5) * 0.1;

  const hr = getHueRange(m);
  const sr = getSatRange(m);
  const hue = hr[0] + Math.random() * (hr[1] - hr[0]);
  const sat = sr[0] + Math.random() * (sr[1] - sr[0]);
  const light = m.lightRange[0] + Math.random() * (m.lightRange[1] - m.lightRange[0]);
  tmpColor.setHSL(hue, sat, light);

  colors[i3] = tmpColor.r;
  colors[i3 + 1] = tmpColor.g;
  colors[i3 + 2] = tmpColor.b;

  sizes[i] = m.sizeRange[0] + Math.random() * (m.sizeRange[1] - m.sizeRange[0]);
  alphas[i] = 0.25 + Math.random() * 0.75;
}

for (let i = 0; i < COUNT; i++) {
  randomizeParticle(i, MODES[DEFAULT_MODE]);
}

// ─── Geometry & Material ──────────────────────────────────
const geometry = new THREE.BufferGeometry();
const posAttr = new THREE.BufferAttribute(positions, 3);
const colAttr = new THREE.BufferAttribute(colors, 3);
const sizeAttr = new THREE.BufferAttribute(sizes, 1);
const alphaAttr = new THREE.BufferAttribute(alphas, 1);

geometry.setAttribute('position', posAttr);
geometry.setAttribute('color', colAttr);
geometry.setAttribute('aSize', sizeAttr);
geometry.setAttribute('aAlpha', alphaAttr);

const material = new THREE.ShaderMaterial({
  vertexShader: VERT,
  fragmentShader: FRAG,
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
  },
});

const points = new THREE.Points(geometry, material);
scene.add(points);

// ─── Transition Targets ──────────────────────────────────
function precomputeTargets(m: Mode) {
  const hr = getHueRange(m);
  for (let i = 0; i < COUNT; i++) {
    const i3 = i * 3;
    const sr = getSatRange(m);
    const hue = hr[0] + Math.random() * (hr[1] - hr[0]);
    const sat = sr[0] + Math.random() * (sr[1] - sr[0]);
    const light = m.lightRange[0] + Math.random() * (m.lightRange[1] - m.lightRange[0]);
    tmpColor.setHSL(hue, sat, light);
    targetColors[i3] = tmpColor.r;
    targetColors[i3 + 1] = tmpColor.g;
    targetColors[i3 + 2] = tmpColor.b;
    targetSizes[i] = m.sizeRange[0] + Math.random() * (m.sizeRange[1] - m.sizeRange[0]);
  }
}

// ─── UI Wiring ────────────────────────────────────────────
const modeButtons = document.querySelectorAll<HTMLButtonElement>('.mode-btn');
const modeDescEl = document.getElementById('mode-desc')!;

function updateModeUI(index: number) {
  modeButtons.forEach((btn) => {
    btn.classList.toggle('active', parseInt(btn.dataset.mode!, 10) === index);
  });
  modeDescEl.textContent = MODES[index].desc;
}

function setMode(index: number) {
  if (index < 0 || index >= MODES.length) return;
  if (index === currentMode && modeBlend >= 1) return;
  targetMode = index;
  modeBlend = 0;
  precomputeTargets(MODES[index]);
  updateModeUI(index);
  audio.setMode(index);
}

modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = parseInt(btn.dataset.mode!, 10);
    setMode(idx);
  });
});

// ─── Color Picker ─────────────────────────────────────────
const swatches = document.querySelectorAll<HTMLElement>('.swatch');
const customColorInput = document.getElementById('custom-color') as HTMLInputElement;

function triggerColorTransition() {
  // Recompute target colors with the current mode + color override
  const m = MODES[modeBlend >= 1 ? currentMode : targetMode];
  precomputeTargets(m);
  if (modeBlend >= 1) {
    // Force a blend to happen
    modeBlend = 0.5;
    targetMode = currentMode;
  }
  audio.triggerColorChange();
}

function setActiveColor(el: HTMLElement) {
  swatches.forEach((s) => s.classList.remove('active'));
  el.classList.add('active');
}

swatches.forEach((swatch) => {
  swatch.addEventListener('click', () => {
    if (swatch.dataset.color === 'auto') {
      colorOverride = null;
      setActiveColor(swatch);
      triggerColorTransition();
    } else if (swatch.dataset.hue !== undefined) {
      colorOverride = parseFloat(swatch.dataset.hue);
      setActiveColor(swatch);
      triggerColorTransition();
    }
    // label wrapping the custom input handles its own click
  });
});

customColorInput.addEventListener('input', () => {
  const hex = customColorInput.value;
  tmpColor.set(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  tmpColor.getHSL(hsl);
  colorOverride = hsl.h;

  // Update the custom dot's appearance
  const dot = customColorInput.parentElement?.querySelector('.custom-dot') as HTMLElement;
  if (dot) {
    dot.style.background = hex;
    dot.textContent = '';
  }
  setActiveColor(customColorInput.parentElement as HTMLElement);
  triggerColorTransition();
});

// ─── Sound Toggle ─────────────────────────────────────────
const soundToggle = document.getElementById('sound-toggle')!;
const soundOnIcon = document.getElementById('sound-on-icon')!;
const soundOffIcon = document.getElementById('sound-off-icon')!;

// Sound is desired on by default — show toggle as active
let soundDesired = true;
soundToggle.classList.add('active');
soundOnIcon.style.display = 'block';
soundOffIcon.style.display = 'none';

function updateSoundUI(on: boolean) {
  soundDesired = on;
  soundToggle.classList.toggle('active', on);
  soundOnIcon.style.display = on ? 'block' : 'none';
  soundOffIcon.style.display = on ? 'none' : 'block';
}

// AudioContext requires user gesture — auto-start on first canvas interaction
function ensureAudio() {
  if (!audio.enabled && soundDesired) {
    audio.toggle();
  }
}

soundToggle.addEventListener('click', () => {
  if (!audio.enabled && soundDesired) {
    // Shown as on but not yet init'd — user wants to turn off before first interaction
    updateSoundUI(false);
  } else if (!audio.enabled && !soundDesired) {
    // Shown as off, user wants to turn on — init now (this IS a user gesture)
    audio.toggle();
    updateSoundUI(true);
  } else {
    // Already running, normal toggle
    updateSoundUI(audio.toggle());
  }
});

// ─── Physics ──────────────────────────────────────────────
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getActiveMode(): Mode {
  if (modeBlend >= 1) return MODES[currentMode];
  const a = MODES[currentMode];
  const b = MODES[targetMode];
  const t = modeBlend;
  return {
    name: b.name,
    desc: b.desc,
    hueRange: b.hueRange,
    satRange: b.satRange,
    lightRange: b.lightRange,
    sizeRange: b.sizeRange,
    damping: lerp(a.damping, b.damping, t),
    mouseForce: lerp(a.mouseForce, b.mouseForce, t),
    drift: lerp(a.drift, b.drift, t),
    centerPull: lerp(a.centerPull, b.centerPull, t),
    equilibrium: lerp(a.equilibrium, b.equilibrium, t),
    swirl: lerp(a.swirl, b.swirl, t),
    bloom: lerp(a.bloom, b.bloom, t),
    depthRange: lerp(a.depthRange, b.depthRange, t),
  };
}

function updateParticles(dt: number) {
  const m = getActiveMode();

  bloomPass.strength = m.bloom;

  const mx = mouseWorld.x;
  const my = mouseWorld.y;
  const mz = mouseWorld.z;
  const forceDir = repelling ? -2.0 : 1.0;
  const mf = mouseDown
    ? m.mouseForce * forceDir
    : mouseActive
      ? m.mouseForce * 0.25
      : 0;
  const eq = m.equilibrium;

  for (let i = 0; i < COUNT; i++) {
    const i3 = i * 3;
    let px = positions[i3],
      py = positions[i3 + 1],
      pz = positions[i3 + 2];
    let vx = velocities[i3],
      vy = velocities[i3 + 1],
      vz = velocities[i3 + 2];

    // Center pull with equilibrium — attracts when far, repels when close
    const centerDist = Math.sqrt(px * px + py * py + pz * pz) + 0.1;
    const pullForce = m.centerPull * (centerDist - eq);
    vx -= (px / centerDist) * pullForce;
    vy -= (py / centerDist) * pullForce;
    vz -= (pz / centerDist) * pullForce * 0.3;

    // Mouse gravity
    if (mf !== 0) {
      const dx = mx - px;
      const dy = my - py;
      const dz = mz - pz;
      const distSq = dx * dx + dy * dy + dz * dz + 4;
      const f = (mf * dt) / distSq;
      vx += dx * f;
      vy += dy * f;
      vz += dz * f * 0.2;
    }

    // Swirl
    if (m.swirl > 0) {
      const dist = Math.sqrt(px * px + pz * pz) + 0.5;
      vx += (-pz / dist) * m.swirl;
      vz += (px / dist) * m.swirl;
    }

    // Random drift
    vx += (Math.random() - 0.5) * m.drift;
    vy += (Math.random() - 0.5) * m.drift;
    vz += (Math.random() - 0.5) * m.drift * 0.3;

    // Damping
    vx *= m.damping;
    vy *= m.damping;
    vz *= m.damping;

    // Integrate
    px += vx * dt * 60;
    py += vy * dt * 60;
    pz += vz * dt * 60;

    // Soft boundary
    if (px > BOUNDS) { px = BOUNDS; vx *= -0.3; }
    if (px < -BOUNDS) { px = -BOUNDS; vx *= -0.3; }
    if (py > BOUNDS) { py = BOUNDS; vy *= -0.3; }
    if (py < -BOUNDS) { py = -BOUNDS; vy *= -0.3; }
    if (pz > m.depthRange) { pz = m.depthRange; vz *= -0.3; }
    if (pz < -m.depthRange) { pz = -m.depthRange; vz *= -0.3; }

    positions[i3] = px;
    positions[i3 + 1] = py;
    positions[i3 + 2] = pz;
    velocities[i3] = vx;
    velocities[i3 + 1] = vy;
    velocities[i3 + 2] = vz;
  }

  // Smooth color/size transition
  if (modeBlend < 1) {
    modeBlend = Math.min(modeBlend + dt * 0.5, 1);
    if (modeBlend >= 1) {
      currentMode = targetMode;
    }

    const rate = dt * 2.5;
    for (let i = 0; i < COUNT * 3; i++) {
      colors[i] += (targetColors[i] - colors[i]) * rate;
    }
    for (let i = 0; i < COUNT; i++) {
      sizes[i] += (targetSizes[i] - sizes[i]) * rate;
    }

    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
  }

  posAttr.needsUpdate = true;
}

// ─── Click Burst ──────────────────────────────────────────
function burstAt(wx: number, wy: number, push: boolean) {
  const force = push ? -3 : 3;
  const radius = 12;
  const radiusSq = radius * radius;

  for (let i = 0; i < COUNT; i++) {
    const i3 = i * 3;
    const dx = positions[i3] - wx;
    const dy = positions[i3 + 1] - wy;
    const distSq = dx * dx + dy * dy;

    if (distSq < radiusSq) {
      const strength = (1 - distSq / radiusSq) * force;
      const dist = Math.sqrt(distSq) + 0.5;
      velocities[i3] += (dx / dist) * strength;
      velocities[i3 + 1] += (dy / dist) * strength;
      velocities[i3 + 2] += (Math.random() - 0.5) * Math.abs(strength) * 0.3;
    }
  }

  audio.triggerBurst();
}

// ─── Mouse Helpers ────────────────────────────────────────
function updateMouseWorld() {
  raycaster.setFromCamera(mouseNDC, camera);
  raycaster.ray.intersectPlane(interactionPlane, mouseWorld);
}

// ─── Event Listeners ──────────────────────────────────────
canvas.addEventListener('mousemove', (e) => {
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  mouseActive = true;
  updateMouseWorld();
});

canvas.addEventListener('mouseenter', () => { mouseActive = true; });
canvas.addEventListener('mouseleave', () => { mouseActive = false; });

canvas.addEventListener('mousedown', (e) => {
  ensureAudio();
  mouseDown = true;
  if (e.button === 2 || e.shiftKey) repelling = true;
  if (mouseActive) burstAt(mouseWorld.x, mouseWorld.y, repelling);
});
canvas.addEventListener('mouseup', () => {
  mouseDown = false;
  repelling = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Touch
canvas.addEventListener('touchstart', (e) => {
  ensureAudio();
  e.preventDefault();
  mouseDown = true;
  mouseActive = true;
  const t = e.touches[0];
  mouseNDC.x = (t.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(t.clientY / window.innerHeight) * 2 + 1;
  updateMouseWorld();
  burstAt(mouseWorld.x, mouseWorld.y, false);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  mouseNDC.x = (t.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(t.clientY / window.innerHeight) * 2 + 1;
  updateMouseWorld();
}, { passive: false });

canvas.addEventListener('touchend', () => {
  mouseDown = false;
  mouseActive = false;
});

// Keyboard
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') repelling = true;
  const n = parseInt(e.key);
  if (n >= 1 && n <= MODES.length) setMode(n - 1);
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') repelling = false;
});

// Scroll zoom
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.position.z = Math.max(20, Math.min(120, camera.position.z + e.deltaY * 0.05));
}, { passive: false });

// Double-click reset
canvas.addEventListener('dblclick', () => {
  camera.position.z = CAMERA_Z;
});

// Resize
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
});

// ─── Animation Loop ──────────────────────────────────────
let cameraAngle = 0;
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  material.uniforms.uTime.value = now / 1000;

  cameraAngle += dt * 0.04;
  camera.position.x = Math.sin(cameraAngle) * 3;
  camera.position.y = Math.cos(cameraAngle * 0.7) * 2;
  camera.lookAt(0, 0, 0);

  updateParticles(dt);
  composer.render();
}

// ─── Kick Off ─────────────────────────────────────────────
setTimeout(() => {
  document.getElementById('hint')!.style.opacity = '0';
}, 6000);

animate();
