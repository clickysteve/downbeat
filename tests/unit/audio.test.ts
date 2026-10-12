/**
 * DOWNBEAT on Slop Factory Core: audio settings and their migration, the event adapter (it must
 * equal the engine's performance note for note), export planning, routing and choke groups,
 * sample loading in the App, and portable bundles. Rendering itself runs in Chromium
 * (tests/e2e/audio*.spec.ts).
 */
import { describe, expect, it } from 'vitest';
import { cleanFx, FX_PRESETS, type AudioData } from '@slopfactory/core/dsp';
import { encodeWav16 } from '@slopfactory/core/export';
import { MemorySampleStore } from '@slopfactory/core/storage';
import { App } from '../../src/app/app';
import { makeBundle, unpackBundle } from '../../src/audio/bundle';
import { DrumInstrument } from '../../src/audio/drums';
import { defaultExportOptions, freezeRange, planExport, type EngineState } from '../../src/audio/export';
import { chokeOf, instrumentFor, StepSample, voiceStrips } from '../../src/audio/routing';
import { audioOf, chokeFor, defaultAudio, defaultSlot, drumSounds, ensureAudio, parseSoundKey, repairAudio, soundKey, syncAudioShape } from '../../src/audio/settings';
import { CORE_PPQ, freezeItems, freezeTake, performanceTimeline, soundsUsed, TICK_SCALE } from '../../src/audio/timeline';
import { renderCycles } from '../../src/engine/engine';
import type { Project } from '../../src/engine/types';
import { loadProject, parseProject, serialize, PROJECT_VERSION } from '../../src/persistence/format';
import { put, smallProject } from './helpers';
import { SampleLibrary } from '../../src/audio/library';

const noState: EngineState = { lockKey: null, sourceOnly: false, audition: null };

const fakeBuffer = (a: AudioData) => ({ sampleRate: a.sampleRate, length: a.channels[0]!.length, numberOfChannels: a.channels.length, duration: a.channels[0]!.length / a.sampleRate, getChannelData: (i: number) => a.channels[i] }) as unknown as AudioBuffer;

async function wavBytes(seconds = 0.1, freq = 220): Promise<ArrayBuffer> {
  const n = Math.round(seconds * 44100);
  const ch = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / 44100));
  return (await encodeWav16([ch, ch], 44100)).slice().buffer;
}

/** A small project with a busy pattern: written strikes, flams, a shift, a fill borrowing HAT's sound, a chord step. */
function busyProject(): Project {
  const pr = smallProject();
  const p = pr.patterns[0]!;
  put(p, 'k', [0, 4, 8, 12], 4);
  put(p, 's', [4, 12], 5, { f: true });
  put(p, 'h', [0, 2, 4, 6, 8, 10, 12, 14], 3, { s: 0 });
  p.tracks.t!.fill = { ...p.tracks.t!.fill, on: true, amount: 80, sound: 'h', max: 3 };
  p.tracks.h!.shift = -2;
  pr.voices[1]!.notes[1] = [40, 37];
  put(p, 's', [10], 3, { s: 2 });
  return pr;
}

