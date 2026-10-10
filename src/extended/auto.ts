/**
 * EXTENDED autopilot (generative performance), algorithm version 1.
 *
 * Time is divided into phrases of `phrase` cycles. Each phrase is given a
 * section, chosen by the seeded hash and the ACTIVITY setting:
 *
 *   HOME    the groove as written (or as evolved)
 *   VARY    light mutation of hats and percussion
 *   BUSY    more fills, more ghost notes
 *   SPARSE  hats and percussion thinned
 *   BREAK   kick and hats pulled back (a breakdown)
 *
 * After any other section the next phrase favours HOME, so the music keeps
 * returning to familiar material. The last cycle of every phrase carries a
 * fill on snares and toms. Everything the autopilot does is expressed as the
 * same per-voice modifications rules use, and is shown in the monitor.
 */
import { SALT, rand } from '../engine/rng';
import type { FillZone, Voice } from '../engine/types';

export type Section = 'HOME' | 'VARY' | 'BUSY' | 'SPARSE' | 'BREAK';

export const SECTION_HELP: Record<Section, string> = {
  HOME: 'the groove as it is',
  VARY: 'hats and percussion mutate lightly',
  BUSY: 'more fills and ghost notes',
  SPARSE: 'hats and percussion thin out',
  BREAK: 'kick and hats pull back',
};

const cache = new Map<string, Section>();

export function sectionOf(phraseIndex: number, activity: number, seed: number): Section {
  if (phraseIndex <= 0) return 'HOME';
  const key = `${seed}:${activity}:${phraseIndex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const prev = sectionOf(phraseIndex - 1, activity, seed);
  const a = Math.max(0, Math.min(1, activity / 100));
  let s: Section;
  if (prev !== 'HOME' && rand(seed, SALT.auto, phraseIndex, 1) < 0.6) s = 'HOME';
  else {
    const opts: [Section, number][] = [
      ['HOME', 3 * (1 - a) + 0.4],
      ['VARY', 1 + 2 * a],
      ['BUSY', 2.2 * a],
      ['SPARSE', 0.8],
      ['BREAK', a > 0.3 ? a * 1.2 : 0],
    ];
    const total = opts.reduce((x, o) => x + o[1], 0);
    let x = rand(seed, SALT.auto, phraseIndex, 2) * total;
    s = 'HOME';
    for (const [name, w] of opts) {
      x -= w;
      if (x < 0) {
        s = name;
        break;
      }
    }
  }
  if (cache.size > 4096) cache.clear();
  cache.set(key, s);
  return s;
}

export interface AutoEffect {
  section: Section;
  phrase: number;
  position: number;
  /** Per voice modifications. */
  densityMul: Record<string, number>;
  fillBoost: Record<string, number>;
  extraBoost: Record<string, number>;
  forceFill: Record<string, { zone: FillZone; amount: number }>;
  /** Voices to mutate this cycle, with strength 0-1 and a seed shared across the phrase. */
  mutate: { voices: string[]; strength: number; seed: number } | null;
}

const isHat = (v: Voice) => v.family === 'hat' || v.family === 'openhat';
const isPerc = (v: Voice) => v.family === 'perc' || v.family === 'cymbal';
const isFiller = (v: Voice) => v.family === 'snare' || v.family === 'tom' || v.family === 'clap';

export function autoEffect(cycle: number, phrase: number, activity: number, seed: number, voices: Voice[], fillVoices: string[]): AutoEffect {
  const P = Math.max(1, Math.floor(phrase));
  const ph = Math.floor(cycle / P);
  const position = cycle % P;
  const a = Math.max(0, Math.min(1, activity / 100));
  const section = sectionOf(ph, activity, seed);
  const eff: AutoEffect = { section, phrase: ph, position, densityMul: {}, fillBoost: {}, extraBoost: {}, forceFill: {}, mutate: null };
  const hp = voices.filter((v) => isHat(v) || isPerc(v)).map((v) => v.id);
  switch (section) {
    case 'HOME':
      break;
    case 'VARY':
      if (hp.length) eff.mutate = { voices: hp, strength: 0.15 + 0.45 * a, seed: (seed ^ (ph * 2654435761)) >>> 0 };
      break;
    case 'BUSY':
      for (const v of voices) {
        if (isFiller(v) || isPerc(v)) eff.fillBoost[v.id] = 15 + 35 * a;
        if (isHat(v)) eff.extraBoost[v.id] = 10 + 20 * a;
      }
      break;
    case 'SPARSE':
      for (const id of hp) eff.densityMul[id] = 0.75 - 0.3 * a;
      break;
    case 'BREAK':
      if (position < P - 1 || P === 1) {
        for (const v of voices) {
          if (v.family === 'kick') eff.densityMul[v.id] = 0.25;
          if (isHat(v)) eff.densityMul[v.id] = 0.5;
        }
      }
      break;
  }
  if (P >= 2 && position === P - 1 && a > 0) {
    const zone: FillZone = a < 0.35 ? 'beat' : a < 0.7 ? 'half' : 'bar';
    const targets = new Set([...voices.filter(isFiller).map((v) => v.id), ...fillVoices]);
    for (const id of targets) eff.forceFill[id] = { zone, amount: 45 + 45 * a };
  }
  return eff;
}
