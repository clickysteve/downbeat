import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine/engine';
import { MidiOutput, type MidiSink } from '../../src/midi/output';
import { Scheduler, type SchedulerEvent, type Ticker } from '../../src/scheduler/scheduler';
import { noteName, parseNote, parseNotes } from '../../src/midi/messages';
import { put, smallProject } from './helpers';
import { makePattern } from '../../src/engine/defaults';

type Msg = { bytes: number[]; t: number };

class FakeSink implements MidiSink {
  id = 'fake';
  name = 'Fake';
  msgs: Msg[] = [];
  constructor(private clock: { now: number }, private canClear = true) {}
  send(bytes: number[], t?: number): void {
    this.msgs.push({ bytes: [...bytes], t: t ?? this.clock.now });
  }
  get clear(): (() => void) | undefined {
    if (!this.canClear) return undefined;
    return () => {
      this.msgs = this.msgs.filter((m) => m.t <= this.clock.now);
    };
  }
}

class ManualTicker implements Ticker {
  fn: (() => void) | null = null;
  start(fn: () => void): void {
    this.fn = fn;
  }
  stop(): void {
    this.fn = null;
  }
}

function rig(setup?: (p: ReturnType<typeof smallProject>) => void) {
  const pr = smallProject();
  const p = pr.patterns[0]!;
  put(p, 'k', [0, 8], 4);
  put(p, 's', [4, 12], 5);
  put(p, 'h', [0, 2, 4, 6, 8, 10, 12, 14]);
  setup?.(pr);
  const clock = { now: 1000 };
  const engine = new Engine(pr);
  const out = new MidiOutput(() => clock.now);
  const sink = new FakeSink(clock);
  out.setSink(sink);
  const ticker = new ManualTicker();
  const sched = new Scheduler(engine, out, () => clock.now, ticker);
  const events: SchedulerEvent[] = [];
  sched.on((e) => events.push(e));
  /** Advance time, pumping every 25 ms like the real ticker. */
  const run = (ms: number) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now = Math.min(end, clock.now + 25);
      ticker.fn?.();
    }
  };
  return { pr, clock, engine, out, sink, sched, events, run, ticker };
}

const isOn = (m: Msg) => (m.bytes[0]! & 0xf0) === 0x90 && m.bytes[2]! > 0;
const isOff = (m: Msg) => (m.bytes[0]! & 0xf0) === 0x80;
const is = (b: number) => (m: Msg) => m.bytes[0] === b;

/** Notes left sounding after sorting all messages by time. */
function hanging(msgs: Msg[]): string[] {
  const held = new Map<string, number>();
  const sorted = msgs.map((m, i) => ({ m, i })).sort((a, b) => a.m.t - b.m.t || a.i - b.i);
  for (const { m } of sorted) {
    const k = `${m.bytes[0]! & 0x0f}:${m.bytes[1]}`;
    if (isOn(m)) held.set(k, (held.get(k) ?? 0) + 1);
    else if (isOff(m)) held.set(k, 0);
  }
  return [...held].filter(([, v]) => v > 0).map(([k]) => k);
}

