// ─── Generative Ambient Sound Engine ──────────────────────
// Uses Web Audio API to create layered drone + interaction sounds.
// No audio files needed — everything is synthesized.

const MODE_FREQS: number[][] = [
  [65.4, 98.0, 164.8],   // nebula: C2, G2, E3 — open, spacious
  [73.4, 110.0, 185.0],  // solar: D2, A2, F#3 — warm, bright
  [82.4, 123.5, 207.7],  // aurora: E2, B2, G#3 — shimmering
  [92.5, 138.6, 233.1],  // vortex: F#2, C#3, A#3 — tense, spiraling
  [55.0, 82.4, 123.5],   // void: A1, E2, B2 — deep, ethereal
];

export class AmbientSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxGain!: GainNode;
  private filter!: BiquadFilterNode;
  private drones: OscillatorNode[] = [];
  private currentMode = 4;
  private _enabled = false;

  get enabled() {
    return this._enabled;
  }

  toggle(): boolean {
    if (!this.ctx) {
      this.init(this.currentMode);
      return this._enabled;
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this._enabled = !this._enabled;
    const t = this.ctx.currentTime + 0.5;
    this.master.gain.linearRampToValueAtTime(this._enabled ? 0.08 : 0, t);
    this.sfxGain.gain.linearRampToValueAtTime(this._enabled ? 0.5 : 0, t);
    return this._enabled;
  }

  private init(modeIndex: number) {
    this.ctx = new AudioContext();
    const ctx = this.ctx;

    // Master gain (for continuous drone — kept low)
    this.master = ctx.createGain();
    this.master.gain.value = 0.08;

    // Separate SFX gain (for one-shot sounds — much louder)
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.sfxGain.connect(ctx.destination);

    // Warm lowpass filter
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 500;
    this.filter.Q.value = 0.6;
    this.filter.connect(this.master);
    this.master.connect(ctx.destination);

    // 3 drone oscillators with slow vibrato
    const freqs = MODE_FREQS[modeIndex];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freqs[i];

      const gain = ctx.createGain();
      gain.gain.value = i === 0 ? 0.5 : 0.3;

      // Slow vibrato — each voice at a different rate for organic movement
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06 + i * 0.04;
      const lfoAmp = ctx.createGain();
      lfoAmp.gain.value = freqs[i] * 0.004;
      lfo.connect(lfoAmp);
      lfoAmp.connect(osc.frequency);
      lfo.start();

      // Slow volume swell
      const volLfo = ctx.createOscillator();
      volLfo.frequency.value = 0.03 + i * 0.02;
      const volLfoAmp = ctx.createGain();
      volLfoAmp.gain.value = 0.1;
      volLfo.connect(volLfoAmp);
      volLfoAmp.connect(gain.gain);
      volLfo.start();

      osc.connect(gain);
      gain.connect(this.filter);
      osc.start();

      this.drones.push(osc);
    }

    // Soft noise texture layer
    const bufLen = ctx.sampleRate * 4;
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 300;
    noiseFilter.Q.value = 0.4;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.015;

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.master);
    noise.start();

    this._enabled = true;
  }

  setMode(index: number) {
    this.currentMode = index;
    if (!this.ctx || !this._enabled) return;

    const freqs = MODE_FREQS[index];
    const now = this.ctx.currentTime;

    this.drones.forEach((osc, i) => {
      osc.frequency.linearRampToValueAtTime(freqs[i], now + 3);
    });

    this.triggerSweep();
  }

  /** Percussive impact — low thump + noise whoosh to match particle explosion */
  triggerBurst() {
    if (!this.ctx || !this._enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Low-frequency thump (the "boom")
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(70 + Math.random() * 30, now);
    thump.frequency.exponentialRampToValueAtTime(25, now + 0.18);

    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.12, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    thump.connect(thumpGain);
    thumpGain.connect(this.sfxGain);
    thump.start(now);
    thump.stop(now + 0.25);

    // Filtered noise burst (the "whoosh" of particles scattering)
    const bufLen = Math.floor(ctx.sampleRate * 0.35);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const noiseFilt = ctx.createBiquadFilter();
    noiseFilt.type = 'lowpass';
    noiseFilt.frequency.setValueAtTime(2500, now);
    noiseFilt.frequency.exponentialRampToValueAtTime(150, now + 0.25);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    noise.connect(noiseFilt);
    noiseFilt.connect(noiseGain);
    noiseGain.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 0.35);
  }

  /** Soft rising tone on color change */
  triggerColorChange() {
    if (!this.ctx || !this._enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const base = 600 + Math.random() * 200;

    // Two quick rising notes
    [0, 0.06].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const freq = base * (1 + i * 0.25);
      osc.frequency.setValueAtTime(freq * 0.9, now + delay);
      osc.frequency.linearRampToValueAtTime(freq, now + delay + 0.08);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.1, now + delay);
      g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.18);

      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(now + delay);
      osc.stop(now + delay + 0.2);
    });
  }

  /** Descending whoosh on mode change */
  private triggerSweep() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const bufLen = ctx.sampleRate;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 4;
    bp.frequency.setValueAtTime(2500, now);
    bp.frequency.exponentialRampToValueAtTime(150, now + 0.6);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.04, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.7);
  }
}
