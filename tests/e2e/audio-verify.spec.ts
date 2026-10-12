/**
 * Objective audio verification of DOWNBEAT's audio export (Slop Factory Core in Chromium):
 * controlled patterns and synthetic samples are rendered through the real export path
 * (OfflineAudioContext, the output-processing worklet, real WAV decoding and encoding), and the
 * WAV data is measured: timing, alignment, choke groups, transposition, velocity, pan,
 * processing, voice and drum-sound stems, fills, flams, shifts, song export, tails, clipping,
 * internal sounds, and live playback against the offline render. Nobody listens.
 *
 * With VERIFY_OUT set, measurements are written there as JSON (docs/AUDIO-VERIFICATION.md).
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { velocityGain } from '@slopfactory/core/sampler';
import { C3_HZ, closedHatWav, kickWav, melodicWav, onset, openHatWav, peak, pitchHz, readWav16, rms, snareWav, stereoWav } from './audio-fixtures';
import { installFakeMidi } from './fake-midi';

const SR = 44100;
/** 125 BPM: a sixteenth (one step) is 0.12 s = 5292 frames; an engine tick 882 frames. */
const STEP = 5292;
const TICK = 882;
const CYCLE = 16 * STEP;
/** One 16-bit step, with room for float rounding of the decoded values. */
const LSB = 1.001 / 32767;

const report = new Proxy({} as Record<string, unknown>, {
  set(target, key: string, value) {
    target[key] = value;
    if (process.env.VERIFY_OUT) {
      const all = existsSync(process.env.VERIFY_OUT) ? JSON.parse(readFileSync(process.env.VERIFY_OUT, 'utf8')) : {};
      all[key] = value;
      writeFileSync(process.env.VERIFY_OUT, JSON.stringify(all, null, 2));
    }
    return true;
  },
});

type Wav = ReturnType<typeof readWav16>;
type Files = Map<string, Wav & { clipped: number; peakDb: number }>;

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(installFakeMidi);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('downbeat.test.booted')) {
      localStorage.clear();
      sessionStorage.setItem('downbeat.test.booted', '1');
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('grid')).toBeVisible();
  // a fresh project at 125 BPM with an empty pattern, exact velocities, nothing generated
  await page.evaluate(() => {
    const a = (window as any).__downbeat;
    a.newProject();
    a.setTempo(125);
    const p = a.project;
    const pat = p.patterns.find((x: any) => x.id === p.current);
    for (const t of Object.values(pat.tracks) as any[]) {
      t.strikes = t.strikes.map(() => null);
      t.fill.on = false;
      t.vel.range = [0, 0, 0, 0, 0];
    }
    a.touch(['project', 'pattern']);
  });
  return errors;
}

/** Write strikes into a voice's track: steps, striker level, sound step (1-based), flam. */
async function strikes(page: Page, voice: string, steps: number[], o: { v?: number; s?: number; f?: boolean } = {}) {
  await page.evaluate(
    ([voice, steps, o]) => {
      const a = (window as any).__downbeat;
      const v = a.project.voices.find((x: any) => x.name === voice);
      const pat = a.project.patterns.find((x: any) => x.id === a.project.current);
      for (const s of steps as number[]) pat.tracks[v.id].strikes[s] = { v: (o as any).v ?? 4, s: (o as any).s ?? 1, ...((o as any).f ? { f: true } : {}) };
      a.touch(['pattern']);
    },
    [voice, steps, o] as const,
  );
}

const key = (page: Page, voice: string, step = 0) => page.evaluate(([voice, step]) => `${(window as any).__downbeat.project.voices.find((x: any) => x.name === voice).id}#${step}`, [voice, step] as const);

async function sample(page: Page, voice: string, step: number, name: string, wav: Buffer) {
  const k = await key(page, voice, step);
  const ok = await page.evaluate(
    async ([k, name, b64]) => {
      const a = (window as any).__downbeat;
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0)).buffer;
      const r = await a.loadSample(k, { bytes, name });
      await a.library.ready();
      return r;
    },
    [k, name, wav.toString('base64')] as const,
  );
  expect(ok).toBe(true);
  return k;
}

