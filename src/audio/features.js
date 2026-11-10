import { CONFIG } from '../config.js';

const A = CONFIG.audio;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Envelope follower: fast attack, slow release (separate time constants).
export function follow(cur, target, dt, attack, release) {
  const tau = target > cur ? attack : release;
  if (tau <= 0) return target;
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

// Slow auto-gain on a dB value → 0..1 within a sliding window below the recent peak.
class AGC {
  constructor(minRef) { this.minRef = minRef; this.ref = minRef; }
  norm(db, dt) {
    this.ref = Math.max(db, this.ref - A.agcDecayDb * dt, this.minRef);
    return clamp01((db - (this.ref - A.agcRangeDb)) / A.agcRangeDb);
  }
}

// Adaptive-threshold peak picker over a flux signal.
class OnsetDetector {
  constructor(size, refractory) { this.h = new Float32Array(size); this.i = 0; this.refractory = refractory; this.last = -1e9; this.above = false; this.threshold = 0; }
  update(v, t) {
    const h = this.h;
    let mean = 0; for (let k = 0; k < h.length; k++) mean += h[k]; mean /= h.length;
    let vr = 0; for (let k = 0; k < h.length; k++) { const d = h[k] - mean; vr += d * d; }
    const std = Math.sqrt(vr / h.length);
    h[this.i] = v; this.i = (this.i + 1) % h.length;
    const thr = mean + A.onsetK * std + A.onsetMin;
    this.threshold = thr;
    const above = v > thr;
    const fire = above && !this.above && t - this.last > this.refractory;
    this.above = above;
    if (fire) this.last = t;
    return fire ? clamp01((v - thr) / (thr + 1e-6)) : -1;
  }
}

export class FeatureExtractor {
  constructor() { this.an = null; this.reset(); }

  reset() {
    this.t = 0;
    this.agc = { bass: new AGC(A.agcMinRefDb), mid: new AGC(A.agcMinRefDb), treble: new AGC(A.agcMinRefDb), loud: new AGC(A.loudMinRefDb) };
    this.fluxRef = A.fluxMinRef;
    this.onsetDet = new OnsetDetector(A.onsetWindow, A.onsetRefractory);
    this.beatDet = new OnsetDetector(A.onsetWindow, A.beatRefractory);
    if (this.prevLog) this.prevLog.fill(0);
    this.out = {
      bass: 0, mid: 0, treble: 0, loudness: 0, flux: 0, silence: 1,
      onset: false, beat: false, onsetStrength: 0, onsetPulse: 0, beatPulse: 0,
      loudDb: -120, rawFlux: 0, fluxThreshold: 0,
    };
  }

  attach(analyser, sampleRate) {
    this.an = analyser;
    const bins = analyser.frequencyBinCount;
    this.freq = new Float32Array(bins);
    this.mag = new Float32Array(bins);
    this.prevLog = new Float32Array(bins);
    this.time = new Float32Array(analyser.fftSize);
    const hz = sampleRate / analyser.fftSize;
    const b = (f) => Math.max(1, Math.min(bins - 1, Math.round(f / hz)));
    this.bands = {};
    for (const k of ['bass', 'mid', 'treble']) this.bands[k] = [b(A.bands[k][0]), b(A.bands[k][1])];
    this.fluxMax = b(A.fluxMaxHz);
  }

  update(dt) {
    const out = this.out;
    out.onset = false; out.beat = false;
    if (!this.an || dt <= 0) return out;
    this.t += dt;
    const { freq, mag, prevLog, time } = this;
    this.an.getFloatFrequencyData(freq);
    this.an.getFloatTimeDomainData(time);

    // loudness (RMS)
    let ss = 0;
    for (let i = 0; i < time.length; i++) ss += time[i] * time[i];
    const loudDb = 20 * Math.log10(Math.sqrt(ss / time.length) + 1e-9);
    out.loudDb = loudDb;

    // magnitudes + spectral flux (positive log-magnitude change), full and bass-only
    let flux = 0, bflux = 0;
    const bassHi = this.bands.bass[1];
    for (let i = 1; i <= this.fluxMax; i++) {
      const db = freq[i];
      const m = db > -160 ? Math.pow(10, db / 20) : 0;
      mag[i] = m;
      const lm = Math.log(1 + 1000 * m);
      const d = lm - prevLog[i];
      prevLog[i] = lm;
      if (d > 0) { flux += d; if (i <= bassHi) bflux += d; }
    }
    flux /= this.fluxMax;
    bflux /= bassHi;

    const bandDb = (r) => { let s = 0; for (let i = r[0]; i <= r[1]; i++) s += mag[i]; return 20 * Math.log10(s / (r[1] - r[0] + 1) + 1e-9); };
    const silentNow = loudDb < A.silenceDb ? 1 : 0;
    const gate = 1 - silentNow;
    const bass = this.agc.bass.norm(bandDb(this.bands.bass), dt) * gate;
    const mid = this.agc.mid.norm(bandDb(this.bands.mid), dt) * gate;
    const treble = this.agc.treble.norm(bandDb(this.bands.treble), dt) * gate;
    const loud = this.agc.loud.norm(loudDb, dt) * gate;

    this.fluxRef = Math.max(flux, this.fluxRef * Math.exp(-dt / A.fluxAgcTau), A.fluxMinRef);
    const fluxN = clamp01(flux / this.fluxRef) * gate;
    out.rawFlux = flux;

    const E = A.env;
    out.bass = follow(out.bass, bass, dt, ...E.bass);
    out.mid = follow(out.mid, mid, dt, ...E.mid);
    out.treble = follow(out.treble, treble, dt, ...E.treble);
    out.loudness = follow(out.loudness, loud, dt, ...E.loudness);
    out.flux = follow(out.flux, fluxN, dt, ...E.flux);
    out.silence = follow(out.silence, silentNow, dt, ...E.silence);

    // onsets / beats
    const os = this.onsetDet.update(flux, this.t);
    out.fluxThreshold = this.onsetDet.threshold;
    if (os >= 0 && out.silence < 0.5) { out.onset = true; out.onsetStrength = os; out.onsetPulse = 1; }
    const bs = this.beatDet.update(bflux, this.t);
    if (bs >= 0 && out.silence < 0.5 && out.bass > A.beatMinBass) { out.beat = true; out.onsetStrength = Math.max(out.onsetStrength, bs); out.beatPulse = 1; }
    out.onsetPulse = follow(out.onsetPulse, 0, dt, ...E.pulse);
    out.beatPulse = follow(out.beatPulse, 0, dt, ...E.pulse);
    return out;
  }
}
