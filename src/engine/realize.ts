/**
 * Realisation: the performance of one cycle.
 *
 * `realize()` is a pure function of (project settings, pattern, cycle plan).
 * It returns every event the cycle will play and, for the display, the state
 * of every cell: written and played (SOURCE), written but not played
 * (SUPPRESSED, with the reason), and notes the engine added (GENERATED).
 *
 * Classic algorithms here are version 1 (project.algorithms.classic = 1);
 * see docs/CLASSIC_SPEC.md. A future version would be a new function chosen
 * by that number, so saved projects keep their sound.
 */
import { emphasise, swingWarp, templateAt } from './groove';
import { SALT, rand, strCode, weighted } from './rng';
import type { CyclePlan, VoiceMods } from './plan';
import { noMods } from './plan';
import { ACCENT, FINE, clamp, type Pattern, type Project, type Strike, type Track, type Voice } from './types';

export type EventKind = 'source' | 'flam' | 'fill' | 'extra' | 'jam' | 'echo';
export type Suppress = 'density' | 'prob' | 'mutation' | 'morph' | 'rule';

export interface PerfEvent {
  /** Unique within the cycle (used to avoid sending an event twice). */
  key: string;
  /** Absolute tick (fractional). */
  tick: number;
  /** The track (voice) the event belongs to. */
  voice: string;
  /** The voice whose notes / channel / sound play it (differs for fills with another sound). */
  sound: string;
  velocity: number;
  /** Striker level 1-5. */
  level: number;
  /** Index into the sound voice's step list. */
  note: number;
  kind: EventKind;
  /** Cycle step (integer part of x). */
  step: number;
  /** Position in steps (fractional for fills between steps). */
  x: number;
}

export interface Cell {
  /** The strike performed at this track position this cycle (variant), if any. */
  strike: Strike | null;
  /** Written in the source at this position. */
  written: boolean;
  /** Times a strike here played this cycle. */
  played: number;
  /** Why a written / variant strike did not play (last visit). */
  suppressed: Suppress | null;
  /** Kind of generated note(s) in this cell, if any. */
  gen: EventKind | null;
  /** Number of generated notes in this cell. */
  genCount: number;
  /** The variant added this strike (mutation / morph). */
  added: boolean;
  /** The variant changed this strike's level or step. */
  changed: boolean;
}

export interface VoiceStats {
  written: number;
  played: number;
  generated: number;
}

export interface Realization {
  plan: CyclePlan;
  events: PerfEvent[];
  cells: Record<string, Cell[]>;
  stats: Record<string, VoiceStats>;
}

export interface RealizeFlags {
  /** EXTENDED probability controls. */
  prob: boolean;
  /** EXTENDED groove. */
  groove: boolean;
}

export function flagsOf(project: Project): RealizeFlags {
  const e = project.ext;
  return { prob: e.enabled && e.features.prob, groove: e.enabled && e.features.groove };
}

/** Density exponents per striker level: louder strikes survive more often. */
export const DENSITY_WEIGHT = [1.6, 1.3, 1.0, 0.7, 0.4];
/** Flam grace note: ticks before the strike, velocity factor. */
export const FLAM_TICKS = 1;
export const FLAM_VEL = 0.55;

const vclamp = (v: number) => clamp(Math.round(v), 1, 127);

export function velocityFor(track: Track, level: number, u: number): number {
  const c = track.vel.center[level - 1] ?? 80;
  const r = track.vel.range[level - 1] ?? 0;
  return vclamp(c + (u * 2 - 1) * r);
}

function emptyCell(strike: Strike | null, written: boolean): Cell {
  return { strike, written, played: 0, suppressed: null, gen: null, genCount: 0, added: false, changed: false };
}

