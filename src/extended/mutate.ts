/**
 * EXTENDED pattern mutation (algorithm version 1).
 *
 * A mutation is a short list of musical edits applied to a copy of the
 * strikes. Strength (0-1) sets how many edits there are and which kinds are
 * allowed: at low strength only small, local edits on weak metric positions
 * (the groove stays recognisable); at high strength rotation, reversal,
 * rests and recombined fragments can reshape the pattern.
 */
import type { Rng } from '../engine/rng';
import type { Geometry, Strike } from '../engine/types';
import { cloneStrike } from '../engine/patternOps';

export type Strikes = (Strike | null)[];
export type TrackStrikes = Record<string, Strikes>;

export type MutationOp = 'add' | 'remove' | 'shift' | 'swap' | 'accent' | 'velocity' | 'rest' | 'recombine' | 'rotate' | 'reverse' | 'density';

export const OP_LABEL: Record<MutationOp, string> = {
  add: '+HIT',
  remove: '-HIT',
  shift: 'SHIFT',
  swap: 'SWAP',
  accent: 'ACCENT',
  velocity: 'VEL',
  rest: 'REST',
  recombine: 'RECOMBINE',
  rotate: 'ROTATE',
  reverse: 'REVERSE',
  density: 'DENSITY',
};

/** Metric weight of a step: 1 bar downbeat, 0.8 beat, 0.5 half beat, 0.25 other. */
export function metricWeight(i: number, geo: Pick<Geometry, 'grid' | 'stepsPerBar'>): number {
  if (i % geo.stepsPerBar === 0) return 1;
  if (i % geo.grid === 0) return 0.8;
  if (geo.grid % 2 === 0 && i % (geo.grid / 2) === 0) return 0.5;
  return 0.25;
}

interface OpDef {
  op: MutationOp;
  weight: number;
  minStrength: number;
}

const OPS: OpDef[] = [
  { op: 'add', weight: 24, minStrength: 0 },
  { op: 'remove', weight: 20, minStrength: 0 },
  { op: 'shift', weight: 16, minStrength: 0 },
  { op: 'velocity', weight: 12, minStrength: 0 },
  { op: 'accent', weight: 8, minStrength: 0 },
  { op: 'swap', weight: 8, minStrength: 0.15 },
  { op: 'density', weight: 5, minStrength: 0.3 },
  { op: 'rest', weight: 4, minStrength: 0.35 },
  { op: 'recombine', weight: 5, minStrength: 0.4 },
  { op: 'rotate', weight: 3, minStrength: 0.6 },
  { op: 'reverse', weight: 2, minStrength: 0.6 },
];

export interface MutationResult {
  tracks: TrackStrikes;
  ops: MutationOp[];
}

/**
 * Mutate. `lengths` gives each track's loop length (edits stay inside it).
 * `targets` lists the voices that may change (empty = every voice with hits).
 */
