/**
 * Internal drum sounds: small Web Audio synthesisers, no samples.
 *
 * They exist so DOWNBEAT is audible without external equipment. Each voice's sound is played
 * by a `DrumInstrument`, a Slop Factory Core instrument, so the same synthesis runs live (an
 * AudioContext) and in offline audio export (an OfflineAudioContext), through the same
 * routing as samples. Every voice is original synthesis; the code below is DOWNBEAT's
 * original synthesis, unchanged except that it plays into the node it is given and picks its
 * noise start point from a hash instead of Math.random().
 */
import type { Instrument, NoteHandle, NoteRequest } from '@slopfactory/core/audio';
import type { InternalSound, VoiceSound } from '../engine/types';

/** 808-style metallic partials (Hz). */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

/** One second of white noise per context (the same generator and seed as always). */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseFor(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    const len = ctx.sampleRate;
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 22222;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = s / 0x3fffffff - 1;
    }
    noiseBuffers.set(ctx, b);
  }
  return b;
}

/**
 * Where in the noise buffer a hit starts reading (0-0.5 s). It used to be Math.random(); a
 * hash of the hit's time sounds the same (an arbitrary point in white noise) but makes
 * offline renders repeatable.
 */
export function noiseOffset(when: number, salt: number): number {
  let h = (Math.round(when * 96000) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 0.5;
}

export interface Hit {
  /** Nodes that can be stopped. */
  sources: AudioScheduledSourceNode[];
  /** Output gain of the hit (for chokes and stops). */
  gain: GainNode;
  start: number;
  end: number;
}

/** Synthesise one hit of `kind` at `w` into `out`. `pm` pitch multiplier, `dm` decay multiplier. */
export function drumHit(ctx: BaseAudioContext, out: AudioNode, kind: InternalSound, w: number, amp: number, pm: number, dm: number): Hit | null {
  if (kind === 'none') return null;
  const noise = noiseFor(ctx);
  const sources: AudioScheduledSourceNode[] = [];
  let end = w + 0.1;
  let salt = 0;
  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(out);
  const env = (param: AudioParam, when: number, peak: number, attack: number, decay: number): number => {
    param.setValueAtTime(0.0001, when);
    param.linearRampToValueAtTime(peak, when + attack);
    param.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    return when + attack + decay + 0.02;
  };
  const osc = (type: OscillatorType, freq: number, when: number, e: number): OscillatorNode => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    o.start(when);
    o.stop(e);
    return o;
  };
  const noiseSrc = (when: number, e: number): AudioBufferSourceNode => {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    n.start(when, noiseOffset(when, salt++));
    n.stop(e);
    return n;
  };
  const filter = (type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };
  const metal = (when: number, e: number, mult: number, into: AudioNode): OscillatorNode[] =>
    METAL.map((f) => {
      const o = osc('square', f * mult, when, e);
      o.connect(into);
      return o;
    });
  const tone = (type: OscillatorType, f0: number, f1: number, sweep: number, peak: number, decay: number) => {
    const e = w + decay + 0.05;
    const o = osc(type, f0 * pm, w, e);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pm), w + sweep);
    const g = ctx.createGain();
    env(g.gain, w, peak * amp, 0.002, decay);
    o.connect(g).connect(bus);
    sources.push(o);
    end = Math.max(end, e);
  };
  const hiss = (ftype: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number) => {
    const e = w + attack + decay + 0.05;
    const n = noiseSrc(w, e);
    const g = ctx.createGain();
    env(g.gain, w, peak * amp, attack, decay);
    n.connect(filter(ftype, freq * pm, q)).connect(g).connect(bus);
    sources.push(n);
    end = Math.max(end, e);
  };
  const metallic = (bp: number, hp: number, peak: number, decay: number, mult = 1) => {
    const e = w + decay + 0.05;
    const g = ctx.createGain();
    env(g.gain, w, peak * amp, 0.001, decay);
    const band = filter('bandpass', bp, 0.8);
    const high = filter('highpass', hp, 0.7);
    sources.push(...metal(w, e, pm * mult, band));
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
        const n = noiseSrc(t, t + 0.03);
        const g = ctx.createGain();
        env(g.gain, t, 0.75 * amp, 0.001, 0.01);
        n.connect(filter('bandpass', 1150 * pm, 1.4)).connect(g).connect(bus);
        sources.push(n);
      }
      const t = w + 0.033;
      const n = noiseSrc(t, t + 0.25 * dm + 0.05);
      const g = ctx.createGain();
      env(g.gain, t, 0.6 * amp, 0.001, 0.2 * dm);
      n.connect(filter('bandpass', 1150 * pm, 1.2)).connect(g).connect(bus);
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
      env(g.gain, w, 0.4 * amp, 0.001, 0.3 * dm);
      const bp = filter('bandpass', 800 * pm, 1.5);
      for (const f of [540, 800]) {
        const o = osc('square', f * pm, w, e);
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
  }
  return { sources, gain: bus, start: w, end };
}

/** Time constant of the fade when a hit is choked or stopped (the old closed-hat choke's). */
export const DRUM_CHOKE_TAU = 0.008;

/**
 * A voice's internal sound as a Core instrument. Pitch follows the note's distance from the
 * voice's first note (within an octave either way), plus the sound's TUNE; level follows
 * velocity on a 1.4-power curve times the sound's LEVEL, exactly as before.
 */
export class DrumInstrument implements Instrument {
  constructor(
    readonly sound: VoiceSound,
    /** the voice's first note: the pitch that plays the sound untransposed */
    readonly base: number,
  ) {}

  start(ctx: BaseAudioContext, out: AudioNode, note: NoteRequest): NoteHandle | null {
    const semis = Math.max(-12, Math.min(12, note.pitch - this.base)) + this.sound.tune;
    const amp = Math.pow(Math.max(1, note.velocity) / 127, 1.4) * this.sound.level;
    const hit = drumHit(ctx, out, this.sound.kind, note.time, amp, Math.pow(2, semis / 12), Math.max(0.25, Math.min(4, this.sound.decay)));
    if (!hit) return null;
    const handle = {
      end: hit.end,
      // drum hits ring out: note-off does nothing
      release(): void {},
      // chokes and stops fade with the exponential curve the old closed-hat choke used
      stop(time: number, fade = DRUM_CHOKE_TAU): void {
        if (time >= handle.end) return;
        const at = Math.max(time, hit.start);
        hit.gain.gain.cancelScheduledValues(at);
        hit.gain.gain.setTargetAtTime(0, at, fade);
        handle.end = Math.min(handle.end, at + fade * 10);
      },
    };
    return handle;
  }
}
