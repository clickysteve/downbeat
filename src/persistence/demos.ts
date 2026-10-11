/**
 * Original demonstration projects, written for DOWNBEAT (none is copied from
 * historical presets). Rows are text: one character per step.
 *
 *   .  empty        g  ghost (1)   s  soft (2)   x  normal (3)
 *   X  loud (4)     A  accent (5)  ?  random striker
 *   f  flam (loud)  r  normal, random sound step
 *   spaces and | are ignored (bar lines for readability)
 */
import { EXTRA_VOICES, KIT, defaultExt, makePattern, makeVoice } from '../engine/defaults';
import { euclidStrikes } from '../extended/euclid';
import { geometry, type ExtSettings, type Pattern, type Project, type Rule, type Strike, type Track, type Voice } from '../engine/types';

const LEVEL: Record<string, Strike> = {
  g: { v: 1, s: 1 },
  s: { v: 2, s: 1 },
  x: { v: 3, s: 1 },
  X: { v: 4, s: 1 },
  A: { v: 5, s: 1 },
  '?': { v: 0, s: 1 },
  f: { v: 4, s: 1, f: true },
  r: { v: 3, s: 0 },
};

export function parseRow(row: string, steps: number): (Strike | null)[] {
  const chars = row.replace(/[\s|]/g, '').split('');
  return Array.from({ length: steps }, (_, i) => {
    const c = chars[i];
    const s = c ? LEVEL[c] : undefined;
    return s ? { ...s } : null;
  });
}

interface PatternSpec {
  name: string;
  beats?: number;
  unit?: number;
  bars?: number;
  grid?: number;
  tempo?: number;
  rows: Record<string, string>;
  tracks?: Record<string, (t: Track, voices: Voice[]) => void>;
  evolve?: Partial<Pattern['evolve']>;
}

interface DemoSpec {
  id: string;
  name: string;
  blurb: string;
  tempo: number;
  seed: number;
  voices: string[];
  patterns: PatternSpec[];
  song?: [string, number][];
  playMode?: 'pattern' | 'song';
  ext?: Partial<Omit<ExtSettings, 'groove'>> & { groove?: Partial<ExtSettings['groove']> };
  rules?: Omit<Rule, 'id' | 'on'>[];
}

const byName = (voices: Voice[], name: string) => voices.find((v) => v.name === name);

function build(spec: DemoSpec): Project {
  const templates = [...KIT, ...EXTRA_VOICES];
  const voices = spec.voices.map((n, i) => {
    const t = templates.find((x) => x.name === n);
    if (!t) throw new Error(`demo voice ${n}`);
    return makeVoice(t, `${spec.id}-v${i}`);
  });
  const patterns = spec.patterns.map((ps, i) => {
    const p = makePattern(voices, ps.name, { beats: ps.beats, unit: ps.unit, bars: ps.bars, grid: ps.grid });
    p.id = `${spec.id}-p${i}`;
    p.tempo = ps.tempo ?? null;
    const { steps } = geometry(p);
    for (const [name, row] of Object.entries(ps.rows)) {
      const v = byName(voices, name);
      if (!v) throw new Error(`demo row ${name}`);
      p.tracks[v.id]!.strikes = parseRow(row, steps);
    }
    for (const [name, fn] of Object.entries(ps.tracks ?? {})) {
      const v = byName(voices, name);
      if (!v) throw new Error(`demo track ${name}`);
      fn(p.tracks[v.id]!, voices);
    }
    if (ps.evolve) {
      const targets = (ps.evolve.targets ?? []).map((n) => byName(voices, n)?.id).filter((x): x is string => !!x);
      p.evolve = { ...p.evolve, ...ps.evolve, targets };
    }
    return p;
  });
  const ext = { ...defaultExt(), ...spec.ext, groove: { ...defaultExt().groove, ...(spec.ext?.groove ?? {}) } };
  ext.rules = (spec.rules ?? []).map((r, i) => ({
    ...r,
    id: `${spec.id}-r${i}`,
    on: true,
    target: r.target.startsWith('@') || r.target === 'all' ? r.target : byName(voices, r.target)?.id ?? 'all',
  }));
  const pid = (name: string) => patterns.find((p) => p.name === name)!.id;
  return {
    name: spec.name,
    tempo: spec.tempo,
    seed: spec.seed,
    algorithms: { classic: 1, extended: 1 },
    voices,
    patterns,
    song: { entries: (spec.song ?? [[patterns[0]!.name, 4]]).map(([n, r]) => ({ patternId: pid(n), repeats: r })), loop: true },
    playMode: spec.playMode ?? 'pattern',
    current: patterns[0]!.id,
    ext,
    notes: spec.blurb,
  };
}