export function mutate(source: TrackStrikes, lengths: Record<string, number>, geo: Geometry, rng: Rng, strength: number, targets: string[] = []): MutationResult {
  const s = Math.max(0, Math.min(1, strength));
  const tracks: TrackStrikes = {};
  for (const [id, t] of Object.entries(source)) tracks[id] = t.map(cloneStrike);
  const ids = (targets.length ? targets : Object.keys(tracks).filter((id) => tracks[id]!.some(Boolean))).filter((id) => tracks[id]);
  const ops: MutationOp[] = [];
  if (!ids.length || s <= 0) return { tracks, ops };
  let hits = 0;
  for (const id of ids) hits += tracks[id]!.filter(Boolean).length;
  const n = Math.max(1, Math.round(Math.pow(s, 1.4) * (hits * 0.5 + 3)));
  const allowed = OPS.filter((o) => s >= o.minStrength);
  const total = allowed.reduce((a, o) => a + o.weight, 0);

  /** Choose a position, preferring weak metric positions at low strength. */
  const pickPos = (len: number, pred: (i: number) => boolean): number => {
    const cand: number[] = [];
    const w: number[] = [];
    for (let i = 0; i < len; i++) {
      if (!pred(i)) continue;
      cand.push(i);
      w.push(Math.max(0.02, 1 - metricWeight(i, geo) * (1 - s)));
    }
    if (!cand.length) return -1;
    let x = rng.next() * w.reduce((a, b) => a + b, 0);
    for (let k = 0; k < cand.length; k++) {
      x -= w[k]!;
      if (x < 0) return cand[k]!;
    }
    return cand[cand.length - 1]!;
  };

  for (let k = 0; k < n; k++) {
    let x = rng.next() * total;
    let def = allowed[0]!;
    for (const o of allowed) {
      x -= o.weight;
      if (x < 0) {
        def = o;
        break;
      }
    }
    const id = rng.pick(ids);
    const t = tracks[id]!;
    const len = Math.max(1, Math.min(lengths[id] ?? t.length, t.length));
    if (apply(def.op, t, len)) ops.push(def.op);
  }
  return { tracks, ops };

  function apply(op: MutationOp, t: Strikes, len: number): boolean {
    switch (op) {
      case 'add': {
        const i = pickPos(len, (j) => !t[j]);
        if (i < 0) return false;
        t[i] = { v: 1 + rng.int(3), s: 1 };
        return true;
      }
      case 'remove': {
        const i = pickPos(len, (j) => !!t[j] && (s > 0.5 || (t[j]!.v !== 5 || metricWeight(j, geo) < 0.8)));
        if (i < 0) return false;
        t[i] = null;
        return true;
      }
      case 'shift': {
        const i = pickPos(len, (j) => !!t[j]);
        if (i < 0) return false;
        const dir = rng.chance(0.5) ? 1 : -1;
        const j = (i + dir + len) % len;
        if (t[j]) return false;
        t[j] = t[i]!;
        t[i] = null;
        return true;
      }
      case 'swap': {
        const i = pickPos(len, (j) => !!t[j] || !!t[(j + 1) % len]);
        if (i < 0) return false;
        const j = (i + 1) % len;
        const a = t[i] ?? null;
        t[i] = t[j] ?? null;
        t[j] = a;
        return true;
      }
      case 'velocity': {
        const i = pickPos(len, (j) => !!t[j]);
        if (i < 0) return false;
        const st = t[i]!;
        const v = st.v || 3;
        st.v = Math.max(1, Math.min(5, v + (rng.chance(0.5) ? 1 : -1)));
        return true;
      }
      case 'accent': {
        const i = pickPos(len, (j) => !!t[j]);
        if (i < 0) return false;
        const st = t[i]!;
        st.v = st.v === 5 ? 3 : 5;
        return true;
      }
      case 'density': {
        const add = rng.chance(0.5);
        let done = false;
        for (let c = 0; c < 2; c++) {
          const i = pickPos(len, (j) => (add ? !t[j] : !!t[j]));
          if (i < 0) break;
          t[i] = add ? { v: 1 + rng.int(2), s: 1 } : null;
          done = true;
        }
        return done;
      }
      case 'rest': {
        const runLen = 2 + rng.int(3);
        const start = pickPos(len, (j) => metricWeight(j, geo) < 1);
        if (start < 0) return false;
        let any = false;
        for (let c = 0; c < runLen && start + c < len; c++) {
          if (t[start + c]) any = true;
          t[start + c] = null;
        }
        return any;
      }
      case 'recombine': {
        const frag = Math.max(1, Math.min(len, geo.grid));
        const slots = Math.floor(len / frag);
        if (slots < 2) return false;
        const a = rng.int(slots);
        let b = rng.int(slots - 1);
        if (b >= a) b++;
        for (let c = 0; c < frag; c++) t[b * frag + c] = cloneStrike(t[a * frag + c] ?? null);
        return true;
      }
      case 'rotate': {
        const dir = rng.chance(0.5) ? 1 : -1;
        const seg = t.slice(0, len);
        for (let i = 0; i < len; i++) t[(i + dir + len) % len] = seg[i] ?? null;
        return true;
      }
      case 'reverse': {
        const frag = Math.max(2, Math.min(len, geo.grid));
        const slots = Math.floor(len / frag);
        if (slots < 1) return false;
        const a = rng.int(slots) * frag;
        const seg = t.slice(a, a + frag).reverse();
        for (let c = 0; c < frag; c++) t[a + c] = seg[c] ?? null;
        return true;
      }
    }
  }
}

/** Fraction of positions (within loop lengths) that differ from the source. */
export function distance(a: TrackStrikes, b: TrackStrikes, lengths: Record<string, number>): number {
  let diff = 0;
  let total = 0;
  for (const id of Object.keys(a)) {
    const x = a[id]!;
    const y = b[id] ?? [];
    const len = Math.min(lengths[id] ?? x.length, x.length);
    for (let i = 0; i < len; i++) {
      const p = x[i];
      const q = y[i];
      if (p || q) total++;
      if (!!p !== !!q || (p && q && (p.v !== q.v || p.s !== q.s))) diff++;
    }
  }
  return total ? diff / total : 0;
}

/** Summarise ops for the monitor: "+HIT 2 · SHIFT 1". */
export function summariseOps(ops: MutationOp[]): string {
  const counts = new Map<MutationOp, number>();
  for (const o of ops) counts.set(o, (counts.get(o) ?? 0) + 1);
  return [...counts].map(([o, c]) => `${OP_LABEL[o]} ${c}`).join(' · ') || 'NO CHANGE';
}
