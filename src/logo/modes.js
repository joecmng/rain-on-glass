// Logo interaction modes: how the uploaded logo changes the way water behaves on the glass.
//
// The drop simulation knows nothing about logos. It has one hook object, `sim.surfaceMode`,
// and calls it at a few points:
//   begin(sim, F, dt)          once per physics step (smoothing, extra water)
//   spawn(sim, x, y, r)        a raindrop is about to land; return true if the mode
//                              handled it (splashed it, moved it…), false for normal
//   spawnMist(x, y)            false = no mist droplet may form here
//   drop(x, y, r, i, sim)      for every drop: fills `this.out` (see LogoMode); i and sim
//                              let a mode hold or feed a particular drop (Water's drips)
//   mistEvap(x, y)             evaporation multiplier for a mist droplet
// The renderer reads three numbers from the active mode: frost, dry and raise.
// With the hook removed (or a mode's Effect at zero) the engine behaves exactly as before.

import { CONFIG } from '../config.js';
import { MAX_PIECES } from './fieldcore.js';   // the shader gets one fill value per piece

const rand = Math.random;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mistR = () => CONFIG.sim.mistRMin + rand() * (CONFIG.sim.mistRMax - CONFIG.sim.mistRMin);

// ── shared behaviour ────────────────────────────────────────────────────────
// drop() output, all "1 / 0 = unchanged":
//   pin, kin        multipliers on static / sliding friction
//   evap            multiplier on drying
//   drag            extra drag, 1/s
//   ax, ay          extra acceleration, u/s²
//   wall            1 = an obstacle: (nx, ny) is its outward normal; the drop can't move
//                   into it and is pushed out by `pen` units (it slides along the contour)
export class LogoMode {
  constructor(logo, key) {
    this.logo = logo;                         // LogoController (its .field is the surface map)
    this.key = key;
    this.p = { ...CONFIG.logo[key] };         // live parameters (panel sliders)
    this.out = { pin: 1, kin: 1, evap: 1, drag: 0, ax: 0, ay: 0, wall: 0, nx: 0, ny: 0, pen: 0 };
    this.rainLevel = 1;                       // smoothed rain intensity (1 = default rain)
    this.ease = 0;                            // 0 = raining, 1 = rain has stopped
    this.driveX = 0; this.driveY = 1;         // unit direction water is pushed (gravity + air)
    this.frost = 0; this.dry = 0; this.raise = 0;   // what the renderer shows
  }
  get active() { return !!this.logo.field && this.p.strength > 0; }

  _common(F, dt) {
    const rain = F.spawnRate / (CONFIG.sim.spawnRate * CONFIG.defaults.rain);
    this.rainLevel += (rain - this.rainLevel) * (1 - Math.exp(-dt / 2.5));
    this.ease = 1 - smooth(0.08, 0.45, this.rainLevel);
    const S = CONFIG.sim;
    const ax = Math.cos(F.windAngle) * S.windAccel * F.wind;
    const ay = Math.sin(F.windAngle) * S.windAccel * F.wind + S.gravity * F.gravity;
    const l = Math.hypot(ax, ay) || 1;
    this.driveX = ax / l; this.driveY = ay / l;
  }
  _clear() {
    const o = this.out;
    o.pin = 1; o.kin = 1; o.evap = 1; o.drag = 0; o.ax = 0; o.ay = 0; o.wall = 0; o.pen = 0;
    return o;
  }
  // Downstream edge (the lower edges, or the trailing edges in strong airflow): water is
  // held in a band just inside the edge until it is heavy enough to break away. Pinning
  // falls as 1/r², so only big gathered drops escape → drips.
  _edgeHold(o, q, r, band, hold) {
    const facing = q.nx * this.driveX + q.ny * this.driveY;
    if (facing > 0.25 && q.sd > -band && q.sd < r) {
      const k = smooth(-band, -band * 0.3, q.sd) * smooth(0.25, 0.7, facing) * hold;
      o.pin *= 1 + k; o.kin *= 1 + 0.5 * k;
    }
  }
  // Make the logo an obstacle for a drop outside it whose edge overlaps it.
  _wall(o, q, r) {
    const reach = r * 0.85;
    if (q.sd < reach && (q.nx || q.ny)) {
      o.wall = 1; o.nx = q.nx; o.ny = q.ny;
      o.pen = Math.min(reach - q.sd, r) * 0.5;
    }
  }
  spawn() { return false; }
  spawnMist() { return true; }
  mistEvap() { return 1; }
}

