// Logo controller: owns the uploaded logo, its mask settings and its placement, keeps the
// precomputed surface map (LogoField) in step, and draws the 2D overlay (placement box and
// the debug mask view).
//
// Placement is stored relative to the screen so it survives resizes:
//   cx, cy  centre, as fractions of the window (0.5, 0.5 = centred)
//   size    longer side, as a fraction of the window's shorter side
// Interaction on the canvas: drag the logo to move it, mouse wheel / pinch over it to scale.
//
// The simulation reads `logo.field` (null when there's nothing) and calls field.query(x, y)
// with world coordinates. Building the field happens only when the logo or its mask
// settings change; moving or scaling it just updates two numbers.
//
// Drawing: when there are strokes (DrawingLayer), the logo and the drawing are combined into
// one full-window shape with its own field, rebuilt (throttled) as you draw, so drawn lines
// and the logo are one body of water. `field` is whichever is active; `fieldRect()` is the
// screen area it covers.

import { loadLogoFile, LogoError } from './loader.js';
import { buildField, GRID_PAD, paintMask } from './mask.js';
import { CONFIG } from '../config.js';

const MASK_RASTER = 1024;   // long side of the raster the mask grid is sampled from

export class LogoController {
  constructor({ canvas, overlay, world, onChange }) {
    this.canvas = canvas;          // the WebGL canvas (pointer input)
    this.overlay = overlay;        // 2D canvas on top (pointer-events: none)
    this.world = world;            // () => ({ W, H }) simulation world size
    this.onChange = onChange;      // (logo) => void: UI sync (size slider, page picker…)
    const L = CONFIG.logo;
    this.opts = { mode: L.maskMode, threshold: L.threshold, invert: false };
    this.place = { cx: 0.5, cy: 0.5, size: L.size };
    this.source = null; this.logoField = null;
    this.drawing = null; this.combined = null; this.combinedCanvas = null; this._composeTimer = 0;
    this.baked = new Set();          // strokes already part of the combined shape
    this._composeToken = 0;
    this.showMask = false;
    this.display = null; this.displayLong = 0;     // crisp raster at screen size
    this.maskCanvas = null; this.maskVersion = 0;   // white, alpha = mask (for the renderer)
    this.silhouette = null;                         // tinted mask image for the overlay
    this.highlightUntil = 0;
    this.pointer = null;                            // last cursor position (CSS px) for the readout
    this._dirty = true; this._busy = 0; this._maskTimer = 0; this._dispTimer = 0;
    this._bindInput();
    addEventListener('resize', () => { this._applyPlacement(); this._scheduleDisplay(); if (this.drawing && !this.drawing.empty) this._scheduleCompose(true); });
    const loop = () => { this._draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  get loaded() { return !!this.source; }
  // the active surface: logo + drawing combined, or just the logo
  get field() { return this.combined || this.logoField; }
  // what the renderer draws from: colour + alpha mask, matching fieldRect()
  get surfaceCanvas() { return this.combined ? this.combinedCanvas : this.maskCanvas; }
  fieldRect() { return this.combined ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : this.screenRect(); }

  // ── drawing ──────────────────────────────────────────────────────────────
  setDrawing(layer) {
    this.drawing = layer;
    layer.onChange = (urgent) => this._scheduleCompose(urgent);
  }
  // Rebuild the combined shape (in the background worker): straight away when a stroke is
  // finished, undone or cleared, at most ~11×/s otherwise (fading, the logo being dragged).
  // A stroke being drawn isn't rebuilt: it is shown instantly as droplets (DrawingLayer.ink)
  // until it is part of the shape.
  _scheduleCompose(urgent) {
    if (urgent) { clearTimeout(this._composeTimer); this._composeTimer = 0; this._compose(); return; }
    if (!this._composeTimer) this._composeTimer = setTimeout(() => { this._composeTimer = 0; this._compose(); }, 90);
  }
  async _compose() {
    const d = this.drawing, token = ++this._composeToken;
    if (!d || !d.strokes.length) {
      this.baked = new Set();
      if (this.combined) { this.combined = null; this.fieldVersion = (this.fieldVersion || 0) + 1; this.maskVersion++; this._dirty = true; }
      return;
    }
    // one window-shaped canvas: the logo (its own colours) where it sits, plus the strokes
    const vw = innerWidth, vh = innerHeight, aspect = vw / vh, L = CONFIG.draw.canvasLong;
    if (!vw || !vh) return;                         // window has no size (e.g. a hidden tab)
    const cw = aspect >= 1 ? L : Math.round(L * aspect), ch = aspect >= 1 ? Math.round(L / aspect) : L;
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    const r = this.screenRect();
    if (r && this.maskCanvas) g.drawImage(this.maskCanvas, r.x * cw / vw, r.y * ch / vh, r.w * cw / vw, r.h * ch / vh);
    const baked = new Set(d.strokes);
    g.drawImage(d.render(cw, ch, false), 0, 0);
    let f;
    try { f = await buildField(c, { mode: 'alpha', threshold: 0.5, invert: false }, { long: CONFIG.draw.gridLong, sample: 2 }); }
    catch (e) { console.error(e); return; }
    if (token !== this._composeToken) return;              // a newer rebuild has started
    f.place(0, 0, this.world().W);
    this.combined = f; this.combinedCanvas = c; this.baked = baked;
    this.fieldVersion = (this.fieldVersion || 0) + 1; this.maskVersion++;
    this._dirty = true;
  }

  // ── loading ──────────────────────────────────────────────────────────────
  async load(file) {
    const token = ++this._busy;
    const src = await loadLogoFile(file);           // throws LogoError with a friendly message
    if (token !== this._busy) { src.dispose?.(); return; }
    this.source?.dispose?.();
    this.source = src;
    this.place = { cx: 0.5, cy: 0.5, size: CONFIG.logo.size };
    try { await this._rebuild(); }
    catch (e) { if (token !== this._busy) return; throw e; }   // replaced mid-render: not an error
    this.highlight(2500);
    this.onChange?.(this);
  }

  async setPage(n) {
    if (!this.source || this.source.pages < 2) return;
    await this.source.setPage(n);
    await this._rebuild();
    this.highlight();
    this.onChange?.(this);
  }

  remove() {
    this._busy++;
    this.source?.dispose?.();
    this.source = null; this.logoField = null; this.display = null; this.silhouette = null; this.displayLong = 0;
    this.maskCanvas = null; this.maskVersion++;
    this._dirty = true;
    this._compose();                     // the drawing (if any) carries on without the logo
    this.onChange?.(this);
  }

  // ── mask settings ────────────────────────────────────────────────────────
  // Slider-friendly: rebuilds at most every ~80 ms while it's being dragged.
  setMask(partial) {
    Object.assign(this.opts, partial);
    if (!this.source) return;
    clearTimeout(this._maskTimer);
    this._maskTimer = setTimeout(() => this._rebuild().catch((e) => console.error(e)), 80);
  }

  async _rebuild() {
    const src = this.source;
    if (!src) return;
    const raster = await src.render(MASK_RASTER);
    if (src !== this.source) return;
    const field = await buildField(raster, this.opts);
    if (src !== this.source) return;
    this.logoField = field;
    this.fieldVersion = (this.fieldVersion || 0) + 1;   // renderer re-uploads the distance map
    this.displayLong = 0;                // force a fresh crisp raster
    this._applyPlacement();
    await this._refreshDisplay();
  }

  // ── placement ────────────────────────────────────────────────────────────
  setSize(size) {
    const L = CONFIG.logo;
    this.place.size = Math.min(L.maxSize, Math.max(L.minSize, size));
    this._applyPlacement(); this._scheduleDisplay(); this.highlight();
    this.onChange?.(this);
  }
  setCentre(cx, cy) {
    this.place.cx = Math.min(1, Math.max(0, cx));
    this.place.cy = Math.min(1, Math.max(0, cy));
    this._applyPlacement(); this.highlight();
  }
  resetPlacement() {
    this.place = { cx: 0.5, cy: 0.5, size: CONFIG.logo.size };
    this._applyPlacement(); this._scheduleDisplay(); this.highlight();
    this.onChange?.(this);
  }
  highlight(ms = 1500) { this.highlightUntil = performance.now() + ms; this._dirty = true; }

  // Logo box in CSS pixels.
  screenRect() {
    if (!this.logoField) return null;
    const vw = innerWidth, vh = innerHeight;
    const long = this.place.size * Math.min(vw, vh);
    const a = this.logoField.aspect;
    const w = a >= 1 ? long : long * a, h = a >= 1 ? long / a : long;
    return { x: this.place.cx * vw - w / 2, y: this.place.cy * vh - h / 2, w, h };
  }

  // World rectangle → the field. Screen and world map linearly (the world fills the canvas).
  _applyPlacement() {
    this._dirty = true;
    const r = this.screenRect();
    if (!r) return;
    const { W, H } = this.world();
    const kx = W / innerWidth, ky = H / innerHeight;
    this.logoField.place(r.x * kx, r.y * ky, r.w * kx);
    if (this.drawing && !this.drawing.empty) this._scheduleCompose(false);   // moved under a drawing
  }

  // Crisp raster at the logo's on-screen size. Vector logos are re-rendered when the logo
  // grows past the current raster (or shrinks a lot), so edges never go soft.
  _scheduleDisplay() {
    clearTimeout(this._dispTimer);
    this._dispTimer = setTimeout(() => this._refreshDisplay().catch((e) => console.error(e)), 150);
  }
  async _refreshDisplay() {
    const src = this.source, r = this.screenRect();
    if (!src || !r) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const want = Math.ceil(Math.max(r.w, r.h) * dpr);
    const have = this.displayLong;
    if (have && want <= have * 1.1 && want >= have * 0.5) return;
    const canvas = await src.render(want);
    if (src !== this.source) return;
    this.display = canvas; this.displayLong = want;
    // overlay silhouette from a copy (the display raster stays untouched for the renderer)
    const s = document.createElement('canvas');
    s.width = canvas.width; s.height = canvas.height;
    s.getContext('2d').drawImage(canvas, 0, 0);
    paintMask(s, this.opts);
    this.silhouette = s;
    // for the GPU: the logo's own colours, alpha = mask
    const m = document.createElement('canvas');
    m.width = canvas.width; m.height = canvas.height;
    m.getContext('2d').drawImage(canvas, 0, 0);
    paintMask(m, this.opts, null, 1);
    this.maskCanvas = m; this.maskVersion++;
    this._dirty = true;
    if (this.drawing && !this.drawing.empty) this._compose();
  }

  // ── pointer input on the canvas ──────────────────────────────────────────
  _hit(e, pad = 8) {
    const r = this.screenRect();
    return r && e.clientX >= r.x - pad && e.clientX <= r.x + r.w + pad && e.clientY >= r.y - pad && e.clientY <= r.y + r.h + pad;
  }
  _bindInput() {
    const c = this.canvas;
    const pts = new Map();      // active pointers on the logo
    let drag = null, pinch = null;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => {
      if (!this.logoField || this.drawing?.enabled) return;     // in Draw mode the pen draws
      if (!pts.size && !this._hit(e, e.pointerType === 'touch' ? 24 : 8)) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        drag = { x: e.clientX, y: e.clientY, cx: this.place.cx, cy: this.place.cy };
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, size: this.place.size };
        drag = null;
      }
      this.highlight(); c.classList.add('logo-dragging');
    });
    c.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      if (this.showMask) this._dirty = true;
      if (!pts.has(e.pointerId)) {
        c.classList.toggle('logo-hover', !!this.logoField && !this.drawing?.enabled && this._hit(e));
        return;
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        this.setSize(pinch.size * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
      } else if (drag) {
        this.setCentre(drag.cx + (e.clientX - drag.x) / innerWidth, drag.cy + (e.clientY - drag.y) / innerHeight);
      }
    });
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return;
      if (pts.size < 2) pinch = null;
      if (pts.size === 1) {      // one finger left after a pinch: carry on dragging from here
        const [p] = [...pts.values()];
        drag = { x: p.x, y: p.y, cx: this.place.cx, cy: this.place.cy };
      }
      if (!pts.size) { drag = null; c.classList.remove('logo-dragging'); this.onChange?.(this); }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.pointer = null; if (this.showMask) this._dirty = true; });
    c.addEventListener('wheel', (e) => {
      if (!this.logoField || this.drawing?.enabled || !this._hit(e)) return;
      e.preventDefault();
      this.setSize(this.place.size * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  // ── overlay ──────────────────────────────────────────────────────────────
  _draw() {
    const now = performance.now();
    const highlighting = now < this.highlightUntil;
    if (!this._dirty && !highlighting && !this._wasHighlighting) return;
    this._wasHighlighting = highlighting;
    this._dirty = false;
    const o = this.overlay, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (o.width !== w || o.height !== h) { o.width = w; o.height = h; }
    const g = o.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    const r = this.screenRect(), fr = this.fieldRect();
    if (!fr) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.showMask && this.field) {
      // the grid the simulation uses: distance rings outside, edge in white
      const f = this.field, P = GRID_PAD;
      const cw = fr.w / f.lw, ch = fr.h / f.lh;
      g.imageSmoothingEnabled = true;
      g.drawImage(f.debugImage(), fr.x - P * cw, fr.y - P * ch, f.gw * cw, f.gh * ch);
      if (this.silhouette && r && !this.combined) g.drawImage(this.silhouette, r.x, r.y, r.w, r.h);   // crisp mask
      this._drawReadout(g);
    }
    if (r && (highlighting || this.showMask)) {
      const fade = this.showMask ? 1 : Math.min(1, (this.highlightUntil - now) / 400);
      g.globalAlpha = fade;
      g.setLineDash([6, 5]);
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
      g.setLineDash([]);
      // corner handles
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) g.fillRect(x - 3, y - 3, 6, 6);
      g.globalAlpha = 1;
    }
  }

  // Under the cursor: what field.query() returns there (proves the sim lookup works).
  _drawReadout(g) {
    const p = this.pointer;
    if (!p || !this.field) return;
    const { W, H } = this.world();
    const q = this.field.query(p.x * W / innerWidth, p.y * H / innerHeight);
    const toCss = innerWidth / W;
    if (q.near && (q.nx || q.ny)) {
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + q.nx * 24, p.y + q.ny * 24); g.stroke();
    }
    const text = `${q.inside ? 'on logo' : 'off logo'}  cov ${q.cov.toFixed(2)}  edge ${(q.sd * toCss).toFixed(0)}px`;
    g.font = '11px ui-monospace, Consolas, monospace';
    const tw = g.measureText(text).width;
    const tx = Math.min(p.x + 14, innerWidth - tw - 12), ty = Math.max(p.y - 14, 16);
    g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(tx - 5, ty - 12, tw + 10, 17);
    g.fillStyle = '#fff'; g.fillText(text, tx, ty);
  }

  setShowMask(on) { this.showMask = !!on; this._dirty = true; }
}

export { LogoError };