describe('audio settings (project format 2)', () => {
  it('give every voice one drum sound per sound step, INTERNAL, AUTO choke, CLEAN', () => {
    const pr = smallProject();
    const a = defaultAudio(pr);
    expect(Object.keys(a.sounds)).toEqual(['k', 's', 'h', 't']);
    expect(a.sounds.h!.length).toBe(3);
    expect(a.sounds.h![2]).toEqual(defaultSlot());
    expect(a.voiceFx.k).toEqual(cleanFx());
    expect(drumSounds(pr).map((d) => d.label)).toEqual(['KICK', 'SNARE 1', 'SNARE 2', 'HAT 1', 'HAT 2', 'HAT 3', 'TOM']);
  });

  it('follow voices and steps as they change', () => {
    const pr = smallProject();
    const a = ensureAudio(pr);
    a.sounds.h![1]!.source = 'sample';
    pr.voices = pr.voices.filter((v) => v.id !== 't');
    pr.voices[2]!.notes.push([49]);
    syncAudioShape(a, pr.voices);
    expect(Object.keys(a.sounds)).toEqual(['k', 's', 'h']);
    expect(a.sounds.h!.length).toBe(4);
    expect(a.sounds.h![1]!.source).toBe('sample');
    expect(a.voiceFx.t).toBeUndefined();
  });

  it('are repaired: bad values fixed, unknown voices dropped, missing steps filled', () => {
    const pr = smallProject();
    const r = repairAudio({ sounds: { k: [{ source: 'sample', sampleId: 'not-a-hash', zone: { volume: 9 }, choke: { mode: 'group', group: 9, role: 'x' } }], ghost: [{}] }, voiceFx: { s: { crunch: { enabled: true, bits: 99 } } }, master: 'junk' }, pr.voices);
    expect(r.sounds.ghost).toBeUndefined();
    expect(r.sounds.k![0]!.sampleId).toBeNull();
    expect(r.sounds.k![0]!.zone.volume).toBe(2);
    expect(r.sounds.k![0]!.choke).toEqual({ mode: 'group', group: 4, role: 'both' });
    expect(r.voiceFx.s!.crunch.bits).toBe(16);
    expect(r.master).toEqual(cleanFx());
    expect(r.sounds.h!.length).toBe(3);
  });

  it('format 1 projects load unchanged, without an audio section, and play the same', () => {
    const pr = busyProject();
    const v1 = JSON.stringify({ format: 'downbeat-project', version: 1, savedAt: '2026-01-01T00:00:00Z', project: pr });
    const r = parseProject(v1);
    expect(r.fromVersion).toBe(1);
    expect(r.report).toEqual([]);
    expect(r.project.audio).toBeUndefined();
    expect(r.project).toEqual(pr);
    expect(renderCycles(r.project, 2).notes).toEqual(renderCycles(pr, 2).notes);
    // and the defaults they play with are all internal and clean
    expect(audioOf(r.project)).toEqual(defaultAudio(pr));
  });

  it('format 2 round-trips the audio section exactly; older versions are told it is newer', () => {
    expect(PROJECT_VERSION).toBe(2);
    const pr = smallProject();
    const a = ensureAudio(pr);
    a.sounds.h![0] = { ...defaultSlot(), source: 'sample', sampleId: 'a'.repeat(64), name: 'hat.wav', choke: { mode: 'group', group: 2, role: 'cuts' } };
    a.voiceFx.s = FX_PRESETS.find((p) => p.key === 'bitcrush')!.apply(cleanFx());
    a.master = FX_PRESETS.find((p) => p.key === 'cassette')!.apply(cleanFx());
    const back = parseProject(serialize(pr));
    expect(back.report).toEqual([]);
    expect(back.project).toEqual(pr);
    expect(JSON.parse(serialize(pr)).version).toBe(2);
    expect(() => loadProject({ format: 'downbeat-project', version: 3, project: pr })).toThrow(/newer/);
  });

  it('never put audio in the project file, only sample ids and names', () => {
    const pr = smallProject();
    ensureAudio(pr).sounds.k![0] = { ...defaultSlot(), source: 'sample', sampleId: 'b'.repeat(64), name: 'kick.wav' };
    expect(serialize(pr).length).toBeLessThan(20000);
    expect(serialize(pr)).toContain('kick.wav');
  });
});

describe('choke groups', () => {
  it('AUTO keeps the old behaviour: HAT cuts OPEN HAT one way, nothing else chokes', () => {
    const slot = defaultSlot();
    expect(chokeFor(slot, 'hat')).toEqual({ group: 'auto:hat', cutBy: false, fade: 0.008 });
    expect(chokeFor(slot, 'openhat')).toEqual({ group: 'auto:hat', cuts: false, fade: 0.008 });
    expect(chokeFor(slot, 'kick')).toBeNull();
    expect(chokeFor({ ...slot, choke: { mode: 'off', group: 1, role: 'both' } }, 'hat')).toBeNull();
    expect(chokeFor({ ...slot, choke: { mode: 'group', group: 3, role: 'cutby' } }, 'kick')).toEqual({ group: 'group:3', cuts: false, cutBy: true, fade: 0.008 });
  });

  it('are found from the note\'s drum sound, not its voice', () => {
    const pr = smallProject();
    pr.voices.push({ ...pr.voices[2]!, id: 'o', name: 'OPEN', sound: { ...pr.voices[2]!.sound, kind: 'openhat' } });
    expect(chokeOf(pr, soundKey('h', 1))?.cutBy).toBe(false);
    expect(chokeOf(pr, soundKey('o', 0))?.cuts).toBe(false);
    expect(chokeOf(pr, soundKey('k', 0))).toBeNull();
    expect(chokeOf(pr, undefined)).toBeNull();
  });
});

