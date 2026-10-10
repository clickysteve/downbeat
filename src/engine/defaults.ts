/** Factories for voices, tracks, patterns and projects. */
import {
  MAX_STEPS,
  geometry,
  type EvolveSettings,
  type ExtSettings,
  type Family,
  type FillSettings,
  type InternalSound,
  type Pattern,
  type Project,
  type Track,
  type VelocityTools,
  type Voice,
} from './types';

let idCounter = 0;
/** Short unique id with a prefix. */
export function makeId(prefix: string): string {
  idCounter = (idCounter + 1) % 1679616;
  const t = Date.now().toString(36).slice(-5);
  const r = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
  return `${prefix}${t}${idCounter.toString(36)}${r}`;
}

export const FAMILY_COLOR: Record<Family, number> = {
  kick: 0,
  snare: 1,
  clap: 1,
  hat: 2,
  openhat: 2,
  tom: 3,
  perc: 4,
  cymbal: 5,
};

export interface VoiceTemplate {
  name: string;
  family: Family;
  notes: number[][];
  sound: InternalSound;
  gate?: number;
}

/** The default kit (General MIDI drum notes on channel 10). */
export const KIT: VoiceTemplate[] = [
  { name: 'KICK', family: 'kick', notes: [[36]], sound: 'kick' },
  { name: 'SNARE', family: 'snare', notes: [[38], [40]], sound: 'snare' },
  { name: 'CLAP', family: 'clap', notes: [[39]], sound: 'clap' },
  { name: 'RIM', family: 'snare', notes: [[37]], sound: 'rim' },
  { name: 'CL HAT', family: 'hat', notes: [[42], [44]], sound: 'hat' },
  { name: 'OP HAT', family: 'openhat', notes: [[46]], sound: 'openhat' },
  { name: 'LO TOM', family: 'tom', notes: [[45]], sound: 'tomlo' },
  { name: 'MID TOM', family: 'tom', notes: [[47]], sound: 'tommid' },
  { name: 'HI TOM', family: 'tom', notes: [[50]], sound: 'tomhi' },
  { name: 'COWBELL', family: 'perc', notes: [[56]], sound: 'cowbell' },
  { name: 'SHAKER', family: 'perc', notes: [[70]], sound: 'shaker' },
  { name: 'CRASH', family: 'cymbal', notes: [[49]], sound: 'crash', gate: 12 },
];

/** Extra voices offered by ADD VOICE once the kit is in use. */
export const EXTRA_VOICES: VoiceTemplate[] = [
  { name: 'CLAVE', family: 'perc', notes: [[75]], sound: 'clave' },
  { name: 'CONGA', family: 'perc', notes: [[63], [62], [64]], sound: 'conga' },
  { name: 'RIDE', family: 'cymbal', notes: [[51]], sound: 'ride', gate: 12 },
  { name: 'ZAP', family: 'perc', notes: [[76]], sound: 'zap' },
  { name: 'KICK 2', family: 'kick', notes: [[35]], sound: 'kick2' },
  { name: 'SNARE 2', family: 'snare', notes: [[40]], sound: 'snare2' },
];

export function makeVoice(t: VoiceTemplate, id = makeId('v')): Voice {
  return {
    id,
    name: t.name,
    family: t.family,
    color: FAMILY_COLOR[t.family],
    channel: 10,
    notes: t.notes.map((n) => [...n]),
    program: null,
    sound: { kind: t.sound, tune: 0, decay: 1, level: 0.8 },
    gate: t.gate ?? 3,
    mute: false,
    solo: false,
  };
}

export function defaultVelocity(): VelocityTools {
  return { center: [28, 52, 80, 104, 124], range: [4, 6, 6, 6, 3], weights: [10, 25, 35, 20, 10] };
}

export function defaultFill(): FillSettings {
  return { on: false, sound: null, amount: 30, rate: 1, spacing: 0, max: 2, zone: 'all', weights: [35, 35, 20, 10, 0] };
}

export function makeTrack(steps: number): Track {
  return {
    strikes: new Array<null>(steps).fill(null),
    loop: steps,
    loopPct: 100,
    phase: 'pattern',
    shift: 0,
    density: 100,
    timing: 0,
    vel: defaultVelocity(),
    fill: defaultFill(),
    ext: { prob: 100, extra: 0, accent: 0, velVar: 0 },
  };
}

export function defaultEvolve(): EvolveSettings {
  return { on: false, mode: 'original', every: 2, strength: 25, targets: [], returnEvery: 0, maxDrift: 40, locked: null };
}

export function makePattern(voices: Voice[], name = 'PATTERN 1', opts: Partial<Pick<Pattern, 'beats' | 'unit' | 'bars' | 'grid'>> = {}): Pattern {
  const p: Pattern = {
    id: makeId('p'),
    name,
    beats: opts.beats ?? 4,
    unit: opts.unit ?? 4,
    bars: opts.bars ?? 1,
    grid: opts.grid ?? 4,
    tempo: null,
    tracks: {},
    evolve: defaultEvolve(),
  };
  const { steps } = geometry(p);
  if (steps > MAX_STEPS) throw new Error('pattern too long');
  for (const v of voices) p.tracks[v.id] = makeTrack(steps);
  return p;
}

export function defaultExt(): ExtSettings {
  return {
    enabled: false,
    features: { prob: true, groove: true, evolve: true, rules: true, auto: false },
    groove: { swing: 50, template: 'none', depth: 100, humanize: 0, velVar: 0, accent: 0 },
    rules: [],
    activity: 40,
    phrase: 8,
  };
}

/** A new project with the default kit and one pattern holding a simple beat. */
export function newProject(): Project {
  const voices = KIT.map((t) => makeVoice(t));
  const p = makePattern(voices, 'BEAT');
  const set = (name: string, steps: number[], v = 3) => {
    const voice = voices.find((x) => x.name === name)!;
    for (const s of steps) p.tracks[voice.id]!.strikes[s] = { v, s: 1 };
  };
  set('KICK', [0, 8], 4);
  set('KICK', [10], 3);
  set('SNARE', [4, 12], 5);
  set('CL HAT', [0, 2, 4, 6, 8, 10, 12, 14], 3);
  set('CL HAT', [2, 6, 10, 14], 2);
  return {
    name: 'UNTITLED',
    tempo: 120,
    seed: 1,
    algorithms: { classic: 1, extended: 1 },
    voices,
    patterns: [p],
    song: { entries: [{ patternId: p.id, repeats: 4 }], loop: true },
    playMode: 'pattern',
    current: p.id,
    ext: defaultExt(),
    notes: '',
  };
}

/** Make sure every pattern has a track for every voice, with the right length (repair). */
export function syncTracks(project: Project): void {
  for (const p of project.patterns) {
    const { steps } = geometry(p);
    for (const v of project.voices) {
      if (!p.tracks[v.id]) p.tracks[v.id] = makeTrack(steps);
    }
    for (const id of Object.keys(p.tracks)) {
      if (!project.voices.some((v) => v.id === id)) delete p.tracks[id];
    }
  }
}
