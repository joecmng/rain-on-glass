import { CONFIG } from './config.js';
import { Renderer } from './gl/renderer.js';
import { DropSim } from './sim/drops.js';
import { AudioEngine } from './audio/audio.js';
import { Mapper } from './mapping.js';
import { setupUI } from './ui/ui.js';
import { DebugPanel } from './ui/debug.js';
import { ScenePlayer, YouTubeScene } from './scenes.js';
import { PhotoSlideshow } from './photos.js';
import { LogoController } from './logo/logo.js';
import { setupLogoPanel } from './logo/panel.js';
import { DrawingLayer } from './logo/draw.js';
import { createModes } from './logo/modes.js';
import { GRID_PAD } from './logo/mask.js';

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

// uploaded logo: placement + precomputed surface map (sim.logo is read by the rain modes)
const logo = new LogoController({
  canvas, overlay: document.getElementById('logoOverlay'),
  world: () => ({ W: sim.W, H: sim.H }),
});
logo.setDrawing(new DrawingLayer({ canvas }));   // drawings combine with the logo
const logoModes = createModes(logo);
sim.surfaceMode = logoModes[CONFIG.logo.mode];   // the panel switches this (and restores the saved one)
// hand the renderer the logo mask, where it is, and how frosted it is right now
function syncLogoLayer() {
  const LL = renderer.logoLayer, r = logo.fieldRect(), m = sim.surfaceMode;
  LL.canvas = r ? logo.surfaceCanvas : null;
  LL.version = logo.maskVersion;
  if (r) LL.rect = [r.x / innerWidth, r.y / innerHeight, r.w / innerWidth, r.h / innerHeight];
  const on = m && m.active;
  LL.frost = on ? m.frost : 0;
  LL.dry = on ? m.dry : 0;
  LL.raise = on ? m.raise : 0;
  if (m) { LL.bevel = m.p.bevel ?? 7; LL.gloss = m.p.gloss ?? 1; LL.depth = m.p.depth ?? 1; }
  const f = logo.field;
  LL.water = on && m.key === 'water' && f ? {
    amount: m.water, profile: m.profile(), thick: m.thick(), weight: m.p.weight, cell: f.cell, clearFog: m.p.clearFog,
    swell: m.p.swell, bulge: m.p.bulge, fills: m.fills,
  } : null;
  // distance map + pieces (built by the Water mode, also used by the others for the distance)
  const surf = f ? logoModes.water.surface() : null;
  if (!surf) LL.sdf = null;
  else if (!LL.sdf || LL.sdf.version !== surf.version) {
    LL.sdf = { data: surf.packed, w: f.gw, h: f.gh, version: surf.version,
      map: [f.lw / f.gw, f.lh / f.gh, GRID_PAD / f.gw, GRID_PAD / f.gh] };
  }
}

function stopWebcam() { webcamStream?.getTracks().forEach((t) => t.stop()); webcamStream = null; }

