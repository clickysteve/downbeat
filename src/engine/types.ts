import type { ProjectAudio } from '../audio/settings';

/**
 * DOWNBEAT data model.
 *
 * The fundamental distinction: a Pattern's tracks hold the *source* (what the
 * musician wrote). Nothing in the engine ever changes them. What plays is a
 * *performance* realised from the source for each cycle (see realize.ts).
 */

/** Engine ticks per quarter note: one MIDI Clock pulse per tick. */
export const PPQ = 24;
/** Fine units per tick. One fine unit = 1/96 quarter (UpBeat's resolution). */
export const FINE = 4;

export const MAX_VOICES = 16;
export const MAX_STEPS = 64;
export const MAX_BARS = 8;
export const MAX_SOUND_STEPS = 16;
export const MAX_PATTERNS = 64;
export const MAX_RULES = 16;
export const MAX_SONG_ENTRIES = 64;

/** Striker levels 1-5 (5 = accent); 0 = the random striker. */
export const LEVELS = [1, 2, 3, 4, 5] as const;
export const ACCENT = 5;

export interface Strike {
  /** Striker: 1 ghost .. 5 accent, 0 = random striker. */
  v: number;
  /** Sound step: 1..n, 0 = random step. */
  s: number;
  /** Flam (grace note before the strike). */
  f?: boolean;
  /** EXTENDED per-step probability 0-100 (absent = 100). */
  p?: number;
}

export type Family = 'kick' | 'snare' | 'clap' | 'hat' | 'openhat' | 'tom' | 'perc' | 'cymbal';

export const SOUNDS = [
  'kick',
  'kick2',
  'snare',
  'snare2',
  'rim',
  'clap',
  'hat',
  'openhat',
  'tomlo',
  'tommid',
  'tomhi',
  'cowbell',
  'clave',
  'shaker',
  'conga',
  'crash',
  'ride',
  'zap',
  'none',
] as const;
export type InternalSound = (typeof SOUNDS)[number];

export interface VoiceSound {
  kind: InternalSound;
  /** Semitones. */
  tune: number;
  /** Decay multiplier 0.25-4. */
  decay: number;
  /** Level 0-1. */
  level: number;
}

export interface Voice {
  id: string;
  name: string;
  family: Family;
  /** Voice identity colour slot 0-5 (palette roles v1..v6). */
  color: number;
  /** MIDI channel 1-16. */
  channel: number;
  /** Step list: each step is a note or chord (MIDI note numbers). */
  notes: number[][];
  /** Program change sent at Start (null = none). */
  program: number | null;
  sound: VoiceSound;
  /** Note length in ticks. */
  gate: number;
  mute: boolean;
  solo: boolean;
}

export interface VelocityTools {
  /** Central velocity per striker 1-5. */
  center: number[];
  /** ± range per striker. */
  range: number[];
  /** Random striker weights per striker 1-5 (Random Velocity). */
  weights: number[];
}

export type FillZone = 'all' | 'bar' | 'half' | 'beat';
export const FILL_RATES = [0.5, 1, 2, 3, 4] as const;

export interface FillSettings {
  on: boolean;
  /** Voice whose sound plays the fill (null = this voice). */
  sound: string | null;
  /** Percentage of empty space filled (probability per candidate slot). */
  amount: number;
  /** Fill speed relative to the grid. */
  rate: number;
  /** Minimum distance in steps from written strikes. */
  spacing: number;
  /** Maximum fill notes in one gap between written strikes. */
  max: number;
  zone: FillZone;
  /** Fill velocity probabilities over strikers 1-5. */
  weights: number[];
}

/** EXTENDED per-track probability controls. */
export interface TrackExt {
  /** Probability that a written strike plays (0-100). */
  prob: number;
  /** Probability of an additional ghost hit after a played strike. */
  extra: number;
  /** Probability that a non-accent strike is played as an accent. */
  accent: number;
  /** Extra velocity variation ±%. */
  velVar: number;
}

export interface Track {
  strikes: (Strike | null)[];
  /** Loop length in steps (1..pattern steps). */
  loop: number;
  /** Loop percentage: chance of jumping back at the loop point. */
  loopPct: number;
  /** 'pattern': restart when the pattern starts; 'free': keep running across patterns. */
  phase: 'pattern' | 'free';
  /** Whole-track shift in fine units (negative = early). */
  shift: number;
  /** Note density 0-100. */
  density: number;
  /** ± placement in fine units. */
  timing: number;
  vel: VelocityTools;
  fill: FillSettings;
  ext: TrackExt;
}

