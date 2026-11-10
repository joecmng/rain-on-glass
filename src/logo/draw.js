// Drawing on the glass. Whatever you draw becomes part of the logo shape (it is combined
// with any uploaded logo by LogoController), so it turns into water, fills with the rain
// and drips, just like a logo.
//
// Strokes are kept as point lists, not pixels, so the drawing can be re-rendered at any
// size (it survives window resizes) and undone stroke by stroke:
//   point  { x, y } as fractions of the window, w = width in world units (1000 = window height)
//   stroke { pts: [...], erase: bool }
//
// Input: pen, finger or mouse on the canvas while Draw is on.
//   - pen pressure sets the width (if Pressure is on); finger / mouse draw at a steady
//     width with a short taper at both ends
//   - the pen's eraser end erases; so does the Eraser toggle
//   - while a pen is in use, touches are ignored (your hand resting on the screen)
//   - the mouse wheel changes the brush size

import { CONFIG } from '../config.js';

const now = () => performance.now();

export class DrawingLayer {
  constructor({ canvas, onChange }) {
    this.canvas = canvas;            // the WebGL canvas (pointer input)
    this.onChange = onChange;        // (urgent) → the logo controller re-composes the shape
    const D = CONFIG.draw;
    this.size = D.size; this.pressure = D.pressure;
    this.enabled = false; this.eraser = false;
    this.strokes = []; this.current = null;
    this.out = document.createElement('canvas');   // rendered drawing (white, alpha = ink)
    this._penUntil = 0;
    // brush outline that follows the pointer while drawing
    this.cursor = document.createElement('div');
    this.cursor.className = 'brush-cursor';
    this.cursor.hidden = true;
    document.body.appendChild(this.cursor);
    this._bindInput();
  }

  get empty() { return !this.strokes.length && !this.current; }

  setEnabled(on) {
    this.enabled = !!on;
    this.canvas.classList.toggle('drawing', this.enabled);
    if (!this.enabled) { this.cursor.hidden = true; this._finish(); }
  }
  undo() {
    if (this.current) this.current = null;
    else this.strokes.pop();
    this.onChange?.(true);
  }
  clear() { this.strokes = []; this.current = null; this.onChange?.(true); }

  // ── rendering ─────────────────────────────────────────────────────────────
  // Draw every stroke into a canvas of the given size (round stamps along each stroke, so
  // width changes along it are smooth).
  render(w, h, withCurrent = true) {
    const c = this.out;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.fillStyle = CONFIG.draw.colour;
    const kw = h / 1000;                                 // world units → pixels
    const list = this.current && withCurrent ? [...this.strokes, this.current] : this.strokes;
    for (const s of list) {
      g.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      const P = s.pts;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[i + 1] || a;
        const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h;
        const ra = a.w * 0.5 * kw, rb = b.w * 0.5 * kw;
        const d = Math.hypot(bx - ax, by - ay);
        const step = Math.max(0.6, Math.min(ra, rb) * 0.35);
        const n = Math.max(1, Math.ceil(d / step));
        for (let k = 0; k < (b === a ? 1 : n); k++) {
          const u = k / n, r = ra + (rb - ra) * u;
          if (r < 0.3) continue;
          g.beginPath(); g.arc(ax + (bx - ax) * u, ay + (by - ay) * u, r, 0, Math.PI * 2); g.fill();
        }
      }
    }
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  // Strokes not yet in the water shape (the one being drawn, and any finished since the
  // last rebuild) as drop instances for the renderer: a chain of overlapping droplets along
  // the stroke, which the water field fuses into a continuous line of water instantly.
  // Same layout as DropSim.instances: [x, y, r, angle, stretch, taper, seed, wobble].
  ink(W, H, baked) {
    const list = this.strokes.filter((s) => !s.erase && !baked.has(s));
    if (this.current && !this.current.erase) list.push(this.current);
    if (!list.length) return null;
    const max = 6000;
    if (!this._ink) this._ink = new Float32Array(max * 8);
    const out = this._ink;
    let n = 0;
    for (const s of list) {
      const P = s.pts;
      for (let i = 0; i < P.length && n < max; i++) {
        const a = P[i], b = P[i + 1] || a;
        const ax = a.x * W, ay = a.y * H, bx = b.x * W, by = b.y * H;
        const ra = a.w * 0.5, rb = b.w * 0.5;
        const d = Math.hypot(bx - ax, by - ay);
        const k = b === a ? 1 : Math.max(1, Math.ceil(d / Math.max(0.8, Math.min(ra, rb) * 0.5)));
        for (let j = 0; j < k && n < max; j++) {
          const u = j / k, o = n * 8;
          out[o] = ax + (bx - ax) * u; out[o + 1] = ay + (by - ay) * u; out[o + 2] = ra + (rb - ra) * u;
          out[o + 3] = 0; out[o + 4] = 0; out[o + 5] = 0; out[o + 6] = (n * 0.618) % 1; out[o + 7] = 0;
          n++;
        }
      }
    }
    return { data: out, count: n };
  }

