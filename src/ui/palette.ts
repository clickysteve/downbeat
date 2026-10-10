/**
 * Colour palettes: a purely cosmetic layer. Changing palette never changes
 * anything musical.
 *
 * The interface draws only with semantic roles (CSS custom properties). The
 * shared collection roles keep emmm's names: desktop, paper, ink, dim,
 * activity, selection, plus Feelers' warning. DOWNBEAT adds the roles of its
 * rhythm display: source, generated, suppressed, playhead, accent, and six
 * voice identities. Every distinction is also carried by shape (solid,
 * hatched, hollow-with-slash), so the 1-bit Classic palette loses nothing.
 *
 * Built-in palettes are never edited (editing makes a copy). Palettes are a
 * browser preference (`downbeat.palette.*`), never part of a project.
 * Palette files: `{format: "downbeat-palette", version, name, colors}`;
 * emmm and Feelers palette files import by their shared role names.
 */

export const ROLES = [
  'desktop',
  'paper',
  'ink',
  'dim',
  'source',
  'generated',
  'suppressed',
  'playhead',
  'accent',
  'activity',
  'selection',
  'warning',
  'v1',
  'v2',
  'v3',
  'v4',
  'v5',
  'v6',
] as const;
export type Role = (typeof ROLES)[number];
export type Colors = Record<Role, string>;

export const ROLE_INFO: Record<Role, { label: string; help: string; css: string }> = {
  desktop: { label: 'Desktop', help: 'background behind the panels', css: '--desktop' },
  paper: { label: 'Paper', help: 'panels and the grid', css: '--paper' },
  ink: { label: 'Ink', help: 'frames, text, controls', css: '--ink' },
  dim: { label: 'Dim', help: 'labels, guides, beat lines', css: '--dim' },
  source: { label: 'Source hits', help: 'strikes you wrote that play', css: '--src' },
  generated: { label: 'Generated hits', help: 'fills, extra hits, jams, mutations', css: '--gen' },
  suppressed: { label: 'Suppressed hits', help: 'written strikes that did not play this cycle', css: '--sup' },
  playhead: { label: 'Playhead', help: 'the step now playing', css: '--play' },
  accent: { label: 'Accent', help: 'accent marks (striker 5)', css: '--accent' },
  activity: { label: 'Running', help: 'transport playing, clock running', css: '--activity' },
  selection: { label: 'Selected', help: 'the selected voice, pattern and tool', css: '--selection' },
  warning: { label: 'Warning', help: 'PANIC, lost clock, errors', css: '--warn' },
  v1: { label: 'Voice: kick', help: 'kick drums', css: '--v1' },
  v2: { label: 'Voice: snare', help: 'snares, claps, rims', css: '--v2' },
  v3: { label: 'Voice: hats', help: 'closed and open hats', css: '--v3' },
  v4: { label: 'Voice: toms', help: 'toms', css: '--v4' },
  v5: { label: 'Voice: perc', help: 'percussion', css: '--v5' },
  v6: { label: 'Voice: cymbal', help: 'cymbals', css: '--v6' },
};

export interface Palette {
  id: string;
  name: string;
  builtIn: boolean;
  colors: Colors;
}

const mono = (paper: string, ink: string): Colors =>
  Object.fromEntries(ROLES.map((r) => [r, r === 'paper' ? paper : ink])) as Colors;

export const BUILT_INS: Palette[] = [
  {
    id: 'downbeat',
    name: 'Downbeat',
    builtIn: true,
    colors: {
      desktop: '#d9d5c9',
      paper: '#f6f4ec',
      ink: '#141412',
      dim: '#77736a',
      source: '#141412',
      generated: '#d9480f',
      suppressed: '#8f8a7e',
      playhead: '#1c64d2',
      accent: '#c2112b',
      activity: '#2b8a3e',
      selection: '#f2b705',
      warning: '#c92a2a',
      v1: '#9a3412',
      v2: '#1d4ed8',
      v3: '#15803d',
      v4: '#7e22ce',
      v5: '#a16207',
      v6: '#0e7490',
    },
  },
  { id: 'classic', name: 'Classic', builtIn: true, colors: { ...mono('#ffffff', '#000000'), desktop: '#000000' } },
  {
    id: 'dark',
    name: 'Dark',
    builtIn: true,
    colors: {
      desktop: '#000000',
      paper: '#17191c',
      ink: '#ddd7c9',
      dim: '#8a857a',
      source: '#ddd7c9',
      generated: '#ff8c4b',
      suppressed: '#66625b',
      playhead: '#6fa8ff',
      accent: '#ff6b81',
      activity: '#7fcf87',
      selection: '#e7c35a',
      warning: '#ff6b5b',
      v1: '#f0a070',
      v2: '#8fb0ef',
      v3: '#8cc084',
      v4: '#c99ad6',
      v5: '#e0c072',
      v6: '#6fc7cf',
    },
  },
  {
    id: 'colour',
    name: 'Colour',
    builtIn: true,
    colors: {
      desktop: '#23303a',
      paper: '#fbf8ef',
      ink: '#202020',
      dim: '#8c8576',
      source: '#202020',
      generated: '#2b78c9',
      suppressed: '#a59e8d',
      playhead: '#d0372a',
      accent: '#d0372a',
      activity: '#2c7149',
      selection: '#f2b705',
      warning: '#d0372a',
      v1: '#a94f12',
      v2: '#1d6a86',
      v3: '#2c7149',
      v4: '#8a2f5e',
      v5: '#7a6a12',
      v6: '#4e44a0',
    },
  },
];
export const DEFAULT_PALETTE_ID = 'downbeat';
export const DEFAULT_PALETTE = BUILT_INS[0]!;

