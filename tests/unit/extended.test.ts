import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine/engine';
import { Rng } from '../../src/engine/rng';
import { geometry, type Rule } from '../../src/engine/types';
import { makePattern } from '../../src/engine/defaults';
import { swingWarp } from '../../src/engine/groove';
import { distance, mutate, type TrackStrikes } from '../../src/extended/mutate';
import { breed, BREED_METHODS } from '../../src/extended/breed';
import { combine, euclid, euclidStrikes } from '../../src/extended/euclid';
import { morphTracks } from '../../src/extended/morph';
import { autoEffect, sectionOf } from '../../src/extended/auto';
import { evaluateRules } from '../../src/extended/rules';
import { history, notesOf, put, sig, smallProject } from './helpers';

const CYCLE = 96;
const geo16 = geometry({ beats: 4, unit: 4, bars: 1, grid: 4 });

function beat(): TrackStrikes {
  const pr = smallProject();
  const p = pr.patterns[0]!;
  put(p, 'k', [0, 8, 10], 4);
  put(p, 's', [4, 12], 5);
  put(p, 'h', [0, 2, 4, 6, 8, 10, 12, 14]);
  return Object.fromEntries(Object.entries(p.tracks).map(([k, t]) => [k, t.strikes]));
}
const lengths = { k: 16, s: 16, h: 16, t: 16 };

describe('euclidean rhythms', () => {
  it('spreads hits evenly, first on step 0', () => {
    const s = (b: boolean[]) => b.map((x) => (x ? 'x' : '.')).join('');
    expect(s(euclid(8, 3))).toBe('x..x..x.');
    expect(s(euclid(16, 4))).toBe('x...x...x...x...');
    expect(s(euclid(5, 2))).toBe('x..x.');
    expect(euclid(13, 5).filter(Boolean).length).toBe(5);
    expect(s(euclid(8, 3, 1))).toBe('.x..x..x');
    expect(s(euclid(4, 0))).toBe('....');
  });

  it('accents and combine modes', () => {
    const st = euclidStrikes({ steps: 8, hits: 4, rotation: 0, accent: 'first', accentHits: 0, level: 3 });
    expect(st.map((x) => (x ? x.v : 0))).toEqual([5, 0, 3, 0, 3, 0, 3, 0]);
    const ex = [{ v: 3, s: 1 }, null, null, { v: 3, s: 1 }];
    const gen = [{ v: 5, s: 1 }, { v: 5, s: 1 }, null, null];
    expect(combine(ex, gen, 'merge').map((x) => (x ? x.v : 0))).toEqual([3, 5, 0, 3]);
    expect(combine(ex, gen, 'intersect').map((x) => (x ? x.v : 0))).toEqual([3, 0, 0, 0]);
    expect(combine(ex, gen, 'xor').map((x) => (x ? x.v : 0))).toEqual([0, 5, 0, 3]);
    expect(combine(ex, gen, 'replace').map((x) => (x ? x.v : 0))).toEqual([5, 5, 0, 0]);
  });
});

describe('mutation', () => {
  it('low strength stays close to the source; high strength changes much more', () => {
    const src = beat();
    let low = 0;
    let high = 0;
    for (let i = 0; i < 30; i++) {
      low += distance(src, mutate(src, lengths, geo16, new Rng(i + 1), 0.1).tracks, lengths);
      high += distance(src, mutate(src, lengths, geo16, new Rng(i + 1), 1).tracks, lengths);
    }
    expect(low / 30).toBeLessThan(0.15);
    expect(high / 30).toBeGreaterThan(low / 30 * 3);
  });

  it('never edits its input, is deterministic, and respects targets', () => {
    const src = beat();
    const before = JSON.stringify(src);
    const a = mutate(src, lengths, geo16, new Rng(7), 0.8, ['h']);
    const b = mutate(src, lengths, geo16, new Rng(7), 0.8, ['h']);
    expect(JSON.stringify(src)).toBe(before);
    expect(JSON.stringify(a.tracks)).toBe(JSON.stringify(b.tracks));
    expect(JSON.stringify(a.tracks.k)).toBe(JSON.stringify(src.k));
    expect(JSON.stringify(a.tracks.s)).toBe(JSON.stringify(src.s));
    expect(a.ops.length).toBeGreaterThan(0);
  });

  it('at low strength the accented backbeat survives', () => {
    const src = beat();
    for (let i = 0; i < 50; i++) {
      const m = mutate(src, lengths, geo16, new Rng(100 + i), 0.15);
      expect(m.tracks.s![4] || m.tracks.s![12]).toBeTruthy();
    }
  });
});