async function exportFiles(page: Page, opts: Record<string, unknown>): Promise<Files> {
  const r = await page.evaluate(async (o) => {
    const a = (window as any).__downbeat;
    const base = { range: { kind: 'pattern', patternId: a.project.current, cycles: 1, written: false }, outputs: 'both', stems: 'both', bake: true, all: false, tailSeconds: 1 };
    const res = await a.exportAudio({ ...base, ...o });
    if (!res) throw new Error(a.status);
    return res.files.map((f: any) => [f.name, btoa(Array.from(f.bytes as Uint8Array, (b) => String.fromCharCode(b)).join('')), f.stats.clipped, f.stats.peakDb]);
  }, opts);
  return new Map(r.map(([n, b, clipped, peakDb]: [string, string, number, number]) => [n, { ...readWav16(Buffer.from(b, 'base64')), clipped, peakDb }]));
}

const find = (files: Files, part: string) => {
  const k = [...files.keys()].find((n) => n.includes(part));
  if (!k) throw new Error(`no file with "${part}" in ${[...files.keys()].join(', ')}`);
  return files.get(k)!;
};
const onsetsAt = (x: Float32Array, at: number[], window = 400) => at.map((a) => onset(x.subarray(Math.max(0, a - window)), 1.5 / 32767) + Math.max(0, a - window) - a);
const sumOf = (ws: Wav[], ch = 0) => {
  const out = new Float32Array(ws[0]!.channels[0]!.length);
  for (const w of ws) for (let i = 0; i < out.length; i++) out[i]! += w.channels[ch]![i]!;
  return out;
};
const maxDiff = (a: Float32Array, b: Float32Array) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};

test('timing and alignment: exact onsets, every file the same length from sample 0', async ({ page }) => {
  await boot(page);
  await sample(page, 'KICK', 0, 'kick.wav', kickWav());
  await strikes(page, 'KICK', [0, 4, 8, 12]);
  await sample(page, 'SNARE', 0, 'snare.wav', snareWav());
  await strikes(page, 'SNARE', [4, 12]);
  const files = await exportFiles(page, {});
  const lengths = [...files.values()].map((w) => w.channels[0]!.length);
  const kick = find(files, 'voice-01-kick');
  const kickSound = find(files, 'sound-kick');
  const snare = find(files, 'voice-02-snare');
  const offs = onsetsAt(kick.channels[0]!, [0, 4, 8, 12].map((s) => s * STEP));
  const snOffs = onsetsAt(snare.channels[0]!, [4, 12].map((s) => s * STEP));
  report.timing = { files: [...files.keys()], frames: lengths, expectedFrames: CYCLE + SR, kickOnsetErrorFrames: offs, snareOnsetErrorFrames: snOffs, sampleRate: kick.sampleRate, bits: kick.bits };
  for (const w of files.values()) expect([w.sampleRate, w.bits, w.format, w.channels.length]).toEqual([SR, 16, 1, 2]);
  expect(new Set(lengths)).toEqual(new Set([CYCLE + SR]));
  for (const o of [...offs, ...snOffs]) expect(Math.abs(o)).toBeLessThanOrEqual(1);
  // the master lines up with the stems (the compressor's look-ahead is removed)
  const master = find(files, '_master');
  const masterOffs = onsetsAt(master.channels[0]!, [0, 4, 8, 12].map((s) => s * STEP));
  report.timing = { ...(report.timing as object), masterOnsetErrorFrames: masterOffs };
  for (const o of masterOffs) expect(Math.abs(o)).toBeLessThanOrEqual(1);
  // a voice that only plays its own sound: voice stem and drum-sound stem are identical
  expect(maxDiff(kick.channels[0]!, kickSound.channels[0]!)).toBeLessThanOrEqual(LSB);
  // stems sum the same either way (CLEAN processing)
  const voices = [...files].filter(([n]) => n.includes('_voice-')).map(([, w]) => w);
  const sounds = [...files].filter(([n]) => n.includes('_sound-')).map(([, w]) => w);
  expect(maxDiff(sumOf(voices), sumOf(sounds))).toBeLessThanOrEqual(2 * LSB);
  // the tail is the shared tail: silent after the music has rung out
  expect(rms(kick.channels[0]!, CYCLE + 0.4 * SR, CYCLE + SR)).toBe(0);
});