describe('internal clock output', () => {
  it('sends Start, then 24 clocks per quarter at the tempo, then Stop and Song Position 0', () => {
    const r = rig();
    r.sched.clockOutSetting = true;
    r.sched.start();
    r.run(2000);
    r.sched.stop();
    const m = r.sink.msgs;
    const starts = m.filter(is(0xfa));
    expect(starts.length).toBe(1);
    const clocks = m.filter(is(0xf8)).map((x) => x.t);
    expect(clocks[0]).toBeCloseTo(starts[0]!.t, 6);
    const period = 60000 / (120 * 24);
    for (let i = 1; i < clocks.length; i++) expect(clocks[i]! - clocks[i - 1]!).toBeCloseTo(period, 6);
    expect(clocks.length).toBeGreaterThan(90);
    expect(m.filter(is(0xfc)).length).toBe(1);
    expect(m[m.length - 1]!.bytes).toEqual([0xf2, 0, 0]);
  });

  it('clock pulses line up with notes: the first kick is on the first clock', () => {
    const r = rig();
    r.sched.clockOutSetting = true;
    r.sched.start();
    r.run(500);
    const firstOn = r.sink.msgs.find(isOn)!;
    const firstClock = r.sink.msgs.find(is(0xf8))!;
    expect(firstOn.t).toBeCloseTo(firstClock.t, 6);
  });

  it('pause sends Stop and holds; continue sends Continue and resumes the clock count', () => {
    const r = rig();
    r.sched.clockOutSetting = true;
    r.sched.start();
    r.run(600);
    r.sched.pause();
    const pausedAt = r.sched.positionTick();
    const n = r.sink.msgs.filter(is(0xf8)).length;
    r.run(500);
    expect(r.sink.msgs.filter(is(0xf8)).length).toBe(n);
    expect(r.sched.state).toBe('paused');
    r.sched.resume();
    r.run(500);
    expect(r.sink.msgs.filter(is(0xfb)).length).toBe(1);
    expect(r.sink.msgs.filter(is(0xf8)).length).toBeGreaterThan(n);
    expect(r.sched.positionTick()).toBeGreaterThan(pausedAt);
    expect(hanging(r.sink.msgs).length).toBeLessThanOrEqual(3);
    r.sched.stop();
    expect(hanging(r.sink.msgs)).toEqual([]);
  });

  it('no clock and no transport bytes when CLOCK OUT is off', () => {
    const r = rig();
    r.sched.start();
    r.run(800);
    r.sched.stop();
    expect(r.sink.msgs.some((m) => m.bytes[0]! >= 0xf0)).toBe(false);
  });

  it('a second Start restarts cleanly with one Start byte each and no stuck notes', () => {
    const r = rig();
    r.sched.clockOutSetting = true;
    r.sched.start();
    r.run(300);
    r.sched.start();
    r.run(300);
    r.sched.stop();
    expect(r.sink.msgs.filter(is(0xfa)).length).toBe(2);
    expect(hanging(r.sink.msgs)).toEqual([]);
  });
});

