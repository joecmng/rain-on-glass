// The heavy part of building a logo / drawing surface map, as plain functions with no DOM,
// so it can run in a Web Worker (field.worker.js) and never stall the animation.
//
// Input:  the mask image's RGBA pixels (mw × mh = lw·sx × lh·sx), the grid size (lw × lh
//         cells for the logo itself; GRID_PAD more on every side) and the mask settings.
// Output (typed arrays, gw × gh cells):
//   cov     how much of each cell is logo (0..1)
//   sd      signed distance to the edge, in cells (negative inside)
//   nx, ny  outward edge normal
//   sm      sd lightly blurred (the water's smooth surface uses this)
//   label   which piece (connected area) an inside cell belongs to, else -1
//   pieceOf / src   the same spread a few cells past each edge: the piece, and the inside
//                   cell it was spread from (the water's swelling outline needs them)
//   count   number of pieces;  fill  share of the logo box that is logo;  maskMode used

export const GRID_PAD = 32;
export const MAX_PIECES = 64;

// Per-pixel mask value 0..1 from RGBA (0..1). Soft over ±0.06 round the threshold so
// edges stay anti-aliased.
export function maskFn(mode, threshold, invert) {
  const soft = 0.06;
  const lo = threshold - soft, hi = threshold + soft;
  const ramp = (v) => (v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo));
  if (mode === 'alpha') {
    return invert ? (r, g, b, a) => 1 - ramp(a) : (r, g, b, a) => ramp(a);
  }
  // luminance, composited over white (so transparent areas count as background)
  return (r, g, b, a) => {
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a + (1 - a);
    const v = 1 - ramp(lum);   // dark = logo
    return invert ? 1 - v : v;
  };
}

// Does this image really use transparency? (> 2% of pixels clearly see-through)
export function hasTransparency(data) {
  let clear = 0, n = 0;
  for (let i = 3; i < data.length; i += 16) { n++; if (data[i] < 128) clear++; }
  return clear > n * 0.02;
}

export function resolveMaskMode(mode, data) {
  if (mode === 'alpha' || mode === 'luma') return mode;
  return hasTransparency(data) ? 'alpha' : 'luma';
}

