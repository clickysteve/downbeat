/**
 * Project files: `{format: "downbeat-project", version, savedAt, project}`.
 *
 * Loading always goes through migration (older versions), then validation and
 * repair: every number is clamped to its range, missing parts are filled with
 * defaults, unknown fields are dropped, strike arrays are resized to their
 * pattern. Problems are reported, never thrown, unless the file is not a
 * DOWNBEAT project at all.
 */
import { repairAudio } from '../audio/settings';
import { defaultEvolve, defaultExt, defaultFill, defaultVelocity, makeId, makeTrack, FAMILY_COLOR } from '../engine/defaults';
import {
  FILL_RATES,
  MAX_BARS,
  MAX_PATTERNS,
  MAX_RULES,
  MAX_SONG_ENTRIES,
  MAX_SOUND_STEPS,
  MAX_STEPS,
  MAX_VOICES,
  SOUNDS,
  clamp,
  geometry,
  type Family,
  type FillZone,
  type GrooveTemplate,
  type InternalSound,
  type Pattern,
  type Project,
  type Rule,
  type RuleAction,
  type RuleWhen,
  type Strike,
  type Track,
  type Voice,
} from '../engine/types';

export const PROJECT_FORMAT = 'downbeat-project';
export const PROJECT_VERSION = 2;
export const FILE_SUFFIX = '.downbeat.json';

export class ProjectError extends Error {}

export interface LoadResult {
  project: Project;
  /** What was migrated or repaired, in plain words. */
  report: string[];
  /** The file's version before migration. */
  fromVersion: number;
}

export function serialize(project: Project): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, savedAt: new Date().toISOString(), project }, null, 1);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d: number, lo: number, hi: number, int = false): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return clamp(int ? Math.round(n) : n, lo, hi);
};
const str = (v: unknown, d: string, max = 40): string => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, xs: readonly T[], d: T): T => (xs.includes(v as T) ? (v as T) : d);
const FAMILIES: Family[] = ['kick', 'snare', 'clap', 'hat', 'openhat', 'tom', 'perc', 'cymbal'];

/**
 * Migrations: index n turns a version-n file body into version n+1.
 * Version 0 is the pre-release shape: a bare project object (no wrapper),
 * voices with a single `note` number, and no `algorithms` record.
 */
const MIGRATIONS: ((p: Obj, report: string[]) => Obj)[] = [
  (p, report) => {
    if (Array.isArray(p.voices)) {
      for (const v of p.voices as Obj[]) {
        if (isObj(v) && typeof v.note === 'number' && !Array.isArray(v.notes)) {
          v.notes = [[v.note]];
          delete v.note;
        }
      }
    }
    if (!isObj(p.algorithms)) p.algorithms = { classic: 1, extended: 1 };
    report.push('Converted from the pre-release format (version 0): single notes became step lists.');
    return p;
  },
  // 1 -> 2: an optional `audio` section (samples, choke groups, output processing). A project
  // without one plays its internal sounds unprocessed, as before, so nothing changes here.
  // The version number makes older DOWNBEATs refuse format 2 files instead of silently
  // dropping their sample assignments.
  (p) => p,
];

/** Parse a project file's text. */
export function parseProject(text: string): LoadResult {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new ProjectError('The file is not valid JSON.');
  }
  return loadProject(obj);
}

export function loadProject(obj: unknown): LoadResult {
  if (!isObj(obj)) throw new ProjectError('The file is not a DOWNBEAT project.');
  let body: Obj;
  let version: number;
  if (obj.format !== undefined) {
    if (obj.format !== PROJECT_FORMAT) throw new ProjectError('The file is not a DOWNBEAT project.');
    version = Number(obj.version);
    if (!Number.isInteger(version) || version < 0) throw new ProjectError('The project file has no valid version number.');
    if (version > PROJECT_VERSION) throw new ProjectError(`This project was saved by a newer DOWNBEAT (format version ${version}).`);
    if (!isObj(obj.project)) throw new ProjectError('The project file has no project in it.');
    body = structuredClone(obj.project);
  } else if (Array.isArray(obj.voices) && Array.isArray(obj.patterns)) {
    version = 0;
    body = structuredClone(obj);
  } else throw new ProjectError('The file is not a DOWNBEAT project.');
  const report: string[] = [];
  const from = version;
  while (version < PROJECT_VERSION) {
    body = MIGRATIONS[version]!(body, report);
    version++;
  }
  const project = repair(body, report);
  return { project, report, fromVersion: from };
}

