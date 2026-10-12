/**
 * The audio windows from the interface, in Chromium: the Sample Bank (load, drop, audition,
 * replace, clear, playback settings, choke groups, transformations), Output Processing, Export
 * Audio (real downloads: WAV and ZIP files are opened and checked), persistence across reloads,
 * missing samples, portable bundles, old projects, keyboard and small screens.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { closedHatWav, kickWav, openHatWav, readWav16, readZipStored, rms, snareWav } from './audio-fixtures';
import { installFakeMidi } from './fake-midi';

async function boot(page: Page, opts: { clear?: boolean } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(installFakeMidi);
  if (opts.clear !== false) {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('downbeat.test.booted')) {
        localStorage.clear();
        indexedDB.deleteDatabase('downbeat-samples');
        sessionStorage.setItem('downbeat.test.booted', '1');
      }
    });
  }
  await page.goto('/');
  await expect(page.getByTestId('grid')).toBeVisible();
  return errors;
}

const app = <T>(page: Page, fn: string, ...args: unknown[]) => page.evaluate(([fn, args]) => (window as any).__downbeat[fn as string](...(args as unknown[])), [fn, args] as const) as Promise<T>;
const sound = (page: Page, voice: string, step = 0) => page.evaluate(([v, s]) => {
  const a = (window as any).__downbeat;
  return a.sound(`${a.project.voices.find((x: any) => x.name === v).id}#${s}`);
}, [voice, step] as const);

async function openBank(page: Page) {
  await page.getByTestId('open-audio').click();
  await expect(page.getByTestId('sample-bank')).toBeVisible();
}

async function dropFile(page: Page, testid: string, name: string, wav: Buffer) {
  await page.evaluate(
    ([testid, name, b64]) => {
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name as string, { type: 'audio/wav' }));
      const el = document.querySelector(`[data-testid="${testid}"]`)!;
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [testid, name, wav.toString('base64')] as const,
  );
}

const ready = (page: Page) => page.evaluate(() => (window as any).__downbeat.library.ready());

test('sample bank: load, drop, audition, edit, choke, transform, replace and clear from the interface', async ({ page }) => {
  const errors = await boot(page);
  await openBank(page);
  // one row per drum sound: the default demo's voices and their sound steps
  const rows = await page.locator('[data-testid^="bank-"].bank-row').count();
  const sounds = await page.evaluate(() => (window as any).__downbeat.project.voices.reduce((n: number, v: any) => n + v.notes.length, 0));
  expect(rows).toBe(sounds);
  // load with the file chooser into KICK
  await page.getByTestId('bank-KICK').click();
  await page.getByTestId('sample-file').setInputFiles({ name: 'kick.wav', mimeType: 'audio/wav', buffer: kickWav() });
  await expect(page.getByTestId('bank-KICK')).toContainText('kick.wav');
  await expect(page.getByTestId('sound-source-sample')).toHaveClass(/on/);
  await expect(page.getByTestId('waveform')).toBeVisible();
  expect((await sound(page, 'KICK')).source).toBe('sample');
  // drop a file onto another row: it loads into that drum sound
  await dropFile(page, 'bank-OP HAT', 'open.wav', openHatWav());
  await ready(page);
  await expect(page.getByTestId('bank-OP HAT')).toContainText('open.wav');
  expect((await sound(page, 'OP HAT')).name).toBe('open.wav');
  // audition plays through live audio
  await page.getByTestId('bank-KICK').click();
  await page.getByTestId('sample-audition').click();
  await expect.poll(() => page.evaluate(() => (window as any).__downbeat.audio.ready)).toBe(true);
  // playback settings
  await page.getByTestId('zone-volume').fill('0.5');
  await page.getByTestId('zone-pan').fill('-0.25');
  await page.getByTestId('zone-tune-inc').click();
  await page.getByTestId('zone-tune-inc').click();
  await page.getByTestId('zone-mode-gated').click();
  const k = await sound(page, 'KICK');
  expect(k.zone).toMatchObject({ volume: 0.5, pan: -0.25, tune: 2, mode: 'gated' });
  // choke group
  await page.getByTestId('choke-mode-group').click();
  await page.getByTestId('choke-group-3').click();
  await page.getByTestId('choke-role-cuts').click();
  expect((await sound(page, 'KICK')).choke).toEqual({ mode: 'group', group: 3, role: 'cuts' });
  await expect(page.getByTestId('bank-KICK')).toContainText('CHOKE 3 CUTS');
  // AUTO explains the old hat choke on the hats
  await page.getByTestId('bank-OP HAT').click();
  await expect(page.getByTestId('choke-note')).toContainText('cut by HAT');
  // sample transformation: computed in the Worker, then ready
  await page.getByTestId('bank-KICK').click();
  await page.getByTestId('tf-on').click();
  await page.getByTestId('tf-ratio').fill('2');
  await ready(page);
  expect((await sound(page, 'KICK')).transform).toMatchObject({ enabled: true, ratio: 2 });
  const dur = await page.evaluate(() => {
    const a = (window as any).__downbeat;
    return a.library.state(`${a.project.voices[0].id}#0`).duration;
  });
  expect(dur).toBeGreaterThan(0.5); // 0.3 s stretched about twice
  // replace, then clear: back to the internal sound
  await page.getByTestId('sample-file').setInputFiles({ name: 'snare.wav', mimeType: 'audio/wav', buffer: snareWav() });
  await expect(page.getByTestId('bank-KICK')).toContainText('snare.wav');
  await page.getByTestId('sample-clear').click();
  await expect(page.getByTestId('bank-KICK')).toContainText('INTERNAL KICK');
  expect((await sound(page, 'KICK')).source).toBe('internal');
  // a file that is not audio is refused, with a message, and nothing changes
  await page.getByTestId('sample-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect.poll(() => page.evaluate(() => (window as any).__downbeat.status)).toMatch(/not|unsupported|audio/i);
  expect((await sound(page, 'KICK')).sampleId).toBeNull();
  // undo reaches audio settings
  await page.getByTestId('dialog-close').click();
  await page.keyboard.press('Control+z');
  expect((await sound(page, 'KICK')).name).toBe('snare.wav');
  expect(errors).toEqual([]);
});

test('samples, sources, choke groups and processing survive a reload; a missing sample shows and falls back', async ({ page }) => {
  await boot(page);
  await openBank(page);
  await page.getByTestId('bank-CL HAT 1').click();
  await page.getByTestId('sample-file').setInputFiles({ name: 'closed.wav', mimeType: 'audio/wav', buffer: closedHatWav() });
  await page.getByTestId('choke-mode-off').click();
  await page.getByTestId('audio-tab-fx').click();
  await page.getByTestId('fx-preset').selectOption('bitcrush');
  await ready(page);
  await page.evaluate(() => (window as any).__downbeat.flushAutosave());
  await page.reload();
  await expect(page.getByTestId('grid')).toBeVisible();
  await ready(page);
  const s = await sound(page, 'CL HAT');
  expect(s).toMatchObject({ source: 'sample', name: 'closed.wav', choke: { mode: 'off' } });
  expect(await page.evaluate(() => (window as any).__downbeat.project.audio.master.crunch)).toMatchObject({ enabled: true, bits: 8 });
  await openBank(page);
  await expect(page.getByTestId('bank-CL HAT 1')).toContainText('closed.wav');
  // the stored sample disappears (another browser, cleared storage): MISSING, and the internal sound plays
  await page.evaluate(async () => {
    const a = (window as any).__downbeat;
    const id = a.sound(`${a.project.voices.find((x: any) => x.name === 'CL HAT').id}#0`).sampleId;
    await a.library.store.delete(id);
    a.library.forget(id);
    a.flushAutosave();
  });
  await page.reload();
  await expect(page.getByTestId('grid')).toBeVisible();
  await ready(page);
  await openBank(page);
  await expect(page.getByTestId('bank-CL HAT 1')).toContainText('MISSING');
  await page.getByTestId('bank-CL HAT 1').click();
  await expect(page.getByTestId('sample-message')).toContainText('not in this browser');
  const kind = await page.evaluate(async () => {
    const a = (window as any).__downbeat;
    const res = await a.exportAudio({ range: { kind: 'pattern', patternId: a.project.current, cycles: 1, written: false }, outputs: 'master', stems: 'voices', bake: true, all: false, tailSeconds: 0.5 });
    return res.files[0].stats.silent;
  });
  expect(kind).toBe(false);
});

test('output processing window: targets, presets, bypass, overview, all clean', async ({ page }) => {
  await boot(page);
  await page.getByTestId('open-audio').click();
  await page.getByTestId('audio-tab-fx').click();
  await expect(page.getByTestId('output-fx')).toBeVisible();
  await page.getByTestId('fx-target').selectOption({ label: 'VOICE SNARE' });
  await page.getByTestId('fx-preset').selectOption('drive');
  await expect(page.getByTestId('fx-row-VOICE SNARE')).toContainText('DRIVE');
  await page.getByTestId('fx-bypass').click();
  await expect(page.getByTestId('fx-row-VOICE SNARE')).toContainText('BYPASS');
  await page.getByTestId('fx-crunch').click();
  await page.getByTestId('fx-row-MASTER').click();
  await page.getByTestId('fx-preset').selectOption('cassette');
  const a = await page.evaluate(() => {
    const app = (window as any).__downbeat;
    return { snare: app.project.audio.voiceFx[app.project.voices.find((v: any) => v.name === 'SNARE').id], master: app.project.audio.master };
  });
  expect(a.snare).toMatchObject({ bypass: true, drive: { enabled: true, type: 'tube' }, crunch: { enabled: true } });
  expect(a.master.outputStage).toMatchObject({ enabled: true, mode: 'cassette' });
  await expect(page.getByTestId('fx-unavailable')).toHaveCount(0);
  await page.getByTestId('fx-clear-all').click();
  await expect(page.getByTestId('fx-row-MASTER')).toContainText('CLEAN');
  await expect(page.getByTestId('fx-row-VOICE SNARE')).toContainText('CLEAN');
});

test('export audio window: a master WAV, then master + both kinds of stems as one ZIP', async ({ page }) => {
  await boot(page);
  await app(page, 'openDemo', 'jungle');
  await page.getByTestId('open-audio').click();
  await page.getByTestId('audio-tab-export').click();
  await expect(page.getByTestId('export-audio')).toBeVisible();
  await page.getByTestId('exp-cycles').selectOption('2');
  await expect(page.getByTestId('exp-summary')).toContainText('1 file (master)');
  const [wav] = await Promise.all([page.waitForEvent('download'), page.getByTestId('exp-go').click()]);
  expect(wav.suggestedFilename()).toMatch(/^downbeat_.*_master\.wav$/);
  const master = readWav16(readFileSync((await wav.path())!));
  expect([master.sampleRate, master.bits, master.format, master.channels.length]).toEqual([44100, 16, 1, 2]);
  expect(rms(master.channels[0]!)).toBeGreaterThan(0.005);
  await expect(page.getByTestId('exp-result')).toContainText('PEAK');

  await page.getByTestId('exp-outputs-both').click();
  await page.getByTestId('exp-stems-both').click();
  await expect(page.getByTestId('exp-stem-note')).toContainText('cannot be split');
  const summary = await page.getByTestId('exp-summary').textContent();
  expect(summary).toMatch(/voice stems?.*drum-sound stems?.*one ZIP/);
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByTestId('exp-go').click()]);
  expect(zip.suggestedFilename()).toMatch(/\.zip$/);
  const files = readZipStored(readFileSync((await zip.path())!));
  const names = [...files.keys()];
  expect(names[0]).toMatch(/_master\.wav$/);
  expect(names.some((n) => /_voice-\d\d-/.test(n))).toBe(true);
  expect(names.some((n) => /_sound-/.test(n))).toBe(true);
  const wavs = names.map((n) => readWav16(files.get(n)!));
  const len = wavs[0]!.channels[0]!.length;
  for (const w of wavs) expect([w.sampleRate, w.bits, w.channels.length, w.channels[0]!.length]).toEqual([44100, 16, 2, len]);
  expect(len).toBe(master.channels[0]!.length);
  // with CLEAN processing, voice stems and drum-sound stems hold the same music
  const sum = (part: string) => {
    const out = new Float32Array(len);
    names.forEach((n, i) => {
      if (n.includes(part)) for (let j = 0; j < len; j++) out[j]! += wavs[i]!.channels[0]![j]!;
    });
    return out;
  };
  const v = sum('_voice-');
  const s = sum('_sound-');
  let d = 0;
  for (let j = 0; j < len; j++) d = Math.max(d, Math.abs(v[j]! - s[j]!));
  expect(d).toBeLessThan(names.length / 32767);
});

test('song and recorded take export from the window', async ({ page }) => {
  await boot(page);
  await app(page, 'openDemo', 'electro');
  await page.getByTestId('open-audio').click();
  await page.getByTestId('audio-tab-export').click();
  await page.getByTestId('exp-range-song').click();
  await expect(page.getByTestId('exp-summary')).toContainText('THE SONG');
  const [song] = await Promise.all([page.waitForEvent('download'), page.getByTestId('exp-go').click()]);
  expect(song.suggestedFilename()).toMatch(/_song_master\.wav$/);
  // a take: what plays while REC TAKE is on
  await page.getByTestId('exp-range-take').click();
  await expect(page.getByTestId('exp-take-info')).toContainText('No take');
  await page.getByTestId('dialog-close').click();
  await app(page, 'startTake');
  await page.waitForTimeout(1500);
  await app(page, 'stop');
  await page.getByTestId('open-audio').click();
  await page.getByTestId('audio-tab-export').click();
  await expect(page.getByTestId('exp-take-info')).toContainText('notes');
  const [take] = await Promise.all([page.waitForEvent('download'), page.getByTestId('exp-go').click()]);
  expect(take.suggestedFilename()).toMatch(/_take_master\.wav$/);
  const w = readWav16(readFileSync((await take.path())!));
  expect(rms(w.channels[0]!)).toBeGreaterThan(0.001);
});

test('a portable bundle carries the project and its samples into a fresh browser', async ({ page, browser }) => {
  await boot(page);
  await openBank(page);
  await page.getByTestId('bank-SNARE 1').click();
  await page.getByTestId('sample-file').setInputFiles({ name: 'snare.wav', mimeType: 'audio/wav', buffer: snareWav() });
  await ready(page);
  await page.getByTestId('dialog-close').click();
  await page.getByTestId('open-file').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-bundle').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.downbeatpack$/);
  const bytes = readFileSync((await dl.path())!);
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await boot(p2);
  await p2.getByTestId('open-file').click();
  await p2.getByTestId('open-bundle').setInputFiles({ name: dl.suggestedFilename(), mimeType: 'application/zip', buffer: bytes });
  await expect.poll(() => p2.evaluate(() => (window as any).__downbeat.status)).toContain('Opened bundle');
  await ready(p2);
  expect(await sound(p2, 'SNARE', 0)).toMatchObject({ source: 'sample', name: 'snare.wav' });
  expect(await p2.evaluate(() => {
    const a = (window as any).__downbeat;
    return a.library.state(`${a.project.voices.find((x: any) => x.name === 'SNARE').id}#0`).status;
  })).toBe('ready');
  await ctx.close();
});

test('an old project file (format 1) opens without audio settings and plays its internal sounds', async ({ page }) => {
  await boot(page);
  const project = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).__downbeat.project)));
  delete project.audio;
  const v1 = JSON.stringify({ format: 'downbeat-project', version: 1, savedAt: '2026-01-01T00:00:00Z', project });
  await page.getByTestId('open-file').click();
  await page.getByTestId('import-project').setInputFiles({ name: 'old.downbeat.json', mimeType: 'application/json', buffer: Buffer.from(v1) });
  await expect.poll(() => page.evaluate(() => (window as any).__downbeat.status)).toContain('Imported');
  expect(await page.evaluate(() => (window as any).__downbeat.project.audio)).toBeUndefined();
  await openBank(page);
  await expect(page.getByTestId('bank-KICK')).toContainText('INTERNAL KICK');
  // saved again, it is a format 2 file; still without an audio section until something changes
  await page.getByTestId('dialog-close').click();
  await page.getByTestId('open-file').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-project').click()]);
  const saved = JSON.parse(readFileSync((await dl.path())!, 'utf8'));
  expect(saved.version).toBe(2);
  expect(saved.project.audio).toBeUndefined();
});

test('keyboard and small screens: the windows close with Esc, shortcuts still work, no page scroll at phone width', async ({ page }) => {
  await boot(page);
  await page.getByTestId('open-audio').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sample-bank')).toHaveCount(0);
  await page.keyboard.press(' ');
  await expect.poll(() => app<string>(page, 'pattern').then(() => page.evaluate(() => (window as any).__downbeat.transport))).toBe('playing');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__downbeat.transport)).toBe('stopped');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['bank', 'fx', 'export']) {
    await page.getByTestId('open-audio').click();
    if (tab !== 'bank') await page.getByTestId(`audio-tab-${tab}`).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, tab).toBeLessThanOrEqual(0);
    const box = await page.locator('.dialog').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.getByTestId('dialog-close').click();
  }
});
