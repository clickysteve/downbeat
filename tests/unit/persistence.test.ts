import { describe, expect, it } from 'vitest';
import { newProject } from '../../src/engine/defaults';
import { Engine, renderCycles } from '../../src/engine/engine';
import { ProjectError, loadProject, parseProject, serialize, PROJECT_VERSION, fileName } from '../../src/persistence/format';
import { Store, type KV } from '../../src/persistence/storage';
import { DEMOS, demoProject, parseRow } from '../../src/persistence/demos';
import { BUILT_INS, PaletteStore, contrastWarnings, exportPalette, importPalette, PaletteError, paletteCss, ROLES } from '../../src/ui/palette';
import { notesOf, put, sig, smallProject } from './helpers';

class MemKV implements KV {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('project files', () => {
  it('save then load gives back an identical project that plays identically', () => {
    const pr = smallProject();
    pr.ext.enabled = true;
    put(pr.patterns[0]!, 'k', [0, 8], 4, { f: true });
    put(pr.patterns[0]!, 'h', [0, 2, 4, 6, 8, 10, 12, 14], 0, { s: 0, p: 70 });
    pr.patterns[0]!.tracks.s!.fill = { ...pr.patterns[0]!.tracks.s!.fill, on: true, sound: 't' };
    pr.patterns[0]!.evolve = { ...pr.patterns[0]!.evolve, on: true, mode: 'evolving' };
    pr.ext.rules = [{ id: 'r', on: true, when: { type: 'every', n: 4, offset: 3 }, then: 'fill', target: 's', amount: 70, cycles: 1 }];
    const text = serialize(pr);
    const back = parseProject(text);
    expect(back.report).toEqual([]);
    expect(back.project).toEqual(pr);
    expect(sig(notesOf(new Engine(back.project).generate(96 * 8)))).toEqual(sig(notesOf(new Engine(pr).generate(96 * 8))));
  });

  it('locked variations persist', () => {
    const pr = smallProject();
    put(pr.patterns[0]!, 'k', [0]);
    pr.patterns[0]!.evolve.locked = { generation: 3, tracks: { k: pr.patterns[0]!.tracks.k!.strikes.map((s, i) => (i === 4 ? { v: 5, s: 1 } : s)), s: [], h: [], t: [] } };
    const back = parseProject(serialize(pr)).project;
    expect(back.patterns[0]!.evolve.locked!.generation).toBe(3);
    expect(back.patterns[0]!.evolve.locked!.tracks.k![4]).toEqual({ v: 5, s: 1 });
  });

  it('rejects things that are not projects, and newer versions', () => {
    expect(() => parseProject('not json')).toThrow(ProjectError);
    expect(() => parseProject('{"format":"emmm-project","version":1}')).toThrow(/not a DOWNBEAT/);
    expect(() => parseProject(JSON.stringify({ format: 'downbeat-project', version: PROJECT_VERSION + 1, project: {} }))).toThrow(/newer/);
    expect(() => parseProject(JSON.stringify({ format: 'downbeat-project', version: 1, project: { voices: [], patterns: [] } }))).toThrow(/no voices/);
  });

  it('repairs damaged values and reports what it did', () => {
    const pr = smallProject();
    const raw = JSON.parse(serialize(pr));
    raw.project.tempo = 9999;
    raw.project.voices[0].channel = 99;
    raw.project.voices[1].notes = [];
    raw.project.patterns[0].tracks.k.density = -40;
    raw.project.patterns[0].tracks.k.strikes = [{ v: 9, s: 1 }, 'junk', null];
    raw.project.patterns[0].tracks.s.fill.sound = 'nobody';
    raw.project.song.entries.push({ patternId: 'missing', repeats: 2 });
    raw.project.ext.rules = [{ when: { type: 'bogus' }, then: 'fill' }];
    const r = loadProject(raw);
    const p = r.project;
    expect(p.tempo).toBe(300);
    expect(p.voices[0]!.channel).toBe(16);
    expect(p.voices[1]!.notes.length).toBe(1);
    expect(p.patterns[0]!.tracks.k!.density).toBe(0);
    expect(p.patterns[0]!.tracks.k!.strikes.length).toBe(16);
    expect(p.patterns[0]!.tracks.k!.strikes[0]).toEqual({ v: 5, s: 1 });
    expect(p.patterns[0]!.tracks.k!.strikes[1]).toBeNull();
    expect(p.patterns[0]!.tracks.s!.fill.sound).toBeNull();
    expect(p.song.entries.length).toBe(1);
    expect(p.ext.rules).toEqual([]);
    expect(r.report.length).toBeGreaterThan(0);
  });

  it('migrates a version 0 (pre-release) project', () => {
    const pr = smallProject();
    const v0 = JSON.parse(JSON.stringify(pr));
    delete v0.algorithms;
    for (const v of v0.voices) {
      v.note = v.notes[0][0];
      delete v.notes;
    }
    const r = loadProject(v0);
    expect(r.fromVersion).toBe(0);
    expect(r.project.voices[0]!.notes).toEqual([[36]]);
    expect(r.project.algorithms).toEqual({ classic: 1, extended: 1 });
    expect(r.report.join(' ')).toMatch(/version 0/);
  });

  it('safe file names', () => {
    expect(fileName('Jungle Pressure!')).toBe('jungle-pressure.downbeat.json');
    expect(fileName('  ')).toBe('untitled.downbeat.json');
  });
});

describe('browser storage', () => {
  it('autosave, library and preferences round-trip', () => {
    const kv = new MemKV();
    const s = new Store(kv);
    const pr = newProject();
    pr.name = 'ONE';
    expect(s.saveAutosave(pr)).toBe(true);
    expect(s.loadAutosave()!.project).toEqual(pr);
    s.saveToLibrary(pr);
    pr.name = 'TWO';
    s.saveToLibrary(pr);
    expect(s.library().map((e) => e.name)).toEqual(['TWO', 'ONE']);
    expect(s.loadFromLibrary('ONE')!.project.name).toBe('ONE');
    s.removeFromLibrary('ONE');
    expect(s.library().map((e) => e.name)).toEqual(['TWO']);
    s.savePrefs({ ...s.prefs(), output: 'both', clockOut: true });
    expect(new Store(kv).prefs()).toMatchObject({ output: 'both', clockOut: true });
  });

  it('corrupt or missing storage never throws', () => {
    const kv = new MemKV();
    kv.setItem('downbeat.autosave', '{broken');
    kv.setItem('downbeat.library', 'nope');
    kv.setItem('downbeat.prefs', '[1,2');
    const s = new Store(kv);
    expect(s.loadAutosave()).toBeNull();
    expect(s.library()).toEqual([]);
    expect(s.prefs().output).toBe('internal');
    const none = new Store(null);
    expect(none.saveAutosave(newProject())).toBe(false);
    expect(none.loadAutosave()).toBeNull();
    const throwing: KV = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    const t = new Store(throwing);
    expect(t.saveAutosave(newProject())).toBe(false);
    expect(t.library()).toEqual([]);
  });
});

describe('demos', () => {
  it('there are six original demos; each loads, round-trips and plays straight away', () => {
    expect(DEMOS.length).toBe(6);
    for (const d of DEMOS) {
      const p = demoProject(d.id);
      expect(loadProject(JSON.parse(serialize(p))).project).toEqual(p);
      const r = renderCycles(p, 4);
      expect(r.notes.length).toBeGreaterThan(20);
      const voices = new Set(r.notes.map((n) => n.voice));
      expect(voices.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('the polymetric demo has tracks of different loop lengths', () => {
    const p = demoProject('poly');
    const loops = Object.values(p.patterns[0]!.tracks).map((t) => t.loop);
    expect(new Set(loops).size).toBeGreaterThanOrEqual(5);
  });

  it('rows parse to strikes', () => {
    expect(parseRow('A.g? f r', 6)).toEqual([{ v: 5, s: 1 }, null, { v: 1, s: 1 }, { v: 0, s: 1 }, { v: 4, s: 1, f: true }, { v: 3, s: 0 }]);
  });
});

describe('palettes', () => {
  it('built-ins cover every role; the default has no contrast warnings', () => {
    for (const p of BUILT_INS) for (const r of ROLES) expect(p.colors[r]).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastWarnings(BUILT_INS[0]!.colors)).toEqual([]);
    expect(contrastWarnings(BUILT_INS.find((p) => p.id === 'dark')!.colors)).toEqual([]);
    expect(paletteCss(BUILT_INS[0]!.colors)).toContain('--gen:#d9480f');
  });

  it('export / import round-trip; emmm and Feelers palettes import by shared roles', () => {
    const p = BUILT_INS[2]!;
    const r = importPalette(exportPalette(p));
    expect(r.colors).toEqual(p.colors);
    const emmm = importPalette(JSON.stringify({ format: 'emmm-palette', version: 1, name: 'E', colors: { desktop: '#111111', paper: '#eeeeee', ink: '#222222', dim: '#888888', patterns: '#ff0000', conducting: '#00ff00', activity: '#0000ff', selection: '#ffff00', cyclic: '#00ffff', variables: '#ff00ff', snapshots: '#123456', trajectory: '#654321', midi: '#abcdef' } }));
    expect(emmm.from).toBe('emmm');
    expect(emmm.colors.paper).toBe('#eeeeee');
    expect(emmm.colors.generated).toBe('#ff0000');
    expect(emmm.colors.v1).toBe('#00ff00');
    const feel = importPalette(JSON.stringify({ format: 'feelers-palette', version: 1, name: 'F', colors: { paper: '#fff', ink: '#000', feeler1: '#f00', transform: '#0f0' } }));
    expect(feel.colors.v1).toBe('#ff0000');
    expect(feel.colors.generated).toBe('#00ff00');
    expect(() => importPalette('{"format":"other","version":1,"colors":{}}')).toThrow(PaletteError);
    expect(() => importPalette('nope')).toThrow(PaletteError);
  });

  it('custom palettes persist; built-ins are never edited', () => {
    const kv = new MemKV();
    const s = new PaletteStore(kv);
    const c = s.duplicate('downbeat', 'Mine');
    expect(s.setColor('downbeat', 'ink', '#ff0000')).toBe(false);
    expect(s.setColor(c.id, 'generated', '#00f')).toBe(true);
    const again = new PaletteStore(kv);
    expect(again.current().name).toBe('Mine');
    expect(again.current().colors.generated).toBe('#0000ff');
    expect(BUILT_INS[0]!.colors.ink).toBe('#141412');
    again.remove(c.id);
    expect(new PaletteStore(kv).current().id).toBe('downbeat');
  });

  it('palette changes never change the music', () => {
    const p = demoProject('jungle');
    const a = sig(renderCycles(p, 4).notes);
    const s = new PaletteStore(new MemKV());
    s.select('dark');
    expect(sig(renderCycles(p, 4).notes)).toEqual(a);
  });
});