describe('event adapter (DOWNBEAT -> Core timeline)', () => {
  const pr = busyProject();
  const r = renderCycles(pr, 2);
  const perf = freezeItems(r.notes, r.tempos, r.endTick, pr.tempo);
  const byVoice = performanceTimeline(pr, perf, 'voice');
  const bySound = performanceTimeline(pr, perf, 'sound');

  it('has every note of the performance, one event per chord pitch, at 96 000 PPQ', () => {
    expect(CORE_PPQ).toBe(96000);
    expect(byVoice.events.length).toBe(r.notes.reduce((n, x) => n + x.pitches.length, 0));
    const want = r.notes.flatMap((n) => n.pitches.map((p) => `${Math.round(n.tick * TICK_SCALE)}:${n.voice}:${soundKey(n.sound, n.note)}:${p}:${n.velocity}`)).sort();
    const got = byVoice.events.map((e) => (e.type === 'note' ? `${e.tick}:${e.voice}:${e.instrument}:${e.pitch}:${e.velocity}` : '')).sort();
    expect(got).toEqual(want);
    expect(byVoice.length).toBe(Math.round(r.endTick * TICK_SCALE));
  });

  it('keeps generated variations, fills, flams, shifts and chords exactly', () => {
    const kinds = new Set(r.notes.map((n) => n.kind));
    expect(kinds).toContain('fill');
    expect(kinds).toContain('flam');
    // the fill belongs to TOM's track but plays HAT's sound
    const fill = r.notes.find((n) => n.kind === 'fill')!;
    expect(fill.voice).toBe('t');
    expect(fill.sound).toBe('h');
    const ev = byVoice.events.find((e) => e.type === 'note' && e.tick === Math.round(fill.tick * TICK_SCALE) && e.voice === 't')!;
    expect(ev.type === 'note' && ev.instrument).toBe(soundKey('h', fill.note));
    // shifted hats land between engine ticks: positions are kept to 1/4000 tick
    const hat = r.notes.find((n) => n.voice === 'h' && n.kind === 'source' && n.tick > 1)!;
    expect(hat.tick % 1).not.toBe(0);
    for (const n of r.notes) expect(Math.abs(Math.round(n.tick * TICK_SCALE) / TICK_SCALE - n.tick)).toBeLessThanOrEqual(0.5 / TICK_SCALE);
    // the chord step plays both its notes as the same drum sound
    const chord = byVoice.events.filter((e) => e.type === 'note' && e.instrument === soundKey('s', 1));
    expect(new Set(chord.map((e) => (e.type === 'note' ? e.pitch : 0)))).toEqual(new Set([40, 37]));
  });

  it('separates sequencer voice and drum sound: same events, routed differently', () => {
    expect(bySound.events.length).toBe(byVoice.events.length);
    for (let i = 0; i < bySound.events.length; i++) {
      const s = bySound.events[i]!;
      if (s.type !== 'note') continue;
      expect(s.voice).toBe(s.instrument);
    }
    const sounds = soundsUsed(pr, bySound);
    // HAT 1-3 (random steps), played by HAT itself and by TOM's fills; TOM's own sound never plays
    expect(sounds).toContain(soundKey('h', 0));
    expect(sounds).not.toContain(soundKey('t', 0));
    expect(bySound.voices.map((v) => v.id)).toEqual(drumSounds(pr).map((d) => d.key));
  });

  it('follows pattern tempo changes like the scheduler', () => {
    const p2 = busyProject();
    const b = structuredClone(p2.patterns[0]!);
    b.id = 'B';
    b.tempo = 150;
    p2.patterns.push(b);
    p2.song.entries = [{ patternId: 'A', repeats: 1 }, { patternId: 'B', repeats: 1 }, { patternId: 'A', repeats: 1 }];
    const perf2 = freezeRange(p2, { kind: 'song' }, noState, null);
    // exactly the engine's tempo items: A at the project tempo, B at its own, A at the project tempo again
    const items = renderCycles({ ...p2, playMode: 'song', song: { ...p2.song, loop: false } }, 3).tempos;
    expect(items.map((t) => t.bpm)).toEqual([150, 120]);
    expect(perf2.tempo.changes).toEqual([{ tick: 0, bpm: 120 }, { tick: 96 * TICK_SCALE, bpm: 150 }, { tick: 192 * TICK_SCALE, bpm: 120 }]);
  });

  it('places a recorded take by the times its notes played', () => {
    const items = renderCycles(busyProject(), 1).notes.slice(0, 3);
    const ms = [1000, 1250, 1600];
    const t = freezeTake(items, ms, items[0]!.tick, 120);
    expect(t.tempo.changes).toEqual([{ tick: 0, bpm: 60 }]);
    expect(t.notes.map((n) => n.tick)).toEqual([0, 0.25 * CORE_PPQ, 0.6 * CORE_PPQ]);
  });
});

