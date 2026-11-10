import { CONFIG } from '../config.js';
import { FeatureExtractor } from './features.js';

const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

// Sources: 'display' (tab/system audio via screen share), 'mic', 'file', 'test'.
// Everything feeds one AnalyserNode. Captured audio is NOT routed to the speakers
// (no feedback); file/test playback is.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.mode = 'none';
    this.fx = new FeatureExtractor();
    this.node = null; this.stream = null; this.test = null;
    this.player = null; this.mediaNode = null; this.fileUrl = null;
    this.onEnded = null;
  }

  get active() { return this.mode !== 'none'; }

  // Must be called synchronously inside a user gesture (before any await).
  ensure() {
    if (!this.ctx) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = CONFIG.audio.fftSize;
      this.analyser.smoothingTimeConstant = 0;   // we smooth ourselves
      this.analyser.minDecibels = -110;
      this.analyser.maxDecibels = -10;
      // keep the analyser pulled by the graph without making sound
      const sink = ctx.createGain(); sink.gain.value = 0;
      this.analyser.connect(sink); sink.connect(ctx.destination);
      this.fx.attach(this.analyser, ctx.sampleRate);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  stop() {
    if (this.node) { try { this.node.disconnect(); } catch { /* already */ } this.node = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.test) { this.test.stop(); this.test = null; }
    if (this.player) this.player.pause();
    this.mode = 'none';
    this.fx.reset();
  }

  async useDisplay() {
    this.ensure();
    this.stop();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,                    // Chrome requires video to offer audio
      audio: RAW_AUDIO,
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      preferCurrentTab: false,
    });
    const audio = stream.getAudioTracks();
    if (!audio.length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No audio was shared. Pick the YouTube tab and switch on "Also share tab audio".');
    }
    stream.getVideoTracks().forEach((t) => t.stop());   // we only need sound
    this.stream = stream;
    this.node = this.ctx.createMediaStreamSource(new MediaStream(audio));
    this.node.connect(this.analyser);
    audio[0].addEventListener('ended', () => {
      if (this.mode === 'display') { this.stop(); this.onEnded?.('Sharing stopped'); }
    });
    this.mode = 'display';
    return audio[0].label || 'Shared audio';
  }

  async useMic() {
    this.ensure();
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
    this.stream = stream;
    this.node = this.ctx.createMediaStreamSource(stream);
    this.node.connect(this.analyser);
    this.mode = 'mic';
    return stream.getAudioTracks()[0]?.label || 'Microphone';
  }

  async useFile(file, player) {
    this.ensure();
    this.stop();
    if (!this.mediaNode) { this.player = player; this.mediaNode = this.ctx.createMediaElementSource(player); }
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = URL.createObjectURL(file);
    player.src = this.fileUrl;
    player.loop = true;
    this.node = this.mediaNode;
    this.node.connect(this.analyser);
    this.node.connect(this.ctx.destination);
    await player.play();
    this.mode = 'file';
    return file.name;
  }

  useTest() {
    this.ensure();
    this.stop();
    this.test = new TestBeat(this.ctx, this.analyser);
    this.mode = 'test';
    return 'Built-in test beat (with a silent breakdown every 16 bars)';
  }

  update(dt) { return this.active ? this.fx.update(dt) : null; }
}

// ── Synthesised test groove: kick / snare / hats / pad, then a breakdown ────
class TestBeat {
  constructor(ctx, analyser) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0.45;
    this.out.connect(analyser); this.out.connect(ctx.destination);
    this.bpm = 120; this.step = 0; this.next = ctx.currentTime + 0.1;
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.timer = setInterval(() => this.tick(), 25);
  }
  tick() {
    const spb = 60 / this.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.12) { this.play(this.step, this.next); this.next += spb; this.step++; }
  }
  play(step, t) {
    const bar = Math.floor(step / 16) % 16, s = step % 16;
    if (bar === 14 || bar === 15) return;                // two bars of silence
    const breakdown = bar === 12 || bar === 13;          // pad only
    if (!breakdown) {
      if (s % 4 === 0) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.35 : 0.18);
      if (bar % 4 === 3 && s >= 12) this.hat(t + 0.06, 0.25);
    }
    if (s === 0) this.pad(t, bar, 16 * 60 / this.bpm / 4);
  }
  env(g, t, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  kick(t) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    this.env(g, t, 1.0, 0.42);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.45);
  }
  noiseHit(t, type, freq, q, peak, dur) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); this.env(g, t, peak, dur);
    src.connect(f).connect(g).connect(this.out); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  hat(t, v) { this.noiseHit(t, 'highpass', 7500, 0.7, v, 0.05); }
  snare(t) {
    this.noiseHit(t, 'bandpass', 1900, 0.8, 0.6, 0.2);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = 190; this.env(g, t, 0.35, 0.09);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.12);
  }
  pad(t, bar, len) {
    const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [164.8, 207.7, 246.9]];
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    lp.connect(g).connect(this.out);
    for (const f of chords[bar % 4]) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(lp); o.start(t); o.stop(t + len + 0.05);
    }
  }
  stop() { clearInterval(this.timer); this.out.disconnect(); }
}
