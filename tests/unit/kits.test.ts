/**
 * KITS on Slop Factory Core: drum sounds as kit roles, the project's sounds as a kit and back,
 * loading a kit as one undoable edit that touches nothing but the drum sounds, kits from The
 * Breakery (fewer and other roles: nothing lost), resuming the current kit after a reload, and
 * the sample library (assign without importing again; purge keeps samples kits use).
 */
import { describe, expect, it } from 'vitest';
import type { AudioData } from '@slopfactory/core/dsp';
import { encodeWav16 } from '@slopfactory/core/export';
import { MemorySampleStore } from '@slopfactory/core/storage';
import { KitLibrary, mapKit, MemoryKitStore, readKitArchive, type KitData } from '@slopfactory/core/kits';
import { App } from '../../src/app/app';
import { downbeatTargets, instrumentsOf, planKit, roleOf } from '../../src/audio/kits';
import { audioOf, soundKey } from '../../src/audio/settings';
import { newProject } from '../../src/engine/defaults';
import type { KV } from '../../src/persistence/storage';

const fakeBuffer = (a: AudioData) => ({ sampleRate: a.sampleRate, length: a.channels[0]!.length, numberOfChannels: a.channels.length, duration: a.channels[0]!.length / a.sampleRate, getChannelData: (i: number) => a.channels[i] }) as unknown as AudioBuffer;
async function wav(freq: number): Promise<ArrayBuffer> {
  const ch = Float32Array.from({ length: 2205 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / 44100));
  return (await encodeWav16([ch], 44100)).slice().buffer;
}
const memoryKv = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
function make(o: { kv?: KV | null; store?: MemorySampleStore; kitStore?: MemoryKitStore } = {}) {
  const store = o.store ?? new MemorySampleStore();
  const kitStore = o.kitStore ?? new MemoryKitStore();
  const app = new App({ kv: o.kv ?? null, sampleStore: store, kitStore, makeBuffer: fakeBuffer, workletUrl: null, chainWorkletUrl: null, download: () => {} });
  return { app, store, kitStore };
}
const key = (app: App, name: string, step = 0) => soundKey(app.project.voices.find((v) => v.name === name)!.id, step);
/** Everything that is not the drum sounds' samples. */
const rest = (app: App) => JSON.stringify({ voices: app.project.voices, patterns: app.project.patterns, song: app.project.song, tempo: app.project.tempo, seed: app.project.seed, fx: audioOf(app.project).voiceFx, master: audioOf(app.project).master, chain: audioOf(app.project).chain });

describe('drum sounds as kit roles', () => {
  it('the default kit\'s drum sounds have common roles; later steps take their GM note\'s role', () => {
    const p = newProject();
    expect(downbeatTargets(p).map((t) => `${t.label}=${t.role}`)).toEqual(['KICK=kick', 'SNARE 1=snare', 'SNARE 2=snare', 'CLAP=clap', 'RIM=rim', 'CL HAT 1=hat-closed', 'CL HAT 2=hat-pedal', 'OP HAT=hat-open', 'LO TOM=tom-low', 'MID TOM=tom-mid', 'HI TOM=tom-high', 'COWBELL=cowbell', 'SHAKER=shaker', 'CRASH=crash']);
    const v = p.voices[0]!;
    expect(roleOf({ ...v, sound: { ...v.sound, kind: 'none' }, family: 'perc' }, 0)).toBe('perc');
  });
});