test('choke groups: AUTO closed hat cuts the open hat across voices; OFF lets it ring; stereo kept', async ({ page }) => {
  await boot(page);
  await sample(page, 'OP HAT', 0, 'open.wav', openHatWav());
  const closedKey = await sample(page, 'CL HAT', 0, 'closed.wav', closedHatWav());
  await strikes(page, 'OP HAT', [0, 8]);
  await strikes(page, 'CL HAT', [3, 10]);
  const choked = await exportFiles(page, { outputs: 'stems', stems: 'sounds' });
  const open = find(choked, 'sound-op-hat');
  const cut = 3 * STEP;
  const fade = Math.ceil(0.009 * SR);
  const before = rms(open.channels[0]!, cut - 2000, cut);
  const after = rms(open.channels[0]!, cut + fade, 8 * STEP);
  let lr = 0;
  for (let i = 1000; i < cut; i++) lr = Math.max(lr, Math.abs(open.channels[0]![i]! - open.channels[1]![i]!));
  // retrigger at step 8 rings, cut again at step 10
  const second = rms(open.channels[1]!, 10 * STEP + fade, 16 * STEP);
  await page.evaluate((k) => (window as any).__downbeat.setSoundChoke(k, { mode: 'off' }), closedKey);
  const free = find(await exportFiles(page, { outputs: 'stems', stems: 'sounds' }), 'sound-op-hat');
  const ringing = rms(free.channels[0]!, cut + fade, 8 * STEP);
  report.choke = { cutAtFrame: cut, rmsBeforeCut: before, rmsAfterCutAndFade: after, rmsAfterSecondCut: second, rmsSameWindowChokeOff: ringing, stereoDifferenceBeforeCut: lr };
  expect(before).toBeGreaterThan(0.05);
  expect(after).toBeLessThan(1e-4);
  expect(second).toBeLessThan(1e-4);
  expect(ringing).toBeGreaterThan(0.02);
  expect(lr).toBeGreaterThan(0.05);
});

test('choke groups: explicit groups, roles, and a voice cutting its own previous hit', async ({ page }) => {
  await boot(page);
  const crash = await sample(page, 'CRASH', 0, 'long.wav', openHatWav());
  const cow = await sample(page, 'COWBELL', 0, 'short.wav', closedHatWav());
  await strikes(page, 'CRASH', [0, 2]);
  await strikes(page, 'COWBELL', [6]);
  await page.evaluate(([a, b]) => {
    const app = (window as any).__downbeat;
    app.setSoundChoke(a, { mode: 'group', group: 2, role: 'both' });
    app.setSoundChoke(b, { mode: 'group', group: 2, role: 'cuts' });
  }, [crash, cow] as const);
  const f = await exportFiles(page, { outputs: 'stems', stems: 'sounds' });
  const c = find(f, 'sound-crash').channels[0]!;
  const fade = Math.ceil(0.009 * SR);
  // the second crash cut the first (same sound, role both): from step 2 only one crash sounds
  const single = find(await (async () => {
    await page.evaluate(() => {
      const a = (window as any).__downbeat;
      const v = a.project.voices.find((x: any) => x.name === 'CRASH');
      const pat = a.project.patterns.find((x: any) => x.id === a.project.current);
      pat.tracks[v.id].strikes[0] = null;
      a.touch(['pattern']);
    });
    return exportFiles(page, { outputs: 'stems', stems: 'sounds' });
  })(), 'sound-crash').channels[0]!;
  const selfCut = maxDiff(c.subarray(2 * STEP + fade, 6 * STEP), single.subarray(2 * STEP + fade, 6 * STEP));
  const afterCow = rms(c, 6 * STEP + fade, 12 * STEP);
  report.chokeGroups = { selfCutDifference: selfCut, crashAfterCowbellRms: afterCow };
  expect(selfCut).toBeLessThan(1e-6);
  expect(afterCow).toBeLessThan(1e-4);
});

