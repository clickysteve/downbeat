/**
 * Internal drum sounds: small Web Audio synthesisers, no samples.
 *
 * They exist so DOWNBEAT is audible without external equipment. The
 * scheduler's note events (performance.now() milliseconds) are mapped onto
 * the AudioContext clock with getOutputTimestamp(), so the internal sounds
 * and MIDI output share one timeline. Every voice is original synthesis.
 */
import type { InternalSound, Voice } from '../engine/types';

type Ctx = AudioContext;

interface Hit {
  /** Nodes that can be stopped. */
  sources: AudioScheduledSourceNode[];
  /** Output gain of the hit (for chokes). */
  gain: GainNode;
  start: number;
  end: number;
}

/** 808-style metallic partials (Hz). */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

export class DrumSynth {
  ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hits: Hit[] = [];
  private openHats: Hit[] = [];
  volume = 0.8;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Create / resume the audio context (must follow a user gesture). */
  async ensure(): Promise<boolean> {
    if (typeof AudioContext === 'undefined') return false;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 6;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.12;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let s = 22222;
      for (let i = 0; i < len; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        d[i] = (s / 0x3fffffff) - 1;
      }
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    return this.ctx.state === 'running';
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** performance.now() ms to AudioContext seconds. */
  toCtxTime(ms: number): number {
    const ctx = this.ctx!;
    let t: number;
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      t = ts.contextTime + (ms - ts.performanceTime) / 1000;
    } else {
      t = ctx.currentTime + (ms - performance.now()) / 1000;
    }
    return Math.max(ctx.currentTime, t);
  }

