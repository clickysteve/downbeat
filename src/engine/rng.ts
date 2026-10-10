/**
 * Deterministic randomness.
 *
 * Performance decisions use a *keyed hash*: the value for (seed, purpose,
 * voice, cycle, step) is always the same, whatever order the scheduler asks
 * in and however the lookahead windows fall. Sequential operations
 * (mutation, breeding) use a small seeded generator.
 */

const M1 = 0x85ebca6b;
const M2 = 0xc2b2ae35;

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, M1);
  h ^= h >>> 13;
  h = Math.imul(h, M2);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 32-bit hash of a list of numbers (non-integers are scaled first). */
export function hash32(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    const k = Number.isInteger(x) ? x | 0 : Math.round(x * 4096) | 0;
    h = fmix((h ^ k) + 0x6a09e667 + (h << 6) + (h >>> 2));
  }
  return h;
}

/** Uniform [0, 1) from a keyed hash. */
export function rand(...xs: number[]): number {
  return hash32(...xs) / 4294967296;
}

/** Stable numeric code for a string (voice ids, pattern ids). */
export function strCode(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Purposes, so that different decisions never share a random value. */
export const SALT = {
  density: 1,
  velocity: 2,
  randomStriker: 3,
  step: 4,
  timing: 5,
  fill: 6,
  fillVel: 7,
  fillStep: 8,
  loop: 9,
  prob: 10,
  stepProb: 11,
  extra: 12,
  accent: 13,
  velVar: 14,
  humanize: 15,
  grooveVel: 16,
  rule: 17,
  auto: 18,
  mutate: 19,
  morph: 20,
  breed: 21,
  jam: 22,
} as const;

/** Small seeded generator (mulberry32) for sequential operations. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Weighted choice: index into weights by u in [0,1). Falls back to the last positive weight. */
export function weighted(weights: readonly number[], u: number): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return Math.floor(u * weights.length);
  let x = u * total;
  for (let i = 0; i < weights.length; i++) {
    x -= Math.max(0, weights[i]!);
    if (x < 0) return i;
  }
  return weights.length - 1;
}

export function randomSeed(): number {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0]! || 1;
  } catch {
    return (Math.random() * 4294967296) >>> 0 || 1;
  }
}