// ── Water ───────────────────────────────────────────────────────────────────
// The logo itself is made of water: one continuous body on the glass in the logo's shape,
// shaded exactly like the drops (the renderer adds it to the same water map), so you see
// the scene bend through it, its dark meniscus edge and its highlights.
//   - each stroke gets a rounded cross-section; how far in it rounds over (the profile)
//     is set from the logo's own stroke widths, so thin text and a bold tick both work
//   - Weight thickens or thins the shape (helps thin fonts read)
//
// It holds water, like a container:
//   - the logo is split into its separate pieces (the "£", the "1", the "0"); each piece
//     has its own volume of water on top of its resting state
//   - raindrops landing on a piece, and drops running into it, add their water to it
//   - a fuller piece swells: deeper water, and gravity pulls it down so the lower part
//     bulges most (the renderer reads each piece's fill)
//   - once it holds more than surface tension allows, a drop grows at its lowest point,
//     hangs, and breaks free as an ordinary raindrop that runs down the glass; the piece
//     shrinks back and fills again while it rains
//   - "down" follows gravity + airflow, so in strong wind it drips off the trailing edge
//   - when the rain stops it stops dripping and slowly settles back to its resting state

export class WaterLogo extends LogoMode {
  constructor(logo) {
    super(logo, 'water');
    this.water = 0;                 // fades in (renderer amount)
    this._strokeCells = 6; this._strokeFor = null;
    this.pieces = [];               // { area, cap, vol, fill, shown, sites: [...] }
    this.fills = new Float32Array(MAX_PIECES);   // shown fill per piece (for the shader)
    this.surf = null;               // { label, packed, version } for the renderer
    this._surfFor = null; this._driveAng = 99; this._version = 0;
    this.hanging = new Map();       // uid → hanging drip { piece, ax, ay, nx, ny (where, world), release, born, seen }
    this.fallen = new Map();        // uid → last seen: drips that let go are never re-absorbed
  }

  // ── geometry ──────────────────────────────────────────────────────────────
  // typical half stroke width of the logo, in mask-grid cells (cached per field)
  strokeCells() {
    const f = this.logo.field;
    if (f && this._strokeFor !== f) {
      const d = [];
      for (let i = 0; i < f.sd.length; i++) if (f.sd[i] < 0) d.push(-f.sd[i]);
      d.sort((a, b) => a - b);
      this._strokeCells = d.length ? Math.max(1.5, d[Math.floor(d.length * 0.9)]) : 6;
      this._strokeFor = f;
    }
    return this._strokeCells;
  }
  // world units: how far in from the outline each stroke rounds over, and the water depth
  profile() {
    const f = this.logo.field, p = this.p;
    const half = this.strokeCells() * f.cell + Math.max(0, p.weight);
    return Math.min(p.maxProfile, Math.max(3, half * p.rounding));
  }
  thick() { return Math.min(this.p.maxThick, this.profile() * this.p.thickness); }