test('transposition, velocity and pan', async ({ page }) => {
  await boot(page);
  const k = await sample(page, 'SNARE', 0, 'tone_C3.wav', melodicWav());
  await strikes(page, 'SNARE', [0], { v: 5 });
  await page.evaluate((k) => (window as any).__downbeat.setSoundZone(k, { mode: 'oneshot' }), k);
  const base = find(await exportFiles(page, { outputs: 'stems', stems: 'sounds', tailSeconds: 1 }), 'sound-snare-1').channels[0]!;
  await page.evaluate((k) => (window as any).__downbeat.setSoundZone(k, { tune: 12 }), k);
  const up = find(await exportFiles(page, { outputs: 'stems', stems: 'sounds', tailSeconds: 1 }), 'sound-snare-1').channels[0]!;
  await page.evaluate((k) => (window as any).__downbeat.setSoundZone(k, { tune: -7, fine: 0 }), k);
  const down = find(await exportFiles(page, { outputs: 'stems', stems: 'sounds', tailSeconds: 1 }), 'sound-snare-1').channels[0]!;
  const f0 = pitchHz(base, SR, 4410, 8820, 50, 600);
  const f12 = pitchHz(up, SR, 2205, 4410, 50, 600);
  const f7 = pitchHz(down, SR, 4410, 8820, 50, 600);
  const cents = (f: number, want: number) => 1200 * Math.log2(f / want);
  // a chord step: the second note transposes the sample relative to the step's first note
  await page.evaluate((k) => (window as any).__downbeat.setSoundZone(k, { tune: 0 }), k);
  await page.evaluate(() => {
    const a = (window as any).__downbeat;
    a.setVoiceNotes(a.project.voices.find((x: any) => x.name === 'SNARE').id, 0, [38, 45]);
  });
  const chord = find(await exportFiles(page, { outputs: 'stems', stems: 'sounds', tailSeconds: 1 }), 'sound-snare-1').channels[0]!;

  // velocity: strikers 1-5 with exact centres 28, 52, 80, 104, 124 on a kick
  const kk = await sample(page, 'KICK', 0, 'kick.wav', kickWav());
  await strikes(page, 'KICK', [0], { v: 1 });
  await strikes(page, 'KICK', [4], { v: 2 });
  await strikes(page, 'KICK', [8], { v: 3 });
  await strikes(page, 'KICK', [12], { v: 5 });
  const kick = find(await exportFiles(page, { outputs: 'stems', stems: 'sounds' }), 'sound-kick').channels[0]!;
  const peaks = [0, 4, 8, 12].map((s) => peak(kick.subarray(s * STEP, s * STEP + 4000)));
  const vel = [28, 52, 80, 124];
  const want = vel.map((v) => velocityGain({ velocitySens: 1 }, v) / velocityGain({ velocitySens: 1 }, 124));
  const got = peaks.map((p) => p / peaks[3]!);
  // pan: hard left
  await page.evaluate((k) => (window as any).__downbeat.setSoundZone(k, { pan: -1 }), kk);
  const panned = find(await exportFiles(page, { outputs: 'stems', stems: 'sounds' }), 'sound-kick');
  // measured on the striker-3 hit: the loudest one clips at full scale when panned (+3 dB)
  const centre = rms(kick, 8 * STEP, 8 * STEP + 4000);
  const left = rms(panned.channels[0]!, 8 * STEP, 8 * STEP + 4000);
  report.pitchVelocityPan = { baseHz: f0, expectedHz: C3_HZ, tunePlus12Hz: f12, tuneMinus7Hz: f7, chordSecondNoteRaisesBy7: { rmsChord: rms(chord, 0, 8820), rmsSingle: rms(base, 0, 8820) }, velocityPeakRatios: got, expectedRatios: want, panCentreRms: centre, panLeftRms: left, panRightRms: rms(panned.channels[1]!), panLeftOverCentre: left / centre };
  expect(Math.abs(cents(f0, C3_HZ))).toBeLessThan(5);
  expect(Math.abs(cents(f12, 2 * C3_HZ))).toBeLessThan(5);
  expect(Math.abs(cents(f7, C3_HZ * 2 ** (-7 / 12)))).toBeLessThan(5);
  expect(rms(chord, 0, 8820)).toBeGreaterThan(rms(base, 0, 8820) * 1.2); // two notes of the chord play
  for (let i = 0; i < 4; i++) expect(Math.abs(got[i]! - want[i]!)).toBeLessThan(0.01);
  // equal-power pan of a mono sample: hard left is +3 dB on the left, nothing on the right
  expect(rms(panned.channels[1]!)).toBeLessThan(1e-6);
  expect(Math.abs(left / centre - Math.SQRT2)).toBeLessThan(0.01);
});

