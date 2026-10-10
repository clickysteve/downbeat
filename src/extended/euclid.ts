/**
 * EXTENDED Euclidean rhythm generator: k hits spread as evenly as possible
 * over n steps (Bresenham form, equivalent to Bjorklund up to rotation,
 * normalised so the first hit is on step 0), with rotation and accents.
 */
import type { Strike } from '../engine/types';

export function euclid(steps: number, hits: number, rotation = 0): boolean[] {
  const n = Math.max(1, Math.floor(steps));
  const k = Math.max(0, Math.min(n, Math.floor(hits)));
  const out: boolean[] = new Array<boolean>(n).fill(false);
  if (k === 0) return out;
  for (let i = 0; i < n; i++) out[i] = (i * k) % n < k;
  const r = ((Math.floor(rotation) % n) + n) % n;
  if (!r) return out;
  return out.map((_, i) => out[(i - r + n) % n]!);
}

export type EuclidAccent = 'none' | 'first' | 'every2' | 'every3' | 'euclid';
export type EuclidMode = 'replace' | 'merge' | 'intersect' | 'xor';

export interface EuclidSpec {
  steps: number;
  hits: number;
  rotation: number;
  accent: EuclidAccent;
  /** Accent hits for 'euclid' accents (a Euclidean pattern over the hits). */
  accentHits: number;
  level: number;
}

/** Strikes for a Euclidean spec (length = steps). */
export function euclidStrikes(spec: EuclidSpec): (Strike | null)[] {
  const on = euclid(spec.steps, spec.hits, spec.rotation);
  const hitCount = on.filter(Boolean).length;
  const acc = euclid(Math.max(1, hitCount), Math.min(hitCount, spec.accentHits));
  let h = 0;
  return on.map((x) => {
    if (!x) return null;
    const idx = h++;
    let accent = false;
    switch (spec.accent) {
      case 'first':
        accent = idx === 0;
        break;
      case 'every2':
        accent = idx % 2 === 0;
        break;
      case 'every3':
        accent = idx % 3 === 0;
        break;
      case 'euclid':
        accent = !!acc[idx];
        break;
      case 'none':
        accent = false;
    }
    return { v: accent ? 5 : spec.level, s: 1 };
  });
}

/** Combine a generated row into an existing one. */
export function combine(existing: (Strike | null)[], gen: (Strike | null)[], mode: EuclidMode): (Strike | null)[] {
  return existing.map((x, i) => {
    const y = i < gen.length ? gen[i] ?? null : null;
    switch (mode) {
      case 'replace':
        return y ? { ...y } : null;
      case 'merge':
        return x ? x : y ? { ...y } : null;
      case 'intersect':
        return x && y ? x : null;
      case 'xor':
        return x && !y ? x : !x && y ? { ...y } : null;
    }
  });
}