  // For the logo's pieces (connected areas, found when the field was built), work out for
  // every cell how far "down" it sits within its piece (0 top … 1 bottom, along the current
  // gravity + airflow direction) and find each piece's drip points (its lowest edge points).
  // Packed for the renderer as RGBA floats per cell: distance, piece, height-in-piece,
  // rounded distance.
  // Rebuilt when the logo changes or "down" turns noticeably.
  surface() {
    const f = this.logo.field;
    if (!f) return null;
    const ang = Math.atan2(this.driveY, this.driveX);
    let da = Math.abs(ang - this._driveAng); if (da > Math.PI) da = 2 * Math.PI - da;
    if (this._surfFor === f && da < 0.12) return this.surf;
    const { gw, gh, sd, nx, ny } = f, n = gw * gh;
    const fresh = this._surfFor !== f;
    let label = this.surf?.label;
    if (fresh) {
      // pieces were found when the field was built (fieldcore.js, in the worker)
      label = f.label;
      const count = f.count;
      // pieces: area (cells) and capacity (in the sim's volume units, r³)
      const area = new Float64Array(MAX_PIECES);
      for (let k = 0; k < n; k++) if (label[k] >= 0) area[label[k]]++;
      const old = this.pieces, oldLabel = this.surf?.label, oldF = this._surfFor;
      this.pieces = [];
      for (let i = 0; i < Math.min(count, MAX_PIECES); i++) this.pieces.push({ area: area[i], vol: 0, fill: 0, shown: 0, sites: [], low: 0, high: 0 });
      // The shape is rebuilt often while drawing (and while strokes fade): carry each piece's
      // water over, shared out by how much of each old piece the new one covers, and keep
      // hanging drips attached to whichever piece is now under them.
      if (oldLabel && oldF && oldF.gw === gw && oldF.gh === gh) {
        const share = new Uint32Array(MAX_PIECES * MAX_PIECES);
        for (let k = 0; k < n; k++) {
          const a = label[k], b = oldLabel[k];
          if (a >= 0 && b >= 0) share[a * MAX_PIECES + b]++;
        }
        for (let key = 0; key < share.length; key++) {
          const cnt = share[key]; if (!cnt) continue;
          const a = Math.floor(key / MAX_PIECES), b = key % MAX_PIECES, ob = old[b];
          if (ob && ob.area && this.pieces[a]) this.pieces[a].vol += ob.vol * cnt / ob.area;
        }
      } else if (old.length === this.pieces.length) this.pieces.forEach((pc, i) => { pc.vol = old[i].vol; });
      for (const [uid, h] of this.hanging) {
        const k = f.cellAt(h.ax - h.nx * f.cell * 1.5, h.ay - h.ny * f.cell * 1.5);
        const L = k >= 0 ? label[k] : -1;
        if (L >= 0) h.piece = L; else this.hanging.delete(uid);
      }
    }
    // height within each piece along "down"
    const dx = this.driveX, dy = this.driveY;
    for (const pc of this.pieces) { pc.low = -Infinity; pc.high = Infinity; pc.sites = []; }
    for (let k = 0; k < n; k++) {
      const L = label[k]; if (L < 0) continue;
      const pr = (k % gw) * dx + ((k / gw) | 0) * dy, pc = this.pieces[L];
      if (pr > pc.low) pc.low = pr;
      if (pr < pc.high) pc.high = pr;
    }
    // drip points: edge cells near the bottom of each piece whose edge faces down
    const cand = this.pieces.map(() => []);
    for (let k = 0; k < n; k++) {
      const L = label[k]; if (L < 0 || sd[k] < -1.5) continue;
      const face = nx[k] * dx + ny[k] * dy;
      if (face < 0.45) continue;
      const pc = this.pieces[L], pr = (k % gw) * dx + ((k / gw) | 0) * dy;
      const span = Math.max(1, pc.low - pc.high);
      if (pr < pc.low - span * 0.18 - 2) continue;
      cand[L].push({ k, pr, face });
    }
    cand.forEach((list, L) => {
      list.sort((a, b) => b.pr - a.pr);
      const sites = this.pieces[L].sites;
      for (const c of list) {
        const cx = c.k % gw, cy = (c.k / gw) | 0;
        if (sites.some((s) => (s.cx - cx) ** 2 + (s.cy - cy) ** 2 < 14 * 14)) continue;
        sites.push({ cx, cy, nx: nx[c.k], ny: ny[c.k], w: c.pr });
        if (sites.length >= 3) break;
      }
    });
    // piece + source cell spread past each edge, and the rounded distance (worker-built)
    const pieceOf = f.pieceOf, src = f.src, sm = f.sm;
    const packed = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      packed[k * 4] = sd[k];
      packed[k * 4 + 3] = sm[k];
      const L = pieceOf[k];
      packed[k * 4 + 1] = L;
      if (L >= 0) {
        const pc = this.pieces[L], s = src[k];
        const pr = (s % gw) * dx + ((s / gw) | 0) * dy;
        packed[k * 4 + 2] = (pr - pc.high) / Math.max(1, pc.low - pc.high);
      }
    }
    this.surf = { label, piece: pieceOf, packed, version: ++this._version };
    this._surfFor = f; this._driveAng = ang;
    return this.surf;
  }

  _piece(x, y) {
    const k = this.logo.field.cellAt(x, y);
    return k < 0 || !this.surf ? -1 : this.surf.piece[k];   // includes a margin outside the edge
  }
  _cap(pc) { const c = this.logo.field.cell; return pc.area * c * c * this.p.capacity; }
  _addWater(x, y, vol) {
    const L = this._piece(x, y);
    if (L >= 0) this.pieces[L].vol += vol;
  }

  // ── per step ──────────────────────────────────────────────────────────────
  begin(sim, F, dt) {
    const p = this.p;
    this._common(F, dt);
    const want = Math.min(1, p.strength);
    this.water += (want - this.water) * (1 - Math.exp(-dt / 0.35));
    if (!this.surface()) return;
    const f = this.logo.field, now = sim.time;
    // forget drips that no longer exist (merged into another drop)
    for (const [uid, h] of this.hanging) if (now - h.seen > 0.1) this.hanging.delete(uid);
    // drip points already in use (compared by position: sites are rebuilt with the shape)
    const hangs = [...this.hanging.values()], near2 = (p.dripSize * 2.5) ** 2;
    const siteXY = (s) => [f.x0 + (s.cx + 0.5) * f.cell, f.y0 + (s.cy + 0.5) * f.cell];
    const isFree = (s) => { const [x, y] = siteXY(s); return !hangs.some((h) => (h.ax - x) ** 2 + (h.ay - y) ** 2 < near2); };
    const perPiece = new Map();
    for (const h of this.hanging.values()) perPiece.set(h.piece, (perPiece.get(h.piece) || 0) + 1);
    for (const [uid, f] of this.fallen) if (now - f.seen > 0.1) this.fallen.delete(uid);   // gone
    this.pieces.forEach((pc, L) => {
      const cap = this._cap(pc);
      // dries back toward its resting state when the rain stops (slowly while it rains)
      pc.vol -= pc.vol * dt / (p.drain * (0.25 + 0.75 * (1 - this.ease)));
      if (pc.vol > cap * 1.6) pc.vol = cap * 1.6;
      pc.fill = pc.vol / cap;
      // over the surface-tension limit: start a drip at one of its low points
      const free = pc.sites.filter(isFree);
      // one drip at a time, a second (third) only when it is well over full
      const allowed = 1 + Math.floor(Math.max(0, pc.fill - p.dripAt) / 0.5);
      if (pc.fill > p.dripAt && free.length && (perPiece.get(L) || 0) < allowed && p.drips > 0 && sim.n < sim.cap * 0.95) {
        // the lowest free point most of the time
        const s = Math.random() < 0.6 ? free[0] : free[Math.floor(Math.random() * free.length)];
        const r0 = 2.5;
        const [ax, ay] = siteXY(s);
        const j = sim.add(ax + s.nx * r0 * 0.5, ay + s.ny * r0 * 0.5, r0);
        if (j >= 0) {
          const h = { piece: L, ax, ay, nx: s.nx, ny: s.ny, born: now, seen: now, release: p.dripSize * (0.8 + Math.random() * 0.45) };
          this.hanging.set(sim.uid[j], h); hangs.push(h);
          pc.vol -= r0 * r0 * r0;
        }
      }
    });
    // what the renderer shows: eased, so a drip breaking off relaxes the bulge smoothly
    const k = 1 - Math.exp(-dt / 0.25);
    this.pieces.forEach((pc, L) => { pc.shown += (Math.max(0, pc.fill) - pc.shown) * k; this.fills[L] = pc.shown; });
  }

  // rain landing on the logo joins the body of water
  spawn(sim, x, y, r) {
    if (this.p.strength < 0.5) return false;
    const q = this.logo.field.query(x, y);
    if (q.sd - this.p.weight >= -r * 0.3) return false;
    this._addWater(x, y, r * r * r);
    return true;
  }
  spawnMist(x, y) { return this.logo.field.query(x, y).sd - this.p.weight > 0; }

  drop(x, y, r, i, sim) {
    const o = this._clear(), p = this.p;
    // a hanging drip: held at its drip point, fed from its piece, then let go
    if (sim && this.hanging.size) {
      const h = this.hanging.get(sim.uid[i]);
      if (h) return this._hang(o, h, r, i, sim);
    }
    if (this.fallen.size && sim && this.fallen.has(sim.uid[i])) {
      // a drip that let go: never re-absorbed, and slick for its first second so it falls
      // clear of the drip point instead of stalling there (the next drip would merge into it)
      const f = this.fallen.get(sim.uid[i]);
      f.seen = sim.time;
      if (sim.time - f.t < 1) { o.pin = 0.15; o.kin = 0.15; }
      return o;
    }
    const q = this.logo.field.query(x, y);
    const sd = q.sd - p.weight;
    if (!q.near || sd > r) return o;
    // touching the logo's water (overlapping its edge by more than a quarter): it is caught
    // and drains into its piece, shrinking away in ~½ s while the shared water field shows
    // it fused with the logo. (Drops just grazing the edge stay separate.)
    if (sd < r * 0.75 && p.strength >= 0.5) {
      const EV = 1500;
      o.evap = 1 + EV; o.drag = 40; o.pin = 6; o.kin = 6;
      const r1 = Math.max(0, r - CONFIG.sim.evap * (1 + EV) * (sim ? sim._dt : 0));
      // a big logo catches every stream running down the glass, so only part of that
      // water counts toward filling it (otherwise it would drip non-stop)
      this._addWater(x, y, (r * r * r - r1 * r1 * r1) * p.catch);
    }
    return o;
  }

  _hang(o, h, r, i, sim) {
    const pc = this.pieces[h.piece], p = this.p;
    if (!pc) { this.hanging.delete(sim.uid[i]); return o; }
    const dt = sim._dt;
    h.seen = sim.time;
    // grow from the piece's spare water
    const spare = pc.vol - this._cap(pc) * 0.15;
    if (spare > 0 && r < h.release) {
      const dv = Math.min(spare, Math.max(500, spare * 3) * dt);
      const r2 = Math.cbrt(r * r * r + dv);
      pc.vol -= r2 * r2 * r2 - r * r * r;
      sim.r[i] = r = r2;
    }
    // hang from the edge: centre a little outside it, so drop and logo stay joined by a neck
    const out = r * 0.55 + p.weight;
    sim.x[i] = h.ax + h.nx * out; sim.y[i] = h.ay + h.ny * out;
    sim.vx[i] = 0; sim.vy[i] = 0;
    o.pin = 1e3; o.kin = 1e3;
    // starved before it got heavy: it draws back into the logo
    if (sim.time - h.born > 3 && r < h.release * 0.6) {
      this.hanging.delete(sim.uid[i]);
      pc.vol += r * r * r; sim.dead[i] = 1;
      return o;
    }
    // heavy enough (or nothing left to feed it): it lets go and runs down the glass
    if (r >= h.release || (spare <= 0 && r > h.release * 0.6) || sim.time - h.born > 3) {
      this.hanging.delete(sim.uid[i]);
      this.fallen.set(sim.uid[i], { t: sim.time, seen: sim.time });
      sim.stuck[i] = 0; sim.hold[i] = 0; sim.stall[i] = -0.9;
      sim.vx[i] = this.driveX * 140; sim.vy[i] = this.driveY * 140;
      sim.x[i] += h.nx * r * 0.4; sim.y[i] += h.ny * r * 0.4;
      o.pin = 0.3; o.kin = 0.3;
    }
    return o;
  }

  mistEvap(x, y) { return this.logo.field.query(x, y).sd - this.p.weight < 0 ? 40 : 1; }
}

