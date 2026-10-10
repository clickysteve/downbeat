/**
 * Lookahead scheduler: turns engine events into timestamped MIDI and sound.
 *
 * INTERNAL clock: a ticker (a Worker timer, which background tabs throttle far
 * less than main-thread timers) calls pump() every 25 ms. Each pump asks the
 * engine for everything before now + 100 ms, maps ticks to performance.now()
 * milliseconds through a tempo anchor, and hands notes to Web MIDI with
 * absolute timestamps, so JavaScript jitter never reaches the notes. Note-offs
 * wait in a queue until they too fall inside the window. No wall-clock timer
 * ever decides musical time: only the anchor maths does.
 *
 * EXTERNAL clock: incoming 24 PPQN MIDI Clock owns time. Pulse n *is* engine
 * tick n. Each pulse releases the events before the next pulse; events between
 * pulses (swing, shifts, flams) are placed by the measured pulse period. FA
 * Start, FB Continue, FC Stop and F2 Song Position drive the transport. Clock
 * while stopped never starts DOWNBEAT. Clock out is off while following, so
 * clock is never echoed back.
 *
 * Transport:
 *   start()  reset the engine and play from the beginning (FA, then F8s)
 *   pause()  stop at the horizon keeping all state (FC)
 *   resume() continue from exactly there (FB)
 *   stop()   silence at once, cancel queued notes, reset (FC, F2 0)
 */
import type { Engine, EngineItem, NoteItem } from '../engine/engine';
import { PPQ } from '../engine/types';
import { CLOCK, CONTINUE, SONG_POSITION, START, STOP, programChange, songPosition } from '../midi/messages';
import type { MidiOutput } from '../midi/output';
import { PulseEstimator } from './pulses';

export interface Ticker {
  start(fn: () => void, intervalMs: number): void;
  stop(): void;
}

export class IntervalTicker implements Ticker {
  private h: ReturnType<typeof setInterval> | null = null;
  start(fn: () => void, intervalMs: number): void {
    this.stop();
    this.h = setInterval(fn, intervalMs);
  }
  stop(): void {
    if (this.h !== null) clearInterval(this.h);
    this.h = null;
  }
}

/** Ticker in a dedicated Worker (falls back to setInterval). */
export class WorkerTicker implements Ticker {
  private worker: Worker | null = null;
  private fallback = new IntervalTicker();
  start(fn: () => void, intervalMs: number): void {
    this.stop();
    try {
      const src = 'let h=null;onmessage=(e)=>{if(h)clearInterval(h);h=null;if(e.data>0)h=setInterval(()=>postMessage(0),e.data)}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = () => fn();
      this.worker.postMessage(intervalMs);
    } catch {
      this.worker = null;
      this.fallback.start(fn, intervalMs);
    }
  }
  stop(): void {
    if (this.worker) {
      this.worker.postMessage(0);
      this.worker.terminate();
      this.worker = null;
    }
    this.fallback.stop();
  }
}

export type TransportState = 'stopped' | 'playing' | 'paused';
export type ClockSource = 'internal' | 'external';
/** External sync status, for display. */
export type SyncStatus = 'internal' | 'no-input' | 'waiting' | 'clock' | 'running' | 'stopped' | 'lost';

export const CLOCK_LOSS_MS = 500;

export interface NoteEvent {
  item: NoteItem;
  /** Onset (performance.now() ms). */
  ms: number;
  offMs: number;
}

export type SchedulerEvent =
  | { type: 'transport'; state: TransportState }
  | { type: 'note'; note: NoteEvent }
  | { type: 'tempo'; bpm: number }
  | { type: 'sync'; status: SyncStatus }
  | { type: 'realtime'; message: 'Start' | 'Continue' | 'Stop' | 'Song Position'; t: number };

interface PendingOff {
  tick: number;
  id: number;
  channel: number;
  pitch: number;
}

export interface SchedulerOptions {
  lookaheadMs: number;
  intervalMs: number;
  startLatencyMs: number;
}

export const DEFAULT_OPTIONS: SchedulerOptions = { lookaheadMs: 100, intervalMs: 25, startLatencyMs: 40 };