// ---------------------------------------------------------------------------- colour maths

export function normHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return `#${s.toLowerCase()}`;
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Contrast each role needs against the paper to stay readable. */
const NEEDS: Partial<Record<Role, number>> = {
  ink: 4.5,
  dim: 2,
  source: 3,
  generated: 2.5,
  suppressed: 1.6,
  playhead: 2.5,
  accent: 2.5,
  activity: 2,
  selection: 1.3,
  warning: 2.5,
  v1: 2,
  v2: 2,
  v3: 2,
  v4: 2,
  v5: 2,
  v6: 2,
};

export interface ContrastWarning {
  role: Role;
  ratio: number;
  need: number;
}

/** Roles that are hard to see against the paper. Never changes a colour. */
export function contrastWarnings(c: Colors): ContrastWarning[] {
  const out: ContrastWarning[] = [];
  for (const role of ROLES) {
    const need = NEEDS[role];
    if (need === undefined) continue;
    const ratio = contrast(c[role], c.paper);
    if (ratio < need) out.push({ role, ratio, need });
  }
  return out;
}

// ---------------------------------------------------------------------------- CSS

export function paletteCss(c: Colors): string {
  const decl = ROLES.map((r) => `${ROLE_INFO[r].css}:${c[r]}`).join(';');
  const scheme = luminance(c.paper) < 0.3 ? 'dark' : 'light';
  return `:root{${decl};color-scheme:${scheme}}`;
}

export function applyPalette(p: Palette, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc) return;
  let el = doc.getElementById('downbeat-palette') as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = 'downbeat-palette';
    doc.head.appendChild(el);
  }
  el.textContent = paletteCss(p.colors);
  doc.documentElement.dataset.palette = p.builtIn ? p.id : 'custom';
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.colors.desktop);
}

// ---------------------------------------------------------------------------- files

export const PALETTE_FORMAT = 'downbeat-palette';
export const PALETTE_VERSION = 1;

export function exportPalette(p: { name: string; colors: Colors }): string {
  return JSON.stringify({ format: PALETTE_FORMAT, version: PALETTE_VERSION, name: p.name, colors: { ...p.colors } }, null, 2);
}

export class PaletteError extends Error {}

export interface ImportResult {
  name: string;
  colors: Colors;
  /** Where the file came from. */
  from: 'downbeat' | 'emmm' | 'feelers';
  /** Roles missing from the file, taken from a sibling role or the default. */
  filled: Role[];
  ignored: string[];
}

/** Sibling roles that stand in for DOWNBEAT roles. */
const FROM_EMMM: Partial<Record<Role, string>> = {
  source: 'ink',
  generated: 'patterns',
  suppressed: 'dim',
  playhead: 'activity',
  accent: 'conducting',
  warning: 'activity',
  v1: 'conducting',
  v2: 'patterns',
  v3: 'cyclic',
  v4: 'variables',
  v5: 'snapshots',
  v6: 'trajectory',
};
const FROM_FEELERS: Partial<Record<Role, string>> = {
  source: 'ink',
  generated: 'transform',
  suppressed: 'dim',
  playhead: 'activity',
  accent: 'warning',
  v1: 'feeler1',
  v2: 'feeler2',
  v3: 'feeler3',
  v4: 'feeler4',
  v5: 'transform',
  v6: 'selection',
};

