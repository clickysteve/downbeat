import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/app';
import { parseSmf } from '../../src/midi/smf';
import type { Ticker } from '../../src/scheduler/scheduler';
import { geometry } from '../../src/engine/types';

class ManualTicker implements Ticker {
  fn: (() => void) | null = null;
  start(fn: () => void): void {
    this.fn = fn;
  }
  stop(): void {
    this.fn = null;
  }
}

function makeApp() {
  const files: { name: string; data: Blob | string }[] = [];
  const clock = { now: 1000 };
  const ticker = new ManualTicker();
  const app = new App({ kv: null, ticker, now: () => clock.now, download: (name, data) => files.push({ name, data }) });
  const run = (ms: number) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now += 25;
      ticker.fn?.();
    }
  };
  return { app, files, clock, run };
}

const blobBytes = async (b: Blob | string) => new Uint8Array(typeof b === 'string' ? new TextEncoder().encode(b) : await b.arrayBuffer());

describe('app actions', () => {
  it('starts with the electro demo and strikes paint, erase and undo', () => {
    const { app } = makeApp();
    expect(app.project.name).toBe('BASIC ELECTRO');
    app.newProject();
    const kick = app.project.voices[0]!.id;
    app.setTool({ kind: 'strike', level: 5 });
    expect(app.strikeAction(kick, 1)).toBe('paint');
    app.applyStrike(kick, 1, 'paint');
    expect(app.track(kick).strikes[1]).toEqual({ v: 5, s: 1 });
    expect(app.strikeAction(kick, 1)).toBe('erase');
    app.applyStrike(kick, 1, 'erase');
    expect(app.track(kick).strikes[1]).toBeNull();
    app.undo();
    expect(app.track(kick).strikes[1]).toEqual({ v: 5, s: 1 });
    app.redo();
    expect(app.track(kick).strikes[1]).toBeNull();
  });

  it('exports the written pattern as a MIDI file that imports back into the same strikes', async () => {
    const { app, files } = makeApp();
    app.newProject();
    const before = app.project.voices.map((v) => app.track(v.id).strikes.map((s) => !!s));
    app.exportMidi('pattern', 1, 1);
    const f = files.pop()!;
    expect(f.name).toMatch(/\.mid$/);
    const bytes = await blobBytes(f.data);
    const parsed = parseSmf(bytes);
    expect(parsed.ppq).toBe(96);
    expect(parsed.bpm).toBeCloseTo(120);
    expect(app.importMidi(bytes, 'BACK')).toBe(true);
    expect(app.pattern().name).toBe('BACK');
    const after = app.project.voices.map((v) => app.track(v.id).strikes.map((s) => !!s));
    expect(after).toEqual(before);
  });

  it('a performance export contains generated notes; a take records what played', async () => {
    const { app, files, run } = makeApp();
    app.openDemo('jungle');
    app.exportMidi('performance', 4, 0);
    const perf = parseSmf(await blobBytes(files.pop()!.data));
    app.exportMidi('pattern', 4, 0);
    const written = parseSmf(await blobBytes(files.pop()!.data));
    expect(perf.notes.length).not.toBe(written.notes.length);
    app.startTake();
    run(1500);
    app.stop();
    expect(app.take.notes.length).toBeGreaterThan(10);
    app.exportMidi('take');
    expect(parseSmf(await blobBytes(files.pop()!.data)).notes.length).toBe(app.take.notes.reduce((a, n) => a + n.pitches.length, 0));
  });

  it('captures the playing variation (fills written in) as a new pattern', () => {
    const { app, run } = makeApp();
    app.newProject();
    const snare = app.project.voices.find((v) => v.name === 'SNARE')!.id;
    app.selectVoice(snare, false);
    app.setTrack((t) => (t.fill = { ...t.fill, on: true, amount: 100, max: 16, rate: 1 }));
    app.play();
    run(300);
    const n = app.project.patterns.length;
    app.captureVariation();
    expect(app.project.patterns.length).toBe(n + 1);
    const cap = app.pattern();
    expect(cap.tracks[snare]!.strikes.filter(Boolean).length).toBeGreaterThan(4);
    expect(cap.tracks[snare]!.fill.on).toBe(false);
    app.stop();
  });

  it('Euclid apply, breeding keep and the CLASSIC switch', () => {
    const { app } = makeApp();
    app.newProject();
    app.setMode(true);
    const cow = app.project.voices.find((v) => v.name === 'COWBELL')!.id;
    app.selectVoice(cow, false);
    app.euclid = { ...app.euclid, steps: 7, hits: 3, setLoop: true, mode: 'replace' };
    app.applyEuclid();
    expect(app.track(cow).loop).toBe(7);
    expect(app.track(cow).strikes.filter(Boolean).length).toBe(3);
    app.duplicatePattern();
    app.auditionBreed();
    expect(app.engine.audition).not.toBeNull();
    app.keepBreed();
    expect(app.engine.audition).toBeNull();
    expect(app.project.patterns.length).toBe(3);
    app.setMode(false);
    expect(app.project.ext.enabled).toBe(false);
  });

  it('bad imports leave the project alone and say why', () => {
    const { app } = makeApp();
    const name = app.project.name;
    expect(app.importProjectText('{"format":"something-else"}')).toBe(false);
    expect(app.statusKind).toBe('warn');
    expect(app.project.name).toBe(name);
    expect(app.importMidi(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(app.statusKind).toBe('warn');
  });

  it('pattern geometry changes keep strikes and refuse more than 64 steps', () => {
    const { app } = makeApp();
    app.newProject();
    expect(app.setGeometry({ bars: 4 })).toBe(true);
    expect(geometry(app.pattern()).steps).toBe(64);
    expect(app.setGeometry({ bars: 5 })).toBe(false);
    expect(app.statusKind).toBe('warn');
  });

  it('the monitor feed reports fills and changes as cycles are heard', () => {
    const { app, run } = makeApp();
    app.openDemo('jungle');
    app.play();
    for (let i = 0; i < 40; i++) {
      run(100);
      app.heard();
    }
    app.stop();
    const kinds = new Set(app.feed.map((l) => l.kind));
    expect(kinds.has('fill')).toBe(true);
    expect(app.feed.some((l) => /^FILL SNARE/.test(l.text))).toBe(true);
  });

  it('records strikes from MIDI input while playing, at the nearest step, only when armed', () => {
    const { app, run } = makeApp();
    app.newProject();
    app.clearTrack(true);
    const clap = app.project.voices.find((v) => v.name === 'CLAP')!.id;
    app.play();
    run(300);
    app.noteIn(9, 39, 127);
    expect(app.track(clap).strikes.filter(Boolean).length).toBe(0);
    app.recArmed = true;
    app.heard();
    app.noteIn(9, 39, 127);
    app.noteIn(9, 60, 100); // no voice plays note 60: ignored
    const written = app.track(clap).strikes.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    expect(written.length).toBe(1);
    expect(app.track(clap).strikes[written[0]!]!.v).toBe(5);
    const pos = app.sched.positionTick() % 96;
    expect(Math.abs(written[0]! * 6 - pos)).toBeLessThanOrEqual(3 + 1e-9);
    app.stop();
  });
});