function repairVoice(v: Obj, i: number, report: string[]): Voice {
  const family = oneOf(v.family, FAMILIES, 'perc');
  const s = isObj(v.sound) ? v.sound : {};
  let notes: number[][] = [];
  if (Array.isArray(v.notes)) {
    notes = (v.notes as unknown[])
      .map((n) => (Array.isArray(n) ? n : [n]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).map((x) => clamp(Math.round(x), 0, 127)).slice(0, 8))
      .filter((n) => n.length)
      .slice(0, MAX_SOUND_STEPS);
  }
  if (!notes.length) {
    notes = [[36 + i]];
    report.push(`Voice ${i + 1} had no notes; given note ${36 + i}.`);
  }
  return {
    id: str(v.id, '', 32) || makeId('v'),
    name: str(v.name, `VOICE ${i + 1}`, 12).toUpperCase() || `VOICE ${i + 1}`,
    family,
    color: num(v.color, FAMILY_COLOR[family], 0, 5, true),
    channel: num(v.channel, 10, 1, 16, true),
    notes,
    program: v.program === null || v.program === undefined ? null : num(v.program, 0, 0, 127, true),
    sound: {
      kind: oneOf(s.kind, SOUNDS, 'kick') as InternalSound,
      tune: num(s.tune, 0, -24, 24),
      decay: num(s.decay, 1, 0.25, 4),
      level: num(s.level, 0.8, 0, 1),
    },
    gate: num(v.gate, 3, 0.5, 96),
    mute: bool(v.mute, false),
    solo: bool(v.solo, false),
  };
}

function repairStrike(s: unknown, soundSteps: number): Strike | null {
  if (!isObj(s)) return null;
  const out: Strike = { v: num(s.v, 3, 0, 5, true), s: num(s.s, 1, 0, soundSteps, true) };
  if (s.f === true) out.f = true;
  if (typeof s.p === 'number') out.p = num(s.p, 100, 0, 100, true);
  return out;
}

function nums(v: unknown, d: number[], lo: number, hi: number): number[] {
  const a = Array.isArray(v) ? v : [];
  return d.map((x, i) => num(a[i], x, lo, hi));
}

function repairTrack(t: unknown, steps: number, soundSteps: number, voiceIds: Set<string>): Track {
  const base = makeTrack(steps);
  if (!isObj(t)) return base;
  const strikes = Array.isArray(t.strikes) ? (t.strikes as unknown[]) : [];
  base.strikes = Array.from({ length: steps }, (_, i) => repairStrike(strikes[i], soundSteps));
  base.loop = num(t.loop, steps, 1, steps, true);
  base.loopPct = num(t.loopPct, 100, 0, 100, true);
  base.phase = oneOf(t.phase, ['pattern', 'free'] as const, 'pattern');
  base.shift = num(t.shift, 0, -48, 48, true);
  base.density = num(t.density, 100, 0, 100, true);
  base.timing = num(t.timing, 0, 0, 24, true);
  const vel = isObj(t.vel) ? t.vel : {};
  const dv = defaultVelocity();
  base.vel = { center: nums(vel.center, dv.center, 1, 127), range: nums(vel.range, dv.range, 0, 40), weights: nums(vel.weights, dv.weights, 0, 100) };
  const f = isObj(t.fill) ? t.fill : {};
  const df = defaultFill();
  base.fill = {
    on: bool(f.on, df.on),
    sound: typeof f.sound === 'string' && voiceIds.has(f.sound) ? f.sound : null,
    amount: num(f.amount, df.amount, 0, 100, true),
    rate: (FILL_RATES as readonly number[]).includes(f.rate as number) ? (f.rate as number) : df.rate,
    spacing: num(f.spacing, df.spacing, 0, 4, true),
    max: num(f.max, df.max, 1, 16, true),
    zone: oneOf(f.zone, ['all', 'bar', 'half', 'beat'] as FillZone[], 'all'),
    weights: nums(f.weights, df.weights, 0, 100),
  };
  const e = isObj(t.ext) ? t.ext : {};
  base.ext = { prob: num(e.prob, 100, 0, 100, true), extra: num(e.extra, 0, 0, 100, true), accent: num(e.accent, 0, 0, 100, true), velVar: num(e.velVar, 0, 0, 50, true) };
  return base;
}