export function importPalette(text: string): ImportResult {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new PaletteError('The file is not valid JSON.');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new PaletteError('The file is not a palette.');
  const o = obj as Record<string, unknown>;
  const from = o.format === 'emmm-palette' ? 'emmm' : o.format === 'feelers-palette' ? 'feelers' : o.format === undefined || o.format === PALETTE_FORMAT ? 'downbeat' : null;
  if (!from) throw new PaletteError('The file is not a DOWNBEAT, emmm or Feelers palette.');
  const version = Number(o.version);
  if (!Number.isInteger(version) || version < 1) throw new PaletteError('The palette file has no valid version number.');
  if (from === 'downbeat' && version > PALETTE_VERSION) throw new PaletteError(`This palette was made by a newer DOWNBEAT (format v${version}).`);
  if (!o.colors || typeof o.colors !== 'object' || Array.isArray(o.colors)) throw new PaletteError('The palette file has no colours.');
  const src = o.colors as Record<string, unknown>;
  const map = from === 'emmm' ? FROM_EMMM : from === 'feelers' ? FROM_FEELERS : {};
  const colors = {} as Colors;
  const filled: Role[] = [];
  let valid = 0;
  for (const r of ROLES) {
    const direct = normHex(src[r]);
    if (direct) {
      colors[r] = direct;
      valid++;
      continue;
    }
    const alias = map[r];
    const viaAlias = alias ? normHex(src[alias]) : null;
    colors[r] = viaAlias ?? DEFAULT_PALETTE.colors[r];
    if (!viaAlias || from === 'downbeat') filled.push(r);
  }
  if (!valid) throw new PaletteError('None of the palette colours could be read.');
  const known = new Set<string>([...ROLES, ...Object.values(map)]);
  const ignored = Object.keys(src).filter((k) => !known.has(k));
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : 'Imported palette';
  return { name, colors, from, filled, ignored };
}

// ---------------------------------------------------------------------------- persistence

export const KEY_SELECTED = 'downbeat.palette.selected';
export const KEY_CUSTOM = 'downbeat.palette.custom';

export interface PaletteKV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export class PaletteStore {
  custom: Palette[] = [];
  selected = DEFAULT_PALETTE_ID;

  constructor(private kv: PaletteKV | null) {
    this.load();
  }

  private load(): void {
    try {
      const raw = this.kv?.getItem(KEY_CUSTOM);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) {
          for (const p of arr) {
            if (!p || typeof p !== 'object' || typeof p.id !== 'string') continue;
            const colors = {} as Colors;
            for (const r of ROLES) colors[r] = normHex(p.colors?.[r]) ?? DEFAULT_PALETTE.colors[r];
            this.custom.push({ id: p.id, name: String(p.name ?? 'Custom').slice(0, 40), builtIn: false, colors });
          }
        }
      }
      const sel = this.kv?.getItem(KEY_SELECTED);
      if (sel && this.all().some((p) => p.id === sel)) this.selected = sel;
    } catch {
      /* storage unavailable or corrupt: defaults */
    }
  }

  private save(): void {
    try {
      this.kv?.setItem(KEY_CUSTOM, JSON.stringify(this.custom.map((p) => ({ id: p.id, name: p.name, colors: p.colors }))));
      this.kv?.setItem(KEY_SELECTED, this.selected);
    } catch {
      /* ignore */
    }
  }

  all(): Palette[] {
    return [...BUILT_INS, ...this.custom];
  }

  current(): Palette {
    return this.all().find((p) => p.id === this.selected) ?? DEFAULT_PALETTE;
  }

  select(id: string): Palette {
    if (this.all().some((p) => p.id === id)) this.selected = id;
    this.save();
    return this.current();
  }

  /** Copy a palette into a new custom one (built-ins are never edited). */
  duplicate(id: string, name?: string): Palette {
    const src = this.all().find((p) => p.id === id) ?? DEFAULT_PALETTE;
    const p: Palette = { id: `custom-${Date.now().toString(36)}-${this.custom.length}`, name: (name ?? `${src.name} copy`).slice(0, 40), builtIn: false, colors: { ...src.colors } };
    this.custom.push(p);
    this.selected = p.id;
    this.save();
    return p;
  }

  setColor(id: string, role: Role, hex: string): boolean {
    const p = this.custom.find((x) => x.id === id);
    const h = normHex(hex);
    if (!p || !h) return false;
    p.colors[role] = h;
    this.save();
    return true;
  }

  rename(id: string, name: string): void {
    const p = this.custom.find((x) => x.id === id);
    if (p && name.trim()) {
      p.name = name.trim().slice(0, 40);
      this.save();
    }
  }

  remove(id: string): void {
    this.custom = this.custom.filter((p) => p.id !== id);
    if (this.selected === id) this.selected = DEFAULT_PALETTE_ID;
    this.save();
  }

  addImported(r: ImportResult): Palette {
    const p: Palette = { id: `custom-${Date.now().toString(36)}-${this.custom.length}`, name: r.name, builtIn: false, colors: r.colors };
    this.custom.push(p);
    this.selected = p.id;
    this.save();
    return p;
  }
}
