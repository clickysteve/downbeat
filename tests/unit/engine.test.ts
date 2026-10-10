import { describe, expect, it } from 'vitest';
import { Engine, renderCycles } from '../../src/engine/engine';
import { DENSITY_WEIGHT } from '../../src/engine/realize';
import { regrid, reverse, rotate, doubleLength } from '../../src/engine/patternOps';
import { geometry } from '../../src/engine/types';
import { makePattern } from '../../src/engine/defaults';
import { notesOf, put, sig, smallProject } from './helpers';

const CYCLE = 16 * 6; // 16 sixteenths of 6 ticks

describe('timing and voices', () => {
  it('places strikes on the grid with each voice on its own channel and note', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 'k', [0, 8]);
    put(p, 's', [4, 12]);
    pr.voices[1]!.channel = 2;
    const e = new Engine(pr);
    const ns = notesOf(e.generate(CYCLE));
    expect(ns.map((n) => [n.tick, n.voice, n.channel, n.pitches[0]])).toEqual([
      [0, 'k', 10, 36],
      [24, 's', 2, 38],
      [48, 'k', 10, 36],
      [72, 's', 2, 38],
    ]);
  });

  it('geometry follows time signature, bars and grid', () => {
    expect(geometry({ beats: 4, unit: 4, bars: 1, grid: 4 })).toMatchObject({ steps: 16, stepTicks: 6 });
    expect(geometry({ beats: 7, unit: 8, bars: 2, grid: 2 })).toMatchObject({ steps: 28, stepTicks: 6, stepsPerBar: 14 });
    expect(geometry({ beats: 4, unit: 4, bars: 1, grid: 3 })).toMatchObject({ steps: 12, stepTicks: 8 });
  });

  it('loops the pattern cycle after cycle', () => {
    const pr = smallProject();
    put(pr.patterns[0]!, 'k', [0]);
    const e = new Engine(pr);
    const ns = notesOf(e.generate(CYCLE * 3));
    expect(ns.map((n) => n.tick)).toEqual([0, 96, 192]);
    expect(ns.map((n) => n.cycle)).toEqual([0, 1, 2]);
  });

  it('emits the same events whatever the window sizes', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 'k', [0, 3, 8, 11], 4);
    put(p, 'h', [0, 2, 4, 6, 8, 10, 12, 14], 0, { s: 0 });
    p.tracks.h!.density = 60;
    p.tracks.h!.timing = 6;
    p.tracks.s!.fill = { ...p.tracks.s!.fill, on: true, amount: 50, rate: 2, max: 3 };
    put(p, 's', [4, 12], 5);
    const a = new Engine(pr);
    const big = notesOf(a.generate(CYCLE * 4));
    const b = new Engine(pr);
    const small: ReturnType<typeof notesOf> = [];
    for (let t = 1; t <= CYCLE * 4; t += 1.7) small.push(...notesOf(b.generate(t)));
    small.push(...notesOf(b.generate(CYCLE * 4)));
    expect(sig(small)).toEqual(sig(big));
  });
});

