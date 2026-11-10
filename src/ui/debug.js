// Debug overlay (toggle with D): audio meters, onset/beat lamps, force outputs, FPS.
const METERS = [
  ['bass', 'Bass'], ['mid', 'Mid'], ['treble', 'Treble'], ['loudness', 'Loud'], ['flux', 'Flux'], ['silence', 'Silence'],
];
const FORCES = [
  ['wind', 'Wind', 2], ['turbulence', 'Turb', 2], ['pinScale', 'Pin', 1], ['mistRate', 'Mist/s', 500], ['shimmer', 'Shimmer', 1.5],
];

export class DebugPanel {
  constructor(el) {
    this.el = el;
    this.visible = false;
    this.frames = 0; this.acc = 0; this.fps = 0; this.ms = 0; this.lastText = 0;
    const row = (key, label, cls) => `<div class="m"><span>${label}</span><div class="bar ${cls}"><i data-k="${key}"></i></div><b data-v="${key}"></b></div>`;
    el.innerHTML = `
      <div class="dh"><span id="dbgFps">– fps</span><span id="dbgCounts"></span></div>
      <div class="sec">Audio <span class="lamp" id="lampOnset">onset</span><span class="lamp" id="lampBeat">beat</span> <span id="dbgDb"></span></div>
      ${METERS.map(([k, l]) => row('a.' + k, l, 'a')).join('')}
      <div class="sec">Forces</div>
      ${FORCES.map(([k, l]) => row('f.' + k, l, 'f')).join('')}
      <div class="sec small">D: debug · H: hide UI · F: fullscreen · 1–4: streaks</div>`;
    this.bars = {}; this.vals = {};
    el.querySelectorAll('i[data-k]').forEach((n) => (this.bars[n.dataset.k] = n));
    el.querySelectorAll('b[data-v]').forEach((n) => (this.vals[n.dataset.v] = n));
    this.fpsEl = el.querySelector('#dbgFps'); this.countEl = el.querySelector('#dbgCounts');
    this.dbEl = el.querySelector('#dbgDb');
    this.lampOnset = el.querySelector('#lampOnset'); this.lampBeat = el.querySelector('#lampBeat');
  }

  toggle() { this.visible = !this.visible; this.el.hidden = !this.visible; }

  update(dt, frameMs, features, forces, sim) {
    this.frames++; this.acc += dt; this.ms += frameMs;
    if (this.acc >= 0.5) { this.fps = this.frames / this.acc; this.msAvg = this.ms / this.frames; this.frames = 0; this.acc = 0; this.ms = 0; }
    if (!this.visible) return;
    const f = features || {};
    for (const [k] of METERS) this._set('a.' + k, f[k] ?? 0, 1);
    for (const [k, , max] of FORCES) this._set('f.' + k, forces[k] ?? 0, max);
    this.lampOnset.classList.toggle('on', (f.onsetPulse ?? 0) > 0.3);
    this.lampBeat.classList.toggle('on', (f.beatPulse ?? 0) > 0.3);
    const now = performance.now();
    if (now - this.lastText > 200) {
      this.lastText = now;
      this.fpsEl.textContent = `${this.fps.toFixed(0)} fps · ${(this.msAvg || 0).toFixed(1)} ms cpu`;
      this.countEl.textContent = `${sim.n} drops · ${sim.stats.moving} sliding · ${sim.mn} mist`;
      this.dbEl.textContent = features ? `${f.loudDb.toFixed(0)} dB` : 'no source';
      for (const k in this.vals) {
        const [grp, key] = k.split('.');
        const v = grp === 'a' ? f[key] : forces[key];
        this.vals[k].textContent = v == null ? '–' : v >= 10 ? v.toFixed(0) : v.toFixed(2);
      }
    }
  }

  _set(k, v, max) { const b = this.bars[k]; if (b) b.style.transform = `scaleX(${Math.max(0, Math.min(1, v / max))})`; }
}
