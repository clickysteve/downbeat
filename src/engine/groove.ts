/**
 * EXTENDED groove: swing, templates, humanisation, velocity variation and
 * accent emphasis. All timing is in ticks (fractional), so it stays exact
 * under MIDI Clock and replays identically for a seed.
 */
import { FINE, clamp, type GrooveSettings, type GrooveTemplate } from './types';

/** Template offsets (fine units) and velocity factors for the four quarters of a beat. */
export const TEMPLATES: Record<GrooveTemplate, { timing: number[]; vel: number[]; label: string }> = {
  none: { timing: [0, 0, 0, 0], vel: [1, 1, 1, 1], label: 'NONE' },
  shuffle: { timing: [0, 0, 3, 0], vel: [1, 0.78, 0.92, 0.8], label: 'SHUFFLE' },
  push: { timing: [0, -2, -1, -3], vel: [1, 0.85, 0.95, 0.85], label: 'PUSH' },
  lazy: { timing: [0, 2, 1, 3], vel: [1, 0.9, 0.97, 0.88], label: 'LAZY' },
  break: { timing: [0, 2, -1, 3], vel: [1, 0.7, 0.9, 0.74], label: 'BREAK' },
};

/**
 * Swing as a time warp over pairs of grid steps: the off-step of each pair is
 * delayed so that it falls at `swing` % of the pair. Applies to fractional
 * positions too (fills between steps move with the grid).
 */
export function swingWarp(x: number, swing: number, grid: number): number {
  if (swing <= 50 || grid % 2 !== 0) return x;
  const s = (clamp(swing, 50, 75) - 50) / 50;
  const pair = Math.floor(x / 2) * 2;
  const f = x - pair;
  return pair + (f < 1 ? f * (1 + s) : 1 + s + (f - 1) * (1 - s));
}

/** Template timing offset in ticks and velocity factor for position x (steps). */
export function templateAt(g: GrooveSettings, x: number, grid: number): { ticks: number; vel: number } {
  const t = TEMPLATES[g.template] ?? TEMPLATES.none;
  const q = ((x % grid) + grid) % grid;
  const i = Math.min(3, Math.floor((q / grid) * 4 + 1e-9));
  const depth = clamp(g.depth, 0, 100) / 100;
  return { ticks: (t.timing[i]! * depth) / FINE, vel: 1 + (t.vel[i]! - 1) * depth };
}

/** Accent emphasis: accents louder, the rest softer. */
export function emphasise(vel: number, level: number, accent: number): number {
  if (accent <= 0) return vel;
  const a = clamp(accent, 0, 100) / 100;
  return level >= 5 ? vel * (1 + a * 0.25) : vel * (1 - a * (0.35 - level * 0.05));
}