test('processing: voice processing in voice stems only; master processing in the master only', async ({ page }) => {
  await boot(page);
  await sample(page, 'SNARE', 0, 'tone.wav', melodicWav());
  await strikes(page, 'SNARE', [0], { v: 5 });
  const clean = await exportFiles(page, { tailSeconds: 0.5 });
  await page.evaluate(() => {
    const a = (window as any).__downbeat;
    const id = a.project.voices.find((x: any) => x.name === 'SNARE').id;
    const fx = structuredClone(a.project.audio.voiceFx[id]);
    fx.crunch = { enabled: true, bits: 4, rateDivide: 1 };
    a.setVoiceFx(id, fx);
  });
  const crunched = await exportFiles(page, { tailSeconds: 0.5 });
  const levels = (x: Float32Array) => new Set(Array.from(x.subarray(0, 20000), (v) => Math.round(v * 32767))).size;
  const vClean = find(clean, 'voice-02').channels[0]!;
  const vCrunch = find(crunched, 'voice-02').channels[0]!;
  const sCrunch = find(crunched, 'sound-snare-1').channels[0]!;
  // master processing: on, the voice stems are untouched, the master changes
  await page.evaluate(() => {
    const a = (window as any).__downbeat;
    const m = structuredClone(a.project.audio.master);
    m.drive = { enabled: true, type: 'fuzz', amountPct: 80 };
    a.setMasterFx(m);
  });
  const mastered = await exportFiles(page, { tailSeconds: 0.5 });
  // dry voice stems: voice processing left out
  const dry = await exportFiles(page, { tailSeconds: 0.5, bake: false });
  report.processing = { voiceStemLevelsClean: levels(vClean), voiceStemLevelsCrunch4: levels(vCrunch), soundStemLevelsWithVoiceCrunch: levels(sCrunch), voiceStemChangedByMasterFx: maxDiff(find(mastered, 'voice-02').channels[0]!, vCrunch), masterChangedByMasterFx: maxDiff(find(mastered, '_master').channels[0]!, find(crunched, '_master').channels[0]!), dryVoiceStemEqualsSoundStem: maxDiff(find(dry, 'voice-02').channels[0]!, sCrunch) };
  expect(levels(vCrunch)).toBeLessThanOrEqual(17);
  expect(levels(vClean)).toBeGreaterThan(1000);
  expect(levels(sCrunch)).toBeGreaterThan(1000);
  expect(maxDiff(find(mastered, 'voice-02').channels[0]!, vCrunch)).toBe(0);
  expect(maxDiff(find(mastered, '_master').channels[0]!, find(crunched, '_master').channels[0]!)).toBeGreaterThan(0.01);
  expect(maxDiff(find(dry, 'voice-02').channels[0]!, sCrunch)).toBeLessThanOrEqual(LSB);
});