export type EvolveMode = 'original' | 'evolving';

export interface EvolveSettings {
  on: boolean;
  mode: EvolveMode;
  /** New generation every n cycles. */
  every: number;
  /** Mutation strength 0-100. */
  strength: number;
  /** Voices that may mutate (empty = all). */
  targets: string[];
  /** Return to the source every n generations (0 = never). */
  returnEvery: number;
  /** EVOLVING: pull back to the source when more than this % of the pattern has changed. */
  maxDrift: number;
  /** A locked variation (played instead of evolving). */
  locked: null | { generation: number; tracks: Record<string, (Strike | null)[]> };
}

export interface Pattern {
  id: string;
  name: string;
  /** Time signature numerator 1-15. */
  beats: number;
  /** Time signature denominator 4, 8 or 16. */
  unit: number;
  bars: number;
  /** Steps per beat (the Edit grid). */
  grid: number;
  /** Pattern tempo (null = project tempo). */
  tempo: number | null;
  tracks: Record<string, Track>;
  evolve: EvolveSettings;
}

export interface SongEntry {
  patternId: string;
  repeats: number;
}

export type GrooveTemplate = 'none' | 'shuffle' | 'push' | 'lazy' | 'break';

export interface GrooveSettings {
  /** Swing 50-75 %. */
  swing: number;
  template: GrooveTemplate;
  /** Template depth 0-100. */
  depth: number;
  /** Timing variation ± fine units. */
  humanize: number;
  /** Velocity variation ± %. */
  velVar: number;
  /** Accent emphasis 0-100 %. */
  accent: number;
}

export type RuleWhen =
  | { type: 'every'; n: number; offset: number }
  | { type: 'rep'; n: number }
  | { type: 'patternStart' }
  | { type: 'density'; voice: string; below: number }
  | { type: 'generation'; every: number }
  | { type: 'chance'; p: number };

export type RuleAction = 'fill' | 'mutate' | 'thin' | 'boost' | 'mute' | 'unmute' | 'reset' | 'source' | 'next';

export interface Rule {
  id: string;
  on: boolean;
  when: RuleWhen;
  then: RuleAction;
  /** Target voice id, a family ('@hat'), or 'all'. */
  target: string;
  /** Strength / amount 0-100 where meaningful. */
  amount: number;
  /** How many cycles the effect lasts. */
  cycles: number;
}

export interface ExtFeatures {
  prob: boolean;
  groove: boolean;
  evolve: boolean;
  rules: boolean;
  auto: boolean;
}

export interface ExtSettings {
  /** EXTENDED mode master switch. Off = CLASSIC. */
  enabled: boolean;
  features: ExtFeatures;
  groove: GrooveSettings;
  rules: Rule[];
  /** ACTIVITY 0-100: how much the autopilot changes things. */
  activity: number;
  /** Autopilot phrase length in cycles. */
  phrase: number;
}

export interface Project {
  name: string;
  tempo: number;
  seed: number;
  /** Versions of the inferred algorithms this project was made with. */
  algorithms: { classic: number; extended: number };
  voices: Voice[];
  patterns: Pattern[];
  song: { entries: SongEntry[]; loop: boolean };
  playMode: 'pattern' | 'song';
  current: string;
  ext: ExtSettings;
  notes: string;
  /**
   * Samples, choke groups and output processing (format 2). Absent until something is changed:
   * then every sound is internal and nothing is processed, exactly as before format 2.
   */
  audio?: ProjectAudio;
}

/** Geometry of a pattern. */
export interface Geometry {
  steps: number;
  stepTicks: number;
  stepsPerBar: number;
  grid: number;
  bars: number;
}

export function geometry(p: Pick<Pattern, 'beats' | 'unit' | 'bars' | 'grid'>): Geometry {
  const stepsPerBar = p.beats * p.grid;
  return {
    steps: stepsPerBar * p.bars,
    stepTicks: (PPQ * 4) / p.unit / p.grid,
    stepsPerBar,
    grid: p.grid,
    bars: p.bars,
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