function repairPattern(p: Obj, i: number, voices: Voice[], report: string[]): Pattern | null {
  const beats = num(p.beats, 4, 1, 15, true);
  const unit = [4, 8, 16].includes(p.unit as number) ? (p.unit as number) : 4;
  let bars = num(p.bars, 1, 1, MAX_BARS, true);
  let grid = num(p.grid, 4, 1, 8, true);
  while (geometry({ beats, unit, bars, grid }).steps > MAX_STEPS && bars > 1) bars--;
  while (geometry({ beats, unit, bars, grid }).steps > MAX_STEPS && grid > 1) grid--;
  if (geometry({ beats, unit, bars, grid }).steps > MAX_STEPS) {
    report.push(`Pattern ${i + 1} was too long and was skipped.`);
    return null;
  }
  const { steps } = geometry({ beats, unit, bars, grid });
  const tracks: Record<string, Track> = {};
  const src = isObj(p.tracks) ? p.tracks : {};
  const ids = new Set(voices.map((v) => v.id));
  for (const v of voices) tracks[v.id] = repairTrack(src[v.id], steps, v.notes.length, ids);
  const ev = isObj(p.evolve) ? p.evolve : {};
  const de = defaultEvolve();
  let locked: Pattern['evolve']['locked'] = null;
  if (isObj(ev.locked) && isObj(ev.locked.tracks)) {
    const lt: Record<string, (Strike | null)[]> = {};
    for (const v of voices) {
      const a = (ev.locked.tracks as Obj)[v.id];
      lt[v.id] = Array.from({ length: steps }, (_, k) => repairStrike(Array.isArray(a) ? a[k] : null, v.notes.length));
    }
    locked = { generation: num(ev.locked.generation, 1, 0, 100000, true), tracks: lt };
  }
  return {
    id: str(p.id, '', 32) || makeId('p'),
    name: str(p.name, `PATTERN ${i + 1}`, 16).toUpperCase() || `PATTERN ${i + 1}`,
    beats,
    unit,
    bars,
    grid,
    tempo: p.tempo === null || p.tempo === undefined ? null : num(p.tempo, 120, 20, 300),
    tracks,
    evolve: {
      on: bool(ev.on, de.on),
      mode: oneOf(ev.mode, ['original', 'evolving'] as const, 'original'),
      every: num(ev.every, de.every, 1, 64, true),
      strength: num(ev.strength, de.strength, 0, 100, true),
      targets: Array.isArray(ev.targets) ? (ev.targets as unknown[]).filter((x): x is string => typeof x === 'string' && ids.has(x)) : [],
      returnEvery: num(ev.returnEvery, 0, 0, 64, true),
      maxDrift: num(ev.maxDrift, de.maxDrift, 0, 100, true),
      locked,
    },
  };
}

const ACTIONS: RuleAction[] = ['fill', 'mutate', 'thin', 'boost', 'mute', 'unmute', 'reset', 'source', 'next'];

function repairRule(r: unknown, voices: Voice[]): Rule | null {
  if (!isObj(r) || !isObj(r.when)) return null;
  const w = r.when;
  let when: RuleWhen;
  switch (w.type) {
    case 'every':
      when = { type: 'every', n: num(w.n, 4, 1, 64, true), offset: num(w.offset, 0, 0, 63, true) };
      break;
    case 'rep':
      when = { type: 'rep', n: num(w.n, 4, 1, 64, true) };
      break;
    case 'patternStart':
      when = { type: 'patternStart' };
      break;
    case 'density':
      if (typeof w.voice !== 'string' || !voices.some((v) => v.id === w.voice)) return null;
      when = { type: 'density', voice: w.voice, below: num(w.below, 50, 0, 100, true) };
      break;
    case 'generation':
      when = { type: 'generation', every: num(w.every, 4, 1, 64, true) };
      break;
    case 'chance':
      when = { type: 'chance', p: num(w.p, 25, 0, 100, true) };
      break;
    default:
      return null;
  }
  const target = typeof r.target === 'string' && (r.target === 'all' || r.target.startsWith('@') || voices.some((v) => v.id === r.target)) ? r.target : 'all';
  return {
    id: str(r.id, '', 32) || makeId('r'),
    on: bool(r.on, true),
    when,
    then: oneOf(r.then, ACTIONS, 'fill'),
    target,
    amount: num(r.amount, 50, 0, 100, true),
    cycles: num(r.cycles, 1, 1, 64, true),
  };
}

