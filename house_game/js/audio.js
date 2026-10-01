// All sounds are synthesized with WebAudio, so the project has no audio assets.
export class Sfx {
  constructor() { this.ctx = null; this.enabled = true; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);
    // Synthetic reverb tail for a temple-courtyard feel.
    const len = ctx.sampleRate * 2.5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.master);
  }

  get ok() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  out(node, wet = true) {
    node.connect(this.master);
    if (wet) node.connect(this.reverb);
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, attack = 0.005, delay = 0, wet = true } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this.out(g, wet);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noise(dur, { gain = 0.2, freq = 1000, q = 1, type = 'bandpass', delay = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this.out(g);
    src.start(t);
    return { src, f, t };
  }

  // Wind bell (fūrin): inharmonic partials ring out.
  bell(pitch = 1) {
    const f = 1320 * pitch;
    [1, 2.76, 5.4, 8.93].forEach((m, i) => this.tone(f * m, 2.2 - i * 0.4, { gain: 0.12 / (i + 1) }));
  }

  // Temple bonsho-like low bell for the pagoda top.
  gong() {
    [1, 2.0, 2.92, 4.1].forEach((m, i) => this.tone(110 * m, 5 - i, { gain: 0.25 / (i + 1), attack: 0.01 }));
  }

  // Shishi-odoshi bamboo clack.
  clack() {
    this.tone(520, 0.12, { type: 'triangle', gain: 0.5, wet: true });
    this.tone(780, 0.08, { type: 'square', gain: 0.08 });
    this.noise(0.08, { gain: 0.4, freq: 1800, q: 4 });
  }

  water() {
    for (let i = 0; i < 6; i++) this.tone(600 + Math.random() * 900, 0.08, { gain: 0.05, delay: i * 0.05 });
    this.noise(0.6, { gain: 0.08, freq: 2500, q: 0.7 });
  }

  pebble() {
    this.tone(900, 0.06, { type: 'triangle', gain: 0.25 });
    this.noise(0.25, { gain: 0.12, freq: 3000, q: 0.5, type: 'highpass', delay: 0.03 });
  }

  rake() { this.noise(0.18, { gain: 0.05, freq: 4000, q: 0.4, type: 'highpass' }); }

  roar() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 1.4);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 700;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(f).connect(g);
    this.out(g);
    o.start(t); o.stop(t + 1.6);
    this.noise(1.4, { gain: 0.3, freq: 400, q: 0.8 });
  }

  chime() { [0, 3, 7, 10, 12].forEach((s, i) => this.tone(880 * 2 ** (s / 12), 1.5, { gain: 0.06, delay: i * 0.09 })); }

  meow() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(500, t);
    o.frequency.linearRampToValueAtTime(900, t + 0.15);
    o.frequency.linearRampToValueAtTime(450, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g); this.out(g);
    o.start(t); o.stop(t + 0.6);
  }

  click() { this.tone(1200, 0.05, { type: 'triangle', gain: 0.1, wet: false }); }

  // Continuous rain bed: looped noise through a band-pass, faded by level (0..1).
  setRain(level) {
    if (!this.ctx) return;
    if (!this.rainGain) {
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.4;
      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(f).connect(this.rainGain).connect(this.master);
      src.start();
    }
    const v = this.enabled ? level * 0.22 : 0;
    this.rainGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }

  thunder(delay = 1) {
    if (!this.ok) return;
    const n = this.noise(3.5, { gain: 0.7, freq: 120, q: 0.6, type: 'lowpass', delay });
    if (n) n.f.frequency.setValueAtTime(400, n.t);
    if (n) n.f.frequency.exponentialRampToValueAtTime(60, n.t + 3);
  }
}