describe('velocity, accents, sound steps, flam', () => {
  it('each striker uses its centre ± range; accents are loudest', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    for (let l = 1; l <= 5; l++) put(p, 'k', [(l - 1) * 3], l);
    const ns = notesOf(new Engine(pr).generate(CYCLE * 8));
    const t = p.tracks.k!;
    for (const n of ns) {
      const c = t.vel.center[n.level - 1]!;
      const r = t.vel.range[n.level - 1]!;
      expect(n.velocity).toBeGreaterThanOrEqual(c - r);
      expect(n.velocity).toBeLessThanOrEqual(Math.min(127, c + r));
    }
    const acc = ns.filter((n) => n.level === 5);
    expect(Math.min(...acc.map((n) => n.velocity))).toBeGreaterThan(Math.max(...ns.filter((n) => n.level < 5).map((n) => n.velocity)));
  });

  it('the random striker draws levels by the Random Velocity weights', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 'k', [...Array(16).keys()], 0);
    p.tracks.k!.vel.weights = [0, 0, 0, 0, 1];
    const ns = notesOf(new Engine(pr).generate(CYCLE * 2));
    expect(new Set(ns.map((n) => n.level))).toEqual(new Set([5]));
  });

  it('random step chooses among the voice step list; fixed step plays that step', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 'h', [...Array(16).keys()], 3, { s: 0 });
    put(p, 's', [4], 3, { s: 2 });
    const ns = notesOf(new Engine(pr).generate(CYCLE * 4));
    const hats = new Set(ns.filter((n) => n.voice === 'h').map((n) => n.pitches[0]));
    expect(hats).toEqual(new Set([42, 44, 46]));
    expect(ns.filter((n) => n.voice === 's').every((n) => n.pitches[0] === 40)).toBe(true);
  });

  it('a flam adds a softer grace note one tick earlier, never before the start', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 's', [0, 4], 4, { f: true });
    const ns = notesOf(new Engine(pr).generate(CYCLE));
    const flams = ns.filter((n) => n.kind === 'flam' && n.cycle === 0);
    expect(flams.map((n) => n.tick)).toEqual([0, 23]);
    const main = ns.find((n) => n.kind === 'source' && n.tick === 24)!;
    expect(flams[1]!.velocity).toBeLessThan(main.velocity);
  });
});

describe('density', () => {
  it('100 % plays everything, 0 % nothing, and never edits the source', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 'h', [0, 2, 4, 6, 8, 10, 12, 14]);
    const before = JSON.stringify(p.tracks.h!.strikes);
    expect(notesOf(new Engine(pr).generate(CYCLE)).length).toBe(8);
    p.tracks.h!.density = 0;
    expect(notesOf(new Engine(pr).generate(CYCLE * 4)).length).toBe(0);
    expect(JSON.stringify(p.tracks.h!.strikes)).toBe(before);
  });

  it('50 % plays a changing subset of the written notes', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 's', [...Array(16).keys()]);
    p.tracks.s!.density = 50;
    const e = new Engine(pr);
    const ns = notesOf(e.generate(CYCLE * 20));
    const frac = ns.length / (16 * 20);
    expect(frac).toBeGreaterThan(0.38);
    expect(frac).toBeLessThan(0.62);
    const perCycle = new Set<string>();
    for (let c = 0; c < 20; c++) perCycle.add(ns.filter((n) => n.cycle === c).map((n) => n.step).join(','));
    expect(perCycle.size).toBeGreaterThan(15);
    // Display reports the suppressed strikes.
    const real = e.realization(e.plans[e.plans.length - 1]!);
    const cells = real.cells.s!;
    expect(cells.filter((c) => c.suppressed === 'density').length + cells.filter((c) => c.played).length).toBe(16);
  });

  it('accents survive thinning more often than ghosts', () => {
    expect(DENSITY_WEIGHT[4]).toBeLessThan(DENSITY_WEIGHT[0]!);
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 'k', [0, 2, 4, 6, 8, 10, 12, 14], 5);
    put(p, 'k', [1, 3, 5, 7, 9, 11, 13, 15], 1);
    p.tracks.k!.density = 40;
    const ns = notesOf(new Engine(pr).generate(CYCLE * 40));
    const acc = ns.filter((n) => n.level === 5).length;
    const ghost = ns.filter((n) => n.level === 1).length;
    expect(acc).toBeGreaterThan(ghost * 1.8);
  });
});