export class Scheduler {
  state: TransportState = 'stopped';
  bpm: number;
  opts: SchedulerOptions;
  source: ClockSource = 'internal';
  /** Send MIDI Clock and transport (forced off while following an external clock). */
  clockOutSetting = false;
  /** Send program changes at Start. */
  programOnStart = true;
  readonly pulses = new PulseEstimator();
  readonly ext = {
    nextTick: 0,
    anchorTick: 0,
    anchorMs: 0,
    lastPulseMs: -Infinity,
    pulseCount: 0,
    lost: false,
    inputReady: false,
  };
  private anchorTick = 0;
  private anchorMs = 0;
  private pauseTick = 0;
  private clockTick = 0;
  private pending: PendingOff[] = [];
  private endAt: number | null = null;
  private listeners = new Set<(e: SchedulerEvent) => void>();
  private lastStatus: SyncStatus = 'internal';

  constructor(
    public engine: Engine,
    public out: MidiOutput,
    private now: () => number,
    private ticker: Ticker,
    opts: Partial<SchedulerOptions> = {},
  ) {
    this.bpm = engine.project.tempo;
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  on(fn: (e: SchedulerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: SchedulerEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get external(): boolean {
    return this.source === 'external';
  }

  get clockOut(): boolean {
    return this.clockOutSetting && !this.external;
  }

  get msPerTick(): number {
    if (this.external) {
      const p = this.pulses.periodMs();
      if (p !== null && p > 0) return p;
    }
    return 60000 / (this.bpm * PPQ);
  }

  tickToMs(t: number): number {
    if (this.external) return this.ext.anchorMs + (t - this.ext.anchorTick) * this.msPerTick;
    return this.anchorMs + (t - this.anchorTick) * this.msPerTick;
  }

  msToTick(ms: number): number {
    if (this.external) return this.ext.anchorTick + (ms - this.ext.anchorMs) / this.msPerTick;
    return this.anchorTick + (ms - this.anchorMs) / this.msPerTick;
  }

  /** Transport position (ticks) as heard now. */
  positionTick(): number {
    if (this.state === 'playing' && this.external) return Math.max(0, Math.min(this.engine.horizon, this.ext.anchorTick));
    if (this.state === 'playing') return Math.max(0, Math.min(this.engine.horizon, this.msToTick(this.now())));
    if (this.state === 'paused') return this.pauseTick;
    return 0;
  }

  // ------------------------------------------------------------------ internal transport

  start(): void {
    if (this.external) return;
    if (this.state !== 'stopped') this.stop();
    this.engine.reset();
    this.pending = [];
    this.endAt = null;
    this.anchorTick = 0;
    this.anchorMs = this.now() + this.opts.startLatencyMs;
    this.clockTick = 0;
    this.bpm = this.engine.project.tempo;
    this.sendPrograms(this.anchorMs - 1);
    if (this.clockOut) this.out.send([START], this.anchorMs);
    this.state = 'playing';
    this.emit({ type: 'transport', state: this.state });
    this.ticker.start(() => this.pump(), this.opts.intervalMs);
    this.pump();
  }

  pause(): void {
    if (this.external || this.state !== 'playing') return;
    this.pauseTick = this.engine.horizon;
    const pms = this.tickToMs(this.pauseTick);
    this.flushPending(this.pauseTick);
    this.releasePending(pms);
    if (this.clockOut) this.out.send([STOP], pms);
    this.ticker.stop();
    this.state = 'paused';
    this.emit({ type: 'transport', state: this.state });
  }

  resume(): void {
    if (this.external || this.state !== 'paused') return;
    this.anchorTick = this.pauseTick;
    this.anchorMs = this.now() + this.opts.startLatencyMs;
    this.clockTick = Math.ceil(this.pauseTick);
    if (this.clockOut) this.out.send([CONTINUE], this.anchorMs);
    this.state = 'playing';
    this.emit({ type: 'transport', state: this.state });
    this.ticker.start(() => this.pump(), this.opts.intervalMs);
    this.pump();
  }

  /** Play / pause toggle. */
  toggle(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
    else this.start();
  }

  stop(): void {
    if (!this.external) this.ticker.stop();
    this.out.releaseAll(true);
    this.pending = [];
    this.endAt = null;
    if (this.clockOut && this.state !== 'stopped') {
      const t = this.now();
      if (this.state === 'playing') this.out.send([STOP], t);
      this.out.send(songPosition(0), t);
    }
    this.state = 'stopped';
    this.pauseTick = 0;
    this.ext.lost = false;
    this.engine.reset();
    this.emit({ type: 'transport', state: this.state });
    this.syncChanged();
  }

  setTempo(bpm: number): void {
    const b = Math.min(300, Math.max(20, bpm));
    if (this.state === 'playing' && !this.external) {
      const h = this.engine.horizon;
      this.anchorMs = this.tickToMs(h);
      this.anchorTick = h;
    }
    this.bpm = b;
    this.emit({ type: 'tempo', bpm: b });
  }

  /** The ticker. INTERNAL: schedule up to now + lookahead. EXTERNAL: watchdog only. */
  pump(): void {
    if (this.external) {
      this.watchdog();
      return;
    }
    if (this.state !== 'playing') return;
    if (this.endAt !== null && this.positionTick() >= this.endAt) {
      this.stop();
      return;
    }
    const horizonTick = this.msToTick(this.now() + this.opts.lookaheadMs);
    if (horizonTick <= this.engine.horizon) return;
    this.advance(horizonTick);
  }

  private advance(horizonTick: number): void {
    const items = this.engine.generate(horizonTick);
    for (const it of items) this.handle(it);
    this.flushClock(horizonTick, false);
    this.flushPending(horizonTick, false);
  }

  private handle(it: EngineItem): void {
    this.flushClock(it.tick, true);
    this.flushPending(it.tick, true);
    if (it.type === 'tempo') {
      if (!this.external && Math.abs(it.bpm - this.bpm) > 1e-9) {
        this.anchorMs = this.tickToMs(it.tick);
        this.anchorTick = it.tick;
        this.bpm = it.bpm;
        this.emit({ type: 'tempo', bpm: it.bpm });
      }
      return;
    }
    if (it.type === 'end') {
      if (!this.external) this.endAt = it.tick;
      return;
    }
    const ms = this.tickToMs(it.tick);
    const offTick = it.tick + it.duration;
    for (const pitch of it.pitches) {
      const id = this.out.noteOn(it.channel, pitch, it.velocity, ms);
      this.insertPending({ tick: offTick, id, channel: it.channel, pitch });
    }
    this.emit({ type: 'note', note: { item: it, ms, offMs: this.tickToMs(offTick) } });
  }

  private flushClock(until: number, inclusive: boolean): void {
    while (inclusive ? this.clockTick <= until : this.clockTick < until) {
      if (this.clockOut) this.out.send([CLOCK], this.tickToMs(this.clockTick));
      this.clockTick++;
    }
  }

  private flushPending(until: number, inclusive = false): void {
    while (this.pending.length) {
      const p = this.pending[0]!;
      if (inclusive ? p.tick > until : p.tick >= until) break;
      this.pending.shift();
      this.out.noteOff(p.channel, p.pitch, p.id, this.tickToMs(p.tick));
    }
  }

  private insertPending(p: PendingOff): void {
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1]!.tick > p.tick) i--;
    this.pending.splice(i, 0, p);
  }

  private releasePending(ms: number): void {
    for (const p of this.pending) this.out.noteOff(p.channel, p.pitch, p.id, ms);
    this.pending = [];
  }

  private sendPrograms(t: number): void {
    if (!this.programOnStart) return;
    const done = new Set<number>();
    for (const v of this.engine.project.voices) {
      if (v.program === null || done.has(v.channel)) continue;
      done.add(v.channel);
      this.out.send(programChange(v.channel, v.program), t);
    }
  }

  /** Audition one voice now (clicking a voice name or painting a strike). */
  audition(item: Omit<NoteItem, 'tick' | 'cycle' | 'step'>): void {
    const ms = this.now() + 5;
    const offMs = ms + Math.max(0.5, item.duration) * this.msPerTick;
    for (const pitch of item.pitches) {
      const id = this.out.noteOn(item.channel, pitch, item.velocity, ms);
      this.out.noteOff(item.channel, pitch, id, offMs);
    }
    this.emit({ type: 'note', note: { item: { ...item, tick: -1, cycle: -1, step: -1 }, ms, offMs } });
  }

  dispose(): void {
    this.ticker.stop();
  }

  // ------------------------------------------------------------------ external clock

  /** Changing source always stops: the two sources disagree about where "now" is. */
  setSource(source: ClockSource): void {
    if (source === this.source) return;
    this.stop();
    this.ticker.stop();
    this.source = source;
    this.pulses.reset();
    Object.assign(this.ext, { nextTick: 0, anchorTick: 0, anchorMs: this.now(), lastPulseMs: -Infinity, pulseCount: 0, lost: false });
    if (this.external) this.ticker.start(() => this.pump(), this.opts.intervalMs);
    this.syncChanged();
  }

  setInputReady(ready: boolean): void {
    this.ext.inputReady = ready;
    this.syncChanged();
  }

  /** Feed incoming MIDI bytes. Acts on F8, FA, FB, FC and F2 only. */
  receive(bytes: ArrayLike<number>, t: number): void {
    if (!this.external) return;
    const now = this.now();
    const ts = Number.isFinite(t) && t > 0 && t <= now + 5 && t >= now - 1000 ? t : now;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      if (b === CLOCK) this.pulse(ts);
      else if (b === START) this.extStart(ts);
      else if (b === CONTINUE) this.extContinue(ts);
      else if (b === STOP) this.extStop(ts);
      else if (b === SONG_POSITION && i + 2 < bytes.length) {
        this.extSongPosition((bytes[i + 1]! & 0x7f) | ((bytes[i + 2]! & 0x7f) << 7), ts);
        i += 2;
      }
    }
  }

