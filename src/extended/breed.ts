/**
 * EXTENDED pattern breeding (algorithm version 1): combine two parent
 * patterns into a child. Parents are never changed. B is mapped onto A's
 * geometry by position.
 */
import { Rng } from '../engine/rng';
import type { Geometry, Strike } from '../engine/types';
import { cloneStrike } from '../engine/patternOps';
import { resample } from './morph';
import type { TrackStrikes } from './mutate';

export const BREED_METHODS = ['steps', 'beats', 'bars', 'crossover', 'voices', 'mix', 'accents', 'fragment'] as const;
export type BreedMethod = (typeof BREED_METHODS)[number];

export const BREED_LABEL: Record<BreedMethod, string> = {
  steps: 'ALTERNATE STEPS',
  beats: 'ALTERNATE BEATS',
  bars: 'ALTERNATE HALVES',
  crossover: 'CROSSOVER',
  voices: 'VOICE BY VOICE',
  mix: 'RANDOM MIX',
  accents: 'A RHYTHM, B ACCENTS',
  fragment: 'FRAGMENT SWAP',
};

export function breed(a: TrackStrikes, b: TrackStrikes, method: BreedMethod, geo: Geometry, seed: number, voiceIds: string[]): TrackStrikes {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const out: TrackStrikes = {};
  const steps = geo.steps;
  const half = Math.max(1, Math.floor(steps / 2));
  const cross = 1 + rng.int(Math.max(1, steps - 1));
  const fragLen = geo.grid;
  const frags = Math.max(1, Math.floor(steps / fragLen));
  const fragAt = rng.int(frags) * fragLen;
  for (const id of voiceIds) {
    const A = (a[id] ?? new Array<null>(steps).fill(null)).map(cloneStrike);
    const B = resample(b[id] ?? [], steps);
    const fromB = rng.chance(0.5);
    const row: (Strike | null)[] = [];
    for (let i = 0; i < steps; i++) {
      const x = A[i] ?? null;
      const y = B[i] ?? null;
      let pick: Strike | null;
      switch (method) {
        case 'steps':
          pick = i % 2 === 0 ? x : y;
          break;
        case 'beats':
          pick = Math.floor(i / geo.grid) % 2 === 0 ? x : y;
          break;
        case 'bars':
          pick = i < half ? x : y;
          break;
        case 'crossover':
          pick = i < cross ? x : y;
          break;
        case 'voices':
          pick = fromB ? y : x;
          break;
        case 'mix':
          pick = x && y ? (rng.chance(0.5) ? x : y) : x || y ? (rng.chance(0.5) ? x || y : null) : null;
          break;
        case 'accents':
          pick = x ? { ...x, v: y ? y.v : Math.min(x.v || 3, 3) } : null;
          break;
        case 'fragment':
          pick = i >= fragAt && i < fragAt + fragLen ? y : x;
          break;
      }
      row.push(pick ? { ...pick } : null);
    }
    out[id] = row;
  }
  return out;
}