// ── Invisible Glass ─────────────────────────────────────────────────────────
// The logo is printed on the glass in a clear water-repellent coating: you can't see it
// when the glass is dry. Rain landing on it beads up into lots of small round drops that
// cling, and the wet film there breaks into frosted micro-beads, so the logo appears,
// drawn in beaded water, only while it rains.
//   - on the logo: drops pin harder (cling), slide slower and evaporate more slowly;
//     extra beads form there; merged beads roll off so it never fills with blobs
//   - along the downstream edges water gathers until it drips
//   - when the rain eases the beads dry up and the logo fades away again
export class InvisibleGlass extends LogoMode {
  constructor(logo) {
    super(logo, 'invisible');
    this.beadAcc = 0; this.mistAcc = 0; this.beadR = 3;
    this.onLogo = 0; this._count = 0;         // drops currently on the logo (bead budget)
    // occupancy grid over the logo box (cells ≈ one bead across), filled by drop() during
    // a step and read by begin() on the next, so new beads land on free glass instead of
    // on top of existing ones (which would just merge them into blobs)
    this.occ = new Uint8Array(0); this.ocols = 0; this.orows = 0; this.ocell = 1; this.ox = 0; this.oy = 0;
  }

  begin(sim, F, dt) {
    const p = this.p, f = this.logo.field;
    this._common(F, dt);
    this.onLogo = this._count; this._count = 0;
    // micro-bead frosting: builds up over ~fillTime while it rains, dries off when it eases
    const want = p.frost * Math.min(1, p.strength) * smooth(0.05, 0.6, this.rainLevel);
    const tau = want > this.frost ? p.fillTime * 0.5 : 100 / Math.max(1, p.fadeEvap);
    this.frost += (want - this.frost) * (1 - Math.exp(-dt / tau));

    // Extra beads on the logo. The bead size is chosen so a fixed budget of drops covers
    // the logo evenly (`coverage` of its area): a big logo gets bigger beads rather than
    // more of them than the simulation can afford. Beads are topped up to that count at a
    // rate set by `fillTime`, in proportion to the rain.
    const b = f.bounds();
    const area = b.w * b.h * f.fill;                                   // logo area, u²
    const budget = Math.max(30, sim.cap * p.beadBudget);
    const cover = Math.min(0.6, p.coverage * p.density);
    this.beadR = Math.min(p.beadRMax, Math.max(p.beadRMin, Math.sqrt(cover * area / (Math.PI * budget))));
    const target = Math.min(budget, cover * area / (Math.PI * this.beadR * this.beadR));
    const rainK = p.strength * Math.min(1.6, this.rainLevel);
    this.beadAcc += (target / p.fillTime) * rainK * dt;
    this.mistAcc += p.mist * p.density * rainK * (area / 1e6) * dt;  // fine spray
    let nb = Math.floor(this.beadAcc); this.beadAcc -= nb;
    let nm = Math.floor(this.mistAcc); this.mistAcc -= nm;
    if (this.onLogo >= target || sim.n > sim.cap * 0.92) nb = 0;     // leave room for the rain
    const occ = this.occ, oc = this.ocell, ocols = this.ocols, orows = this.orows, ox0 = this.ox, oy0 = this.oy;
    for (let tries = 0; (nb > 0 || nm > 0) && tries < (nb + nm) * 8; tries++) {
      const x = b.x + rand() * b.w, y = b.y + rand() * b.h;
      const q = f.query(x, y);
      if (q.cov < 0.5) continue;
      if (nb > 0) {
        const ci = Math.floor((x - ox0) / oc), cj = Math.floor((y - oy0) / oc);
        if (ci >= 0 && cj >= 0 && ci < ocols && cj < orows) {
          const k = cj * ocols + ci;
          if (occ[k]) continue;                               // already a bead here
          occ[k] = 1;
        }
        nb--;
        sim.add(x, y, this.beadR * (0.55 + 0.75 * rand()));
      } else {
        nm--;
        sim.addMist(x, y, mistR());
      }
    }
    // fresh occupancy grid for drop() to fill during this step
    const cell = this.beadR * 2.4;
    const cols = Math.ceil(b.w / cell) + 1, rows = Math.ceil(b.h / cell) + 1;
    if (this.occ.length < cols * rows) this.occ = new Uint8Array(cols * rows);
    else this.occ.fill(0, 0, cols * rows);
    this.ocols = cols; this.orows = rows; this.ocell = cell; this.ox = b.x; this.oy = b.y;
  }