test('voice and drum-sound stems: fills borrowing a sound, several sounds on one voice, flams, shifts', async ({ page }) => {
  await boot(page);
  await sample(page, 'KICK', 0, 'kick.wav', kickWav());
  await sample(page, 'CL HAT', 0, 'closed.wav', closedHatWav());
  await sample(page, 'CL HAT', 1, 'pedal.wav', snareWav());
  await sample(page, 'SNARE', 0, 'snare.wav', snareWav());
  await sample(page, 'LO TOM', 0, 'tom.wav', melodicWav());
  await strikes(page, 'KICK', [0]);
  await strikes(page, 'CL HAT', [0, 8], { s: 1 });
  await strikes(page, 'CL HAT', [4, 12], { s: 2 });
  await strikes(page, 'SNARE', [4], { f: true, v: 5 });
  await strikes(page, 'LO TOM', [10]);
  // LO TOM fills its gaps with KICK's sound (KICK has one sound step)
  await page.evaluate(() => {
    const a = (window as any).__downbeat;
    const id = (n: string) => a.project.voices.find((x: any) => x.name === n).id;
    const pat = a.project.patterns.find((x: any) => x.id === a.project.current);
    pat.tracks[id('LO TOM')].fill = { on: true, sound: id('KICK'), amount: 100, rate: 1, spacing: 1, max: 2, zone: 'all', weights: [0, 0, 100, 0, 0] };
    pat.tracks[id('SNARE')].shift = -2;
    a.touch(['pattern']);
  });
  const files = await exportFiles(page, {});
  const names = [...files.keys()];
  const kickVoice = find(files, 'voice-01-kick').channels[0]!;
  const kickSound = find(files, 'sound-kick').channels[0]!;
  const tomVoice = find(files, 'voice-07-lo-tom').channels[0]!;
  const tomSound = find(files, 'sound-lo-tom').channels[0]!;
  const hat1 = find(files, 'sound-cl-hat-1').channels[0]!;
  const hat2 = find(files, 'sound-cl-hat-2').channels[0]!;
  const snare = find(files, 'voice-02-snare').channels[0]!;
  // fills: KICK's drum-sound stem holds KICK's own hit and TOM's fills; TOM's voice stem holds its hit and the fills
  const fillsInKickSound = new Float32Array(kickSound.length).map((_, i) => kickSound[i]! - kickVoice[i]!);
  const fillsInTomVoice = new Float32Array(tomVoice.length).map((_, i) => tomVoice[i]! - tomSound[i]!);
  // the snare is shifted 2 fine units (half a tick) early, with a flam one tick before that;
  // without the flam, the hit alone shows where the main note starts
  const shift = TICK / 2;
  const flamAt = onsetsAt(snare, [4 * STEP - shift - TICK])[0]!;
  const voices = names.filter((n) => n.includes('_voice-')).map((n) => files.get(n)!);
  const sounds = names.filter((n) => n.includes('_sound-')).map((n) => files.get(n)!);
  const sumDiff = maxDiff(sumOf(voices), sumOf(sounds));
  await strikes(page, 'SNARE', [4], { v: 5 });
  const noFlam = find(await exportFiles(page, {}), 'voice-02-snare').channels[0]!;
  const hitAt = onsetsAt(noFlam, [4 * STEP - shift])[0]!;
  report.stems = { files: names, flamOnsetErrorFrames: flamAt, shiftedHitOnsetErrorFrames: hitAt, fillsRmsInKickSoundStem: rms(fillsInKickSound), fillsInKickSoundEqualFillsInTomVoice: maxDiff(fillsInKickSound, fillsInTomVoice), hat2StemOnsetsErrorFrames: onsetsAt(hat2, [4 * STEP, 12 * STEP]), voiceStemsSumEqualsSoundStemsSum: sumDiff };
  // the fills moved from TOM's voice to KICK's sound, exactly
  expect(rms(fillsInKickSound)).toBeGreaterThan(0.01);
  expect(maxDiff(fillsInKickSound, fillsInTomVoice)).toBeLessThanOrEqual(2 * LSB);
  // TOM's own sound plays only its written hit at step 10
  expect(rms(tomSound, 0, 10 * STEP - 10)).toBe(0);
  // two drum sounds on one voice: separate stems, each only at its own steps
  expect(onsetsAt(hat2, [4 * STEP, 12 * STEP]).every((o) => Math.abs(o) <= 1)).toBe(true);
  expect(rms(hat2, 0, 4 * STEP - 10)).toBe(0);
  expect(onsetsAt(hat1, [0, 8 * STEP]).every((o) => Math.abs(o) <= 1)).toBe(true);
  expect(rms(hat1, 0.1 * SR, 8 * STEP - 10)).toBe(0);
  // flam and shift
  expect(Math.abs(flamAt)).toBeLessThanOrEqual(1);
  expect(Math.abs(hitAt)).toBeLessThanOrEqual(1);
  // the two stem sets add up to the same mix
  expect(sumDiff).toBeLessThanOrEqual(4 * LSB);
});