describe('export planning', () => {
  it('names files after DOWNBEAT\'s voices and drum sounds, master first', () => {
    const pr = busyProject();
    const plan = planExport(pr, { ...defaultExportOptions('A'), outputs: 'both', stems: 'both' }, noState, null);
    expect(plan.names[0]).toBe('downbeat_test_a-x4_master.wav');
    expect(plan.names).toContain('downbeat_test_a-x4_voice-01-kick.wav');
    expect(plan.names).toContain('downbeat_test_a-x4_sound-hat-1.wav');
    expect(plan.voiceStems).toEqual(['k', 's', 'h', 't']);
    expect(plan.soundStems).not.toContain(soundKey('t', 0));
    expect(new Set(plan.names).size).toBe(plan.names.length);
  });

  it('exports silent stems only when asked, and refuses an empty take or song', () => {
    const pr = busyProject();
    pr.voices[3]!.mute = true;
    const quiet = planExport(pr, { ...defaultExportOptions('A'), outputs: 'stems' }, noState, null);
    expect(quiet.voiceStems).not.toContain('t');
    const all = planExport(pr, { ...defaultExportOptions('A'), outputs: 'stems', all: true }, noState, null);
    expect(all.voiceStems).toContain('t');
    expect(() => planExport(pr, { ...defaultExportOptions('A'), range: { kind: 'take' } }, noState, null)).toThrow(/take/);
    pr.song.entries = [];
    expect(() => planExport(pr, { ...defaultExportOptions('A'), range: { kind: 'song' } }, noState, null)).toThrow(/song/);
  });

  it('is deterministic, honours LOCK and SOURCE, and never changes the project', () => {
    const pr = busyProject();
    pr.ext.enabled = true;
    pr.ext.features.prob = true;
    pr.patterns[0]!.tracks.h!.ext.prob = 60;
    const before = JSON.stringify(pr);
    const o = { ...defaultExportOptions('A'), range: { kind: 'pattern' as const, patternId: 'A', cycles: 4, written: false } };
    const a = planExport(pr, o, noState, null);
    const b = planExport(pr, o, noState, null);
    expect(b.voiceTimeline).toEqual(a.voiceTimeline);
    const locked = planExport(pr, o, { ...noState, lockKey: 2 }, null);
    const lr = renderCycles(pr, 4, { lockKey: 2 });
    expect(locked.voiceTimeline.events).toEqual(performanceTimeline(pr, freezeItems(lr.notes, lr.tempos, lr.endTick, pr.tempo), 'voice').events);
    expect(locked.voiceTimeline.events).not.toEqual(a.voiceTimeline.events);
    const written = planExport(pr, { ...o, range: { ...o.range, written: true } }, noState, null);
    const source = planExport(pr, o, { ...noState, sourceOnly: true }, null);
    expect(source.voiceTimeline.events).toEqual(written.voiceTimeline.events);
    expect(JSON.stringify(pr)).toBe(before);
  });
});

describe('routing', () => {
  it('plays INTERNAL sounds with the voice\'s synthesis, SAMPLE sounds with the sample at the step\'s pitch', async () => {
    const pr = smallProject();
    const lib = new SampleLibrary({ store: new MemorySampleStore(), makeBuffer: fakeBuffer });
    expect(instrumentFor(pr, lib, soundKey('h', 1))).toBeInstanceOf(DrumInstrument);
    expect((instrumentFor(pr, lib, soundKey('h', 1)) as DrumInstrument).base).toBe(42);
    const loaded = await lib.importFile(await wavBytes(), 'hat.wav');
    const a = ensureAudio(pr);
    a.sounds.h![1] = { ...defaultSlot(), source: 'sample', sampleId: loaded.id, name: 'hat.wav' };
    // the sample is still loading: the internal sound fills in
    expect(instrumentFor(pr, lib, soundKey('h', 1))).toBeInstanceOf(DrumInstrument);
    lib.sync(a);
    await lib.ready();
    const inst = instrumentFor(pr, lib, soundKey('h', 1));
    expect(inst).toBeInstanceOf(StepSample);
    expect((inst as StepSample).base).toBe(44);
    expect(instrumentFor(pr, lib, soundKey('h', 0))).toBeInstanceOf(DrumInstrument);
    expect(instrumentFor(pr, lib, 'nonsense')).toBeNull();
    expect(parseSoundKey('v1#2')).toEqual({ voice: 'v1', step: 2 });
  });

  it('gives each sequencer voice its processing strip', () => {
    const pr = smallProject();
    expect(voiceStrips(pr).k).toEqual({ fx: cleanFx() });
    ensureAudio(pr).voiceFx.k = FX_PRESETS[2]!.apply(cleanFx());
    expect(voiceStrips(pr).k!.fx).toEqual(FX_PRESETS[2]!.apply(cleanFx()));
  });
});

