import type { Sfx } from './world';

/**
 * All sound is synthesised with WebAudio — no assets.
 * Ambience beds (wind, sea, rain, birds, crickets) follow the atmosphere;
 * one-shot effects follow building actions.
 */
export class Sound {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private noise!: AudioBuffer;
  private beds: Record<string, GainNode> = {};
  private nextBird = 0;
  private nextCricket = 0;
  muted = false;
  env = { night: 0, rain: 0, sea: false, fog: 0 };

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.beds.wind = this.bed('bandpass', 420, 0.7, 0.05, 0.07);
    this.beds.sea = this.bed('lowpass', 480, 0.5, 0, 0.11);
    this.beds.rain = this.bed('highpass', 1400, 0.3, 0, 0);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  /** Looping filtered noise with a slow swell. */
  private bed(type: BiquadFilterType, freq: number, q: number, level: number, lfoHz: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = level;
    src.connect(f); f.connect(g); g.connect(this.master);
    if (lfoHz > 0) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = lfoHz;
      const lg = ctx.createGain(); lg.gain.value = 0.6;
      const swell = ctx.createGain(); swell.gain.value = 1;
      lfo.connect(lg); lg.connect(swell.gain);
      g.disconnect(); g.connect(swell); swell.connect(this.master);
      lfo.start();
    }
    src.start();
    return g;
  }

  /** Called every frame with the current atmosphere. */
  update() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime, e = this.env;
    this.beds.wind.gain.setTargetAtTime(0.035 + e.rain * 0.03 + e.fog * 0.02, t, 0.5);
    this.beds.sea.gain.setTargetAtTime(e.sea ? 0.09 : 0, t, 0.5);
    this.beds.rain.gain.setTargetAtTime(e.rain * 0.12, t, 0.5);
    if (t > this.nextBird) {
      this.nextBird = t + 1.5 + Math.random() * 5;
      if (e.night < 0.3 && e.rain < 0.4) this.bird();
    }
    if (t > this.nextCricket) {
      this.nextCricket = t + 0.6 + Math.random() * 1.6;
      if (e.night > 0.6 && e.rain < 0.4) this.cricket();
    }
  }

  private env2(g: GainNode, t: number, peak: number, a: number, dcy: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }

  private bird() {
    const ctx = this.ctx!, t0 = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4), base = 2400 + Math.random() * 1500;
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.06);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + 0.06);
      this.env2(g, t, 0.025, 0.01, 0.07);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.1);
    }
  }

  private cricket() {
    const ctx = this.ctx!, t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.045;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = 4300 + Math.random() * 200;
      this.env2(g, t, 0.012, 0.005, 0.03);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.05);
    }
  }

  private burst(t: number, freq: number, q: number, peak: number, dcy: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    this.env2(g, t, peak, 0.004, dcy);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dcy + 0.05);
  }

  private tone(t: number, f0: number, f1: number, peak: number, dur: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this.env2(g, t, peak, 0.005, dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  play(name: Sfx | 'bell' | 'tick' | 'thunder') {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'wood': // hammer knocks on timber
        for (let i = 0; i < 3; i++) { this.burst(t + i * 0.16, 700 + Math.random() * 300, 4, 0.35, 0.08); this.tone(t + i * 0.16, 190, 120, 0.15, 0.09); }
        break;
      case 'stone': // chisel on stone
        for (let i = 0; i < 3; i++) this.burst(t + i * 0.13, 2600 + Math.random() * 800, 6, 0.25, 0.05);
        this.burst(t + 0.42, 400, 1, 0.3, 0.2, 'lowpass');
        break;
      case 'knock': this.burst(t, 600, 3, 0.3, 0.12); break;
      case 'bridge':
        this.tone(t, 140, 110, 0.12, 0.5, 'sawtooth');
        for (let i = 0; i < 4; i++) this.burst(t + 0.15 + i * 0.12, 900, 4, 0.25, 0.07);
        break;
      case 'demolish': this.burst(t, 300, 0.7, 0.5, 0.7, 'lowpass'); for (let i = 0; i < 5; i++) this.burst(t + 0.1 + Math.random() * 0.5, 800 + Math.random() * 1200, 3, 0.2, 0.08); break;
      case 'creak': this.tone(t, 95, 70, 0.1, 0.9, 'sawtooth'); this.tone(t + 0.3, 120, 85, 0.06, 0.7, 'sawtooth'); break;
      case 'crash':
        this.burst(t, 220, 0.6, 0.8, 1.6, 'lowpass');
        for (let i = 0; i < 9; i++) this.burst(t + Math.random() * 1.0, 500 + Math.random() * 2500, 2, 0.25, 0.1);
        this.tone(t, 70, 35, 0.4, 1.0);
        break;
      case 'bell': this.tone(t, 880, 878, 0.05, 1.6); this.tone(t, 1320, 1318, 0.025, 1.2); break;
      case 'tick': this.burst(t, 3000, 5, 0.06, 0.03); break;
      case 'thunder':
        this.burst(t, 120, 0.5, 0.9, 2.6, 'lowpass');
        for (let i = 0; i < 4; i++) this.burst(t + 0.1 + Math.random() * 1.2, 260 + Math.random() * 200, 0.8, 0.35, 0.9, 'lowpass');
        break;
    }
  }
}