describe('evolution', () => {
  const evolvingProject = (mode: 'original' | 'evolving') => {
    const pr = smallProject();
    pr.ext.enabled = true;
    const p = pr.patterns[0]!;
    put(p, 'k', [0, 8, 10], 4);
    put(p, 's', [4, 12], 5);
    put(p, 'h', [0, 2, 4, 6, 8, 10, 12, 14]);
    p.evolve = { ...p.evolve, on: true, mode, every: 1, strength: 30, maxDrift: 100 };
    return pr;
  };

  it('ORIGINAL derives every generation from the source; EVOLVING from the previous one', () => {
    const o = history(new Engine(evolvingProject('original')), 8);
    const ev = history(new Engine(evolvingProject('evolving')), 8);
    const src = beat();
    const dist = (ps: typeof o) =>
      ps.slice(0, 8).map((p) => distance(src, Object.fromEntries(Object.entries(p.variant).map(([k, v]) => [k, v.strikes])), lengths));
    const dO = dist(o);
    const dE = dist(ev);
    expect(o[0]!.generation).toBe(0);
    expect(o[3]!.generation).toBe(3);
    // ORIGINAL stays within one mutation of the source; EVOLVING drifts further.
    expect(Math.max(...dO.slice(1))).toBeLessThan(0.5);
    expect(dE[7]!).toBeGreaterThan(dO[7]!);
  });

  it('is deterministic for a seed and shows what changed', () => {
    const a = new Engine(evolvingProject('evolving'));
    const b = new Engine(evolvingProject('evolving'));
    expect(sig(notesOf(a.generate(CYCLE * 6)))).toEqual(sig(notesOf(b.generate(CYCLE * 6))));
    const real = a.realization(a.plans[4]!);
    const all = Object.values(real.cells).flat();
    expect(all.some((c) => c.added || c.changed || c.suppressed === 'mutation')).toBe(true);
  });

  it('max drift pulls EVOLVING back towards the source', () => {
    const pr = evolvingProject('evolving');
    pr.patterns[0]!.evolve.maxDrift = 20;
    pr.patterns[0]!.evolve.strength = 60;
    const src = beat();
    for (const p of history(new Engine(pr), 12)) {
      const d = distance(src, Object.fromEntries(Object.entries(p.variant).map(([k, v]) => [k, v.strikes])), lengths);
      expect(d).toBeLessThan(0.9);
    }
  });

  it('reset returns to the source; lock plays a captured generation', () => {
    const pr = evolvingProject('original');
    const e = new Engine(pr);
    e.generate(CYCLE * 3 - 30);
    e.resetEvolution('A');
    const early = [...e.plans];
    const ps = [...early, ...history(e, 5).filter((p) => p.index >= early.length)];
    const gens = ps.map((p) => p.generation);
    expect(gens.slice(0, 3)).toEqual([0, 1, 2]);
    expect(gens[3]).toBe(0);
    const locked = ps[2]!;
    pr.patterns[0]!.evolve.locked = { generation: 2, tracks: Object.fromEntries(Object.entries(locked.variant).map(([k, v]) => [k, v.strikes])) };
    expect(history(new Engine(pr), 4).every((p) => p.generation === 2)).toBe(true);
  });

  it('CLASSIC (Extended off) ignores evolution entirely', () => {
    const pr = evolvingProject('evolving');
    pr.ext.enabled = false;
    expect(history(new Engine(pr), 4).every((p) => p.generation === 0)).toBe(true);
  });
});

describe('breeding', () => {
  it('every method keeps both parents and makes a child from their material', () => {
    const a = beat();
    const b: TrackStrikes = { k: [...a.k!].reverse(), s: a.s!.map((x, i) => (i % 3 === 0 ? { v: 2, s: 1 } : x)), h: a.h!.map(() => null), t: a.t! };
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    for (const m of BREED_METHODS) {
      const c = breed(a, b, m, geo16, 42, ['k', 's', 'h', 't']);
      expect(JSON.stringify(a)).toBe(ja);
      expect(JSON.stringify(b)).toBe(jb);
      for (const id of ['k', 's', 'h']) {
        c[id]!.forEach((x, i) => {
          if (!x) return;
          const inA = !!a[id]![i];
          const inB = !!b[id]![i];
          expect(inA || inB).toBe(true);
        });
      }
    }
    const alt = breed(a, b, 'steps', geo16, 1, ['h']);
    expect(alt.h!.filter(Boolean).length).toBe(8); // even steps come from A (hats on evens)
    const halves = breed(a, b, 'bars', geo16, 1, ['h']);
    expect(halves.h!.slice(8).every((x) => !x)).toBe(true);
  });
});

