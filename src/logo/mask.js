// Logo mask → precomputed surface map.
//
// The mask says which parts of the logo count as "logo surface":
//   alpha      opaque pixels are the logo (best for PNG/SVG/PDF with transparency)
//   luminance  dark pixels are the logo (for JPGs / logos on a white background)
//   auto       alpha if the image really has transparent areas, else luminance
// `threshold` sets the cut-off and `invert` swaps logo and background.
//
// From the mask a LogoField is built (on upload, when the mask settings change, or as you
// draw): a grid in the logo's own space (GRID_LONG cells along its longer side, plus a
// margin all round) holding, per cell,
//   cov  how much of the cell is logo (0..1, smooth at the edges)
//   sd   signed distance to the logo's edge, in cells (negative inside)
//   nx,ny  the edge's outward normal (direction of increasing sd)
// plus the logo's separate pieces (used by the Water mode). The heavy maths is in
// fieldcore.js and runs in a Web Worker (buildField), so building never stalls the
// animation. Moving or scaling the logo doesn't touch the grid: query() converts world
// coordinates into grid coordinates and scales the distances, so the simulation can ask
// "am I on the logo, how far from its edge, which way is out?" for every drop, every
// frame, for the price of a few array reads.

import { GRID_PAD, buildCore, maskFn, resolveMaskMode } from './fieldcore.js';

export { GRID_PAD };
export const GRID_LONG = 256;   // grid cells along the logo's longer side

// Turn a canvas's pixels into the mask: alpha = mask, colour = `rgb`, or the logo's own
// colours when rgb is null. Returns the coverage fraction.
export function paintMask(canvas, opts, rgb = [90, 210, 255], alpha = 0.55) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const f = maskFn(resolveMaskMode(opts.mode, d), opts.threshold, opts.invert);
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const m = f(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, d[i + 3] / 255);
    sum += m;
    if (rgb) { d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; }
    d[i + 3] = Math.round(m * alpha * 255);
  }
  g.putImageData(img, 0, 0);
  return sum / (d.length / 4);
}

// The mask image resampled to the grid's sampling size, as RGBA pixels.
// grid: { long, sample } — cells along the longer side and mask pixels per cell (the
// full-window drawing uses a finer grid with fewer samples per cell)
function sampleRaster(raster, grid) {
  const GL = grid.long ?? GRID_LONG, sx = grid.sample ?? 4;
  const aspect = raster.width / raster.height;
  const lw = aspect >= 1 ? GL : Math.max(1, Math.round(GL * aspect));
  const lh = aspect >= 1 ? Math.max(1, Math.round(GL / aspect)) : GL;
  const mw = lw * sx, mh = lh * sx;
  const c = document.createElement('canvas');
  c.width = mw; c.height = mh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(raster, 0, 0, mw, mh);
  return { px: g.getImageData(0, 0, mw, mh).data, mw, mh, lw, lh, sx, aspect };
}

// ── worker ──────────────────────────────────────────────────────────────────
let worker = null, nextId = 1;
const pending = new Map();
function getWorker() {
  if (worker === null) {
    try {
      worker = new Worker(new URL('./field.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.core);
      };
      worker.onerror = () => { for (const p of pending.values()) p.reject(new Error('worker failed')); pending.clear(); worker = false; };
    } catch { worker = false; }
  }
  return worker;
}

// Build a LogoField without blocking the page (falls back to the main thread if workers
// aren't available).
export async function buildField(raster, opts, grid = {}) {
  const s = sampleRaster(raster, grid);
  const w = getWorker();
  const job = { mw: s.mw, mh: s.mh, lw: s.lw, lh: s.lh, sx: s.sx, opts: { ...opts } };
  if (w) {
    try {
      const id = nextId++;
      const core = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const buf = s.px.buffer;
        w.postMessage({ id, px: buf, ...job }, [buf]);
      });
      return new LogoField(core, s.aspect);
    } catch { /* fall through to the main thread */ }
    return new LogoField(buildCore({ px: sampleRaster(raster, grid).px, ...job }), s.aspect);
  }
  return new LogoField(buildCore({ px: s.px, ...job }), s.aspect);
}

