/**
 * Edits to the written (source) pattern. These are the only functions that
 * change a pattern's strikes; they are called by the musician's actions,
 * never by the performance engine.
 */
import { makeId, makeTrack } from './defaults';
import { MAX_STEPS, geometry, type Pattern, type Strike, type Track } from './types';

export const cloneStrike = (s: Strike | null): Strike | null => (s ? { ...s } : null);

export function cloneTrack(t: Track): Track {
  return {
    ...t,
    strikes: t.strikes.map(cloneStrike),
    vel: { center: [...t.vel.center], range: [...t.vel.range], weights: [...t.vel.weights] },
    fill: { ...t.fill, weights: [...t.fill.weights] },
    ext: { ...t.ext },
  };
}

export function clonePattern(p: Pattern, newId = true): Pattern {
  const tracks: Record<string, Track> = {};
  for (const [id, t] of Object.entries(p.tracks)) tracks[id] = cloneTrack(t);
  return {
    ...p,
    id: newId ? makeId('p') : p.id,
    tracks,
    evolve: {
      ...p.evolve,
      targets: [...p.evolve.targets],
      locked: p.evolve.locked
        ? { generation: p.evolve.locked.generation, tracks: Object.fromEntries(Object.entries(p.evolve.locked.tracks).map(([k, v]) => [k, v.map(cloneStrike)])) }
        : null,
    },
  };
}

/** Rotate strikes by n steps with wraparound (positive = later). Within the loop length. */
export function rotate(t: Track, n: number): void {
  const len = Math.max(1, Math.min(t.loop, t.strikes.length));
  const seg = t.strikes.slice(0, len);
  const k = ((n % len) + len) % len;
  for (let i = 0; i < len; i++) t.strikes[(i + k) % len] = seg[i] ?? null;
}

/** Reverse the strikes within the loop length. */
export function reverse(t: Track): void {
  const len = Math.max(1, Math.min(t.loop, t.strikes.length));
  const seg = t.strikes.slice(0, len).reverse();
  for (let i = 0; i < len; i++) t.strikes[i] = seg[i] ?? null;
}

export function clearTrack(t: Track): void {
  t.strikes.fill(null);
}

/**
 * Change a pattern's geometry. Strikes are kept at the same musical position
 * where the new grid has a step there; loop lengths are scaled.
 */
export function regrid(p: Pattern, next: Partial<Pick<Pattern, 'beats' | 'unit' | 'bars' | 'grid'>>): boolean {
  const before = geometry(p);
  const cand = { beats: next.beats ?? p.beats, unit: next.unit ?? p.unit, bars: next.bars ?? p.bars, grid: next.grid ?? p.grid };
  const after = geometry(cand);
  if (after.steps < 1 || after.steps > MAX_STEPS) return false;
  for (const t of Object.values(p.tracks)) {
    const out: (Strike | null)[] = new Array<null>(after.steps).fill(null);
    t.strikes.forEach((s, i) => {
      if (!s) return;
      const tick = i * before.stepTicks;
      const j = tick / after.stepTicks;
      if (Math.abs(j - Math.round(j)) < 1e-6 && Math.round(j) < after.steps) out[Math.round(j)] = s;
    });
    const fullLoop = t.loop >= before.steps;
    t.strikes = out;
    t.loop = fullLoop ? after.steps : Math.max(1, Math.min(after.steps, Math.round((t.loop * before.stepTicks) / after.stepTicks)));
  }
  Object.assign(p, cand);
  return true;
}

/** Double the pattern length, copying the strikes into the new half. */
export function doubleLength(p: Pattern): boolean {
  const g = geometry(p);
  if (g.steps * 2 > MAX_STEPS) return false;
  for (const t of Object.values(p.tracks)) {
    const fullLoop = t.loop >= g.steps;
    t.strikes = [...t.strikes, ...t.strikes.map(cloneStrike)];
    if (fullLoop) t.loop = g.steps * 2;
  }
  p.bars *= 2;
  return true;
}

export function emptyTrackLike(p: Pattern): Track {
  return makeTrack(geometry(p).steps);
}

/** Copy strikes (by position) from one track into another of possibly different length. */
export function pasteStrikes(dst: Track, src: (Strike | null)[]): void {
  for (let i = 0; i < dst.strikes.length; i++) dst.strikes[i] = cloneStrike(src[i % src.length] ?? null);
}

export function countHits(strikes: readonly (Strike | null)[], len = strikes.length): number {
  let n = 0;
  for (let i = 0; i < len; i++) if (strikes[i]) n++;
  return n;
}