test('song export: patterns in order at their tempos, one shared tail; tails; clipping reported', async ({ page }) => {
  await boot(page);
  await sample(page, 'KICK', 0, 'kick.wav', kickWav());
  await strikes(page, 'KICK', [0]);
  await page.evaluate(() => {
    const a = (window as any).__downbeat;
    a.duplicatePattern();
    const p = a.project;
    const b = p.patterns[p.patterns.length - 1];
    b.tempo = 150;
    p.song.entries = [{ patternId: p.patterns[0].id, repeats: 2 }, { patternId: b.id, repeats: 1 }];
    p.current = p.patterns[0].id;
    a.touch(['song', 'pattern']);
  });
  const song = await exportFiles(page, { range: { kind: 'song' }, outputs: 'stems', stems: 'voices', tailSeconds: 2 });
  const k = find(song, 'voice-01').channels[0]!;
  const bStart = 2 * CYCLE;
  const bStep = Math.round((60 / 150 / 4) * SR);
  const songOnsets = onsetsAt(k, [0, CYCLE, bStart]);
  const expectedFrames = 2 * CYCLE + 16 * bStep + 2 * SR;
  const tail0 = await exportFiles(page, { outputs: 'master', tailSeconds: 0 });
  // clipping: a loud sample at double volume, layered: reported, never normalised
  const kk = await key(page, 'KICK');
  await page.evaluate((kk) => (window as any).__downbeat.setSoundZone(kk, { volume: 2 }), kk);
  await strikes(page, 'SNARE', [0]);
  await sample(page, 'SNARE', 0, 'kick2.wav', kickWav());
  const loud = await exportFiles(page, { outputs: 'stems', stems: 'voices' });
  const lk = find(loud, 'voice-01');
  report.song = { frames: k.length, expectedFrames, onsetErrorFrames: songOnsets, tailZeroFrames: find(tail0, 'master').channels[0]!.length, cycleFrames: CYCLE, clippedSamples: lk.clipped, peakDbFs: lk.peakDb, wavPeak: peak(lk.channels[0]!) };
  expect(k.length).toBe(expectedFrames);
  for (const o of songOnsets) expect(Math.abs(o)).toBeLessThanOrEqual(1);
  expect(find(tail0, 'master').channels[0]!.length).toBe(CYCLE);
  expect(lk.clipped).toBeGreaterThan(0);
  expect(lk.peakDb).toBeGreaterThan(0);
  expect(peak(lk.channels[0]!)).toBeGreaterThan(0.999); // clamped at full scale in the file, not scaled down
});

test('internal sounds: an old project with no audio settings exports, repeatably, as with explicit defaults', async ({ page }) => {
  await boot(page);
  await strikes(page, 'KICK', [0, 8]);
  await strikes(page, 'CL HAT', [0, 2, 4, 6, 8, 10, 12, 14]);
  await strikes(page, 'OP HAT', [6]);
  await strikes(page, 'SNARE', [4, 12]);
  const noAudio = await page.evaluate(() => (window as any).__downbeat.project.audio === undefined);
  const a1 = await exportFiles(page, { outputs: 'master' });
  const a2 = await exportFiles(page, { outputs: 'master' });
  // the same project with every setting written out explicitly (INTERNAL, AUTO, CLEAN)
  await page.evaluate(() => {
    const a = (window as any).__downbeat;
    a.setSoundSource(`${a.project.voices[0].id}#0`, 'internal');
  });
  const a3 = await exportFiles(page, { outputs: 'master' });
  const m1 = find(a1, 'master').channels[0]!;
  const m2 = find(a2, 'master').channels[0]!;
  const m3 = find(a3, 'master').channels[0]!;
  // the closed hat at step 8 cuts the open hat from step 6 (the AUTO choke, as before)
  const stems = await exportFiles(page, { outputs: 'stems', stems: 'voices' });
  const op = find(stems, 'voice-06-op-hat').channels[0]!;
  report.internal = { noAudioSection: noAudio, rmsMaster: rms(m1), repeatMaxDiff: maxDiff(m1, m2), explicitDefaultsMaxDiff: maxDiff(m1, m3), openHatBeforeCut: rms(op, 6 * STEP, 8 * STEP), openHatAfterCut: rms(op, 8 * STEP + 2000, 10 * STEP) };
  expect(noAudio).toBe(true);
  expect(rms(m1)).toBeGreaterThan(0.01);
  expect(maxDiff(m1, m2)).toBeLessThanOrEqual(2 * LSB);
  expect(maxDiff(m1, m3)).toBeLessThanOrEqual(2 * LSB);
  expect(rms(op, 6 * STEP, 8 * STEP)).toBeGreaterThan(0.01);
  expect(rms(op, 8 * STEP + 2000, 10 * STEP)).toBeLessThan(rms(op, 6 * STEP, 8 * STEP) / 100);
});

