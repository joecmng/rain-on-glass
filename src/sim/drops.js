import { CONFIG } from '../config.js';
import { curl2, simplex3, SurfaceField } from './noise.js';

const S = CONFIG.sim;
export const KIND_DROP = 0;
export const KIND_TRAIL = 1;
export const KIND_GHOST = 2;   // a drop being drawn into a bigger one (coalescing)
export const FLOATS_PER_INSTANCE = 8; // [x, y, r, angle] [stretch, taper, seed, wobble]

const rand = Math.random;
const gauss = () => (rand() + rand() + rand() - 1.5) * 1.41;
const DROP_F = ['x', 'y', 'vx', 'vy', 'r', 'pin', 'stall', 'hold', 'dist', 'ang', 'str', 'tap', 'seed', 'spd', 'hdg', 'path', 'pw', 'pend', 'ox', 'oy'];
const DROP_I = ['uid', 'tgt'];
const DROP_U = ['stuck', 'kind', 'dead'];
const MIST_F = ['mx', 'my', 'mr', 'mseed'];

// Uniform-grid spatial hash rebuilt every step with a counting sort.
// Coarse map of recent wet tracks: how wet each cell is, which way the water ran,
// and which drop laid it. Fades at the same rate as the visible streaks. Lets a
// sliding drop "feel" an existing track just ahead of it and get drawn into it.
class TrackField {
  constructor(cell) { this.cs = cell; this.cols = 1; this.rows = 1; }
  resize(W, H) {
    this.cols = Math.ceil(W / this.cs) + 2;
    this.rows = Math.ceil(H / this.cs) + 2;
    const n = this.cols * this.rows;
    this.wet = new Float32Array(n); this.dx = new Float32Array(n); this.dy = new Float32Array(n);
    this.owner = new Int32Array(n);
    this.active = false;
  }
  decay(f) {
    if (!this.active) return;
    const w = this.wet; let any = false;
    for (let i = 0; i < w.length; i++) { if (w[i] > 0.01) { w[i] *= f; any = true; } else w[i] = 0; }
    this.active = any;
  }
  deposit(x, y, rad, ux, uy, uid) {
    const cs = this.cs, R = Math.ceil(rad / cs);
    const cx = Math.floor(x / cs) + 1, cy = Math.floor(y / cs) + 1;
    for (let j = cy - R; j <= cy + R; j++) {
      if (j < 0 || j >= this.rows) continue;
      for (let i = cx - R; i <= cx + R; i++) {
        if (i < 0 || i >= this.cols) continue;
        const px = (i - 1 + 0.5) * cs - x, py = (j - 1 + 0.5) * cs - y;
        if (px * px + py * py > rad * rad) continue;
        const k = j * this.cols + i;
        this.wet[k] = 1; this.dx[k] = ux; this.dy[k] = uy; this.owner[k] = uid;
      }
    }
    this.active = true;
  }
  // wettest cell within rad of (x, y) laid by another drop; out = [dirX, dirY, offX, offY]
  // where off is that cell's centre relative to (ox, oy)
  sample(x, y, rad, uid, ox, oy, out) {
    if (!this.active) return 0;
    const cs = this.cs, R = Math.ceil(rad / cs);
    const cx = Math.floor(x / cs) + 1, cy = Math.floor(y / cs) + 1;
    let best = 0;
    for (let j = cy - R; j <= cy + R; j++) {
      if (j < 0 || j >= this.rows) continue;
      for (let i = cx - R; i <= cx + R; i++) {
        if (i < 0 || i >= this.cols) continue;
        const k = j * this.cols + i;
        const w = this.wet[k];
        if (w <= best || this.owner[k] === uid) continue;
        const px = (i - 1 + 0.5) * cs, py = (j - 1 + 0.5) * cs;
        if ((px - x) * (px - x) + (py - y) * (py - y) > rad * rad) continue;
        best = w; out[0] = this.dx[k]; out[1] = this.dy[k]; out[2] = px - ox; out[3] = py - oy;
      }
    }
    return best;
  }
}

