/**
 * Live internal audio on Slop Factory Core: the AudioContext, Core's mixer (one strip per
 * sequencer voice, with its output processing, then master processing and VOLUME), DOWNBEAT's
 * master compressor, and Core's note player, which plays every drum sound (internal or
 * sample) with choke groups. The scheduler's notes arrive with performance.now() times.
 *
 * Signal chain:
 *   drum sound (internal synthesis, or sample + sample transformation + zone)
 *     -> sequencer voice strip (voice output processing)
 *     -> master bus -> master output processing -> VOLUME -> master compressor -> speakers
 *
 * With every processor CLEAN this is the chain DOWNBEAT always had (hits -> VOLUME ->
 * compressor), so the internal sounds are unchanged.
 */
import { Mixer, NotePlayer } from '@slopfactory/core/audio';
import { loadOutputFx } from '@slopfactory/core/dsp';
import type { NoteItem } from '../engine/engine';
import type { Project } from '../engine/types';
import type { SampleLibrary } from './library';
import { FX_SEED, makeChoke, makeResolver, masterCompressor, MAX_PER_VOICE, voiceStrips } from './routing';
import { audioOf, parseSoundKey, soundKey } from './settings';

/** Live audio runs at the export rate where the browser allows (it resamples to the device). */
export const LIVE_SAMPLE_RATE = 44100;

export class LiveAudio {
  ctx: AudioContext | null = null;
  volume = 0.8;
  /** output processing is running (false without AudioWorklet: audio plays unprocessed) */
  processing = false;
  private mixer: Mixer | null = null;
  private player: NotePlayer | null = null;
  private master: AudioNode | null = null;
  private fxAvailable = false;
  private voiceKey = '';
  private seq = 0;
  private starting: Promise<boolean> | null = null;

  constructor(
    private getProject: () => Project,
    private library: SampleLibrary,
    private workletUrl: string | null,
  ) {}

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Create / resume the audio context (must follow a user gesture). */
  async ensure(): Promise<boolean> {
    if (typeof AudioContext === 'undefined') return false;
    if (!this.ctx) {
      if (!this.starting) this.starting = this.create();
      if (!(await this.starting)) return false;
    }
    const ctx = this.ctx!;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    return ctx.state === 'running';
  }

  private async create(): Promise<boolean> {
    try {
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: LIVE_SAMPLE_RATE });
      } catch {
        ctx = new AudioContext({ latencyHint: 'interactive' });
      }
      this.fxAvailable = this.workletUrl ? await loadOutputFx(ctx, this.workletUrl) : false;
      this.processing = this.fxAvailable;
      this.ctx = ctx;
      this.build();
      return true;
    } catch {
      return false;
    }
  }

  /** (Re)build the mixer for the project's voices; the compressor stays. */
  private build(): void {
    const ctx = this.ctx!;
    const p = this.getProject();
    this.player?.stopAll(ctx.currentTime);
    this.mixer?.dispose();
    const a = audioOf(p);
    this.mixer = new Mixer(ctx, { voices: p.voices.map((v) => v.id), strips: voiceStrips(p), masterFx: a.master, masterGain: this.volume, fxAvailable: this.fxAvailable, seed: FX_SEED });
    if (!this.master) {
      this.master = masterCompressor(ctx, this.mixer.output);
      this.master.connect(ctx.destination);
    } else this.mixer.output.connect(this.master);
    this.player = new NotePlayer(ctx, this.mixer, makeResolver(this.getProject, this.library), { maxPerVoice: MAX_PER_VOICE, choke: makeChoke(this.getProject) });
    this.voiceKey = p.voices.map((v) => v.id).join('|');
  }

  /** Push changed settings to the running graph (processing crossfades in the worklet). */
  sync(): void {
    if (!this.ctx || !this.mixer) return;
    const p = this.getProject();
    if (p.voices.map((v) => v.id).join('|') !== this.voiceKey) {
      this.build();
      return;
    }
    for (const [id, s] of Object.entries(voiceStrips(p))) this.mixer.setStrip(id, s);
    this.mixer.setMasterFx(audioOf(p).master);
  }

  setVolume(v: number): void {
    this.volume = v;
    this.mixer?.setMasterGain(v);
  }

  /** performance.now() ms to AudioContext seconds (DOWNBEAT's original mapping). */
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

  /** Play a scheduled note (every pitch of its chord) at a performance.now() time. */
  play(item: NoteItem, ms: number, offMs?: number): void {
    if (!this.ctx || !this.player || this.ctx.state !== 'running') return;
    if (!this.mixer!.voices.includes(item.voice)) this.sync();
    if (!this.mixer!.voices.includes(item.voice)) return;
    const when = this.toCtxTime(ms);
    const off = offMs !== undefined ? Math.max(when, this.toCtxTime(offMs)) : when + 0.05;
    const instrument = soundKey(item.sound, item.note);
    for (const pitch of item.pitches) {
      const key = `n${this.seq++}`;
      this.player.noteOn(key, item.voice, { time: when, pitch, velocity: item.velocity, channel: item.channel, instrument });
      this.player.noteOff(key, off);
    }
  }

  /** Play one drum sound now, through the voice it belongs to (Sample Bank AUDITION). */
  audition(key: string, velocity = 110): boolean {
    const k = parseSoundKey(key);
    const v = k && this.getProject().voices.find((x) => x.id === k.voice);
    if (!v || !this.ctx || !this.player || this.ctx.state !== 'running') return false;
    const notes = v.notes[k!.step] ?? v.notes[0] ?? [60];
    const t = this.ctx.currentTime + 0.01;
    let ok = false;
    for (const pitch of notes) {
      const id = `a${this.seq++}`;
      ok = this.player.noteOn(id, v.id, { time: t, pitch, velocity, channel: v.channel, instrument: key }) || ok;
      this.player.noteOff(id, t + Math.max(0.05, v.gate * 0.02));
    }
    return ok;
  }

  /** Silence everything scheduled or sounding (stop, panic). */
  cancel(): void {
    if (!this.ctx || !this.player) return;
    this.player.stopAll(this.ctx.currentTime);
  }

  /** Restart processor state (live START), so processing begins like an export does. */
  resetFx(): void {
    if (this.ctx && this.mixer) this.mixer.resetFx(this.ctx.currentTime);
  }
}