export class LogoField {
  // core: the arrays from fieldcore.buildCore; aspect: the mask image's width / height
  constructor(core, aspect) {
    Object.assign(this, core);
    this.aspect = aspect;
    // placement (world units); set by place()
    this.x0 = 0; this.y0 = 0; this.cell = 1; this.inv = 1;
    this.result = { cov: 0, sd: 1e6, nx: 0, ny: 0, inside: false, near: false };
  }

  // Put the logo's box at world (x, y) with the given world-unit width.
  place(x, y, worldW) {
    this.cell = worldW / this.lw;           // world units per cell
    this.inv = 1 / this.cell;
    this.x0 = x - GRID_PAD * this.cell;     // grid origin includes the padding
    this.y0 = y - GRID_PAD * this.cell;
  }

  // Grid cell index at a world point (nearest cell), or -1 outside the padded grid.
  cellAt(wx, wy) {
    const cx = Math.floor((wx - this.x0) * this.inv), cy = Math.floor((wy - this.y0) * this.inv);
    return cx < 0 || cy < 0 || cx >= this.gw || cy >= this.gh ? -1 : cy * this.gw + cx;
  }

  // World-space bounds of the logo box (without padding).
  bounds() {
    const P = GRID_PAD * this.cell;
    return { x: this.x0 + P, y: this.y0 + P, w: this.lw * this.cell, h: this.lh * this.cell };
  }

  // Query the surface map at a world point. Returns a shared object (don't keep it):
  //   cov 0..1, sd world units (negative inside), nx/ny outward normal,
  //   inside (cov ≥ 0.5), near (within the padded grid)
  // Bilinear interpolation; outside the padded grid the distance is estimated.
  query(wx, wy) {
    const r = this.result;
    const fx = (wx - this.x0) * this.inv - 0.5, fy = (wy - this.y0) * this.inv - 0.5;
    const gw = this.gw, gh = this.gh;
    if (fx < 0 || fy < 0 || fx >= gw - 1 || fy >= gh - 1) {
      // far away: distance to the padded box plus the padding (a lower bound, fine for "far")
      const dx = Math.max(-fx, 0, fx - (gw - 1)), dy = Math.max(-fy, 0, fy - (gh - 1));
      r.cov = 0; r.sd = (Math.hypot(dx, dy) + GRID_PAD) * this.cell;
      r.nx = 0; r.ny = 0; r.inside = false; r.near = false;
      return r;
    }
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
    const i00 = iy * gw + ix, i10 = i00 + 1, i01 = i00 + gw, i11 = i01 + 1;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    const C = this.cov, S = this.sd, NX = this.nx, NY = this.ny;
    r.cov = C[i00] * w00 + C[i10] * w10 + C[i01] * w01 + C[i11] * w11;
    r.sd = (S[i00] * w00 + S[i10] * w10 + S[i01] * w01 + S[i11] * w11) * this.cell;
    let nx = NX[i00] * w00 + NX[i10] * w10 + NX[i01] * w01 + NX[i11] * w11;
    let ny = NY[i00] * w00 + NY[i10] * w10 + NY[i01] * w01 + NY[i11] * w11;
    const l = Math.hypot(nx, ny);
    if (l > 1e-6) { nx /= l; ny /= l; }
    r.nx = nx; r.ny = ny; r.inside = r.cov >= 0.5; r.near = true;
    return r;
  }

  // Debug picture of the grid: logo coverage in cyan, distance bands outside, the edge
  // in white. One pixel per cell; draw it scaled over the logo's padded box.
  debugImage() {
    const { gw, gh, cov, sd } = this;
    const c = document.createElement('canvas');
    c.width = gw; c.height = gh;
    const g = c.getContext('2d');
    const img = g.createImageData(gw, gh), d = img.data;
    for (let i = 0; i < gw * gh; i++) {
      const s = sd[i], k = i * 4;
      if (Math.abs(s) < 0.75) { d[k] = 255; d[k + 1] = 255; d[k + 2] = 255; d[k + 3] = 230; }
      else if (s < 0) { d[k] = 60; d[k + 1] = 200; d[k + 2] = 255; d[k + 3] = Math.round(25 + 40 * cov[i]); }
      else {
        const band = (Math.floor(s / 4) % 2) ? 0.5 : 1;    // 4-cell rings
        const fade = Math.max(0, 1 - s / GRID_PAD);
        d[k] = 255; d[k + 1] = 170; d[k + 2] = 80; d[k + 3] = Math.round(60 * fade * band);
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
}