  // ── input ─────────────────────────────────────────────────────────────────
  _width(e) {
    const pen = e.pointerType === 'pen';
    if (!pen || !this.pressure) return this.size;
    const p = e.pressure > 0 ? e.pressure : 0.5;
    return this.size * (0.12 + 0.88 * Math.pow(p, 0.8));
  }
  _point(e) { return { x: e.clientX / innerWidth, y: e.clientY / innerHeight, w: this._width(e) }; }

  _finish() {
    const s = this.current;
    if (!s) return;
    this.current = null;
    if (s.pts.length) {
      if (!s.pen) taper(s.pts);
      this.strokes.push(s);
    }
    this.onChange?.(true);
    this.onStrokes?.();
  }

  _bindInput() {
    const c = this.canvas;
    let id = null, last = null;
    const add = (ev) => {
      const pt = this._point(ev);
      const px = pt.x * innerWidth, py = pt.y * innerHeight;
      // light smoothing, and skip points that barely moved
      if (last) {
        const lx = last.x * innerWidth, ly = last.y * innerHeight;
        if (Math.hypot(px - lx, py - ly) < 1.2) return;
        pt.x = last.x + (pt.x - last.x) * 0.65; pt.y = last.y + (pt.y - last.y) * 0.65;
      }
      this.current.pts.push(pt); last = pt;
    };
    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'pen') this._penUntil = now() + 1500;
      else if (e.pointerType === 'touch' && now() < this._penUntil) return;   // palm rejection
      if (id !== null) return;
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      id = e.pointerId; last = null;
      const erase = this.eraser || (e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0));
      this.current = { pts: [], erase, pen: e.pointerType === 'pen' && this.pressure };
      add(e);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.enabled) this._moveCursor(e);
      if (e.pointerId !== id || !this.current) return;
      if (e.pointerType === 'pen') this._penUntil = now() + 1500;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) add(ev);
    });
    const up = (e) => { if (e.pointerId !== id) return; id = null; this._finish(); };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.cursor.hidden = true; });
    c.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const D = CONFIG.draw;
      this.size = Math.min(D.maxSize, Math.max(D.minSize, this.size * Math.exp(-e.deltaY * 0.0015)));
      this.onSize?.(this.size);
      this._moveCursor(e);
    }, { passive: false });
  }

  _moveCursor(e) {
    if (e.pointerType === 'touch') { this.cursor.hidden = true; return; }
    const d = Math.max(4, this._width(e) * innerHeight / 1000);
    const s = this.cursor.style;
    this.cursor.hidden = false;
    this.cursor.classList.toggle('erase', this.eraser);
    s.width = s.height = `${d}px`;
    s.transform = `translate(${e.clientX - d / 2}px, ${e.clientY - d / 2}px)`;
  }
}

// Finger / mouse strokes: narrow the first and last ~12 px so lines don't look stamped.
function taper(pts) {
  const L = 12 / innerHeight;
  const ramp = (list) => {
    let acc = 0;
    for (let i = 0; i < list.length; i++) {
      if (i) acc += Math.hypot((list[i].x - list[i - 1].x) * innerWidth / innerHeight, list[i].y - list[i - 1].y);
      if (acc >= L) break;
      list[i].w *= 0.35 + 0.65 * (acc / L);
    }
  };
  ramp(pts);
  ramp([...pts].reverse());
}