function repair(p: Obj, report: string[]): Project {
  const vin = Array.isArray(p.voices) ? (p.voices as unknown[]).filter(isObj) : [];
  if (vin.length > MAX_VOICES) report.push(`Only the first ${MAX_VOICES} voices were kept.`);
  const voices = vin.slice(0, MAX_VOICES).map((v, i) => repairVoice(v, i, report));
  const seen = new Set<string>();
  for (const v of voices) {
    if (seen.has(v.id)) v.id = makeId('v');
    seen.add(v.id);
  }
  if (!voices.length) throw new ProjectError('The project has no voices.');
  const pin = Array.isArray(p.patterns) ? (p.patterns as unknown[]).filter(isObj) : [];
  const patterns = pin
    .slice(0, MAX_PATTERNS)
    .map((x, i) => repairPattern(x, i, voices, report))
    .filter((x): x is Pattern => !!x);
  const pseen = new Set<string>();
  for (const pt of patterns) {
    if (pseen.has(pt.id)) pt.id = makeId('p');
    pseen.add(pt.id);
  }
  if (!patterns.length) throw new ProjectError('The project has no patterns.');
  const song = isObj(p.song) ? p.song : {};
  const entries = (Array.isArray(song.entries) ? (song.entries as unknown[]) : [])
    .filter(isObj)
    .filter((e) => patterns.some((pt) => pt.id === e.patternId))
    .slice(0, MAX_SONG_ENTRIES)
    .map((e) => ({ patternId: e.patternId as string, repeats: num(e.repeats, 1, 1, 99, true) }));
  const ex = isObj(p.ext) ? p.ext : {};
  const de = defaultExt();
  const feat = isObj(ex.features) ? ex.features : {};
  const g = isObj(ex.groove) ? ex.groove : {};
  const rules = (Array.isArray(ex.rules) ? (ex.rules as unknown[]) : [])
    .map((r) => repairRule(r, voices))
    .filter((r): r is Rule => !!r)
    .slice(0, MAX_RULES);
  const algorithms = isObj(p.algorithms) ? p.algorithms : {};
  const current = typeof p.current === 'string' && patterns.some((pt) => pt.id === p.current) ? p.current : patterns[0]!.id;
  return {
    name: str(p.name, 'UNTITLED', 40) || 'UNTITLED',
    tempo: num(p.tempo, 120, 20, 300),
    seed: num(p.seed, 1, 1, 4294967295, true),
    algorithms: { classic: num(algorithms.classic, 1, 1, 1, true), extended: num(algorithms.extended, 1, 1, 1, true) },
    voices,
    patterns,
    song: { entries, loop: bool(song.loop, true) },
    playMode: oneOf(p.playMode, ['pattern', 'song'] as const, 'pattern'),
    current,
    ext: {
      enabled: bool(ex.enabled, de.enabled),
      features: {
        prob: bool(feat.prob, de.features.prob),
        groove: bool(feat.groove, de.features.groove),
        evolve: bool(feat.evolve, de.features.evolve),
        rules: bool(feat.rules, de.features.rules),
        auto: bool(feat.auto, de.features.auto),
      },
      groove: {
        swing: num(g.swing, 50, 50, 75, true),
        template: oneOf(g.template, ['none', 'shuffle', 'push', 'lazy', 'break'] as GrooveTemplate[], 'none'),
        depth: num(g.depth, 100, 0, 100, true),
        humanize: num(g.humanize, 0, 0, 24, true),
        velVar: num(g.velVar, 0, 0, 50, true),
        accent: num(g.accent, 0, 0, 100, true),
      },
      rules,
      activity: num(ex.activity, de.activity, 0, 100, true),
      phrase: num(ex.phrase, de.phrase, 1, 64, true),
    },
    notes: str(p.notes, '', 4000),
    ...(p.audio !== undefined ? { audio: repairAudio(p.audio, voices) } : {}),
  };
}

/** A safe file name from a project name. */
export function fileName(name: string, suffix = FILE_SUFFIX): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  return `${base}${suffix}`;
}