describe('timing, shift and rotation', () => {
  it('shift moves a whole track by fine units; timing stays within ±', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 's', [4, 12]);
    p.tracks.s!.shift = 8; // 2 ticks late
    let ns = notesOf(new Engine(pr).generate(CYCLE));
    expect(ns.map((n) => n.tick)).toEqual([26, 74]);
    p.tracks.s!.shift = 0;
    p.tracks.s!.timing = 8;
    ns = notesOf(new Engine(pr).generate(CYCLE * 10));
    for (const n of ns) expect(Math.abs(n.tick - (n.step * 6 + n.cycle * CYCLE))).toBeLessThanOrEqual(2 + 1e-9);
    expect(new Set(ns.map((n) => (n.tick % 6).toFixed(3))).size).toBeGreaterThan(3);
  });

  it('early notes on the first step never fall before the transport start', () => {
    const pr = smallProject();
    put(pr.patterns[0]!, 'k', [0]);
    pr.patterns[0]!.tracks.k!.shift = -8;
    const ns = notesOf(new Engine(pr).generate(CYCLE * 2));
    expect(ns[0]!.tick).toBe(0);
    expect(ns[1]!.tick).toBe(CYCLE - 2);
  });

  it('rotate wraps around within the loop; reverse mirrors', () => {
    const pr = smallProject();
    const t = pr.patterns[0]!.tracks.k!;
    put(pr.patterns[0]!, 'k', [0, 15]);
    rotate(t, 1);
    expect(t.strikes.map((s, i) => (s ? i : -1)).filter((i) => i >= 0)).toEqual([0, 1]);
    rotate(t, -2);
    expect(t.strikes.map((s, i) => (s ? i : -1)).filter((i) => i >= 0)).toEqual([14, 15]);
    reverse(t);
    expect(t.strikes.map((s, i) => (s ? i : -1)).filter((i) => i >= 0)).toEqual([0, 1]);
  });

  it('regrid keeps strikes at their musical positions; double copies', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 'k', [0, 4, 6]);
    regrid(p, { grid: 2 });
    expect(p.tracks.k!.strikes.length).toBe(8);
    expect(p.tracks.k!.strikes.map((s, i) => (s ? i : -1)).filter((i) => i >= 0)).toEqual([0, 2, 3]);
    doubleLength(p);
    expect(p.bars).toBe(2);
    expect(p.tracks.k!.strikes.map((s, i) => (s ? i : -1)).filter((i) => i >= 0)).toEqual([0, 2, 3, 8, 10, 11]);
  });
});