describe('notes', () => {
  it('every note-on is followed by its note-off; stop leaves nothing hanging', () => {
    const r = rig((pr) => {
      pr.patterns[0]!.tracks.s!.fill = { ...pr.patterns[0]!.tracks.s!.fill, on: true, amount: 70, rate: 2, max: 4, sound: 't' };
    });
    r.sched.start();
    r.run(3000);
    r.sched.stop();
    const ons = r.sink.msgs.filter(isOn);
    expect(ons.length).toBeGreaterThan(20);
    expect(hanging(r.sink.msgs)).toEqual([]);
  });

  it('stop in the middle of long notes cancels queued messages and releases everything', () => {
    const r = rig((pr) => {
      pr.voices[0]!.gate = 48;
    });
    r.sched.start();
    r.run(330);
    r.sched.stop();
    expect(hanging(r.sink.msgs)).toEqual([]);
    expect(r.out.heldCount()).toBe(0);
  });

  it('without clear() support, emergency note-offs are stamped after queued messages', () => {
    const pr = smallProject();
    put(pr.patterns[0]!, 'k', [0, 4, 8, 12]);
    pr.voices[0]!.gate = 48;
    const clock = { now: 1000 };
    const out = new MidiOutput(() => clock.now);
    const sink = new FakeSink(clock, false);
    out.setSink(sink);
    const ticker = new ManualTicker();
    const s = new Scheduler(new Engine(pr), out, () => clock.now, ticker);
    s.start();
    clock.now += 25;
    ticker.fn?.();
    s.stop();
    expect(hanging(sink.msgs)).toEqual([]);
  });

  it('notes land exactly on the grid at the tempo', () => {
    const r = rig();
    r.sched.start();
    r.run(1100);
    const kicks = r.sink.msgs.filter((m) => isOn(m) && m.bytes[1] === 36).map((m) => m.t);
    expect(kicks[1]! - kicks[0]!).toBeCloseTo(1000, 6); // half a bar at 120 BPM
  });

  it('tempo changes re-anchor at the horizon: no gap, no overlap, new spacing after', () => {
    const r = rig((pr) => {
      put(pr.patterns[0]!, 'h', [...Array(16).keys()]);
    });
    r.sched.start();
    r.run(1000);
    r.sched.setTempo(60);
    r.run(2000);
    const hats = r.sink.msgs.filter((m) => isOn(m) && m.bytes[1] === 42).map((m) => m.t);
    const gaps = hats.slice(1).map((t, i) => t - hats[i]!);
    // Every gap is the old or new sixteenth, except one transition gap between them
    // (the re-anchor falls at the fractional horizon tick). Nothing overlaps.
    const odd = gaps.filter((g) => ![125, 250].some((x) => Math.abs(g - x) < 1e-6));
    expect(odd.length).toBeLessThanOrEqual(1);
    for (const g of odd) expect(g > 125 && g < 250).toBe(true);
    expect(gaps.filter((g) => Math.abs(g - 250) < 1e-6).length).toBeGreaterThan(4);
  });

  it('a pattern with its own tempo changes tempo at its start and back afterwards', () => {
    const r = rig((pr) => {
      const b = makePattern(pr.voices, 'B');
      b.id = 'B';
      b.tempo = 60;
      put(b, 'k', [0, 4, 8, 12]);
      pr.patterns.push(b);
      pr.playMode = 'song';
      pr.song = { entries: [{ patternId: 'A', repeats: 1 }, { patternId: 'B', repeats: 1 }], loop: true };
    });
    r.sched.start();
    r.run(7000);
    const tempos = r.events.filter((e) => e.type === 'tempo').map((e) => (e as { bpm: number }).bpm);
    expect(tempos.slice(0, 2)).toEqual([60, 120]);
  });

  it('a non-looping song stops the transport at its end', () => {
    const r = rig((pr) => {
      pr.playMode = 'song';
      pr.song = { entries: [{ patternId: 'A', repeats: 2 }], loop: false };
    });
    r.sched.start();
    r.run(5000);
    expect(r.sched.state).toBe('stopped');
    const kicks = r.sink.msgs.filter((m) => isOn(m) && m.bytes[1] === 36);
    expect(kicks.length).toBe(4);
    expect(hanging(r.sink.msgs)).toEqual([]);
  });

  it('device change releases held notes on the old device first', () => {
    const r = rig((pr) => {
      pr.voices[0]!.gate = 48;
    });
    r.sched.start();
    r.run(60);
    const other = new FakeSink(r.clock);
    r.out.setSink(other);
    expect(hanging(r.sink.msgs)).toEqual([]);
    r.run(2000);
    r.sched.stop();
    expect(hanging(other.msgs)).toEqual([]);
  });

  it('panic sends All Notes Off and All Sound Off on all 16 channels', () => {
    const r = rig();
    r.sched.start();
    r.run(100);
    r.out.panic();
    const cc = r.sink.msgs.filter((m) => (m.bytes[0]! & 0xf0) === 0xb0);
    expect(cc.length).toBe(32);
    expect(hanging(r.sink.msgs)).toEqual([]);
  });

  it('program changes are sent once per channel at Start', () => {
    const r = rig((pr) => {
      pr.voices[0]!.program = 5;
      pr.voices[1]!.program = 7; // same channel 10: only the first is sent
    });
    r.sched.start();
    r.run(100);
    const pcs = r.sink.msgs.filter((m) => (m.bytes[0]! & 0xf0) === 0xc0);
    expect(pcs.map((m) => m.bytes)).toEqual([[0xc9, 5]]);
  });
});