test('live playback matches the offline render (timing and level)', async ({ page }) => {
  await boot(page);
  await sample(page, 'KICK', 0, 'kick.wav', kickWav());
  await strikes(page, 'KICK', [0, 4, 8, 12]);
  const off = find(await exportFiles(page, { outputs: 'master', tailSeconds: 0.5 }), 'master').channels[0]!;
  const live = await page.evaluate(async () => {
    const a = (window as any).__downbeat;
    await a.ensureAudio();
    const ctx: AudioContext = a.audio.ctx;
    const code = "registerProcessor('rec', class extends AudioWorkletProcessor { constructor() { super(); this.buf = []; this.port.onmessage = () => this.port.postMessage(this.buf.splice(0)); } process(i) { const c = i[0] && i[0][0]; this.buf.push(c ? c.slice() : new Float32Array(128)); return true; } });";
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const rec = new AudioWorkletNode(ctx, 'rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    const sink = ctx.createGain();
    sink.gain.value = 0;
    a.audio.output.connect(rec);
    rec.connect(sink).connect(ctx.destination);
    await new Promise((r) => setTimeout(r, 200));
    a.play();
    await new Promise((r) => setTimeout(r, 2600));
    a.stop();
    const blocks: Float32Array[] = await new Promise((res) => {
      rec.port.onmessage = (e) => res(e.data);
      rec.port.postMessage('flush');
    });
    a.audio.output.disconnect(rec);
    const out = new Float32Array(blocks.length * 128);
    blocks.forEach((b, i) => out.set(b, i * 128));
    return { data: Array.from(out), rate: ctx.sampleRate };
  });
  const x = Float32Array.from(live.data);
  const thr = 1.5 / 32767;
  const s0 = onset(x, thr);
  const hits = [0, 1, 2, 3].map((i) => {
    const from = s0 + i * 4 * STEP - 3000;
    return onset(x.subarray(from), thr) + from;
  });
  const intervals = hits.slice(1).map((h, i) => h - hits[i]! - 4 * STEP);
  const level = [0, 1, 2, 3].map((i) => rms(x, hits[i]!, hits[i]! + 2000) / rms(off, i * 4 * STEP, i * 4 * STEP + 2000));
  report.liveVsOffline = { liveSampleRate: live.rate, firstOnsetFrame: s0, hitIntervalErrorFrames: intervals, levelRatioLiveOverOffline: level };
  expect(live.rate).toBe(SR);
  for (const e of intervals) expect(Math.abs(e)).toBeLessThan(0.01 * SR);
  for (const r of level) expect(Math.abs(r - 1)).toBeLessThan(0.05);
});

test('stereo samples stay stereo in every output', async ({ page }) => {
  await boot(page);
  await sample(page, 'COWBELL', 0, 'stereo.wav', stereoWav());
  await strikes(page, 'COWBELL', [0]);
  const f = await exportFiles(page, {});
  const s = find(f, 'sound-cowbell');
  const v = find(f, 'voice-10-cowbell');
  const lHz = pitchHz(s.channels[0]!, SR, 2000, 4410, 200, 1000);
  const rHz = pitchHz(s.channels[1]!, SR, 2000, 4410, 200, 1000);
  report.stereo = { leftHz: lHz, rightHz: rHz, voiceStemEqualsSoundStem: maxDiff(s.channels[1]!, v.channels[1]!) };
  expect(Math.abs(lHz - 440)).toBeLessThan(3);
  expect(Math.abs(rHz - 660)).toBeLessThan(4);
  expect(maxDiff(s.channels[1]!, v.channels[1]!)).toBeLessThanOrEqual(LSB);
});