class Grid {
  constructor(cell) { this.cs = cell; this.cols = 1; this.rows = 1; this.items = new Int32Array(0); this.cellIdx = new Int32Array(0); }
  resize(W, H, cap) {
    this.cols = Math.ceil(W / this.cs) + 3;
    this.rows = Math.ceil(H / this.cs) + 3;
    const cells = this.cols * this.rows;
    this.start = new Int32Array(cells + 1);
    this.cursor = new Int32Array(cells + 1);
    if (this.items.length < cap) { this.items = new Int32Array(cap); this.cellIdx = new Int32Array(cap); }
  }
  cx(x) { const c = Math.floor(x / this.cs) + 1; return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c; }
  cy(y) { const c = Math.floor(y / this.cs) + 1; return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c; }
  build(xs, ys, n) {
    const { start, cursor, items, cellIdx, cols } = this;
    start.fill(0);
    for (let i = 0; i < n; i++) { const c = this.cy(ys[i]) * cols + this.cx(xs[i]); cellIdx[i] = c; start[c + 1]++; }
    for (let c = 0; c < start.length - 1; c++) start[c + 1] += start[c];
    cursor.set(start);
    for (let i = 0; i < n; i++) items[cursor[cellIdx[i]]++] = i;
  }
}

export class DropSim {
  constructor() {
    this.W = 1778; this.H = S.worldHeight;
    this.n = 0; this.cap = 0; this.mn = 0; this.mcap = 0; this.nextId = 1;
    this.time = 0; this.spawnAcc = 0; this.mistAcc = 0;
    this.surface = new SurfaceField(128, S.surfaceAmp, S.surfaceCell);
    this.grid = new Grid(S.gridCell);
    this.mgrid = new Grid(S.gridCell);
    this.track = new TrackField(S.trackCell);
    this._tr = [0, 0, 0, 0];
    this._curl = [0, 0];
    this.instanceCount = 0; this.wetCount = 0;
    this.stats = { moving: 0 };
    this.style = CONFIG.streakStyles[CONFIG.defaultStreakStyle];
  }

  setStyle(name) { this.style = CONFIG.streakStyles[name] || this.style; }

  setCapacity(maxDrops, maxMist) {
    const keep = Math.min(this.n, maxDrops), mkeep = Math.min(this.mn, maxMist);
    for (const f of DROP_F) { const a = new Float32Array(maxDrops); if (this[f]) a.set(this[f].subarray(0, keep)); this[f] = a; }
    for (const f of DROP_U) { const a = new Uint8Array(maxDrops); if (this[f]) a.set(this[f].subarray(0, keep)); this[f] = a; }
    for (const f of DROP_I) { const a = new Int32Array(maxDrops); if (this[f]) a.set(this[f].subarray(0, keep)); this[f] = a; }
    for (const f of MIST_F) { const a = new Float32Array(maxMist); if (this[f]) a.set(this[f].subarray(0, mkeep)); this[f] = a; }
    this.mdead = new Uint8Array(maxMist);
    this.n = keep; this.mn = mkeep; this.cap = maxDrops; this.mcap = maxMist;
    this.instances = new Float32Array((maxDrops + maxMist) * FLOATS_PER_INSTANCE);
    this.wet = new Float32Array(maxDrops * FLOATS_PER_INSTANCE);
    this.grid.resize(this.W, this.H, maxDrops);
    this.mgrid.resize(this.W, this.H, maxMist);
  }

  resize(aspect) {
    const oldW = this.W;
    this.W = S.worldHeight * aspect;
    // keep drops spread over the glass when the window changes shape
    if (oldW > 0 && Math.abs(oldW - this.W) > 1) {
      const k = this.W / oldW;
      for (let i = 0; i < this.n; i++) this.x[i] *= k;
      for (let i = 0; i < this.mn; i++) this.mx[i] *= k;
    }
    this.grid.resize(this.W, this.H, this.cap);
    this.mgrid.resize(this.W, this.H, this.mcap);
    this.track.resize(this.W, this.H);
  }