export function realize(project: Project, pattern: Pattern, plan: CyclePlan, flags: RealizeFlags = flagsOf(project)): Realization {
  const seed = project.seed;
  const K = plan.key;
  const { steps, stepTicks, stepsPerBar, grid } = plan.geo;
  const groove = project.ext.groove;
  const events: PerfEvent[] = [];
  const cells: Record<string, Cell[]> = {};
  const stats: Record<string, VoiceStats> = {};
  const byId = new Map(project.voices.map((v) => [v.id, v] as const));

  /** Time of position x (steps) with the track's offset in fine units and groove. */
  const timeOf = (x: number, fineOffset: number): number => {
    let pos = x;
    let extra = fineOffset / FINE;
    if (flags.groove && !plan.sourceOnly) {
      pos = swingWarp(x, groove.swing, grid);
      extra += templateAt(groove, x, grid).ticks;
    }
    return Math.max(0, plan.startTick + pos * stepTicks + extra);
  };

  const finishVel = (vel: number, level: number, x: number, vc: number, track: Track): number => {
    if (plan.sourceOnly) return vel;
    let v = vel;
    if (flags.prob && track.ext.velVar > 0) v *= 1 + (rand(seed, SALT.velVar, vc, K, x) * 2 - 1) * (track.ext.velVar / 100);
    if (flags.groove) {
      v *= templateAt(groove, x, grid).vel;
      if (groove.velVar > 0) v *= 1 + (rand(seed, SALT.humanize, vc, K, x, 1) * 2 - 1) * (groove.velVar / 100);
      v = emphasise(v, level, groove.accent);
    }
    return vclamp(v);
  };

  const humanize = (x: number, vc: number, track: Track): number => {
    if (plan.sourceOnly) return 0;
    let fine = track.shift;
    if (track.timing > 0) fine += (rand(seed, SALT.timing, vc, K, x) * 2 - 1) * track.timing;
    if (flags.groove && groove.humanize > 0) fine += (rand(seed, SALT.humanize, vc, K, x) * 2 - 1) * groove.humanize;
    return fine;
  };

  const noteFor = (sound: Voice, s: number, u: number): number => {
    const n = Math.max(1, sound.notes.length);
    return s <= 0 ? Math.floor(u * n) : Math.min(s, n) - 1;
  };

  for (const voice of project.voices) {
    const track = pattern.tracks[voice.id];
    const vt = plan.variant[voice.id];
    const pos = plan.pos[voice.id];
    if (!track || !vt || !pos) continue;
    const mods: VoiceMods = plan.mods[voice.id] ?? noMods();
    const vc = strCode(voice.id);
    const row: Cell[] = vt.strikes.map((s, i) => {
      if (vt.live) return emptyCell(s, !!s);
      const c = emptyCell(s, (vt.origin[i] !== null && vt.origin[i] !== 'added') || vt.removed[i] === true);
      c.added = vt.origin[i] === 'added';
      c.changed = vt.origin[i] === 'changed';
      if (vt.removed[i]) c.suppressed = plan.morph ? 'morph' : 'mutation';
      return c;
    });
    cells[voice.id] = row;
    const st: VoiceStats = { written: 0, played: 0, generated: 0 };
    stats[voice.id] = st;
    const writtenAt: boolean[] = new Array<boolean>(steps).fill(false);
    const levelAt: number[] = new Array<number>(steps).fill(0);

    for (let i = 0; i < steps; i++) {
      const p = pos[i]!;
      const s = vt.strikes[p];
      if (!s) continue;
      writtenAt[i] = true;
      levelAt[i] = s.v || 3;
      st.written++;
      const cell = row[p]!;

      if (plan.sourceOnly) {
        const level = s.v || 3;
        events.push({
          key: `${voice.id}|s|${i}`,
          tick: timeOf(i, 0),
          voice: voice.id,
          sound: voice.id,
          velocity: vclamp(track.vel.center[level - 1] ?? 80),
          level,
          note: noteFor(voice, s.s || 1, 0),
          kind: 'source',
          step: i,
          x: i,
        });
        cell.played++;
        cell.suppressed = null;
        st.played++;
        continue;
      }

      let level = s.v === 0 ? 1 + weighted(track.vel.weights, rand(seed, SALT.randomStriker, vc, K, i)) : clamp(s.v, 1, 5);

      // Density (Classic v1): louder strikers survive more often.
      const base = clamp(track.density, 0, 100) / 100;
      const d = clamp(base * mods.densityMul, 0, 1);
      const u = rand(seed, SALT.density, vc, K, i);
      const w = DENSITY_WEIGHT[level - 1]!;
      if (!(d >= 1 || (d > 0 && u < Math.pow(d, w)))) {
        const ruleOnly = base >= 1 || (base > 0 && u < Math.pow(base, w));
        cell.suppressed = ruleOnly ? 'rule' : 'density';
        continue;
      }
      // EXTENDED probability.
      if (flags.prob) {
        if (track.ext.prob < 100 && rand(seed, SALT.prob, vc, K, i) >= track.ext.prob / 100) {
          cell.suppressed = 'prob';
          continue;
        }
        if (s.p !== undefined && s.p < 100 && rand(seed, SALT.stepProb, vc, K, i) >= s.p / 100) {
          cell.suppressed = 'prob';
          continue;
        }
        if (level < ACCENT && track.ext.accent > 0 && rand(seed, SALT.accent, vc, K, i) < track.ext.accent / 100) level = ACCENT;
      }
      cell.suppressed = null;
      cell.played++;
      st.played++;
      const vel = finishVel(velocityFor(track, level, rand(seed, SALT.velocity, vc, K, i)), level, i, vc, track);
      const note = noteFor(voice, s.s, rand(seed, SALT.step, vc, K, i));
      const tick = timeOf(i, humanize(i, vc, track));
      if (s.f) {
        events.push({ key: `${voice.id}|f|${i}`, tick: Math.max(0, tick - FLAM_TICKS), voice: voice.id, sound: voice.id, velocity: vclamp(vel * FLAM_VEL), level: 1, note, kind: 'flam', step: i, x: i });
      }
      events.push({ key: `${voice.id}|s|${i}`, tick, voice: voice.id, sound: voice.id, velocity: vel, level, note, kind: 'source', step: i, x: i });

      // EXTENDED additional hit: a ghost half a step later.
      const extraP = (flags.prob ? track.ext.extra : 0) + mods.extraBoost;
      if (extraP > 0 && rand(seed, SALT.extra, vc, K, i) < extraP / 100) {
        const x = i + 0.5;
        {
          const ev: PerfEvent = {
            key: `${voice.id}|x|${x}`,
            tick: timeOf(x, humanize(x, vc, track)),
            voice: voice.id,
            sound: voice.id,
            velocity: finishVel(velocityFor(track, 1, rand(seed, SALT.velocity, vc, K, x)), 1, x, vc, track),
            level: 1,
            note,
            kind: 'extra',
            step: i,
            x,
          };
          events.push(ev);
          st.generated++;
          cell.gen = cell.gen ?? 'extra';
          cell.genCount++;
        }
      }
    }

    if (plan.sourceOnly) continue;

    // Fills (Classic v1).
    const f = track.fill;
    const force = mods.forceFill;
    if (!f.on && !force) continue;
    const amount = clamp((force ? Math.max(f.amount, force.amount) : f.amount) + mods.fillBoost, 0, 100);
    if (amount <= 0) continue;
    const zone = force ? force.zone : f.zone;
    const maxPerGap = force ? 16 : Math.max(1, f.max);
    const rate = f.rate;
    const zoneStart =
      zone === 'all' ? 0 : zone === 'bar' ? steps - stepsPerBar : zone === 'half' ? steps - Math.max(1, Math.floor(stepsPerBar / 2)) : steps - grid;
    const written: number[] = [];
    for (let i = 0; i < steps; i++) if (writtenAt[i]) written.push(i);
    const slots: number[] = [];
    if (rate >= 1) {
      for (let i = 0; i < steps; i++) for (let k = 0; k < rate; k++) slots.push(i + k / rate);
    } else {
      const every = Math.round(1 / rate);
      for (let i = 0; i < steps; i += every) slots.push(i);
    }
    const empty = (x: number): boolean => {
      for (const w of written) {
        const dd = Math.abs(x - w);
        const dist = Math.min(dd, steps - dd);
        if (dist <= f.spacing + 1e-9) return false;
      }
      return true;
    };
    /** The next written strike after x, unwrapped (may be beyond the cycle end), or -1. */
    const nextWritten = (x: number): number => {
      for (const w of written) if (w > x) return w;
      return written.length ? written[0]! + steps : -1;
    };
    // Group candidate slots into gaps keyed by the strike they lead into.
    const gaps = new Map<number, { x: number; d: number }[]>();
    for (const x of slots) {
      if (x < Math.max(0, zoneStart) - 1e-9 || !empty(x)) continue;
      const g = nextWritten(x);
      const key = g < 0 ? -1 : g % steps;
      const list = gaps.get(key) ?? [];
      list.push({ x, d: g < 0 ? steps - x : g - x });
      gaps.set(key, list);
    }
    const sound = (f.sound && byId.get(f.sound)) || voice;
    for (const [g, xs] of gaps) {
      // Fills lead into the next written strike: nearest slots first.
      xs.sort((a, b) => a.d - b.d);
      let count = 0;
      const nextLevel = g >= 0 ? levelAt[g] ?? 0 : 0;
      for (const { x } of xs) {
        if (count >= maxPerGap) break;
        if (rand(seed, SALT.fill, vc, K, x) >= amount / 100) continue;
        count++;
        let level = 1 + weighted(f.weights, rand(seed, SALT.fillVel, vc, K, x));
        if (nextLevel >= ACCENT && level < ACCENT) level++;
        const step = Math.floor(x);
        const ev: PerfEvent = {
          key: `${voice.id}|F|${x.toFixed(4)}`,
          tick: timeOf(x, humanize(x, vc, track)),
          voice: voice.id,
          sound: sound.id,
          velocity: finishVel(velocityFor(track, level, rand(seed, SALT.velocity, vc, K, x, 7)), level, x, vc, track),
          level,
          note: Math.floor(rand(seed, SALT.fillStep, vc, K, x) * Math.max(1, sound.notes.length)),
          kind: 'fill',
          step,
          x,
        };
        events.push(ev);
        st.generated++;
        const cell = row[pos[step]!]!;
        cell.gen = 'fill';
        cell.genCount++;
      }
    }
  }

  events.sort((a, b) => a.tick - b.tick || (a.key < b.key ? -1 : 1));
  return { plan, events, cells, stats };
}