  drop(x, y, r) {
    const o = this._clear(), p = this.p;
    const q = this.logo.field.query(x, y);
    if (!q.near || q.sd > r) return o;
    const s = p.strength;
    const on = smooth(0.15, 0.85, q.cov) * s;                  // 0 off the logo … 1 on it
    if (on > 0.5) this._count++;
    // mark the cells this drop covers as taken
    {
      const c = this.ocell, R = r > c * 0.5 ? Math.ceil((r - c * 0.5) / c) : 0;
      const ci = Math.floor((x - this.ox) / c), cj = Math.floor((y - this.oy) / c);
      for (let j = cj - R; j <= cj + R; j++) {
        if (j < 0 || j >= this.orows) continue;
        for (let i = ci - R; i <= ci + R; i++) if (i >= 0 && i < this.ocols) this.occ[j * this.ocols + i] = 1;
      }
    }
    // the coating: small beads cling and barely move; once beads have merged into a big
    // drop it rolls off easily (high contact angle), so the logo stays covered in even,
    // separate beads instead of filling up with big blobs
    const big = this.beadR * 1.6;
    const small = 1 - smooth(big, big * 2, r);                 // 1 = bead, 0 = big drop
    o.pin = (1 + p.cling * on * small) * (1 - p.rollOff * on * (1 - small));
    o.kin = (1 + p.cling * 0.6 * on * small) * (1 - p.rollOff * on * (1 - small));
    o.drag = p.slide * on * (0.4 + 0.6 * small);
    // slower drying while it rains; once it eases, the beads dry off and the logo fades
    o.evap = 1 + on * (-p.slowEvap + this.ease * p.fadeEvap);
    this._edgeHold(o, q, r, p.edgeBand, p.edgeHold * s);
    return o;
  }