describe('the App and kits', () => {
  it('save, change, load: only the drum sounds change, as one undoable edit', async () => {
    const { app } = make();
    await app.kitsReady;
    await app.loadSample(key(app, 'KICK'), { bytes: await wav(60), name: 'kick.wav' });
    await app.loadSample(key(app, 'SNARE', 1), { bytes: await wav(200), name: 'snare b.wav' });
    app.setSoundZone(key(app, 'KICK'), { volume: 0.5, tune: 3 });
    expect(app.kits.dirty).toBe(true);
    const kit = await app.kits.save('Electro Kit');
    expect(app.kits.dirty).toBe(false);
    expect(kit.instruments.map((i) => [i.role, i.index ?? 0, i.label, i.samples[0]!.name])).toEqual([['kick', 0, 'KICK', 'kick.wav'], ['snare', 1, 'SNARE 2', 'snare b.wav']]);
    const before = rest(app);
    const sounds = JSON.stringify(audioOf(app.project).sounds);
    await app.loadSample(key(app, 'KICK'), { bytes: await wav(80), name: 'other kick.wav' });
    app.clearSample(key(app, 'SNARE', 1));
    expect(app.kits.dirty).toBe(true);
    await app.kits.load(kit.id);
    expect(audioOf(app.project).sounds).toEqual(JSON.parse(sounds)); // zone settings came back too
    expect(rest(app)).toBe(before);
    expect(app.kits.dirty).toBe(false);
    app.undo(); // the load is one edit
    expect(app.sound(key(app, 'KICK'))!.name).toBe('other kick.wav');
    expect(app.kits.dirty).toBe(true);
  });

  it('a kit from The Breakery: roles DOWNBEAT lacks and extra samples are kept, never dropped', async () => {
    const { app } = make();
    await app.kitsReady;
    const ids: string[] = [];
    for (const [n, f] of [['bd.wav', 60], ['sd.wav', 200], ['ghost.wav', 210], ['hh1.wav', 5000], ['hh2.wav', 6000], ['tom.wav', 120], ['rim.wav', 900]] as const) ids.push((await app.kitLibrary.addSample(await wav(f), n)).sample.id);
    const breakery: KitData = { name: 'Breaks', instruments: [
      { role: 'kick', label: 'KICK', samples: [{ sample: ids[0]!, name: 'bd.wav' }] },
      { role: 'snare', label: 'SNARE', samples: [{ sample: ids[1]!, name: 'sd.wav' }] },
      { role: 'snare-ghost', label: 'GHOST', samples: [{ sample: ids[2]!, name: 'ghost.wav' }] },
      { role: 'hat-closed', label: 'HAT', selection: 'roundrobin', samples: [{ sample: ids[3]!, name: 'hh1.wav' }, { sample: ids[4]!, name: 'hh2.wav' }] },
      { role: 'tom-mid', label: 'MID TOM', samples: [{ sample: ids[5]!, name: 'tom.wav' }] },
      { role: 'perc', label: 'PERC', samples: [{ sample: ids[6]!, name: 'rim.wav' }] },
    ] };
    const saved = await app.kitLibrary.saveKit(breakery);
    const before = rest(app);
    const m = await app.kits.load(saved.id);
    expect(rest(app)).toBe(before);
    expect(m.mapped.map((x) => [x.target.label, x.samples[0]!.name, x.match])).toEqual([['KICK', 'bd.wav', 'exact'], ['SNARE 1', 'sd.wav', 'exact'], ['CLAP', 'rim.wav', 'alternate'], ['CL HAT 1', 'hh1.wav', 'exact'], ['MID TOM', 'tom.wav', 'exact']]);
    expect(m.unmapped.map((u) => [u.instrument.label, u.samples.map((s) => s.name), u.reason])).toEqual([['HAT', ['hh2.wav'], 'capacity'], ['GHOST', ['ghost.wav'], 'no-target']]);
    expect(app.sound(key(app, 'CL HAT'))).toMatchObject({ source: 'sample', name: 'hh1.wav', zone: { mode: 'oneshot' } });
    expect(app.sound(key(app, 'OP HAT'))!.source).toBe('internal'); // KEEP: untouched
    // saved again, the kit still has everything The Breakery gave it
    const again = await app.kits.save();
    const roles = again.instruments.map((i) => [i.role, i.samples.length]);
    expect(roles).toContainEqual(['snare-ghost', 1]);
    expect(roles).toContainEqual(['hat-closed', 2]);
    expect(again.instruments.find((i) => i.role === 'hat-closed')!.selection).toBe('roundrobin');
  });

  it('OTHER SOUNDS: INTERNAL puts sounds the kit lacks back on their internal sound; NEW KIT clears every sample', async () => {
    const { app } = make();
    await app.kitsReady;
    await app.loadSample(key(app, 'CRASH'), { bytes: await wav(3000), name: 'crash.wav' });
    const crashOnly = await app.kits.saveAs('Crash');
    await app.loadSample(key(app, 'KICK'), { bytes: await wav(60), name: 'kick.wav' });
    app.otherSounds = 'internal';
    await app.kits.load(crashOnly.id);
    expect(app.sound(key(app, 'KICK'))).toMatchObject({ source: 'internal', sampleId: null });
    expect(app.sound(key(app, 'CRASH'))!.name).toBe('crash.wav');
    await app.kits.newKit();
    expect(app.sound(key(app, 'CRASH'))).toMatchObject({ source: 'internal', sampleId: null });
  });

  it('a missing sample makes LOAD fail with nothing changed', async () => {
    const { app, store } = make();
    await app.kitsReady;
    await app.loadSample(key(app, 'KICK'), { bytes: await wav(60), name: 'kick.wav' });
    const kit = await app.kits.save('K');
    app.clearSample(key(app, 'KICK'));
    await store.delete(kit.instruments[0]!.samples[0]!.sample);
    app.kitLibrary.cache.clear();
    const before = JSON.stringify(app.project);
    await expect(app.kits.load(kit.id)).rejects.toMatchObject({ code: 'missing-audio' });
    expect(JSON.stringify(app.project)).toBe(before);
  });

  it('after a reload the current kit resumes without replacing the autosaved sounds', async () => {
    const kv = memoryKv();
    const store = new MemorySampleStore();
    const kitStore = new MemoryKitStore();
    const one = make({ kv, store, kitStore }).app;
    await one.kitsReady;
    await one.loadSample(key(one, 'KICK'), { bytes: await wav(60), name: 'kick.wav' });
    await one.kits.save('Mine');
    one.flushAutosave();
    const two = make({ kv, store, kitStore }).app;
    await two.kitsReady;
    expect([two.kits.name, two.kits.dirty]).toEqual(['Mine', false]);
    expect(two.sound(key(two, 'KICK'))!.name).toBe('kick.wav');
  });

  it('assigns library samples without importing again; purging keeps samples saved kits use', async () => {
    const { app, store } = make();
    await app.kitsReady;
    const n = await app.importSamples([{ name: 'a.wav', arrayBuffer: () => wav(100) }, { name: 'b.wav', arrayBuffer: () => wav(200) }, { name: 'bad.txt', arrayBuffer: async () => new ArrayBuffer(4) }]);
    expect(n).toBe(2);
    expect(app.statusKind).toBe('warn');
    const [a, b] = await app.kitLibrary.listSamples();
    expect(await app.assignLibrarySample(key(app, 'KICK'), a!.id)).toBe(true);
    expect(app.sound(key(app, 'KICK'))).toMatchObject({ source: 'sample', sampleId: a!.id, name: 'a.wav' });
    await app.kits.save('Uses A');
    app.clearSample(key(app, 'KICK'));
    await app.assignLibrarySample(key(app, 'SNARE'), b!.id);
    app.clearSample(key(app, 'SNARE'));
    expect(await app.purgeSamples()).toBe(1); // b: nothing uses it; a: the kit does
    expect((await store.list()).map((s) => s.name)).toEqual(['a.wav']);
    expect((await app.kitLibrary.listSamples()).map((s) => s.name)).toEqual(['a.wav']);
  });

  it('indexes the samples older projects use (no copy, nothing changed) at startup', async () => {
    const store = new MemorySampleStore();
    const kitStore = new MemoryKitStore();
    const kv = memoryKv();
    const first = new App({ kv, sampleStore: store, kitStore: null, makeBuffer: fakeBuffer, workletUrl: null, chainWorkletUrl: null, download: () => {} });
    await first.loadSample(key(first, 'KICK'), { bytes: await wav(60), name: 'old kick.wav' }).catch(() => false);
    // the sample was stored by a DOWNBEAT before kits (no kit library): put it there directly
    const lib = new KitLibrary({ app: 't', audio: store, store: new MemoryKitStore() });
    const id = (await lib.addSample(await wav(60), 'old kick.wav')).sample.id;
    first.project.audio = { ...audioOf(first.project) };
    first.project.audio.sounds[first.project.voices[0]!.id]![0] = { ...first.project.audio.sounds[first.project.voices[0]!.id]![0]!, source: 'sample', sampleId: id, name: 'old kick.wav' };
    first.flushAutosave();
    const app = new App({ kv, sampleStore: store, kitStore, makeBuffer: fakeBuffer, workletUrl: null, chainWorkletUrl: null, download: () => {} });
    await app.kitsReady;
    expect((await app.kitLibrary.listSamples()).map((s) => s.name)).toEqual(['old kick.wav']);
    expect(app.sound(key(app, 'KICK'))).toMatchObject({ sampleId: id, name: 'old kick.wav' });
  });

  it('exports a portable kit with the samples\' audio and DOWNBEAT\'s settings', async () => {
    const { app } = make();
    await app.kitsReady;
    await app.loadSample(key(app, 'KICK'), { bytes: await wav(60), name: 'kick.wav' });
    app.setSoundZone(key(app, 'KICK'), { pan: -0.5 });
    const f = await app.kits.exportCurrent('Out');
    const r = await readKitArchive(f.bytes);
    expect(r.samples.map((s) => s.name)).toEqual(['kick.wav']);
    expect((r.kit.instruments[0]!.ext!.downbeat as { zone: { pan: number } }).zone.pan).toBe(-0.5);
    // round trip through the mapping alone gives the same settings
    const plan = planKit(app.project, mapKit({ instruments: instrumentsOf(app.project) }, downbeatTargets(app.project)));
    expect(plan.get(key(app, 'KICK'))).toEqual(app.sound(key(app, 'KICK')));
  });
});
