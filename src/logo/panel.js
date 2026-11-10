// Logo section of the settings panel: upload / remove, page picker for multi-page PDFs,
// size, mask mode, threshold, invert, the "show mask" debug view (also the M key), and the
// interaction-mode tabs with each mode's sliders (remembered in localStorage).

import { LOGO_ACCEPT, LogoError } from './loader.js';
import { CONFIG } from '../config.js';

const $ = (id) => document.getElementById(id);

export function setupLogoPanel(logo, toast, modes, onMode) {
  const fileInput = $('logoFile');
  fileInput.accept = LOGO_ACCEPT;
  const box = $('logoBox'), name = $('logoName');
  const pageRow = $('logoPageRow'), pageSel = $('logoPage');
  const size = $('logoSize'), sizeOut = size.parentElement.querySelector('output');
  const mode = $('logoMaskMode'), thr = $('logoThreshold'), thrOut = thr.parentElement.querySelector('output');
  const invert = $('logoInvert'), showMask = $('logoShowMask');

  // keep the controls in step with the controller (wheel / pinch change the size, etc.)
  const sync = () => {
    const on = logo.loaded;
    box.hidden = !on;
    $('effectBox').hidden = !logo.field;               // logo or drawing present
    $('logoEmptyHint').hidden = !!logo.field;
    $('logoReset').hidden = !on;
    $('logoModeReset').hidden = !logo.field;
    $('logoFix').hidden = !on;
    $('logoRemove').hidden = !on;
    $('logoUpload').textContent = on ? 'Replace…' : 'Upload…';
    if (!on) return;
    const s = logo.source, f = logo.logoField;
    const kind = s.kind.toUpperCase() + (s.vector ? ' (vector)' : '');
    const maskNote = f && logo.opts.mode === 'auto' ? ` · mask: ${f.maskMode === 'alpha' ? 'transparency' : 'dark areas'}` : '';
    const empty = f && (f.fill < 0.003 || f.fill > 0.997) ? ' · <b>mask is empty/full: try the threshold or Invert</b>' : '';
    name.innerHTML = `<b></b> <span style="opacity:.7">${kind}${maskNote}</span>${empty}`;
    name.querySelector('b').textContent = s.name;
    pageRow.hidden = s.pages < 2;
    if (s.pages > 1 && pageSel.options.length !== s.pages) {
      pageSel.innerHTML = Array.from({ length: s.pages }, (_, i) => `<option value="${i + 1}">${i + 1} of ${s.pages}</option>`).join('');
    }
    pageSel.value = String(s.page);
    size.value = logo.place.size; sizeOut.textContent = logo.place.size.toFixed(2);
  };
  logo.onChange = sync;

  // ── drawing ──────────────────────────────────────────────────────────────
  const draw = logo.drawing;
  if (draw) {
    const DKEY = 'rainDrawSettings';
    try {
      const sv = JSON.parse(localStorage.getItem(DKEY) || 'null');
      if (sv) {
        if (typeof sv.size === 'number') draw.size = sv.size;
        if (typeof sv.pressure === 'boolean') draw.pressure = sv.pressure;
      }
    } catch { /* ignore */ }
    const saveDraw = () => {
      try { localStorage.setItem(DKEY, JSON.stringify({ size: draw.size, pressure: draw.pressure })); } catch { /* ignore */ }
    };
    const dSize = $('drawSize'), dSizeOut = dSize.parentElement.querySelector('output');
    const syncDraw = () => {
      $('drawToggle').classList.toggle('on', draw.enabled);
      $('drawBrush').classList.toggle('on', !draw.eraser);
      $('drawEraser').classList.toggle('on', draw.eraser);
      document.body.classList.toggle('draw-mode', draw.enabled);   // shows the drawing tools above the dock
      $('drawPressure').parentElement.classList.toggle('on', draw.pressure);
      dSize.value = draw.size; dSizeOut.textContent = draw.size.toFixed(0);
      $('drawPressure').checked = draw.pressure;
      sync();
    };
    // Starting to draw always picks the brush, so the first touch on the glass draws.
    const setDrawing = (on) => {
      if (on) draw.eraser = false;
      draw.setEnabled(on);
      if (on) toast('Draw on the glass. Tap the pencil again (or B) when you’ve finished.', 3500);
      syncDraw();
    };
    $('drawToggle').addEventListener('click', () => setDrawing(!draw.enabled));
    $('drawBrush').addEventListener('click', () => { draw.eraser = false; syncDraw(); });
    $('drawEraser').addEventListener('click', () => { draw.eraser = true; syncDraw(); });
    $('drawUndo').addEventListener('click', () => { draw.undo(); syncDraw(); });
    $('drawClear').addEventListener('click', () => { draw.clear(); syncDraw(); });
    dSize.addEventListener('input', () => { draw.size = parseFloat(dSize.value); dSizeOut.textContent = draw.size.toFixed(0); saveDraw(); });
    $('drawPressure').addEventListener('change', (e) => { draw.pressure = e.target.checked; saveDraw(); syncDraw(); });
    draw.onSize = (s) => { dSize.value = s; dSizeOut.textContent = s.toFixed(0); saveDraw(); };
    draw.onStrokes = () => syncDraw();
    addEventListener('keydown', (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { if (!draw.empty) { draw.undo(); syncDraw(); e.preventDefault(); } return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'b' || e.key === 'B') setDrawing(!draw.enabled);
      else if ((e.key === 'e' || e.key === 'E') && draw.enabled) { draw.eraser = !draw.eraser; syncDraw(); }
    });
    syncDraw();
  }

  let uploads = 0;
  const upload = async (file) => {
    const mine = ++uploads;
    toast(`Loading ${file.name}…`, 20000);
    try {
      await logo.load(file);
      if (mine !== uploads) return;          // a newer upload took over
      const s = logo.source;
      toast(s.pages > 1 ? `Logo loaded (page 1 of ${s.pages}; pick another page in the panel). Drag it to move, scroll or pinch to resize.`
        : 'Logo loaded. Drag it to move, scroll or pinch to resize.', 5000);
    } catch (e) {
      if (mine !== uploads) return;
      toast(e instanceof LogoError ? e.message : `Couldn't load that file (${e?.message || e}).`, 7000);
      if (!(e instanceof LogoError)) console.error(e);
    }
    sync();
  };

  $('logoUpload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { const f = fileInput.files[0]; if (f) upload(f); fileInput.value = ''; });
  $('logoRemove').addEventListener('click', () => { logo.remove(); toast('Logo removed.', 2000); });
  $('logoReset').addEventListener('click', () => logo.resetPlacement());
  pageSel.addEventListener('change', () => logo.setPage(parseInt(pageSel.value, 10)).catch((e) => toast(`Couldn't show that page (${e?.message || e}).`)));

  size.addEventListener('input', () => logo.setSize(parseFloat(size.value)));
  mode.addEventListener('change', () => { logo.setMask({ mode: mode.value }); setTimeout(sync, 200); });
  thr.addEventListener('input', () => { thrOut.textContent = (+thr.value).toFixed(2); logo.setMask({ threshold: parseFloat(thr.value) }); setTimeout(sync, 200); });
  invert.addEventListener('change', () => { logo.setMask({ invert: invert.checked }); setTimeout(sync, 200); });
  const setShow = (on) => { showMask.checked = on; logo.setShowMask(on); };
  showMask.addEventListener('change', () => setShow(showMask.checked));
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if ((e.key === 'm' || e.key === 'M') && logo.field) { setShow(!showMask.checked); toast(showMask.checked ? 'Logo mask shown (M to hide)' : 'Logo mask hidden', 1500); }
  });

  // ── interaction modes: tabs, per-mode sliders, saved settings ─────────────
  const MODE_UI = {
    water: {
      tab: 'Water',
      title: '<b>Water</b>: the logo is made of water on the glass.',
      sliders: [
        { key: 'strength', label: 'Effect', min: 0, max: 1, step: 0.01 },
        { key: 'weight', label: 'Weight', min: -6, max: 16, step: 0.25 },
        { key: 'rounding', label: 'Rounding', min: 0.3, max: 2.5, step: 0.01 },
        { key: 'thickness', label: 'Depth', min: 0.2, max: 2, step: 0.01 },
        { key: 'clearFog', label: 'Clear fog', min: 0, max: 1, step: 0.01 },
        { key: 'capacity', label: 'Holds', min: 0.01, max: 0.2, step: 0.005 },
        { key: 'swell', label: 'Swell', min: 0, max: 2, step: 0.01 },
        { key: 'dripSize', label: 'Drip size', min: 5, max: 20, step: 0.5 },
      ],
    },
    invisible: {
      tab: 'Invisible',
      title: '<b>Invisible Glass</b>: the logo shows only in beaded, frosted water while it rains.',
      sliders: [
        { key: 'strength', label: 'Effect', min: 0, max: 2, step: 0.01 },
        { key: 'density', label: 'Beading', min: 0, max: 3, step: 0.01 },
        { key: 'frost', label: 'Frosting', min: 0, max: 1, step: 0.01 },
        { key: 'cling', label: 'Cling', min: 0, max: 6, step: 0.05 },
        { key: 'edgeHold', label: 'Edge drips', min: 0, max: 10, step: 0.1 },
        { key: 'fadeEvap', label: 'Fade speed', min: 0, max: 40, step: 0.5 },
      ],
    },
    raised: {
      tab: 'Raised',
      title: '<b>Raised Object</b>: a glossy emblem. Rain splashes on it, runs round it and drips off.',
      sliders: [
        { key: 'strength', label: 'Effect', min: 0, max: 1, step: 0.01 },
        { key: 'depth', label: 'Depth', min: 0, max: 3, step: 0.01 },
        { key: 'bevel', label: 'Bevel', min: 1, max: 20, step: 0.5 },
        { key: 'gloss', label: 'Gloss', min: 0, max: 2, step: 0.01 },
        { key: 'splash', label: 'Splash', min: 0, max: 1, step: 0.01 },
        { key: 'edgeHold', label: 'Edge drips', min: 0, max: 12, step: 0.1 },
      ],
    },
    repellent: {
      tab: 'Repellent',
      title: '<b>Water-Repellent</b>: the logo stays dry; water avoids it and beads round the outline.',
      sliders: [
        { key: 'strength', label: 'Effect', min: 0, max: 1, step: 0.01 },
        { key: 'beading', label: 'Beading', min: 0, max: 10, step: 0.1 },
        { key: 'outline', label: 'Outline', min: 2, max: 30, step: 0.5 },
        { key: 'dryness', label: 'Dryness', min: 0, max: 1, step: 0.01 },
      ],
    },
  };

  // Saved on this device: the chosen mode, every mode's sliders and the mask settings
  // (the logo file itself isn't stored). Best effort: storage may be unavailable.
  const KEY = 'rainLogoSettings';
  let current = CONFIG.logo.mode;
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // only what differs from the defaults, so improved defaults still reach this device
      const params = {};
      for (const k in modes) {
        const diff = {};
        for (const key in CONFIG.logo[k]) if (modes[k].p[key] !== CONFIG.logo[k][key]) diff[key] = modes[k].p[key];
        if (Object.keys(diff).length) params[k] = diff;
      }
      try { localStorage.setItem(KEY, JSON.stringify({ mode: current, params, mask: logo.opts })); } catch { /* ignore */ }
    }, 300);
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      for (const k in modes) {
        const sp = saved.params?.[k];
        if (!sp) continue;
        for (const key in CONFIG.logo[k]) if (typeof sp[key] === 'number' && Number.isFinite(sp[key])) modes[k].p[key] = sp[key];
      }
      if (saved.mask) {
        if (['auto', 'alpha', 'luma'].includes(saved.mask.mode)) logo.opts.mode = saved.mask.mode;
        if (typeof saved.mask.threshold === 'number') logo.opts.threshold = saved.mask.threshold;
        logo.opts.invert = !!saved.mask.invert;
      }
      if (modes[saved.mode]) current = saved.mode;
    }
  } catch { /* ignore broken or unavailable storage */ }
  // the mask controls show what was restored
  mode.value = logo.opts.mode;
  thr.value = logo.opts.threshold; thrOut.textContent = (+thr.value).toFixed(2);
  invert.checked = logo.opts.invert;
  for (const el of [mode, thr, invert]) el.addEventListener('change', save);
  thr.addEventListener('input', save);

  const tabs = $('logoTabs');
  tabs.innerHTML = Object.keys(MODE_UI).map((k) =>
    `<button type="button" role="tab" data-mode="${k}" title="${MODE_UI[k].title.replace(/<[^>]+>/g, '')}">${MODE_UI[k].tab}</button>`).join('');
  const buildModeUI = () => {
    const m = modes[current], ui = MODE_UI[current];
    for (const b of tabs.children) {
      const on = b.dataset.mode === current;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
    }
    $('logoModeTitle').innerHTML = ui.title;
    const host = $('logoModeSliders');
    host.innerHTML = '';
    // the first three sliders show; the rest sit under "More"
    let target = host;
    ui.sliders.forEach((sl, idx) => {
      if (idx === 3) {
        const more = document.createElement('details');
        more.className = 'more';
        more.innerHTML = '<summary>More</summary>';
        host.appendChild(more);
        target = more;
      }
      const row = document.createElement('label');
      row.className = 'row';
      row.innerHTML = `${sl.label} <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" /><output></output>`;
      const input = row.querySelector('input'), out = row.querySelector('output');
      const show = () => { out.textContent = (+input.value).toFixed(sl.step < 0.1 ? 2 : 1); };
      input.value = m.p[sl.key]; show();
      input.addEventListener('input', () => { m.p[sl.key] = parseFloat(input.value); show(); save(); });
      target.appendChild(row);
    });
  };
  // Switching is live: the simulation simply starts asking the new mode.
  const setMode = (k) => {
    if (!modes[k]) return;
    current = k;
    for (const m of Object.values(modes)) { m.frost = 0; m.dry = 0; m.raise = 0; }   // the new look fades in
    onMode?.(modes[k]);
    buildModeUI(); save();
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
  $('logoModeReset').addEventListener('click', () => {
    Object.assign(modes[current].p, CONFIG.logo[current]);
    buildModeUI(); save();
  });
  setMode(current);

  sync();
  return { upload };
}