describe('the App with samples', () => {
  const app = (store = new MemorySampleStore()) => new App({ kv: null, sampleStore: store, makeBuffer: fakeBuffer, workletUrl: null, download: () => {} });

  it('loads, assigns, edits (undoably), clears, and keeps drum sounds aligned with steps', async () => {
    const a = app();
    const key = soundKey(a.project.voices[0]!.id, 0);
    expect(a.project.audio).toBeUndefined();
    expect(await a.loadSample(key, { bytes: await wavBytes(), name: 'kick.wav' })).toBe(true);
    expect(a.sound(key)).toMatchObject({ source: 'sample', name: 'kick.wav' });
    await a.library.ready();
    expect(a.library.state(key).status).toBe('ready');
    a.setSoundZone(key, { volume: 0.5 });
    a.setSoundZone(key, { volume: 0.6 }); // coalesced with the previous change
    a.setSoundChoke(key, { mode: 'group', group: 2 });
    expect(a.sound(key)!.zone.volume).toBe(0.6);
    a.undo();
    expect(a.sound(key)!.choke.mode).toBe('auto');
    a.undo();
    expect(a.sound(key)!.zone.volume).toBe(1);
    a.clearSample(key);
    expect(a.sound(key)).toMatchObject({ source: 'internal', sampleId: null });
    // steps: removing one moves the later drum sounds up with their settings
    const hat = a.project.voices.find((v) => v.notes.length >= 2)!;
    a.setSoundSource(soundKey(hat.id, 1), 'sample');
    a.removeSoundStep(hat.id, 0);
    expect(a.sound(soundKey(hat.id, 0))!.source).toBe('sample');
    a.addSoundStep(hat.id);
    expect(a.project.audio!.sounds[hat.id]!.length).toBe(hat.notes.length);
  });

  it('reports bad files without touching the drum sound', async () => {
    const a = app();
    const key = soundKey(a.project.voices[0]!.id, 0);
    expect(await a.loadSample(key, { bytes: new TextEncoder().encode('not audio').buffer as ArrayBuffer, name: 'notes.txt' })).toBe(false);
    expect(a.statusKind).toBe('warn');
    expect(a.sound(key)!.source).toBe('internal');
  });

  it('carries a project and its samples to a fresh browser in a bundle', async () => {
    const store = new MemorySampleStore();
    const a = app(store);
    const key = soundKey(a.project.voices[1]!.id, 0);
    await a.loadSample(key, { bytes: await wavBytes(0.2, 330), name: 'snare.wav' });
    const b = await makeBundle(a.project, store);
    expect(b.name).toMatch(/\.downbeatpack$/);
    expect(b.missing).toEqual([]);
    const fresh = new MemorySampleStore();
    const u = await unpackBundle(b.bytes, fresh);
    expect(u.stored).toBe(1);
    const reopened = parseProject(u.projectText).project;
    expect(reopened.audio!.sounds[a.project.voices[1]!.id]![0]!.name).toBe('snare.wav');
    expect(await fresh.has(reopened.audio!.sounds[a.project.voices[1]!.id]![0]!.sampleId!)).toBe(true);
    // a store without the sample: the bundle lists it as missing
    expect((await makeBundle(a.project, new MemorySampleStore())).missing).toEqual(['snare.wav']);
  });

  it('purges only samples nothing uses', async () => {
    const store = new MemorySampleStore();
    const a = app(store);
    const key = soundKey(a.project.voices[0]!.id, 0);
    await a.loadSample(key, { bytes: await wavBytes(0.1, 100), name: 'a.wav' });
    await a.loadSample(key, { bytes: await wavBytes(0.1, 200), name: 'b.wav' });
    expect((await store.list()).length).toBe(2);
    expect(await a.purgeSamples()).toBe(1);
    expect((await store.list()).map((s) => s.name)).toEqual(['b.wav']);
  });

  it('keeps the audio section in shape when voices are added and removed', () => {
    const a = app();
    a.setSoundSource(soundKey(a.project.voices[0]!.id, 0), 'sample');
    a.addVoice();
    const added = a.project.voices.at(-1)!;
    expect(a.project.audio!.sounds[added.id]!.length).toBe(added.notes.length);
    a.removeVoice(added.id);
    expect(a.project.audio!.sounds[added.id]).toBeUndefined();
  });
});