  private pulse(t: number): void {
    this.pulses.add(t);
    this.ext.pulseCount++;
    this.ext.lastPulseMs = t;
    if (this.state !== 'playing') {
      this.syncChanged();
      return;
    }
    const tick = this.ext.nextTick;
    this.ext.anchorTick = tick;
    this.ext.anchorMs = t;
    this.ext.nextTick = tick + 1;
    if (this.ext.lost) this.ext.lost = false;
    this.advance(tick + 1);
    this.syncChanged();
  }

  private extStart(t: number): void {
    this.emit({ type: 'realtime', message: 'Start', t });
    if (this.state !== 'stopped') this.out.releaseAll(true);
    this.engine.reset();
    this.pending = [];
    this.pauseTick = 0;
    Object.assign(this.ext, { nextTick: 0, anchorTick: 0, anchorMs: t, lost: false });
    this.sendPrograms(t);
    this.state = 'playing';
    this.emit({ type: 'transport', state: this.state });
    this.syncChanged();
  }

  private extContinue(t: number): void {
    this.emit({ type: 'realtime', message: 'Continue', t });
    if (this.state === 'playing') return;
    const from = this.state === 'paused' ? this.pauseTick : this.engine.horizon;
    if (this.engine.horizon !== from) this.engine.seek(from);
    Object.assign(this.ext, { nextTick: from, anchorTick: from, anchorMs: t, lost: false });
    this.state = 'playing';
    this.emit({ type: 'transport', state: this.state });
    this.syncChanged();
  }