describe('morphing', () => {
  it('moves monotonically from A to B, ending exactly at B', () => {
    const a = beat();
    const b: TrackStrikes = { k: a.k!.map((_, i) => (i % 4 === 2 ? { v: 3, s: 1 } : null)), s: a.s!, h: a.h!.map((_, i) => (i % 2 ? { v: 2, s: 1 } : null)), t: a.t! };
    const ids = ['k', 's', 'h', 't'];
    let prev = morphTracks(a, b, 0, geo16, 9, ids);
    expect(JSON.stringify(prev.k)).toBe(JSON.stringify(a.k));
    for (let i = 1; i <= 8; i++) {
      const cur = morphTracks(a, b, i / 8, geo16, 9, ids);
      for (const id of ['k', 'h']) {
        cur[id]!.forEach((x, j) => {
          const inA = !!a[id]![j];
          const inB = !!b[id]![j];
          if (inA && !inB && !prev[id]![j]) expect(x).toBeNull(); // once gone, stays gone
          if (inB && !inA && prev[id]![j]) expect(x).not.toBeNull(); // once arrived, stays
        });
      }
      prev = cur;
    }
    expect(prev.k!.map((x) => !!x)).toEqual(b.k!.map((x) => !!x));
    expect(prev.h!.map((x) => !!x)).toEqual(b.h!.map((x) => !!x));
  });

  it('the engine morphs over N cycles then plays B, showing progress', () => {
    const pr = smallProject();
    pr.ext.enabled = true;
    const b = makePattern(pr.voices, 'B');
    b.id = 'B';
    pr.patterns.push(b);
    put(pr.patterns[0]!, 'k', [0, 4, 8, 12]);
    put(b, 'h', [2, 6, 10, 14]);
    const e = new Engine(pr);
    e.generate(40);
    e.startMorph('B', 4);
    const ps = history(e, 7);
    const ts = ps.map((p) => p.morph?.t ?? null);
    expect(ts.slice(1, 5)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(ps[5]!.patternId).toBe('B');
    expect(pr.current).toBe('B');
  });
});

describe('rules', () => {
  const rule = (r: Partial<Rule>): Rule => ({ id: 'r1', on: true, when: { type: 'every', n: 4, offset: 3 }, then: 'fill', target: 's', amount: 100, cycles: 1, ...r });

  it('conditions: every / repetition / density / chance', () => {
    const pr = smallProject();
    const ctx = { cycle: 3, rep: 3, patternStart: false, generation: 0, generationChanged: false, prev: { k: { written: 4, played: 1 } }, seed: 1 };
    expect(evaluateRules([rule({})], ctx, pr.voices).length).toBe(1);
    expect(evaluateRules([rule({})], { ...ctx, cycle: 4 }, pr.voices).length).toBe(0);
    expect(evaluateRules([rule({ when: { type: 'rep', n: 4 } })], ctx, pr.voices).length).toBe(1);
    expect(evaluateRules([rule({ when: { type: 'density', voice: 'k', below: 50 } })], ctx, pr.voices).length).toBe(1);
    expect(evaluateRules([rule({ when: { type: 'density', voice: 'k', below: 20 } })], ctx, pr.voices).length).toBe(0);
    let n = 0;
    for (let c = 0; c < 200; c++) n += evaluateRules([rule({ when: { type: 'chance', p: 25 } })], { ...ctx, cycle: c }, pr.voices).length;
    expect(n).toBeGreaterThan(30);
    expect(n).toBeLessThan(70);
  });

  it('WHEN cycle 4 THEN fill: forces a fill at the end of every 4th cycle only', () => {
    const pr = smallProject();
    pr.ext.enabled = true;
    put(pr.patterns[0]!, 's', [4, 12], 5);
    pr.ext.rules = [rule({})];
    const ns = notesOf(new Engine(pr).generate(CYCLE * 8));
    const fillCycles = [...new Set(ns.filter((n) => n.kind === 'fill').map((n) => n.cycle))];
    expect(fillCycles).toEqual([3, 7]);
    const ps = history(new Engine(pr), 8);
    expect(ps[3]!.labels.some((l) => l.kind === 'rule')).toBe(true);
  });

  it('EVERY 2 THEN thin hats halves their notes for that cycle; MUTE silences', () => {
    const pr = smallProject();
    pr.ext.enabled = true;
    put(pr.patterns[0]!, 'h', [...Array(16).keys()]);
    put(pr.patterns[0]!, 'k', [0]);
    pr.ext.rules = [rule({ when: { type: 'every', n: 2, offset: 1 }, then: 'mute', target: '@hat' })];
    const ns = notesOf(new Engine(pr).generate(CYCLE * 4));
    expect(ns.filter((n) => n.voice === 'h').map((n) => n.cycle).filter((c) => c % 2 === 1)).toEqual([]);
    expect(ns.filter((n) => n.voice === 'k').length).toBe(4);
  });

  it('rules cannot recurse: a NEXT rule firing every cycle advances one pattern per cycle', () => {
    const pr = smallProject();
    pr.ext.enabled = true;
    for (const name of ['B', 'C']) {
      const p = makePattern(pr.voices, name);
      p.id = name;
      pr.patterns.push(p);
    }
    pr.ext.rules = [rule({ when: { type: 'every', n: 1, offset: 0 }, then: 'next', target: 'all' }), rule({ id: 'r2', when: { type: 'every', n: 1, offset: 0 }, then: 'next', target: 'all' })];
    expect(history(new Engine(pr), 4).slice(0, 4).map((p) => p.patternId)).toEqual(['A', 'B', 'C', 'A']);
  });
});

describe('autopilot', () => {
  it('sections are deterministic and return home after excursions', () => {
    const s1 = [...Array(40).keys()].map((i) => sectionOf(i, 70, 5));
    const s2 = [...Array(40).keys()].map((i) => sectionOf(i, 70, 5));
    expect(s1).toEqual(s2);
    expect(s1[0]).toBe('HOME');
    expect(new Set(s1).size).toBeGreaterThan(2);
    let homeAfter = 0;
    let excursions = 0;
    for (let i = 1; i < s1.length - 1; i++) if (s1[i] !== 'HOME') {
      excursions++;
      if (s1[i + 1] === 'HOME') homeAfter++;
    }
    expect(homeAfter / excursions).toBeGreaterThan(0.4);
  });

  it('the last cycle of each phrase fills snares and toms', () => {
    const pr = smallProject();
    const e0 = autoEffect(7, 8, 60, 1, pr.voices, []);
    expect(Object.keys(e0.forceFill).sort()).toEqual(['s', 't']);
    expect(Object.keys(autoEffect(6, 8, 60, 1, pr.voices, []).forceFill)).toEqual([]);
  });
});

describe('groove and probability', () => {
  it('swing delays off-steps, keeps on-steps and is a no-op at 50 %', () => {
    expect(swingWarp(1, 50, 4)).toBe(1);
    expect(swingWarp(2, 66, 4)).toBe(2);
    expect(swingWarp(1, 75, 4)).toBeCloseTo(1.5);
    expect(swingWarp(3, 66, 4)).toBeCloseTo(3.32);
    expect(swingWarp(1, 66, 3)).toBe(1); // no swing on a triplet grid
  });

  it('groove applies only in EXTENDED and remains deterministic', () => {
    const pr = smallProject();
    put(pr.patterns[0]!, 'h', [0, 1, 2, 3]);
    pr.ext.groove.swing = 75;
    const off = notesOf(new Engine(pr).generate(CYCLE)).map((n) => n.tick);
    expect(off).toEqual([0, 6, 12, 18]);
    pr.ext.enabled = true;
    const on = notesOf(new Engine(pr).generate(CYCLE)).map((n) => n.tick);
    expect(on).toEqual([0, 9, 12, 21]);
  });

  it('per-voice and per-step probability suppress deterministically; extra hits are generated', () => {
    const pr = smallProject();
    pr.ext.enabled = true;
    const p = pr.patterns[0]!;
    put(p, 'h', [...Array(16).keys()]);
    p.tracks.h!.ext.prob = 50;
    const a = notesOf(new Engine(pr).generate(CYCLE * 10));
    expect(a.length).toBeGreaterThan(50);
    expect(a.length).toBeLessThan(110);
    p.tracks.h!.ext.prob = 100;
    put(p, 'h', [...Array(16).keys()], 3, { p: 0 });
    expect(notesOf(new Engine(pr).generate(CYCLE)).length).toBe(0);
    put(p, 'k', [0, 8]);
    p.tracks.k!.ext.extra = 100;
    const ex = notesOf(new Engine(pr).generate(CYCLE)).filter((n) => n.kind === 'extra');
    expect(ex.map((n) => n.tick)).toEqual([3, 51]);
  });
});
