/**
 * EXTENDED morphing (algorithm version 1): a gradual, intentional transition
 * from pattern A to pattern B.
 *
 * Every hit gets a fixed threshold, so the transition is monotonic: once a
 * hit of A has gone it stays gone, once a hit of B has arrived it stays.
 * Thresholds mix a per-hit random value, a per-voice bias (voices tend to
 * change as groups: instrument participation) and metric weight (A's weak
 * notes leave first, its downbeats last; B's strong notes arrive first).
 * Where both patterns have a hit, its striker level is interpolated.
 */
import { SALT, rand, strCode } from '../engine/rng';
import type { Geometry, Strike } from '../engine/types';
import { metricWeight, type TrackStrikes } from './mutate';

/** Map B's strikes onto A's step count by position within the pattern. */
export function resample(b: (Strike | null)[], steps: number): (Strike | null)[] {
  const out: (Strike | null)[] = new Array<null>(steps).fill(null);
  const n = b.length;
  if (!n) return out;
  b.forEach((s, j) => {
    if (!s) return;
    const i = Math.round((j / n) * steps);
    if (i < steps && !out[i]) out[i] = { ...s };
  });
  return out;
}

export function morphTracks(
  a: TrackStrikes,
  b: TrackStrikes,
  t: number,
  geo: Geometry,
  seed: number,
  voiceIds: string[],
): TrackStrikes {
  const out: TrackStrikes = {};
  const tt = Math.max(0, Math.min(1, t));
  for (const id of voiceIds) {
    const A = a[id] ?? new Array<null>(geo.steps).fill(null);
    const B = resample(b[id] ?? [], A.length);
    const vc = strCode(id);
    const bias = rand(seed, SALT.morph, vc, 9999);
    const row: (Strike | null)[] = [];
    for (let i = 0; i < A.length; i++) {
      const x = A[i] ?? null;
      const y = B[i] ?? null;
      const m = metricWeight(i, geo);
      if (x && y) {
        const lv = Math.round((x.v || 3) + ((y.v || 3) - (x.v || 3)) * tt);
        row.push({ ...(tt < 0.5 ? x : y), v: Math.max(1, Math.min(5, lv)) });
      } else if (x) {
        const th = 0.5 * rand(seed, SALT.morph, vc, i, 1) + 0.25 * bias + 0.25 * m;
        row.push(tt < th ? { ...x } : null);
      } else if (y) {
        const th = 0.5 * rand(seed, SALT.morph, vc, i, 2) + 0.25 * bias + 0.25 * (1 - m);
        row.push(tt >= th ? { ...y } : null);
      } else row.push(null);
    }
    out[id] = row;
  }
  return out;
}