  private extStop(t: number): void {
    this.emit({ type: 'realtime', message: 'Stop', t });
    if (this.state !== 'playing') return;
    this.pauseTick = this.engine.horizon;
    this.releasePending(Math.max(this.now(), this.tickToMs(this.pauseTick)));
    this.ext.lost = false;
    this.state = 'paused';
    this.emit({ type: 'transport', state: this.state });
    this.syncChanged();
  }

  /** F2 while not running: move to the position (MIDI beats = 6 clocks); FB continues from there. */
  private extSongPosition(beats: number, t: number): void {
    this.emit({ type: 'realtime', message: 'Song Position', t });
    if (this.state === 'playing') return;
    const tick = beats * 6;
    this.engine.seek(tick);
    this.pauseTick = tick;
    this.pending = [];
    this.state = tick === 0 ? 'stopped' : 'paused';
    this.emit({ type: 'transport', state: this.state });
    this.syncChanged();
  }

  /** The clock stopped arriving while running: release notes, hold position. */
  clockInterrupted(): void {
    if (!this.external) return;
    this.pulses.reset();
    if (this.state === 'playing' && !this.ext.lost) {
      this.ext.lost = true;
      this.releasePending(Math.max(this.now(), this.tickToMs(this.engine.horizon)));
    }
    this.syncChanged();
  }

  private watchdog(): void {
    if (this.state === 'playing' && !this.ext.lost && this.now() - Math.max(this.ext.lastPulseMs, this.ext.anchorMs) > CLOCK_LOSS_MS) {
      this.clockInterrupted();
      return;
    }
    this.syncChanged();
  }

  syncStatus(): SyncStatus {
    if (!this.external) return 'internal';
    if (!this.ext.inputReady) return this.state === 'playing' ? 'lost' : 'no-input';
    if (this.state === 'playing') return this.ext.lost ? 'lost' : 'running';
    if (this.state === 'paused') return 'stopped';
    return this.now() - this.ext.lastPulseMs < CLOCK_LOSS_MS ? 'clock' : 'waiting';
  }

  private syncChanged(): void {
    const s = this.syncStatus();
    if (s === this.lastStatus) return;
    this.lastStatus = s;
    this.emit({ type: 'sync', status: s });
  }
}
