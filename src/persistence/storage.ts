/**
 * Browser storage: autosave of the current project, a library of named
 * projects, and preferences. Every access is guarded: private windows and
 * blocked storage simply mean nothing is remembered.
 */
import type { Project } from '../engine/types';
import { loadProject, serialize, type LoadResult } from './format';

export const KEY_AUTOSAVE = 'downbeat.autosave';
export const KEY_LIBRARY = 'downbeat.library';
export const KEY_PREFS = 'downbeat.prefs';

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function browserStorage(): KV | null {
  try {
    const s = globalThis.localStorage;
    const probe = '__downbeat_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export interface LibraryEntry {
  name: string;
  savedAt: string;
  file: string;
}

export interface Prefs {
  output: 'internal' | 'midi' | 'both';
  midiOut: string | null;
  midiIn: string | null;
  clockSource: 'internal' | 'external';
  clockOut: boolean;
  volume: number;
  /** Panels the musician left open. */
  tab: string;
  midiEnabled: boolean;
  /** The grid follows the playing pattern (song) and scrolls with the playhead. */
  follow: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  output: 'internal',
  midiOut: null,
  midiIn: null,
  clockSource: 'internal',
  clockOut: false,
  volume: 0.8,
  tab: 'voice',
  midiEnabled: false,
  follow: true,
};

export class Store {
  constructor(private kv: KV | null) {}

  get available(): boolean {
    return !!this.kv;
  }

  private get(k: string): string | null {
    try {
      return this.kv?.getItem(k) ?? null;
    } catch {
      return null;
    }
  }

  private set(k: string, v: string): boolean {
    try {
      this.kv?.setItem(k, v);
      return !!this.kv;
    } catch {
      return false;
    }
  }

  saveAutosave(p: Project): boolean {
    return this.set(KEY_AUTOSAVE, serialize(p));
  }

  loadAutosave(): LoadResult | null {
    const t = this.get(KEY_AUTOSAVE);
    if (!t) return null;
    try {
      return loadProject(JSON.parse(t));
    } catch {
      return null;
    }
  }

  library(): LibraryEntry[] {
    const t = this.get(KEY_LIBRARY);
    if (!t) return [];
    try {
      const a = JSON.parse(t) as unknown;
      return Array.isArray(a) ? (a.filter((e) => e && typeof e.name === 'string' && typeof e.file === 'string') as LibraryEntry[]) : [];
    } catch {
      return [];
    }
  }

  saveToLibrary(p: Project): boolean {
    const lib = this.library().filter((e) => e.name !== p.name);
    lib.unshift({ name: p.name, savedAt: new Date().toISOString(), file: serialize(p) });
    return this.set(KEY_LIBRARY, JSON.stringify(lib.slice(0, 100)));
  }

  removeFromLibrary(name: string): void {
    this.set(KEY_LIBRARY, JSON.stringify(this.library().filter((e) => e.name !== name)));
  }

  loadFromLibrary(name: string): LoadResult | null {
    const e = this.library().find((x) => x.name === name);
    if (!e) return null;
    try {
      return loadProject(JSON.parse(e.file));
    } catch {
      return null;
    }
  }

  prefs(): Prefs {
    const t = this.get(KEY_PREFS);
    if (!t) return { ...DEFAULT_PREFS };
    try {
      const o = JSON.parse(t) as Partial<Prefs>;
      return {
        output: o.output === 'midi' || o.output === 'both' ? o.output : 'internal',
        midiOut: typeof o.midiOut === 'string' ? o.midiOut : null,
        midiIn: typeof o.midiIn === 'string' ? o.midiIn : null,
        clockSource: o.clockSource === 'external' ? 'external' : 'internal',
        clockOut: o.clockOut === true,
        volume: typeof o.volume === 'number' ? Math.min(1, Math.max(0, o.volume)) : DEFAULT_PREFS.volume,
        tab: typeof o.tab === 'string' ? o.tab : DEFAULT_PREFS.tab,
        midiEnabled: o.midiEnabled === true,
        follow: o.follow !== false,
      };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  savePrefs(p: Prefs): void {
    this.set(KEY_PREFS, JSON.stringify(p));
  }

  raw(k: string): string | null {
    return this.get(k);
  }

  setRaw(k: string, v: string): boolean {
    return this.set(k, v);
  }
}