describe('external clock', () => {
  const pulses = (r: ReturnType<typeof rig>, n: number, bpm = 120) => {
    const period = 60000 / (bpm * 24);
    for (let i = 0; i < n; i++) {
      r.clock.now += period;
      r.sched.receive([0xf8], r.clock.now);
      if (i % 3 === 0) r.ticker.fn?.();
    }
  };

  it('clock while stopped never starts; FA starts; pulses advance one tick each', () => {
    const r = rig();
    r.sched.setSource('external');
    r.sched.setInputReady(true);
    pulses(r, 48);
    expect(r.sink.msgs.filter(isOn)).toEqual([]);
    expect(r.sched.syncStatus()).toBe('clock');
    r.sched.receive([0xfa], r.clock.now);
    pulses(r, 96);
    expect(r.sched.syncStatus()).toBe('running');
    const kicks = r.sink.msgs.filter((m) => isOn(m) && m.bytes[1] === 36);
    expect(kicks.length).toBe(2);
    expect(r.sched.positionTick()).toBe(95);
  });

  it('FC pauses (notes released), FB continues from the same tick, FA restarts', () => {
    const r = rig();
    r.sched.setSource('external');
    r.sched.setInputReady(true);
    r.sched.receive([0xfa], r.clock.now);
    pulses(r, 30);
    r.sched.receive([0xfc], r.clock.now);
    expect(r.sched.state).toBe('paused');
    expect(hanging(r.sink.msgs)).toEqual([]);
    const before = r.sink.msgs.filter(isOn).length;
    pulses(r, 30);
    expect(r.sink.msgs.filter(isOn).length).toBe(before);
    r.sched.receive([0xfb], r.clock.now);
    pulses(r, 66);
    const kicks = r.sink.msgs.filter((m) => isOn(m) && m.bytes[1] === 36);
    expect(kicks.length).toBe(2); // tick 0 and tick 48: the paused 30 pulses did not advance
    r.sched.receive([0xfa], r.clock.now);
    pulses(r, 1);
    expect(r.sink.msgs.filter((m) => isOn(m) && m.bytes[1] === 36).length).toBe(3);
  });

  it('Song Position then Continue starts from that position', () => {
    const r = rig();
    r.sched.setSource('external');
    r.sched.setInputReady(true);
    r.sched.receive([0xf2, 8, 0], r.clock.now); // 8 sixteenths = tick 48
    r.sched.receive([0xfb], r.clock.now);
    pulses(r, 1);
    const ons = r.sink.msgs.filter(isOn);
    expect(ons.map((m) => m.bytes[1]).sort()).toEqual([36, 42]); // kick and hat on step 8, nothing from step 0
  });

  it('no clock output while following, and clock loss releases notes but holds position', () => {
    const r = rig((pr) => {
      pr.voices[0]!.gate = 48;
    });
    r.sched.clockOutSetting = true;
    r.sched.setSource('external');
    r.sched.setInputReady(true);
    r.sched.receive([0xfa], r.clock.now);
    pulses(r, 10);
    expect(r.sink.msgs.some((m) => m.bytes[0] === 0xf8)).toBe(false);
    const pos = r.sched.positionTick();
    r.clock.now += 600;
    r.ticker.fn?.();
    expect(r.sched.syncStatus()).toBe('lost');
    expect(hanging(r.sink.msgs)).toEqual([]);
    expect(r.sched.positionTick()).toBe(pos);
    pulses(r, 5);
    expect(r.sched.syncStatus()).toBe('running');
  });

  it('measures the incoming tempo', () => {
    const r = rig();
    r.sched.setSource('external');
    r.sched.setInputReady(true);
    pulses(r, 60, 140);
    expect(r.sched.pulses.bpm()).toBeCloseTo(140, 0);
  });

  it('INTERNAL ignores incoming realtime bytes; START is refused while EXTERNAL', () => {
    const r = rig();
    r.sched.receive([0xfa, 0xf8], r.clock.now);
    expect(r.sched.state).toBe('stopped');
    r.sched.setSource('external');
    r.sched.start();
    expect(r.sched.state).toBe('stopped');
  });
});

describe('note names', () => {
  it('parses numbers and names in the C3 = 60 convention, and round-trips with noteName', () => {
    expect(parseNote('36')).toBe(36);
    expect(parseNote('C1')).toBe(36);
    expect(parseNote('c#1')).toBe(37);
    expect(parseNote('Db1')).toBe(37);
    expect(parseNote('C3')).toBe(60);
    expect(parseNote('C-2')).toBe(0);
    expect(parseNote('G8')).toBe(127);
    expect(parseNote('G#8')).toBeNull();
    expect(parseNote('128')).toBeNull();
    expect(parseNote('H2')).toBeNull();
    for (let n = 0; n <= 127; n++) expect(parseNote(noteName(n))).toBe(n);
    expect(parseNotes('42+46')).toEqual([42, 46]);
    expect(parseNotes('F#1, A#1')).toEqual([42, 46]);
    expect(parseNotes('42+nope')).toBeNull();
    expect(parseNotes('')).toBeNull();
  });
});