  add(x, y, r, kind = KIND_DROP) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = 0; this.vy[i] = 0; this.r[i] = r;
    this.pin[i] = S.pinMin + rand() * (S.pinMax - S.pinMin);
    this.stall[i] = 0;
    this.hold[i] = kind === KIND_TRAIL ? 1e9 : S.holdMin + rand() * (S.holdMax - S.holdMin);
    this.dist[i] = 0; this.ang[i] = rand() * Math.PI * 2;
    this.str[i] = 0.04 + rand() * 0.14; this.tap[i] = 0; this.seed[i] = rand(); this.spd[i] = 0; this.hdg[i] = 0; this.path[i] = rand() * 1000; this.pw[i] = 0;
    this.pend[i] = 0; this.ox[i] = 0; this.oy[i] = 0; this.uid[i] = this.nextId++; this.tgt[i] = -1;
    this.stuck[i] = 1; this.kind[i] = kind; this.dead[i] = 0;
    return i;
  }

  addMist(x, y, r) {
    if (this.mn >= this.mcap) return;
    const i = this.mn++;
    this.mx[i] = x; this.my[i] = y; this.mr[i] = r; this.mseed[i] = rand(); this.mdead[i] = 0;
  }

  randomRadius() { return S.spawnRMin + (S.spawnRMax - S.spawnRMin) * Math.pow(rand(), S.spawnBias); }

  prefill() {
    for (let k = 0; k < S.prefillDrops; k++) this.add(rand() * this.W, rand() * this.H, this.randomRadius());
    for (let k = 0; k < S.prefillMist; k++) this.addMist(rand() * this.W, rand() * this.H, S.mistRMin + rand() * (S.mistRMax - S.mistRMin));
  }

  // Beat/onset: some stuck drops let go (bigger ones are likelier to).
  release(strength) {
    const { n, stuck, kind, r, hold, stall } = this;
    for (let i = 0; i < n; i++) {
      if (!stuck[i] || kind[i] !== KIND_DROP) continue;
      const p = strength * S.releaseProb * (r[i] / S.rRef);
      if (rand() < p) { hold[i] = 0; stall[i] = Math.min(stall[i], -S.releaseKick); }
    }
  }

  step(dt, F) {
    this.time += dt;
    const t = this.time;
    const W = this.W, H = this.H;

    // ── spawn rain + mist ───────────────────────────────────────────────
    this.spawnAcc += F.spawnRate * dt;
    let k = Math.floor(this.spawnAcc); this.spawnAcc -= k;
    k += F.burst | 0;
    while (k-- > 0) this.add(rand() * W, rand() * H, this.randomRadius());
    this.mistAcc += F.mistRate * dt;
    let mk = Math.floor(this.mistAcc); this.mistAcc -= mk;
    while (mk-- > 0) this.addMist(rand() * W, rand() * H, S.mistRMin + rand() * (S.mistRMax - S.mistRMin));
    if (F.releaseEvent > 0) this.release(F.releaseEvent);

    const { x, y, vx, vy, r, pin, stall, hold, dist, ang, str, tap, seed, spd, hdg, path, stuck, kind, dead } = this;
    const rRef = S.rRef;
    const wdx = Math.cos(F.windAngle), wdy = Math.sin(F.windAngle);
    const windAcc = S.windAccel * F.wind;
    const g = S.gravity * F.gravity;
    const turbAcc = S.turbAccel * F.turbulence;
    const pinBase = S.pinAccel * F.pinScale;
    const stallDecay = Math.exp(-S.stallDecay * dt);
    const drag = Math.exp(-S.drag * dt);
    const shapeK = Math.min(1, dt * S.stretchResponse);
    const curl = this._curl;
    const st = this.style;
    // coalescence rates: water moves with time constant mergeTime; the ghost closes in more slowly
    const cmk = 1 - Math.exp(-dt / S.mergeTime);
    const cmk2 = 1 - Math.exp(-dt / (S.mergeTime * S.mergePull));
    const cmkR = Math.cbrt(1 - cmk);
    this.track.decay(Math.exp(-dt / st.fade));
    const tr = this._tr, track = this.track;
    this._buildIdMap();
    const n0 = this.n;
    let moving = 0;

    for (let i = 0; i < n0; i++) {
      if (dead[i]) continue;
      if (kind[i] === KIND_GHOST) {
        // flow into the drop that absorbed it: slide toward its centre while shrinking;
        // the shared water field draws a neck between them that pulls in and closes
        const j = this._target(this.tgt[i]);
        if (j < 0) { dead[i] = 1; continue; }
        x[i] += (x[j] - x[i]) * cmk2; y[i] += (y[j] - y[i]) * cmk2;
        r[i] *= cmkR;
        // once it has sunk well inside the bigger drop it is just part of it: remove
        // (its water is already on the way in via pend), so no ring remains inside
        const gx = x[j] - x[i], gy = y[j] - y[i], inner = Math.max(0, r[j] - r[i]) * 0.55;
        if (r[i] < 0.6 || gx * gx + gy * gy < inner * inner) dead[i] = 1;
        continue;
      }
      if (this.pend[i] > 0) {
        // receive the absorbed water gradually; the centre drifts toward the new centroid
        const dv = this.pend[i] * cmk;
        this.pend[i] -= dv;
        r[i] = Math.min(S.rMax, Math.cbrt(r[i] * r[i] * r[i] + dv));
        x[i] += this.ox[i] * cmk; y[i] += this.oy[i] * cmk;
        this.ox[i] -= this.ox[i] * cmk; this.oy[i] -= this.oy[i] * cmk;
        if (this.pend[i] < 0.05) { r[i] = Math.min(S.rMax, Math.cbrt(r[i] * r[i] * r[i] + this.pend[i])); this.pend[i] = 0; }
      }
      if (kind[i] === KIND_TRAIL) {
        r[i] -= S.trailEvap * dt;
        if (r[i] < S.minR) dead[i] = 1;
        continue;
      }
      let ri = r[i] - S.evap * dt;
      if (ri < S.minR) { dead[i] = 1; continue; }
      r[i] = ri;

      const inv = rRef / ri;
      let ax = wdx * windAcc * inv;
      let ay = wdy * windAcc * inv + g;
      stall[i] *= stallDecay;
      const pinTh = pinBase * inv * inv * pin[i] * this.surface.sample(x[i], y[i]) * Math.max(0.15, 1 + stall[i]);

      if (stuck[i]) {
        hold[i] -= dt;
        // relax shape toward a resting bead (keeps last travel direction)
        str[i] += (0.08 - str[i]) * shapeK; tap[i] += (0 - tap[i]) * shapeK; spd[i] *= 0.9;
        if (hold[i] > 0 || ax * ax + ay * ay < pinTh * pinTh) continue;
        stuck[i] = 0;
        // breaking free: set off in a slightly new direction
        hdg[i] = Math.max(-S.kinkMax, Math.min(S.kinkMax, hdg[i] * 0.4 + gauss() * S.kinkAngle));
      }
      // the drop runs along its own heading: drive force rotated by hdg
      { const c = Math.cos(hdg[i]), s = Math.sin(hdg[i]); const rx = ax * c - ay * s; ay = ax * s + ay * c; ax = rx; }

      // turbulent airflow (curl noise): eddies make sliding drops weave
      if (turbAcc > 0) {
        curl2(x[i] * S.curlScale, y[i] * S.curlScale, t * S.curlSpeed, curl);
        const tk = turbAcc * Math.sqrt(inv);
        ax += curl[0] * tk; ay += curl[1] * tk;
      }

      let vxi = vx[i] + ax * dt, vyi = vy[i] + ay * dt;
      let sp = Math.hypot(vxi, vyi);
      const kin = pinTh * S.kineticRatio;
      if (sp > 1e-6) {
        const ns = Math.max(0, sp - kin * dt) * drag;
        const sc = ns / sp; vxi *= sc; vyi *= sc; sp = ns;
      }
      if (sp < S.stopSpeed && Math.hypot(ax, ay) < kin * 1.05) {
        stuck[i] = 1; vx[i] = 0; vy[i] = 0;
        hold[i] = S.holdMin + rand() * (S.holdMax - S.holdMin);
        continue;
      }
      moving++;

      // wet-track capture: a drop running into another drop's track at a shallow
      // enough angle is drawn into it, as on real glass: it turns to follow the
      // track, slides onto its centre line and runs a little faster (pre-wetted
      // glass pins less). Steep crossings still cut across.
      if (S.capture && sp > 1e-3) {
        const ux = vxi / sp, uy = vyi / sp, look = ri * 0.9;
        const wv = track.sample(x[i] + ux * look, y[i] + uy * look, ri * 0.85, this.uid[i], x[i], y[i], tr);
        if (wv > S.captureMin) {
          let tx = tr[0], ty = tr[1];
          if (tx * ux + ty * uy < 0) { tx = -tx; ty = -ty; }   // follow it the way we're going
          if (tx * ux + ty * uy > S.captureMaxCos) {
            const k = Math.min(1, S.captureSteer * wv * dt);
            let nx = ux + (tx - ux) * k, ny = uy + (ty - uy) * k;
            const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
            sp *= 1 + S.captureBoost * wv * dt;
            vxi = nx * sp; vyi = ny * sp;
            const lat = tr[2] * -ny + tr[3] * nx;              // sideways offset to the track centre
            const kp = Math.min(1, S.capturePull * wv * dt);
            x[i] += -ny * lat * kp; y[i] += nx * lat * kp;
            // keep the drive aligned with the new direction so it carries on along the track
            const turn = Math.atan2(ux * ny - uy * nx, ux * nx + uy * ny);
            hdg[i] = Math.max(-1.2, Math.min(1.2, hdg[i] + turn));
          }
        }
      }

      // random pinning defect → stall, drop gathers mass, then breaks away
      if (rand() < S.stallRate * dt) stall[i] = Math.max(stall[i], S.stallBoost * rand());

      // snag: the drop catches on something, loses speed and lurches off at a new
      // angle → straight runs joined by sharp kinks (mids → more/larger kinks)
      const tk = 0.5 + Math.min(1.5, F.turbulence);
      if (rand() < S.kinkRate * tk * dt) {
        const nh = Math.max(-S.kinkMax, Math.min(S.kinkMax, hdg[i] * 0.35 + gauss() * S.kinkAngle * tk));
        const d = nh - hdg[i], c = Math.cos(d), s = Math.sin(d);
        const rx = (vxi * c - vyi * s) * S.kinkSlow; vyi = (vxi * s + vyi * c) * S.kinkSlow; vxi = rx;
        sp *= S.kinkSlow; hdg[i] = nh;
      }

      // lateral wobble (perpendicular to motion)
      let px = 0, py = 0;
      if (sp > 1e-3) {
        const w = Math.sin(t * S.wobbleFreq * (0.7 + seed[i] * 0.6) + seed[i] * 50) * S.wobbleAmp * Math.min(1.5, F.turbulence + 0.3) * sp;
        px = (-vyi / sp) * w; py = (vxi / sp) * w;
      }
      vx[i] = vxi; vy[i] = vyi;
      x[i] += (vxi + px) * dt; y[i] += (vyi + py) * dt;
      spd[i] = sp;
      path[i] += sp * dt;
      if (sp > S.wetMinSpeed && ri > S.trailMinR) track.deposit(x[i], y[i], ri * st.width * 1.1, vxi / sp, vyi / sp, this.uid[i]);

      // shape: elongate + taper along motion
      const tAng = Math.atan2(vyi + py, vxi + px);
      let da = tAng - ang[i];
      da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
      ang[i] += da * Math.min(1, dt * 14);
      const tStr = Math.min(st.maxStretch, sp / (ri * st.stretchK));
      str[i] += (tStr - str[i]) * shapeK;
      tap[i] += (Math.min(1, sp / 60) - tap[i]) * shapeK;

      // trails: leave droplets behind, losing volume
      if (sp > S.trailMinSpeed && ri > S.trailMinR) {
        dist[i] += sp * dt;
        const spacing = st.trailSpacing * ri;
        while (dist[i] > spacing && this.n < this.cap) {
          dist[i] -= spacing;
          const tr = ri * (st.trailFracMin + rand() * (st.trailFracMax - st.trailFracMin));
          const rn = Math.cbrt(Math.max(0, ri * ri * ri - tr * tr * tr));
          const ca = Math.cos(ang[i]), sa = Math.sin(ang[i]);
          const back = (ri * (1 + str[i] * 0.7) + tr) * 1.08;
          const side = (rand() - 0.5) * ri * 0.25;
          const j = this.add(x[i] - ca * back - sa * side, y[i] - sa * back + ca * side, tr, KIND_TRAIL);
          if (j >= 0) { ri = rn; r[i] = rn; this.ang[j] = ang[i]; this.str[j] = 0.15; }
        }
      }
      // oversized drops shed extra
      if (ri > S.rMax) r[i] = S.rMax;

      if (x[i] < -60 || x[i] > W + 60 || y[i] < -60 || y[i] > H + 60) dead[i] = 1;
    }
    this.stats.moving = moving;

    this._merge();
    this._absorbMist();
    this._evaporateMist(dt);
    this._compact();
  }

  // uid → index for this step (indices shift on compaction; uids are stable)
  _buildIdMap() {
    const m = this.idMap || (this.idMap = new Map());
    m.clear();
    for (let i = 0; i < this.n; i++) if (!this.dead[i]) m.set(this.uid[i], i);
  }
  // the live drop a ghost is flowing into (following chains if that drop is itself merging)
  _target(id) {
    for (let hop = 0; hop < 4; hop++) {
      const j = this.idMap.get(id);
      if (j === undefined || this.dead[j]) return -1;
      if (this.kind[j] !== KIND_GHOST) return j;
      id = this.tgt[j];
    }
    return -1;
  }

  _merge() {
    const { x, y, vx, vy, r, stuck, kind, dead, stall, hold, str } = this;
    const n = this.n, grid = this.grid;
    grid.build(x, y, n);
    const { start, items, cols, rows } = grid;
    const md = S.mergeDist;
    for (let i = 0; i < n; i++) {
      if (dead[i] || kind[i] === KIND_GHOST) continue;
      const cx = grid.cx(x[i]), cy = grid.cy(y[i]);
      outer:
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        if (gy < 0 || gy >= rows) continue;
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          if (gx < 0 || gx >= cols) continue;
          const c = gy * cols + gx;
          for (let q = start[c], e = start[c + 1]; q < e; q++) {
            const j = items[q];
            if (j <= i || dead[j] || kind[j] === KIND_GHOST) continue;
            const dx = x[j] - x[i], dy = y[j] - y[i];
            const rr = (r[i] + r[j]) * md;
            if (dx * dx + dy * dy >= rr * rr) continue;
            // coalesce over time: the bigger drop (counting water still on its way in)
            // keeps its place and grows gradually; the smaller one becomes a ghost
            // that flows into it. Volume and momentum are conserved.
            const { pend, ox, oy, uid, tgt } = this;
            const va = r[i] * r[i] * r[i] + pend[i], vb = r[j] * r[j] * r[j] + pend[j], vt = va + vb;
            const keep = va >= vb ? i : j, lose = keep === i ? j : i;
            const vk = keep === i ? va : vb, vl = vt - vk;
            vx[keep] = (vx[i] * va + vx[j] * vb) / vt;
            vy[keep] = (vy[i] * va + vy[j] * vb) / vt;
            stuck[keep] = stuck[i] && stuck[j] ? 1 : 0;
            kind[keep] = KIND_DROP;
            pend[keep] += vl;
            // centre moves to the volume-weighted centroid, gradually
            const cxk = x[keep] + ox[keep], cyk = y[keep] + oy[keep];
            ox[keep] = (cxk * vk + (x[lose] + ox[lose]) * vl) / vt - x[keep];
            oy[keep] = (cyk * vk + (y[lose] + oy[lose]) * vl) / vt - y[keep];
            if (vl > 0.15 * vt) { stall[keep] = Math.min(stall[keep], -S.mergeKick); hold[keep] = 0; }
            if (keep !== i || str[keep] < str[lose]) str[keep] = Math.max(str[keep], str[lose] * 0.7);
            // the smaller drop: hand over its pending water, then flow in as a ghost
            kind[lose] = KIND_GHOST; tgt[lose] = uid[keep]; pend[lose] = 0; ox[lose] = 0; oy[lose] = 0;
            stuck[lose] = 1; vx[lose] = 0; vy[lose] = 0; str[lose] *= 0.5;
            this.idMap.set(uid[keep], keep);
            if (lose === i) break outer;
          }
        }
      }
    }
  }

  _absorbMist() {
    const { mx, my, mr, mdead } = this;
    const { x, y, r, kind, dead } = this;
    const mg = this.mgrid;
    mg.build(mx, my, this.mn);
    const { start, items, cols, rows } = mg;
    for (let i = 0; i < this.n; i++) {
      if (dead[i] || kind[i] !== KIND_DROP || r[i] < S.mistAbsorbMinR) continue;
      const cx = mg.cx(x[i]), cy = mg.cy(y[i]);
      let vol = r[i] * r[i] * r[i], changed = false;
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        if (gy < 0 || gy >= rows) continue;
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          if (gx < 0 || gx >= cols) continue;
          const c = gy * cols + gx;
          for (let q = start[c], e = start[c + 1]; q < e; q++) {
            const k = items[q];
            if (mdead[k]) continue;
            const dx = mx[k] - x[i], dy = my[k] - y[i], rr = r[i] + mr[k];
            if (dx * dx + dy * dy < rr * rr) { vol += mr[k] * mr[k] * mr[k]; mdead[k] = 1; changed = true; }
          }
        }
      }
      if (changed) r[i] = Math.min(S.rMax, Math.cbrt(vol));
    }
  }

  _evaporateMist(dt) {
    const { mr, mdead } = this, e = S.mistEvap * dt;
    for (let i = 0; i < this.mn; i++) { mr[i] -= e; if (mr[i] < 0.3) mdead[i] = 1; }
  }

  _compact() {
    let w = 0;
    const dead = this.dead;
    for (let i = 0; i < this.n; i++) {
      if (dead[i]) continue;
      if (w !== i) {
        for (const f of DROP_F) this[f][w] = this[f][i];
        this.stuck[w] = this.stuck[i]; this.kind[w] = this.kind[i];
        this.uid[w] = this.uid[i]; this.tgt[w] = this.tgt[i];
      }
      dead[w] = 0; w++;
    }
    this.n = w;
    let m = 0;
    const { mx, my, mr, mseed, mdead } = this;
    for (let i = 0; i < this.mn; i++) {
      if (mdead[i]) continue;
      if (m !== i) { mx[m] = mx[i]; my[m] = my[i]; mr[m] = mr[i]; mseed[m] = mseed[i]; }
      mdead[m] = 0; m++;
    }
    this.mn = m;
  }

  // Pack GPU instance data: drops, then mist; plus wet-film splats for sliding drops.
  fillInstances(dt) {
    const out = this.instances, wet = this.wet;
    const { x, y, r, ang, str, tap, seed, spd, stuck, pw } = this;
    const st = this.style;
    let o = 0, wo = 0, wc = 0;
    for (let i = 0; i < this.n; i++) {
      out[o] = x[i]; out[o + 1] = y[i]; out[o + 2] = r[i]; out[o + 3] = ang[i];
      out[o + 4] = str[i]; out[o + 5] = tap[i]; out[o + 6] = seed[i];
      out[o + 7] = stuck[i] ? 0 : Math.min(1, spd[i] / 150);
      o += 8;
      if (stuck[i] || spd[i] <= S.wetMinSpeed || r[i] <= S.trailMinR) pw[i] = 0;
      else {
        // channel segment: from the drop centre back along the path travelled this frame
        // lumpy width (a chain of merged blobs) + bulge where the drop is slow
        const lump = 1 + st.lumps * simplex3(this.path[i] * 0.022, seed[i] * 97, 0.5);
        const bulge = 1 + 0.35 * Math.max(0, 1 - spd[i] / 140);
        const target = Math.max(0.8, r[i] * st.width * lump * bulge);
        // width eases toward its target and each piece tapers from last frame's
        // width to this one, so consecutive pieces join without steps
        const w0 = pw[i] > 0 ? pw[i] : target;
        const wdt = w0 + (target - w0) * Math.min(1, dt * 10);
        pw[i] = wdt;
        wet[wo] = x[i]; wet[wo + 1] = y[i]; wet[wo + 2] = wdt; wet[wo + 3] = ang[i];
        wet[wo + 4] = (spd[i] * dt * 1.3) / wdt + r[i] / wdt * 0.4;   // length, in head widths
        wet[wo + 5] = st.height;                                      // height per unit width
        wet[wo + 6] = w0 / wdt;                                       // tail width / head width
        wet[wo + 7] = 0;
        wo += 8; wc++;
      }
    }
    const { mx, my, mr, mseed } = this;
    for (let i = 0; i < this.mn; i++) {
      out[o] = mx[i]; out[o + 1] = my[i]; out[o + 2] = mr[i]; out[o + 3] = mseed[i] * 6.283;
      out[o + 4] = 0.05; out[o + 5] = 0; out[o + 6] = mseed[i]; out[o + 7] = 0;
      o += 8;
    }
    this.instanceCount = this.n + this.mn;
    this.wetCount = wc;
  }
}
