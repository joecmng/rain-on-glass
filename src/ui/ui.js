import { CONFIG } from '../config.js';
import { setupDock } from './dock.js';

const $ = (id) => document.getElementById(id);

// Wires the overlay. `h` = handlers: { audio(mode, file?), background(mode, file?), quality(q), debug() }
export function setupUI(settings, h) {
  const panel = $('panel');
  const toastEl = $('toast');
  let toastTimer = 0;
  const toast = (msg, ms = 4000) => {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  };
  const status = (msg) => { $('audioStatus').textContent = msg || ''; };

  // the control dock (icons at the bottom; each opens a card)
  const dock = setupDock();

  // audio controls are behind a feature switch (hidden for now)
  const audioOn = !!CONFIG.features?.audio;
  $('audioSection').hidden = !audioOn;
  if (audioOn) {
    $('dropHint').textContent = 'Drop an audio or logo file anywhere.';
    $('dropzone').textContent = 'Drop audio or a logo';
  }

  if (CONFIG.features?.youtube) { const o = $('bgYouTube'); o.hidden = false; o.disabled = false; }

  // sliders
  const fmt = { sensitivity: (v) => v.toFixed(2), speed: (v) => v.toFixed(2), rain: (v) => v.toFixed(2), fog: (v) => v.toFixed(2), bokeh: (v) => v.toFixed(2), grain: (v) => v.toFixed(2) };
  for (const key of ['sensitivity', 'speed', 'rain', 'fog', 'bokeh']) {
    const input = $(key), out = input.parentElement.querySelector('output');
    input.value = settings[key];
    const sync = () => { settings[key] = parseFloat(input.value); out.textContent = fmt[key](settings[key]); };
    input.addEventListener('input', sync); sync();
  }

  // wind dial: the arrow points where the air pushes the drops. Angle is measured from
  // straight down (gravity) toward the rear: 0° = down, 90° = horizontal, 180° = up.
  const dial = $('windDial'), arrow = $('windArrow'), windOut = $('windOut');
  const ticks = dial.querySelector('.dial-ticks');
  for (let a = 0; a < 360; a += 30) {
    const r = (a * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r);
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', (s * 38).toFixed(1)); l.setAttribute('y1', (c * 38).toFixed(1));
    l.setAttribute('x2', (s * 44).toFixed(1)); l.setAttribute('y2', (c * 44).toFixed(1));
    ticks.appendChild(l);
  }
  const describe = (a) => {
    const d = ((a % 360) + 360) % 360;
    if (d < 20 || d > 340) return 'down';
    if (d < 70) return 'back & down';
    if (d <= 110) return 'back';
    if (d < 160) return 'back & up';
    if (d <= 200) return 'up';
    if (d < 250) return 'fwd & up';
    if (d <= 290) return 'forward';
    return 'fwd & down';
  };
  const setWind = (a) => {
    a = Math.round(((a % 360) + 360) % 360);
    settings.windAngle = a;
    arrow.setAttribute('transform', `rotate(${-a})`);   // arrow is drawn pointing down
    windOut.textContent = `${a}°`;
    dial.setAttribute('aria-valuenow', a);
    dial.setAttribute('aria-valuetext', `${a} degrees, ${describe(a)}`);
    dial.title = `Airflow ${describe(a)} (${a}°). Drag to change, double-click to reset.`;
  };
  const angleFrom = (e) => {
    const r = dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    return (Math.atan2(dx, dy) * 180) / Math.PI;      // 0 = down, +90 = right
  };
  dial.addEventListener('pointerdown', (e) => { dial.setPointerCapture(e.pointerId); dial.classList.add('dragging'); setWind(angleFrom(e)); });
  dial.addEventListener('pointermove', (e) => { if (dial.hasPointerCapture(e.pointerId)) setWind(angleFrom(e)); });
  dial.addEventListener('pointerup', (e) => { dial.releasePointerCapture(e.pointerId); dial.classList.remove('dragging'); });
  dial.addEventListener('dblclick', () => setWind(CONFIG.defaults.windAngle));
  dial.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { setWind(settings.windAngle - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { setWind(settings.windAngle + step); e.preventDefault(); }
  });
  setWind(settings.windAngle);

  // audio source
  const audioSel = $('audioSrc');
  let audioMode = 'none';
  const pickAudio = async (mode, file) => {
    try {
      status(mode === 'display' ? 'Pick the YouTube tab and switch on “Also share tab audio”…' : mode === 'none' ? '' : 'Starting…');
      const label = await h.audio(mode, file);
      audioMode = mode; audioSel.value = mode;
      $('player').hidden = mode !== 'file';
      status(label || '');
    } catch (e) {
      audioSel.value = audioMode;
      status('');
      if (e?.name === 'NotAllowedError') toast('Permission was denied or the picker was cancelled.');
      else toast(e?.message || String(e), 6000);
    }
  };
  audioSel.addEventListener('change', () => {
    if (audioSel.value === 'file') { audioSel.value = audioMode; $('audioFile').click(); return; }
    pickAudio(audioSel.value);
  });
  $('audioFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) pickAudio('file', f); e.target.value = ''; });

  // background
  const bgSel = $('bg');
  bgSel.value = settings.background;
  let bgMode = settings.background;
  const pickBg = async (mode, file) => {
    try { await h.background(mode, file); bgMode = mode; bgSel.value = mode; settings.background = mode; }
    catch (e) { bgSel.value = bgMode; toast(e?.message || String(e), 5000); }
  };
  // scene box (credits / next / capture) for the video backgrounds
  const sceneBox = $('sceneBox'), sceneText = $('sceneText'), sceneCapture = $('sceneCapture');
  const showScene = (info) => {
    sceneBox.hidden = !info;
    if (!info) return;
    sceneText.innerHTML = info.html;
    sceneCapture.hidden = !info.capture;
    $('scenePrev').hidden = !info.prev;
    $('sceneNext').textContent = info.nextLabel || 'Next scene';
  };
  $('sceneNext').addEventListener('click', () => h.nextScene());
  $('scenePrev').addEventListener('click', () => h.prevScene());
  // ← / → step through the photo slideshow (ignored while typing or on the wind dial)
  addEventListener('keydown', (e) => {
    if (settings.background !== 'photos') return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t?.id === 'windDial') return;
    if (e.key === 'ArrowRight') { h.nextScene(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { h.prevScene(); e.preventDefault(); }
  });
  sceneCapture.addEventListener('click', () => h.captureScene());

  bgSel.addEventListener('change', () => {
    if (bgSel.value === 'image') { bgSel.value = bgMode; $('imageFile').click(); return; }
    pickBg(bgSel.value);
  });
  $('imageFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) pickBg('image', f); e.target.value = ''; });

  // streak style (options come from CONFIG.streakStyles; keys 1–4 switch too)
  const stSel = $('streakStyle');
  const styleKeys = Object.keys(CONFIG.streakStyles);
  stSel.innerHTML = styleKeys.map((k) => `<option value="${k}">${CONFIG.streakStyles[k].label}</option>`).join('');
  stSel.value = settings.streakStyle;
  const pickStyle = (k) => { settings.streakStyle = k; stSel.value = k; h.streakStyle(k); };
  stSel.addEventListener('change', () => pickStyle(stSel.value));
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const i = parseInt(e.key, 10) - 1;
    if (i >= 0 && i < styleKeys.length) { pickStyle(styleKeys[i]); toast(`Streaks: ${CONFIG.streakStyles[styleKeys[i]].label}`, 1500); }
  });

  // quality
  const qSel = $('quality');
  qSel.value = settings.quality;
  qSel.addEventListener('change', () => { settings.quality = qSel.value; h.quality(qSel.value); });

  // fullscreen / debug
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  $('fullscreen').addEventListener('click', fullscreen);
  $('debugBtn').addEventListener('click', () => h.debug());

  // keyboard
  let forceHidden = false;
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) { if (e.key !== 'd' && e.key !== 'D') return; }
    if (e.key === 'd' || e.key === 'D') h.debug();
    else if (e.key === 'f' || e.key === 'F') fullscreen();
    else if (e.key === 'h' || e.key === 'H') { forceHidden = !forceHidden; document.body.classList.toggle('idle', forceHidden); }
  });

  // auto-hide after inactivity (never while interacting with the panel)
  let idleTimer = 0, hovering = false;
  const wake = () => {
    if (forceHidden) return;
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!hovering && !panel.contains(document.activeElement)) document.body.classList.add('idle'); else wake(); }, CONFIG.ui.hideAfterMs);
  };
  panel.addEventListener('mouseenter', () => (hovering = true));
  panel.addEventListener('mouseleave', () => { hovering = false; wake(); });
  for (const ev of ['mousemove', 'mousedown', 'touchstart', 'wheel']) addEventListener(ev, wake, { passive: true });
  wake();

  // drag & drop: audio → audio source, images / SVG / PDF / AI / EPS → the logo
  // (a background picture is chosen from Background → Image…)
  const logoLike = (f) => /^image\//.test(f.type) || f.type === 'application/pdf' || f.type === 'application/postscript'
    || /\.(png|jpe?g|webp|gif|svg|pdf|ai|eps|epsf)$/i.test(f.name);
  let dragDepth = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (audioOn && (f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i.test(f.name))) pickAudio('file', f);
    else if (logoLike(f)) h.logoFile(f);
    else toast(`“${f.name}” isn't a supported logo file. Use PNG, JPG, WebP, GIF, SVG, PDF or AI.`, 5000);
  });

  return { toast, status, showScene, background: (m) => pickBg(m), startBackground: () => pickBg(settings.background), setBackgroundMode: (m) => { bgMode = m; bgSel.value = m; settings.background = m; }, setAudioMode: (m) => { audioMode = m; audioSel.value = m; $('player').hidden = m !== 'file'; } };
}