  /** Play a voice's sound for a MIDI pitch at a performance.now() time. */
  play(voice: Voice, pitch: number, velocity: number, ms: number): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    const kind = voice.sound.kind;
    if (kind === 'none') return;
    const base = voice.notes[0]?.[0] ?? pitch;
    const semis = Math.max(-12, Math.min(12, pitch - base)) + voice.sound.tune;
    const when = this.toCtxTime(ms);
    const amp = Math.pow(Math.max(1, velocity) / 127, 1.4) * voice.sound.level;
    this.prune();
    if (kind === 'hat') this.choke(when);
    const hit = this.voice(kind, when, amp, Math.pow(2, semis / 12), Math.max(0.25, Math.min(4, voice.sound.decay)));
    if (hit) {
      this.hits.push(hit);
      if (kind === 'openhat') this.openHats.push(hit);
    }
  }

  /** Silence everything scheduled or sounding (stop, panic). */
  cancel(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const h of this.hits) {
      try {
        h.gain.gain.cancelScheduledValues(now);
        h.gain.gain.setValueAtTime(0, now);
        for (const s of h.sources) s.stop(now + 0.01);
      } catch {
        /* already stopped */
      }
    }
    this.hits = [];
    this.openHats = [];
  }

  private prune(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.hits.length > 64) this.hits = this.hits.filter((h) => h.end > now);
    this.openHats = this.openHats.filter((h) => h.end > now);
  }

  /** A closed hat chokes ringing open hats. */
  private choke(when: number): void {
    for (const h of this.openHats) {
      if (h.start < when && h.end > when) {
        h.gain.gain.cancelScheduledValues(when);
        h.gain.gain.setTargetAtTime(0, when, 0.008);
      }
    }
  }

  // ---------------------------------------------------------------- building blocks

  private out(): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = 1;
    g.connect(this.master!);
    return g;
  }

  private env(param: AudioParam, when: number, peak: number, attack: number, decay: number): number {
    param.setValueAtTime(0.0001, when);
    param.linearRampToValueAtTime(peak, when + attack);
    param.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    return when + attack + decay + 0.02;
  }

  private osc(type: OscillatorType, freq: number, when: number, end: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    o.start(when);
    o.stop(end);
    return o;
  }

  private noiseSrc(when: number, end: number): AudioBufferSourceNode {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    n.start(when, Math.random() * 0.5);
    n.stop(end);
    return n;
  }

  private filter(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private metal(when: number, end: number, mult: number, into: AudioNode): OscillatorNode[] {
    return METAL.map((f) => {
      const o = this.osc('square', f * mult, when, end);
      o.connect(into);
      return o;
    });
  }

  // ---------------------------------------------------------------- voices

  private voice(kind: InternalSound, w: number, amp: number, pm: number, dm: number): Hit | null {
    const ctx = this.ctx!;
    const sources: AudioScheduledSourceNode[] = [];
    let end = w + 0.1;
    const bus = this.out();
    const tone = (type: OscillatorType, f0: number, f1: number, sweep: number, peak: number, decay: number) => {
      const e = w + decay + 0.05;
      const o = this.osc(type, f0 * pm, w, e);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pm), w + sweep);
      const g = ctx.createGain();
      this.env(g.gain, w, peak * amp, 0.002, decay);
      o.connect(g).connect(bus);
      sources.push(o);
      end = Math.max(end, e);
    };
    const hiss = (ftype: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number) => {
      const e = w + attack + decay + 0.05;
      const n = this.noiseSrc(w, e);
      const g = ctx.createGain();
      this.env(g.gain, w, peak * amp, attack, decay);
      n.connect(this.filter(ftype, freq * pm, q)).connect(g).connect(bus);
      sources.push(n);
      end = Math.max(end, e);
    };
    const metallic = (bp: number, hp: number, peak: number, decay: number, mult = 1) => {
      const e = w + decay + 0.05;
      const g = ctx.createGain();
      this.env(g.gain, w, peak * amp, 0.001, decay);
      const band = this.filter('bandpass', bp, 0.8);
      const high = this.filter('highpass', hp, 0.7);
      sources.push(...this.metal(w, e, pm * mult, band));
      band.connect(high).connect(g).connect(bus);
      end = Math.max(end, e);
    };
    switch (kind) {
      case 'kick':
        tone('sine', 160, 46, 0.09, 1.0, 0.42 * dm);
        hiss('highpass', 2500, 0.7, 0.18, 0.001, 0.012);
        break;
      case 'kick2':
        tone('sine', 110, 50, 0.05, 1.0, 0.9 * dm);
        tone('triangle', 220, 60, 0.02, 0.25, 0.05);
        break;
      case 'snare':
        tone('triangle', 190, 165, 0.05, 0.55, 0.11 * dm);
        tone('sine', 330, 300, 0.05, 0.25, 0.07 * dm);
        hiss('highpass', 1400, 0.7, 0.7, 0.001, 0.19 * dm);
        break;
      case 'snare2':
        tone('triangle', 240, 200, 0.03, 0.4, 0.07 * dm);
        hiss('bandpass', 3800, 0.9, 0.85, 0.001, 0.12 * dm);
        break;
      case 'rim':
        tone('square', 1700, 1650, 0.01, 0.35, 0.025 * dm);
        hiss('bandpass', 2500, 4, 0.5, 0.001, 0.02);
        break;
      case 'clap': {
        for (let k = 0; k < 3; k++) {
          const t = w + k * 0.011;
          const n = this.noiseSrc(t, t + 0.03);
          const g = ctx.createGain();
          this.env(g.gain, t, 0.75 * amp, 0.001, 0.01);
          n.connect(this.filter('bandpass', 1150 * pm, 1.4)).connect(g).connect(bus);
          sources.push(n);
        }
        const t = w + 0.033;
        const n = this.noiseSrc(t, t + 0.25 * dm + 0.05);
        const g = ctx.createGain();
        this.env(g.gain, t, 0.6 * amp, 0.001, 0.2 * dm);
        n.connect(this.filter('bandpass', 1150 * pm, 1.2)).connect(g).connect(bus);
        sources.push(n);
        end = Math.max(end, t + 0.3 * dm + 0.05);
        break;
      }
      case 'hat':
        metallic(10000, 7000, 0.45, 0.055 * dm);
        break;
      case 'openhat':
        metallic(10000, 7000, 0.4, 0.38 * dm);
        break;
      case 'tomlo':
        tone('sine', 105, 74, 0.18, 0.9, 0.38 * dm);
        hiss('lowpass', 900, 0.7, 0.06, 0.001, 0.04);
        break;
      case 'tommid':
        tone('sine', 150, 108, 0.16, 0.85, 0.32 * dm);
        hiss('lowpass', 1200, 0.7, 0.06, 0.001, 0.04);
        break;
      case 'tomhi':
        tone('sine', 205, 150, 0.14, 0.8, 0.27 * dm);
        hiss('lowpass', 1500, 0.7, 0.06, 0.001, 0.035);
        break;
      case 'cowbell': {
        const e = w + 0.35 * dm + 0.05;
        const g = ctx.createGain();
        this.env(g.gain, w, 0.4 * amp, 0.001, 0.3 * dm);
        const bp = this.filter('bandpass', 800 * pm, 1.5);
        for (const f of [540, 800]) {
          const o = this.osc('square', f * pm, w, e);
          o.connect(bp);
          sources.push(o);
        }
        bp.connect(g).connect(bus);
        end = Math.max(end, e);
        break;
      }
      case 'clave':
        tone('sine', 2500, 2450, 0.01, 0.6, 0.045 * dm);
        break;
      case 'shaker':
        hiss('bandpass', 6500, 1.2, 0.4, 0.012, 0.07 * dm);
        break;
      case 'conga':
        tone('sine', 360, 310, 0.04, 0.8, 0.2 * dm);
        hiss('bandpass', 1800, 2, 0.08, 0.001, 0.015);
        break;
      case 'crash':
        metallic(7000, 4000, 0.3, 1.3 * dm, 1.3);
        hiss('highpass', 5000, 0.7, 0.25, 0.002, 1.1 * dm);
        break;
      case 'ride':
        metallic(5000, 2500, 0.22, 0.9 * dm, 1.7);
        tone('sine', 3100, 3050, 0.05, 0.08, 0.6 * dm);
        break;
      case 'zap':
        tone('sine', 2200, 70, 0.12, 0.7, 0.16 * dm);
        break;
      case 'none':
        return null;
    }
    return { sources, gain: bus, start: w, end };
  }
}