describe('fills', () => {
  const fillProject = () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 's', [4, 12], 5);
    p.tracks.s!.fill = { ...p.tracks.s!.fill, on: true, amount: 100, rate: 1, spacing: 0, max: 16, zone: 'all' };
    return { pr, p };
  };

  it('fill notes only go into empty space and are generated, not written', () => {
    const { pr, p } = fillProject();
    const before = JSON.stringify(p.tracks.s!.strikes);
    const ns = notesOf(new Engine(pr).generate(CYCLE));
    const fills = ns.filter((n) => n.kind === 'fill');
    expect(fills.length).toBe(14);
    expect(fills.some((n) => n.step === 4 || n.step === 12)).toBe(false);
    expect(JSON.stringify(p.tracks.s!.strikes)).toBe(before);
  });

  it('spacing keeps fills away from written strikes; MAX limits each gap and fills lead into the next strike', () => {
    const { pr, p } = fillProject();
    p.tracks.s!.fill.spacing = 1;
    p.tracks.s!.fill.max = 2;
    const ns = notesOf(new Engine(pr).generate(CYCLE));
    const steps = ns.filter((n) => n.kind === 'fill').map((n) => n.step).sort((a, b) => a - b);
    // Gaps (5..11) and (13..3 wrapped); spacing 1 excludes 3,5,11,13; the last two before each strike.
    expect(steps).toEqual([1, 2, 9, 10]);
  });

  it('zone limits fills to the end of the cycle', () => {
    const { pr, p } = fillProject();
    p.tracks.s!.fill.zone = 'beat';
    const fills = notesOf(new Engine(pr).generate(CYCLE)).filter((n) => n.kind === 'fill');
    expect(fills.map((n) => n.step).sort((a, b) => a - b)).toEqual([13, 14, 15]);
  });

  it('rate subdivides the grid; another voice can play the fill', () => {
    const { pr, p } = fillProject();
    p.tracks.s!.fill.rate = 2;
    p.tracks.s!.fill.zone = 'beat';
    p.tracks.s!.fill.sound = 't';
    const fills = notesOf(new Engine(pr).generate(CYCLE)).filter((n) => n.kind === 'fill');
    expect(fills.length).toBe(7); // 12.5, 13, 13.5, 14, 14.5, 15, 15.5
    expect(fills.every((n) => n.sound === 't' && n.pitches[0] === 45 && n.voice === 's')).toBe(true);
  });

  it('fills change each cycle, replay identically for a seed, and follow the amount', () => {
    const { pr, p } = fillProject();
    p.tracks.s!.fill.amount = 40;
    const a = notesOf(new Engine(pr).generate(CYCLE * 12)).filter((n) => n.kind === 'fill');
    const b = notesOf(new Engine(pr).generate(CYCLE * 12)).filter((n) => n.kind === 'fill');
    expect(sig(a)).toEqual(sig(b));
    const per = new Set<string>();
    for (let c = 0; c < 12; c++) per.add(a.filter((n) => n.cycle === c).map((n) => n.step).join(','));
    expect(per.size).toBeGreaterThan(6);
    pr.seed = 999;
    const c = notesOf(new Engine(pr).generate(CYCLE * 12)).filter((n) => n.kind === 'fill');
    expect(sig(c)).not.toEqual(sig(a));
  });

  it('a fill note before an accent is raised one striker level', () => {
    const { pr, p } = fillProject();
    p.tracks.s!.fill.weights = [100, 0, 0, 0, 0];
    const fills = notesOf(new Engine(pr).generate(CYCLE)).filter((n) => n.kind === 'fill');
    expect(new Set(fills.map((n) => n.level))).toEqual(new Set([2]));
  });
});

describe('loops and polymeter', () => {
  it('a 7-step loop drifts against a 16-step pattern', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 't', [0]);
    p.tracks.t!.loop = 7;
    const ns = notesOf(new Engine(pr).generate(CYCLE * 2));
    expect(ns.map((n) => n.tick / 6)).toEqual([0, 7, 14, 21, 28]);
  });

  it('loop % sometimes plays on past the loop point', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 't', [0]);
    put(p, 't', [10], 2);
    p.tracks.t!.loop = 8;
    p.tracks.t!.loopPct = 50;
    const ns = notesOf(new Engine(pr).generate(CYCLE * 16));
    const late = ns.filter((n) => n.level === 2).length;
    expect(late).toBeGreaterThan(0);
    expect(ns.filter((n) => n.level === 3).length).toBeGreaterThan(late);
  });

  it('RESYNC realigns loops at the next cycle', () => {
    const pr = smallProject();
    put(pr.patterns[0]!, 't', [0]);
    pr.patterns[0]!.tracks.t!.loop = 5;
    const e = new Engine(pr);
    e.generate(40);
    e.resync();
    const ns = notesOf(e.generate(CYCLE * 2)).filter((n) => n.cycle === 1);
    expect(ns[0]!.tick).toBe(CYCLE); // without RESYNC: 120 (the loop is out of phase)
  });
});