  mistEvap(x, y) {
    const q = this.logo.field.query(x, y);
    if (!q.near || q.cov < 0.05) return 1;
    const on = smooth(0.15, 0.85, q.cov) * this.p.strength;
    return Math.max(0.05, 1 + on * (-this.p.slowEvap + this.ease * this.p.fadeEvap));
  }
}

// ── Raised Object ───────────────────────────────────────────────────────────
// A glossy emblem stuck on the outside of the glass, standing slightly proud of it.
//   - rain hitting the emblem splashes: the drop breaks into a few smaller ones thrown
//     outward, some landing on the emblem, some on the glass around it
//   - its top is slick: water runs across it quickly toward the downstream edge, where it
//     hangs in a band, gathers and drips off
//   - for water on the glass it's an obstacle: drops arriving from upstream can't cross
//     it, so they run along its contour and round it
export class RaisedObject extends LogoMode {
  constructor(logo) { super(logo, 'raised'); }

  begin(sim, F, dt) {
    this._common(F, dt);
    const want = Math.min(1, this.p.strength);
    this.raise += (want - this.raise) * (1 - Math.exp(-dt / 0.3));   // fade in/out on switch
  }

  spawn(sim, x, y, r) {
    const p = this.p, f = this.logo.field;
    const q = f.query(x, y);
    if (q.cov < 0.5 || rand() > p.splash * Math.min(1, p.strength)) return false;
    // splash: 2–4 smaller drops (same total water) thrown outward from the impact
    const k = 2 + Math.floor(rand() * 3);
    const rk = r / Math.cbrt(k);
    for (let i = 0; i < k; i++) {
      const a = rand() * Math.PI * 2, d = r * (1.2 + rand() * 2.5) * p.spread;
      sim.add(x + Math.cos(a) * d, y + Math.sin(a) * d, rk * (0.75 + rand() * 0.4));
    }
    // and a little fine spray round the impact (on the glass only)
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2, d = r * (2 + rand() * 4) * p.spread;
      const mx = x + Math.cos(a) * d, my = y + Math.sin(a) * d;
      if (f.query(mx, my).cov < 0.5) sim.addMist(mx, my, mistR());
    }
    return true;
  }

  spawnMist(x, y) { return this.logo.field.query(x, y).cov < 0.5; }   // none on the emblem

  drop(x, y, r) {
    const o = this._clear(), p = this.p, s = Math.min(1, p.strength);
    const q = this.logo.field.query(x, y);
    if (!q.near || q.sd > r) return o;
    if (q.sd < 0) {
      // on the emblem: slick glossy surface
      const on = smooth(0, -4, q.sd) * s;
      o.pin = 1 - (1 - p.slick) * on;
      o.kin = o.pin;
      this._edgeHold(o, q, r, p.edgeBand, p.edgeHold * s);
    } else if (s > 0.5) {
      this._wall(o, q, r);           // on the glass beside it: can't climb onto it
    }
    return o;
  }

  mistEvap(x, y) { return this.logo.field.query(x, y).cov >= 0.5 ? 20 : 1; }
}

