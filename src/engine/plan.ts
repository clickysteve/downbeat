/** Cycle plans: what the engine decided for one repetition of a pattern. */
import type { FillZone, Geometry, Strike } from './types';

/** Where a variant strike came from relative to the written source. */
export type Origin = 'source' | 'added' | 'changed';

/** One track of the pattern as it will be performed this cycle (track-position space). */
export interface VariantTrack {
  strikes: (Strike | null)[];
  /** Per position: null (empty), 'source' (as written), 'added' (not written), 'changed' (written, altered). */
  origin: (Origin | null)[];
  /** Per position: a written strike that the variant removed. */
  removed: boolean[];
  /** `strikes` is the source array itself (no transformation), so live edits are heard at once. */
  live?: boolean;
}

export type Variant = Record<string, VariantTrack>;

/** Temporary per-voice modifications from rules or the autopilot. */
export interface VoiceMods {
  /** Multiplies density (0-1). */
  densityMul: number;
  /** Added to fill amount (percentage points). */
  fillBoost: number;
  /** Forced fill for this cycle. */
  forceFill: { zone: FillZone; amount: number } | null;
  /** Temporary mute (true), unmute (false) or no change (null). */
  mute: boolean | null;
  /** Added to EXTENDED extra-hit probability. */
  extraBoost: number;
}

export const noMods = (): VoiceMods => ({ densityMul: 1, fillBoost: 0, forceFill: null, mute: null, extraBoost: 0 });

/** A message for the performance monitor. */
export interface Label {
  kind: 'pattern' | 'fill' | 'evolve' | 'mutate' | 'morph' | 'rule' | 'auto' | 'loop' | 'source' | 'lock' | 'song';
  text: string;
}

export interface CyclePlan {
  /** Cycle number since Start. */
  index: number;
  patternId: string;
  /** Repetition of this pattern in the current run (0 = first). */
  rep: number;
  startTick: number;
  geo: Geometry;
  /** Per voice: the track position played at each cycle step. */
  pos: Record<string, number[]>;
  variant: Variant;
  /** Evolution generation (0 = source). */
  generation: number;
  mods: Record<string, VoiceMods>;
  /** Play the plain written pattern (SOURCE), with nothing generated. */
  sourceOnly: boolean;
  /** Key for random decisions (the cycle index, or a locked cycle). */
  key: number;
  labels: Label[];
  /** Tempo to apply at the start of this cycle (null = unchanged). */
  tempo: number | null;
  morph: { from: string; to: string; t: number } | null;
  /** Song position, for display. */
  song: { entry: number; repeat: number; of: number } | null;
  /** The song ends at the end of this cycle. */
  endsSong: boolean;
}

export const endTick = (p: CyclePlan): number => p.startTick + p.geo.steps * p.geo.stepTicks;