describe('transport-level behaviour', () => {
  it('a selected pattern starts at the next cycle boundary', () => {
    const pr = smallProject();
    const b = makePattern(pr.voices, 'B');
    b.id = 'B';
    pr.patterns.push(b);
    put(pr.patterns[0]!, 'k', [0]);
    put(b, 's', [0]);
    const e = new Engine(pr);
    e.generate(40);
    pr.current = 'B';
    const ns = notesOf(e.generate(CYCLE * 2));
    expect(ns.map((n) => [n.tick, n.voice])).toEqual([[CYCLE, 's']]);
  });

  it('song mode plays entries with repeats and can end', () => {
    const pr = smallProject();
    const b = makePattern(pr.voices, 'B');
    b.id = 'B';
    pr.patterns.push(b);
    put(pr.patterns[0]!, 'k', [0]);
    put(b, 's', [0]);
    pr.playMode = 'song';
    pr.song = { entries: [{ patternId: 'A', repeats: 2 }, { patternId: 'B', repeats: 1 }], loop: false };
    const e = new Engine(pr);
    const items = e.generate(CYCLE * 6);
    expect(notesOf(items).map((n) => n.voice)).toEqual(['k', 'k', 's']);
    expect(items.filter((i) => i.type === 'end').map((i) => i.tick)).toEqual([CYCLE * 3]);
  });

  it('a pattern with its own tempo emits a tempo change at its start', () => {
    const pr = smallProject();
    pr.patterns[0]!.tempo = 90;
    const items = new Engine(pr).generate(CYCLE * 2);
    expect(items.filter((i) => i.type === 'tempo')).toEqual([{ type: 'tempo', tick: 0, bpm: 90 }]);
  });

  it('mute and solo act at emission; live edits are heard in the current cycle', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 'k', [0, 8]);
    put(p, 's', [4, 12]);
    const e = new Engine(pr);
    e.generate(30);
    pr.voices[0]!.mute = true;
    put(p, 's', [10]);
    e.touch();
    const ns = notesOf(e.generate(CYCLE));
    expect(ns.map((n) => [n.tick, n.voice])).toEqual([
      [60, 's'],
      [72, 's'],
    ]);
    pr.voices[0]!.mute = false;
    pr.voices[1]!.solo = true;
    expect(notesOf(e.generate(CYCLE * 2)).every((n) => n.voice === 's')).toBe(true);
  });

  it('JAM ROLL superimposes a continuous roll while held', () => {
    const pr = smallProject();
    put(pr.patterns[0]!, 's', [4]);
    const e = new Engine(pr);
    e.setJam('s', 'roll');
    const ns = notesOf(e.generate(CYCLE));
    expect(ns.filter((n) => n.kind === 'jam').length).toBe(16);
    e.setJam('s', null);
    expect(notesOf(e.generate(CYCLE * 2)).filter((n) => n.kind === 'jam').length).toBe(0);
  });

  it('SOURCE plays the written pattern plainly; LOCK repeats one variation', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 'h', [...Array(16).keys()]);
    p.tracks.h!.density = 50;
    const e = new Engine(pr);
    e.sourceOnly = true;
    expect(notesOf(e.generate(CYCLE)).length).toBe(16);
    const l = new Engine(pr);
    l.lockKey = 3;
    const ns = notesOf(l.generate(CYCLE * 4));
    const per = new Set<string>();
    for (let c = 0; c < 4; c++) per.add(ns.filter((n) => n.cycle === c).map((n) => `${n.step}:${n.velocity}`).join(','));
    expect(per.size).toBe(1);
  });

  it('seek reproduces the same events as playing through', () => {
    const pr = smallProject();
    const p = pr.patterns[0]!;
    put(p, 'h', [...Array(16).keys()]);
    p.tracks.h!.density = 50;
    const a = notesOf(new Engine(pr).generate(CYCLE * 5)).filter((n) => n.tick >= CYCLE * 3);
    const e = new Engine(pr);
    e.seek(CYCLE * 3);
    expect(sig(notesOf(e.generate(CYCLE * 5)))).toEqual(sig(a));
  });

  it('renderCycles renders a fixed number of cycles', () => {
    const pr = smallProject();
    put(pr.patterns[0]!, 'k', [0, 8]);
    const r = renderCycles(pr, 3);
    expect(r.notes.length).toBe(6);
    expect(r.endTick).toBe(CYCLE * 3);
  });
});