// ── Water-Repellent ─────────────────────────────────────────────────────────
// The logo is a strongly water-repellent patch: it stays completely dry.
//   - rain landing on it skitters straight off to the nearest edge
//   - drops on the glass are kept out and steer round it
//   - water collects in beads all along the outline
//   - no condensation forms on it, so it shows as a clear silhouette in the fog
export class WaterRepellent extends LogoMode {
  constructor(logo) { super(logo, 'repellent'); }

  begin(sim, F, dt) {
    this._common(F, dt);
    const want = Math.min(1, this.p.strength) * this.p.dryness;
    this.dry += (want - this.dry) * (1 - Math.exp(-dt / 0.3));
  }

  // rain landing on the patch: moved out to just beyond the nearest edge (it beads there)
  spawn(sim, x, y, r) {
    if (this.p.strength < 0.5) return false;
    const q = this.logo.field.query(x, y);
    if (q.sd >= 0 || !(q.nx || q.ny)) return false;
    const d = -q.sd + r * (0.6 + rand() * 0.8);
    sim.add(x + q.nx * d, y + q.ny * d, r);
    return true;
  }

  spawnMist(x, y) { return this.logo.field.query(x, y).sd > 0; }

  drop(x, y, r) {
    const o = this._clear(), p = this.p, s = Math.min(1, p.strength);
    const q = this.logo.field.query(x, y);
    if (!q.near || q.sd > r + p.outline) return o;
    if (q.sd < 0) {
      // inside (e.g. was there when the mode switched on): pushed out, no grip at all
      o.ax = q.nx * p.repel * s; o.ay = q.ny * p.repel * s;
      o.pin = 1 - 0.9 * s; o.kin = o.pin;
      o.evap = 1 + 10 * s;
      return o;
    }
    // just outside: beads cling along the outline
    const band = smooth(r + p.outline, r * 0.5, q.sd) * s;
    o.pin = 1 + p.beading * band;
    o.kin = 1 + p.beading * 0.6 * band;
    if (s > 0.5) this._wall(o, q, r);
    return o;
  }

  mistEvap(x, y) { return this.logo.field.query(x, y).sd < 0 ? 40 : 1; }
}

export function createModes(logo) {
  return { water: new WaterLogo(logo), invisible: new InvisibleGlass(logo), raised: new RaisedObject(logo), repellent: new WaterRepellent(logo) };
}

export const MODE_NAMES = { water: 'Water', invisible: 'Invisible Glass', raised: 'Raised Object', repellent: 'Water-Repellent' };