// 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher 2012).
function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}
// 2-D: squared distance from every cell to the nearest cell where target[i] === want.
function edt2d(target, want, w, h) {
  const INF = 1e20, out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = target[i] === want ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {             // columns
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {             // rows
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}

export function buildCore({ px, mw, mh, lw, lh, sx, opts }) {
  const P = GRID_PAD, gw = lw + 2 * P, gh = lh + 2 * P, n = gw * gh;

  // 1) coverage: the mask box-averaged over sx × sx pixels per cell
  const maskMode = resolveMaskMode(opts.mode, px);
  const cov = new Float32Array(n);
  const inv255 = 1 / 255, norm = 1 / (sx * sx);
  let total = 0;
  if (maskMode === 'alpha' && !opts.invert) {
    // fast path (drawings, most logos): straight from the alpha channel
    const lo = opts.threshold - 0.06, span = 0.12;
    for (let cy = 0; cy < lh; cy++) {
      for (let cx = 0; cx < lw; cx++) {
        let s = 0;
        for (let yy = 0; yy < sx; yy++) {
          let i = ((cy * sx + yy) * mw + cx * sx) * 4 + 3;
          for (let xx = 0; xx < sx; xx++, i += 4) {
            const a = px[i] * inv255 - lo;
            s += a <= 0 ? 0 : a >= span ? 1 : a / span;
          }
        }
        s *= norm;
        cov[(cy + P) * gw + cx + P] = s; total += s;
      }
    }
  } else {
    const f = maskFn(maskMode, opts.threshold, opts.invert);
    for (let cy = 0; cy < lh; cy++) {
      for (let cx = 0; cx < lw; cx++) {
        let s = 0;
        for (let yy = 0; yy < sx; yy++) {
          let i = ((cy * sx + yy) * mw + cx * sx) * 4;
          for (let xx = 0; xx < sx; xx++, i += 4) s += f(px[i] * inv255, px[i + 1] * inv255, px[i + 2] * inv255, px[i + 3] * inv255);
        }
        s *= norm;
        cov[(cy + P) * gw + cx + P] = s; total += s;
      }
    }
  }
  const fill = total / (lw * lh);

  // 2) signed distance (in cells) from the two distance transforms
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) inside[i] = cov[i] >= 0.5 ? 1 : 0;
  const dIn = edt2d(inside, 1, gw, gh), dOut = edt2d(inside, 0, gw, gh);
  const sd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = inside[i] ? -(Math.sqrt(dOut[i]) - 0.5) : Math.sqrt(dIn[i]) - 0.5;
    if (!(Math.abs(v) <= 1e6)) v = 1e6;          // empty mask: "infinitely" far
    sd[i] = v;
  }

  // 3) outward normals: gradient of sd (central differences), normalised
  const nx = new Float32Array(n), ny = new Float32Array(n);
  for (let y = 0; y < gh; y++) {
    const y0 = Math.max(0, y - 1) * gw, y1 = Math.min(gh - 1, y + 1) * gw, row = y * gw;
    for (let x = 0; x < gw; x++) {
      const gx = sd[row + Math.min(gw - 1, x + 1)] - sd[row + Math.max(0, x - 1)];
      const gy = sd[y1 + x] - sd[y0 + x];
      const l = Math.sqrt(gx * gx + gy * gy);
      if (l > 1e-6) { nx[row + x] = gx / l; ny[row + x] = gy / l; }
    }
  }

  // 4) pieces: connected inside areas (8-neighbour flood fill)
  const label = new Int16Array(n).fill(-1);
  const stack = new Int32Array(n);
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (!inside[s] || label[s] >= 0) continue;
    const id = Math.min(count, MAX_PIECES - 1); count++;
    let top = 0; stack[top++] = s; label[s] = id;
    while (top) {
      const c = stack[--top], cx = c % gw, cy = (c / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const y = cy + dy; if (y < 0 || y >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx; if (x < 0 || x >= gw) continue;
          const k = y * gw + x;
          if (inside[k] && label[k] < 0) { label[k] = id; stack[top++] = k; }
        }
      }
    }
  }
  count = Math.min(count, MAX_PIECES);

  // 5) spread piece (and source cell) up to 16 cells past each edge (breadth-first)
  const pieceOf = new Int16Array(label), src = new Int32Array(n).fill(-1);
  let front = new Int32Array(n), next = new Int32Array(n), fl = 0;
  for (let k = 0; k < n; k++) if (label[k] >= 0) { src[k] = k; front[fl++] = k; }
  for (let step = 0; step < 16 && fl; step++) {
    let nl = 0;
    for (let q = 0; q < fl; q++) {
      const c = front[q], cx = c % gw, cy = (c / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const y = cy + dy; if (y < 0 || y >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx; if (x < 0 || x >= gw) continue;
          const k = y * gw + x;
          if (src[k] >= 0) continue;
          src[k] = src[c]; pieceOf[k] = pieceOf[c]; next[nl++] = k;
        }
      }
    }
    [front, next] = [next, front]; fl = nl;
  }

  // 6) sd blurred (separable 3-tap box, twice): rounds the crease along each stroke's middle
  let sm = Float32Array.from(sd), tmp = new Float32Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < gh; y++) {
      const row = y * gw;
      for (let x = 0; x < gw; x++) {
        const a = sm[row + Math.max(0, x - 1)], b = sm[row + x], c = sm[row + Math.min(gw - 1, x + 1)];
        tmp[row + x] = (a + b + c) / 3;
      }
    }
    for (let y = 0; y < gh; y++) {
      const y0 = Math.max(0, y - 1) * gw, y1 = Math.min(gh - 1, y + 1) * gw, row = y * gw;
      for (let x = 0; x < gw; x++) sm[row + x] = (tmp[y0 + x] + tmp[row + x] + tmp[y1 + x]) / 3;
    }
  }

  return { lw, lh, gw, gh, cov, sd, nx, ny, sm, label, pieceOf, src, count, fill, maskMode };
}

// Typed arrays in a core result (to transfer them from the worker without copying).
export const coreBuffers = (c) => [c.cov, c.sd, c.nx, c.ny, c.sm, c.label, c.pieceOf, c.src].map((a) => a.buffer);