// ── scenic video backgrounds ──────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clipCredit = (c) => `<b>${esc(c.title)}</b><br>Video: <a href="${c.page}" target="_blank" rel="noopener">${esc(c.author)}</a>, ${esc(c.license)}, via Wikimedia Commons`;
let currentClip = null;
const scenes = new ScenePlayer({
  rotateSeconds: CONFIG.background.sceneRotateSeconds,
  onClip: (c) => { currentClip = c; ui?.showScene({ html: clipCredit(c) }); },
  // autoplay was blocked (common on phones in battery/data saver): ask for a tap
  onStall: () => ui?.showScene({ html: `<b>Tap anywhere to start the video</b><br>${currentClip ? clipCredit(currentClip) : ''}` }),
  // this device can't play the clips (e.g. older iPhones and WebM): use the photos instead
  onFail: (why) => {
    ui.toast(`Video clips can't play here (${why}), so showing the night-city photos instead.`, 6000);
    ui.setBackgroundMode('photos');
    ui.background('photos');
  },
});
// any tap / click retries video playback (phones only allow it after a gesture sometimes)
addEventListener('pointerdown', () => {
  if (settings.background !== 'scenes' || scenes.playing()) return;
  scenes.kick();
  if (currentClip) setTimeout(() => { if (scenes.playing()) ui.showScene({ html: clipCredit(currentClip) }); }, 800);
}, { passive: true });
const yt = new YouTubeScene();
const photos = new PhotoSlideshow({
  onPhoto: (img, p, i, n) => {
    renderer.setBackground('image', img);
    ui.showScene({
      prev: true, nextLabel: 'Next ▶',
      html: `<b>${esc(p.title)}</b> <span style="opacity:.7">(${i + 1}/${n})</span><br>Photo: <a href="${p.page}" target="_blank" rel="noopener">${esc(p.author)}</a>, ${esc(p.license)}, via Wikimedia Commons`,
    });
  },
  onError: (e) => ui.toast(`${e.message}. Try the next one.`, 4000),
});
let ytStream = null, ytInfo = null;
function stopYouTubeCapture() {
  ytStream?.getTracks().forEach((t) => t.stop());
  ytStream = null;
}
function showYouTubeStep() {
  ui.showScene({
    capture: !ytStream,
    html: ytStream
      ? `<b>${esc(ytInfo.title)}</b><br>Captured from the scene window. “Next scene” loads another drive in it.`
      : `<b>${esc(ytInfo.title)}</b> is opening in a small window.<br>Click <b>Capture scene window</b>, choose the <b>Chrome Tab</b> tab and pick the YouTube one. ${CONFIG.features.audio ? 'Turn on <b>Also share tab audio</b> to use its sound too (click that window and press <b>M</b> to unmute).' : ''}`,
  });
}
async function captureYouTube() {
  if (CONFIG.features.audio) audio.ensure();   // inside the click, before any await
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: CONFIG.features.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
    selfBrowserSurface: 'exclude', surfaceSwitching: 'include', preferCurrentTab: false,
  });
  stopYouTubeCapture();
  ytStream = stream;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.srcObject = new MediaStream(stream.getVideoTracks());
  await v.play();
  renderer.setBackground('youtube', v);
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (ytStream !== stream) return;
    ytStream = null;
    renderer.setBackground('city'); ui.setBackgroundMode('city'); ui.showScene(null);
    ui.toast('Scene sharing stopped, so the background is back to the night city.');
  });
  if (CONFIG.features.audio) {
    const label = audio.useStream(stream, `Scene window: ${ytInfo?.title || 'YouTube'}`);
    if (label) { ui.setAudioMode('display'); ui.status(label); }
  }
  showYouTubeStep();
}

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
    if (mode !== 'scenes') scenes.stop();
    if (mode !== 'youtube') { stopYouTubeCapture(); yt.close(); }
    if (mode !== 'scenes' && mode !== 'youtube' && mode !== 'photos') ui.showScene(null);
    if (mode === 'photos') { await photos.start(); return; }
    if (mode === 'scenes') { renderer.setBackground('scenes', scenes.start()); return; }
    if (mode === 'youtube') {
      ytInfo = yt.open();   // opened right in the click so the popup isn't blocked
      if (ytInfo.blocked) throw new Error('The scene window was blocked. Allow pop-ups for this page and try again.');
      showYouTubeStep();
      return;               // the picture switches over once the window is captured
    }
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
  logoFile(f) { logoPanel.upload(f); },
  nextScene() {
    if (settings.background === 'photos') photos.next();
    else if (settings.background === 'scenes') scenes.next();
    else if (settings.background === 'youtube') { ytInfo = yt.open(); showYouTubeStep(); }
  },
  prevScene() { if (settings.background === 'photos') photos.prev(); },
  captureScene() { captureYouTube().catch((e) => ui.toast(e?.name === 'NotAllowedError' ? 'Capture was cancelled.' : (e?.message || String(e)), 5000)); },
});
const logoPanel = setupLogoPanel(logo, ui.toast, logoModes, (m) => { sim.surfaceMode = m; });
audio.onEnded = (msg) => { ui.setAudioMode('none'); ui.status(''); ui.toast(msg); };
ui.startBackground();   // scenic clips by default (muted video may autoplay without a click)
ui.toast(CONFIG.features.audio
  ? 'Pick “Tab / system audio” to make the rain react to YouTube. Press D for debug.'
  : 'Press D for debug, H to hide this panel, F for fullscreen.', 6000);

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
  syncLogoLayer();
  renderer.ink = logo.drawing.ink(sim.W, sim.H, logo.baked);
  renderer.render(sim, dt, time, forces, settings);
  debug.update(dt, performance.now() - t0, features, forces, sim);
}

// Auto quality: if the visible, focused page averages < 50 fps for 5 s, step down a level.
// Disabled once the user picks a quality themselves.
const LEVELS = ['low', 'medium', 'high', 'ultra'];
let slowTime = 0, fpsAcc = 0, fpsFrames = 0;
function autoQuality(dt) {
  // Very long gaps (> 100 ms) mean the page is being throttled or was in the background,
  // not that the computer is slow, so they don't count (they wrongly forced Low before).
  if (userPickedQuality || document.hidden || !document.hasFocus() || dt <= 0 || dt > 0.1) { slowTime = 0; fpsAcc = 0; fpsFrames = 0; return; }
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
window.__app = { config: CONFIG, sim, logo, logoModes, audio, mapper, renderer, settings, get features() { return features; }, get forces() { return forces; } };
