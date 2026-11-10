import { CONFIG } from './config.js';
import { Renderer } from './gl/renderer.js';
import { DropSim } from './sim/drops.js';
import { AudioEngine } from './audio/audio.js';
import { Mapper } from './mapping.js';
import { setupUI } from './ui/ui.js';
import { DebugPanel } from './ui/debug.js';

const settings = { ...CONFIG.defaults, quality: CONFIG.defaultQuality };
const canvas = document.getElementById('gl');

let renderer;
try { renderer = new Renderer(canvas); }
catch (e) {
  const el = document.getElementById('fatal');
  el.hidden = false; el.textContent = 'Could not start WebGL2.\n\n' + e.message;
  throw e;
}

const sim = new DropSim();
const audio = new AudioEngine();
const mapper = new Mapper();
const debug = new DebugPanel(document.getElementById('debug'));
let webcamStream = null;
let userPickedQuality = false;

function applyQuality(q) {
  const Q = CONFIG.quality[q];
  sim.setCapacity(Q.maxDrops, Q.maxMist);
  renderer.resize(innerWidth, innerHeight, q);
  sim.resize(renderer.aspect);
}
applyQuality(settings.quality);
addEventListener('resize', () => { renderer.resize(innerWidth, innerHeight, settings.quality); sim.resize(renderer.aspect); });
sim.setStyle(settings.streakStyle);
sim.prefill();

function stopWebcam() { webcamStream?.getTracks().forEach((t) => t.stop()); webcamStream = null; }

const ui = setupUI(settings, {
  async audio(mode, file) {
    if (mode === 'none') { audio.stop(); return ''; }
    if (mode === 'display') return audio.useDisplay();
    if (mode === 'mic') return audio.useMic();
    if (mode === 'file') return audio.useFile(file, document.getElementById('player'));
    if (mode === 'test') return audio.useTest();
    return '';
  },
  async background(mode, file) {
    if (mode !== 'webcam') stopWebcam();
    if (mode === 'city' || mode === 'day') { renderer.setBackground(mode); return; }
    if (mode === 'image') {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();
      renderer.setBackground('image', img);
      return;
    }
    if (mode === 'webcam') {
      stopWebcam();
      webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.srcObject = webcamStream;
      await v.play();
      renderer.setBackground('webcam', v, true);
    }
  },
  quality(q) { userPickedQuality = true; applyQuality(q); },
  streakStyle(k) { sim.setStyle(k); },
  debug() { debug.toggle(); },
});
audio.onEnded = (msg) => { ui.setAudioMode('none'); ui.status(''); ui.toast(msg); };
ui.toast('Pick “Tab / system audio” to make the rain react to YouTube. Press D for debug.', 6000);

// ── frame loop ───────────────────────────────────────────────────────────
let time = 0, last = performance.now();
let features = null, forces = mapper.out;

function tick(dt) {
  const t0 = performance.now();
  time += dt;
  features = audio.update(dt);
  forces = mapper.update(dt, features, settings);
  // substep the physics when frames are long, so stick/slip stays stable
  const steps = Math.max(1, Math.ceil(dt / CONFIG.substepDt));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    sim.step(sdt, forces);
    if (i === 0) { forces.burst = 0; forces.releaseEvent = 0; } // one-shot events
  }
  sim.fillInstances(dt);
  renderer.render(sim, dt, time, forces, settings);
  debug.update(dt, performance.now() - t0, features, forces, sim);
}

// Auto quality: if the visible, focused page averages < 50 fps for 5 s, step down a level.
// Disabled once the user picks a quality themselves.
const LEVELS = ['low', 'medium', 'high', 'ultra'];
let slowTime = 0, fpsAcc = 0, fpsFrames = 0;
function autoQuality(dt) {
  if (userPickedQuality || document.hidden || !document.hasFocus() || dt <= 0) { slowTime = 0; fpsAcc = 0; fpsFrames = 0; return; }
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc < 1) return;
  const fps = fpsFrames / fpsAcc;
  fpsAcc = 0; fpsFrames = 0;
  slowTime = fps < 50 ? slowTime + 1 : 0;
  const i = LEVELS.indexOf(settings.quality);
  if (slowTime >= 5 && i > 0) {
    slowTime = 0;
    settings.quality = LEVELS[i - 1];
    document.getElementById('quality').value = settings.quality;
    applyQuality(settings.quality);
    ui.toast(`Running at ${fps.toFixed(0)} fps, so quality was lowered to ${settings.quality}.`);
  }
}

function frame(now) {
  const dt = Math.max(0, (now - last) / 1000);
  last = now;
  if (window.__paused) { requestAnimationFrame(frame); return; }   // dev: freeze for frame-by-frame checks
  tick(Math.min(CONFIG.maxDt, dt));
  autoQuality(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// dev hooks (console): advance the sim synchronously, inspect state
window.__advance = (sec, step = 1 / 60) => { for (let t = 0; t < sec; t += step) tick(step); return { drops: sim.n, moving: sim.stats.moving, mist: sim.mn }; };
window.__app = { config: CONFIG, sim, audio, mapper, renderer, settings, get features() { return features; }, get forces() { return forces; } };