const fill = (o: Partial<Track['fill']> & { soundName?: string }) => (t: Track, voices: Voice[]) => {
  const { soundName, ...rest } = o;
  t.fill = { ...t.fill, on: true, ...rest, sound: soundName ? byName(voices, soundName)?.id ?? null : null };
};
const set = (o: Partial<Omit<Track, 'fill' | 'vel' | 'ext'>> & { ext?: Partial<Track['ext']> }) => (t: Track) => {
  const { ext, ...rest } = o;
  Object.assign(t, rest);
  if (ext) Object.assign(t.ext, ext);
};
const both =
  (...fns: ((t: Track, v: Voice[]) => void)[]) =>
  (t: Track, v: Voice[]) => {
    for (const f of fns) f(t, v);
  };
const euclidRow = (steps: number, hits: number, rot = 0, level = 3) => (t: Track) => {
  const e = euclidStrikes({ steps, hits, rotation: rot, accent: 'first', accentHits: 0, level });
  t.strikes = t.strikes.map((_, i) => (i < steps ? e[i] ?? null : null));
  t.loop = steps;
};

export const DEMO_SPECS: DemoSpec[] = [
  {
    id: 'electro',
    name: 'BASIC ELECTRO',
    blurb: 'A classic electro groove. CLASSIC only: density on the hats, tom fills into the snare, flams. Try FILL amount and the hat DENSITY.',
    tempo: 124,
    seed: 4101,
    voices: ['KICK', 'SNARE', 'CLAP', 'CL HAT', 'OP HAT', 'LO TOM', 'MID TOM', 'HI TOM', 'COWBELL', 'CRASH'],
    patterns: [
      {
        name: 'ELECTRO A',
        rows: {
          KICK: 'A.....X. ..X..... ',
          SNARE: '....A... ....A...',
          CLAP: '....x... ....x...',
          'CL HAT': 'XgxgXgxg XgxgXgxg',
          COWBELL: '......s. ........',
        },
        tracks: {
          'CL HAT': set({ density: 88 }),
          SNARE: fill({ soundName: 'MID TOM', amount: 30, max: 2, spacing: 1, zone: 'half' }),
        },
      },
      {
        name: 'ELECTRO B',
        rows: {
          KICK: 'A.....X. ..X...X. ',
          SNARE: '....A... ....A..f',
          CLAP: '....x... ....x...',
          'CL HAT': 'XgxgXgxg XgxgX...',
          'OP HAT': '........ .....x..',
          'LO TOM': '........ ........',
        },
        tracks: {
          SNARE: fill({ soundName: 'LO TOM', amount: 45, rate: 2, max: 4, zone: 'beat' }),
        },
      },
    ],
    song: [
      ['ELECTRO A', 3],
      ['ELECTRO B', 1],
    ],
    playMode: 'song',
  },
  {
    id: 'techno',
    name: 'FOUR TO THE FLOOR',
    blurb: 'Steady techno. EXTENDED: the hats and percussion evolve from the original every two cycles, a light swing, and the autopilot adds phrase-end fills. The kick never moves.',
    tempo: 132,
    seed: 777,
    voices: ['KICK', 'CLAP', 'RIM', 'CL HAT', 'OP HAT', 'SHAKER', 'COWBELL', 'MID TOM', 'CRASH'],
    patterns: [
      {
        name: 'TECHNO',
        rows: {
          KICK: 'A...A...A...A...',
          CLAP: '....x.......x...',
          RIM: '..g..x....g..x..',
          'CL HAT': 'gsxsgsxsgsxsgsxs',
          'OP HAT': '..x...x...x...x.',
          SHAKER: 'sgsgsgsgsgsgsgsg',
        },
        tracks: {
          'CL HAT': set({ density: 75, timing: 2 }),
          SHAKER: set({ density: 55 }),
          CLAP: fill({ soundName: 'RIM', amount: 25, rate: 2, max: 3, zone: 'beat' }),
        },
        evolve: { on: true, mode: 'original', every: 2, strength: 30, targets: ['CL HAT', 'RIM', 'SHAKER', 'COWBELL'] },
      },
    ],
    ext: { enabled: true, activity: 35, phrase: 8, features: { prob: true, groove: true, evolve: true, rules: true, auto: true }, groove: { swing: 54, humanize: 2 } },
  },
  {
    id: 'broken',
    name: 'BROKEN BEAT',
    blurb: 'Two-bar broken beat with a lazy groove template and probabilistic ghost notes. EXTENDED probability: snare ghosts, kick extra hits.',
    tempo: 122,
    seed: 2024,
    voices: ['KICK', 'SNARE', 'RIM', 'CL HAT', 'OP HAT', 'SHAKER', 'CONGA', 'LO TOM'],
    patterns: [
      {
        name: 'BROKEN',
        bars: 2,
        rows: {
          KICK: 'A.....X...x..X.. A.......X.x.....',
          SNARE: '....A..g.g..A... ..g.A..g....A.g.',
          RIM: '.......x........ .x..............',
          'CL HAT': 'x.xgx.xgx.xgx.xg x.xgx.xgx.xg..xg',
          'OP HAT': '................ ............x...',
          SHAKER: 'gsgsgsgsgsgsgsgs gsgsgsgsgsgsgsgs',
          CONGA: '...r..r....r..r. ..r...r....r.r..',
        },
        tracks: {
          SNARE: set({ ext: { prob: 100, extra: 12, accent: 0, velVar: 8 } }),
          KICK: set({ ext: { prob: 100, extra: 10, accent: 0, velVar: 0 } }),
          'CL HAT': set({ ext: { prob: 85, extra: 0, accent: 10, velVar: 10 } }),
          SHAKER: set({ density: 70 }),
          CONGA: set({ ext: { prob: 70, extra: 0, accent: 0, velVar: 15 } }),
        },
      },
    ],
    ext: { enabled: true, features: { prob: true, groove: true, evolve: true, rules: true, auto: false }, groove: { swing: 60, template: 'lazy', depth: 80, humanize: 3, velVar: 6 } },
  },
  {
    id: 'jungle',
    name: 'JUNGLE PRESSURE',
    blurb: 'An original two-bar break at 172 BPM. Snare rolls in triplet 32nds lead into the accents, the break EVOLVES from generation to generation and returns home every four, and a rule throws a fill every fourth cycle.',
    tempo: 172,
    seed: 1993,
    voices: ['KICK', 'SNARE', 'SNARE 2', 'CL HAT', 'OP HAT', 'RIDE', 'LO TOM', 'HI TOM', 'CRASH'],
    patterns: [
      {
        name: 'BREAK',
        bars: 2,
        rows: {
          KICK: 'A.X.......X..... ..X.......X..X..',
          SNARE: '....A..g.g..A..g .g..A..g.f..A...',
          'SNARE 2': '.........g...... ......g.........',
          'CL HAT': 'x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x.',
          RIDE: '..s...s...s...s. ..s...s...s...s.',
          'OP HAT': '................ ..............x.',
        },
        tracks: {
          SNARE: both(set({ density: 92, timing: 1 }), fill({ amount: 40, rate: 3, max: 5, spacing: 0, zone: 'half', weights: [40, 35, 20, 5, 0] })),
          'CL HAT': set({ density: 85, timing: 1 }),
          KICK: set({ shift: -1 }),
        },
        evolve: { on: true, mode: 'evolving', every: 2, strength: 35, maxDrift: 45, returnEvery: 4, targets: ['KICK', 'SNARE', 'SNARE 2', 'CL HAT'] },
      },
      {
        name: 'HALF',
        bars: 2,
        rows: {
          KICK: 'A...........X... ..X.............',
          SNARE: '........A....... ........A..g.g..',
          RIDE: 'x...x...x...x... x...x...x...x...',
          'CL HAT': '..g...g...g...g. ..g...g...g...g.',
        },
        tracks: {
          SNARE: fill({ soundName: 'HI TOM', amount: 35, rate: 2, max: 4, zone: 'beat' }),
        },
      },
    ],
    ext: { enabled: true, features: { prob: true, groove: true, evolve: true, rules: true, auto: false }, groove: { swing: 50, template: 'break', depth: 70, humanize: 1 } },
    rules: [{ when: { type: 'every', n: 4, offset: 3 }, then: 'fill', target: 'SNARE', amount: 60, cycles: 1 }],
  },
  {
    id: 'minimal',
    name: 'MINIMAL GENERATIVE',
    blurb: 'Euclidean sources left to run. The autopilot moves between HOME, VARY, BUSY, SPARSE and BREAK sections and always comes back; a chance rule mutates the percussion now and then.',
    tempo: 118,
    seed: 31337,
    voices: ['KICK', 'RIM', 'CL HAT', 'CLAVE', 'SHAKER', 'CONGA', 'ZAP', 'MID TOM'],
    patterns: [
      {
        name: 'SEED',
        rows: { KICK: 'A.......X.......', SHAKER: 'sgsgsgsgsgsgsgsg', ZAP: '..........g.....' },
        tracks: {
          RIM: euclidRow(16, 5, 2),
          'CL HAT': both(euclidRow(16, 7, 1, 2), set({ ext: { prob: 80, extra: 0, accent: 15, velVar: 10 } })),
          CLAVE: euclidRow(12, 5, 0, 2),
          CONGA: both(euclidRow(7, 3, 0, 3), set({ phase: 'free' })),
          SHAKER: set({ density: 55 }),
          ZAP: set({ ext: { prob: 50, extra: 0, accent: 0, velVar: 0 } }),
          'MID TOM': fill({ amount: 0 }),
        },
        evolve: { on: true, mode: 'original', every: 4, strength: 25, targets: ['RIM', 'CL HAT', 'CLAVE', 'CONGA'] },
      },
    ],
    ext: { enabled: true, activity: 60, phrase: 4, features: { prob: true, groove: true, evolve: true, rules: true, auto: true }, groove: { swing: 56, humanize: 2, velVar: 8 } },
    rules: [{ when: { type: 'chance', p: 20 }, then: 'mutate', target: '@perc', amount: 40, cycles: 2 }],
  },
  {
    id: 'poly',
    name: 'POLYMETRIC PERCUSSION',
    blurb: 'CLASSIC loop points: hats loop every 15 steps, conga 7, cowbell 5, clave 12, shaker 9, against a 16-step kick and snare. Each row shows its own playhead. RESYNC lines them up again.',
    tempo: 112,
    seed: 5,
    voices: ['KICK', 'SNARE', 'CL HAT', 'CONGA', 'COWBELL', 'CLAVE', 'SHAKER', 'LO TOM'],
    patterns: [
      {
        name: 'CYCLES',
        rows: {
          KICK: 'A.....x...X.....',
          SNARE: '....A.......A...',
          'CL HAT': 'x.sxs.x.sxs.xs.',
          CONGA: 'r..r.r.',
          COWBELL: 'X..s.',
          CLAVE: 'x..x..x...x.',
          SHAKER: 'sgsgsgsgs',
        },
        tracks: {
          'CL HAT': set({ loop: 15, phase: 'free' }),
          CONGA: set({ loop: 7, phase: 'free' }),
          COWBELL: set({ loop: 5, phase: 'free', density: 80 }),
          CLAVE: set({ loop: 12, phase: 'free' }),
          SHAKER: set({ loop: 9, phase: 'free', density: 75 }),
          SNARE: fill({ soundName: 'LO TOM', amount: 20, max: 1, spacing: 1, zone: 'bar' }),
        },
      },
    ],
  },
];

export interface DemoInfo {
  id: string;
  name: string;
  blurb: string;
}

export const DEMOS: DemoInfo[] = DEMO_SPECS.map((d) => ({ id: d.id, name: d.name, blurb: d.blurb }));

export function demoProject(id: string): Project {
  const spec = DEMO_SPECS.find((d) => d.id === id) ?? DEMO_SPECS[0]!;
  return build(spec);
}
