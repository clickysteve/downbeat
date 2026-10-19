/**
 * Cross-application portability (the acceptance test of the shared kit format): The Breakery
 * and DOWNBEAT, both built and served on two different origins (so they share no browser
 * storage), exchange a kit as a real downloaded file, through their interfaces.
 *
 * 1. The Breakery: ten real WAV one-shots dropped on the screen, saved as a kit, EXPORTed.
 * 2. DOWNBEAT (its own origin): the file IMPORTed in KITS. Checked: the kit's name, every
 *    sample's bytes (SHA-256 against the original files), the mapping onto drum sounds (GHOST,
 *    which DOWNBEAT has no drum sound for, kept), and playback: rendered drum-sound stems contain
 *    the original waveforms (correlation).
 * 3. DOWNBEAT EXPORTs the kit; The Breakery in a fresh browser profile IMPORTs it. Checked: the
 *    same samples and categories (GHOST is back, carried through DOWNBEAT), and playback: the
 *    TAKEAWAY stems contain the original waveforms.
 *
 * Run (both applications built):  BREAKERY_DIR=../the-breakery npm run test:cross
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readWav16, readZipStored, wav16 } from '../e2e/audio-fixtures';

const BREAKERY = 'http://127.0.0.1:4318';
const DOWNBEAT = 'http://127.0.0.1:4317';
const SR = 44100;

/** Distinct, recognisable one-shots: decaying tones at their own frequencies (noise for cymbals). */
function hit(freq: number, seconds: number, noise = 0, seed = 1): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  return Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => {
    const t = i / SR;
    return 0.8 * Math.exp(-t * (6 / seconds)) * ((1 - noise) * Math.sin(2 * Math.PI * freq * t) + noise * rnd());
  });
}
const KIT: [string, Float32Array, string][] = [
  ['kick.wav', hit(55, 0.35), 'kick'],
  ['snare.wav', hit(190, 0.25, 0.5, 2), 'snare'],
  ['ghost snare.wav', hit(240, 0.15, 0.5, 3), 'ghost'],
  ['closed hat.wav', hit(8000, 0.08, 0.9, 4), 'hat'],
  ['open hat.wav', hit(7000, 0.4, 0.9, 5), 'open'],
  ['hi tom.wav', hit(220, 0.3), 'htom'],
  ['mid tom.wav', hit(160, 0.3), 'mtom'],
  ['low tom.wav', hit(110, 0.35), 'ltom'],
  ['crash.wav', hit(5000, 0.8, 0.95, 6), 'crash'],
  ['clap.wav', hit(1200, 0.12, 0.8, 7), 'perc'],
];
const files = KIT.map(([name, data]) => ({ name, buffer: wav16([data]) }));
const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Best normalised correlation of `ref` with `x` around the first onset in x (gain and position free). */
function match(x: Float32Array, ref: Float32Array): number {
  const n = Math.min(ref.length, 4000);
  let on = x.findIndex((v) => Math.abs(v) > 0.01);
  if (on < 0) return 0;
  let best = 0;
  for (let lag = Math.max(0, on - 64); lag < on + 64 && lag + n <= x.length; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < n; i++) {
      xy += x[lag + i]! * ref[i]!;
      xx += x[lag + i]! ** 2;
      yy += ref[i]! ** 2;
    }
    best = Math.max(best, xy / Math.sqrt(xx * yy || 1));
  }
  return best;
}

async function breakery(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1320, height: 705 } })).newPage();
  page.on('pageerror', (e) => console.log('Breakery error:', e.message));
  await page.goto(`${BREAKERY}/?seed=4242`);
  await page.waitForFunction(() => (window as any).breakery?.kits);
  return page;
}
const bTab = (page: Page, label: string) => page.locator('.mtab', { hasText: new RegExp(`^${label}$`) }).dispatchEvent('pointerdown');
const bButton = (page: Page, label: string) => page.locator('.btn', { hasText: new RegExp(`^${label}$`) }).first().dispatchEvent('pointerdown');

/** TAKEAWAY with stems, read back: stem file name → mono data. */
async function breakeryStems(page: Page): Promise<Map<string, Float32Array>> {
  await page.keyboard.press('t');
  const box = page.locator('.mdialog');
  await expect(box).toBeVisible();
  const stems = box.locator('label', { hasText: '+ STEMS (ZIP)' }).locator('input');
  if (!(await stems.isChecked())) await stems.check();
  const [dl] = await Promise.all([page.waitForEvent('download'), box.locator('button', { hasText: 'Take away' }).click()]);
  const zip = readZipStored(readFileSync((await dl.path())!));
  return new Map([...zip].filter(([n]) => n.endsWith('.wav')).map(([n, b]) => [n, readWav16(b).channels[0]!]));
}

test('a kit goes from The Breakery to DOWNBEAT and back, with playable audio, through files only', async ({ browser }) => {
  test.setTimeout(180_000);
  // ------------------------------------------------------------- 1. The Breakery: import, save, export
  const b = await breakery(browser);
  await bTab(b, 'KITS');
  await bButton(b, 'NEW');
  await b.evaluate((fs) => {
    const dt = new DataTransfer();
    for (const f of fs) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: 'audio/wav' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files.map((f) => ({ name: f.name, b64: f.buffer.toString('base64') })));
  await b.locator('.mdialog button', { hasText: 'Done' }).click();
  const cats = await b.evaluate(() => Object.fromEntries((window as any).breakery.ingredients.items.map((i: any) => [i.name, i.cat])));
  expect(cats).toEqual(Object.fromEntries(KIT.map(([n, , c]) => [n, c])));
  await bButton(b, 'SAVE');
  await b.locator('.mdialog input.mtext').fill('Cross Kit');
  await b.locator('.mdialog button', { hasText: 'OK' }).click();
  await expect.poll(() => b.evaluate(() => (window as any).breakery.kits.currentId)).not.toBeNull();
  const [fromBreakery] = await Promise.all([b.waitForEvent('download'), bButton(b, 'EXPORT')]);
  expect(fromBreakery.suggestedFilename()).toBe('Cross Kit.kit.zip');
  const fileA = readFileSync((await fromBreakery.path())!);
  const zipA = readZipStored(fileA);
  const manifestA = JSON.parse(zipA.get('manifest.json')!.toString());
  expect(manifestA.generator.app).toBe('the-breakery');
  // the archive holds the original bytes of every sample
  expect(manifestA.samples.map((s: any) => sha(zipA.get(s.file)!)).sort()).toEqual(files.map((f) => sha(f.buffer)).sort());
  // The Breakery plays its own kit (baseline)
  const bStems = await breakeryStems(b);
  const bKick = [...bStems].find(([n]) => /kick/i.test(n))![1];
  expect(match(bKick, KIT[0]![1])).toBeGreaterThan(0.95);
  console.log(`Breakery own kit: kick stem correlation ${match(bKick, KIT[0]![1]).toFixed(4)}; stems ${[...bStems.keys()].join(', ')}`);

  // ------------------------------------------------------------- 2. DOWNBEAT, another origin: import
  const d = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } })).newPage();
  const dErrors: string[] = [];
  d.on('pageerror', (e) => dErrors.push(e.message));
  await d.goto(DOWNBEAT);
  await d.waitForFunction(() => (window as any).__downbeat?.kitsReady);
  await d.evaluate(() => (window as any).__downbeat.kitsReady);
  expect(await d.evaluate(() => (window as any).__downbeat.kitLibrary.listSamples().then((s: any[]) => s.length))).toBe(0); // nothing shared
  await d.getByTestId('open-kits').click();
  await d.getByTestId('kit-file').setInputFiles({ name: 'Cross Kit.kit.zip', mimeType: 'application/zip', buffer: fileA });
  await expect(d.getByTestId('kit-Cross Kit')).toBeVisible();
  const assigned = await d.evaluate(() => {
    const a = (window as any).__downbeat;
    return Object.fromEntries(a.project.voices.flatMap((v: any) => v.notes.map((_: unknown, s: number) => [`${v.name}${v.notes.length > 1 ? ' ' + (s + 1) : ''}`, a.sound(`${v.id}#${s}`)?.sampleId ? a.sound(`${v.id}#${s}`).name : null])));
  });
  expect(assigned).toMatchObject({ KICK: 'kick.wav', 'SNARE 1': 'snare.wav', 'SNARE 2': null, CLAP: 'clap.wav', 'CL HAT 1': 'closed hat.wav', 'OP HAT': 'open hat.wav', 'LO TOM': 'low tom.wav', 'MID TOM': 'mid tom.wav', 'HI TOM': 'hi tom.wav', CRASH: 'crash.wav' });
  await d.getByTestId('kit-Cross Kit').click();
  await expect(d.getByTestId('kit-mapping')).toContainText('GHOST: not played here; 1 sample kept in the kit and the library');
  // every sample's bytes, as DOWNBEAT stored them, are the original file's
  const stored = await d.evaluate(async () => {
    const lib = (window as any).__downbeat.kitLibrary;
    const out: [string, string][] = [];
    for (const s of await lib.listSamples()) {
      const r = await lib.readSample(s.id);
      const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', r.bytes)), (x) => x.toString(16).padStart(2, '0')).join('');
      out.push([s.name, h]);
    }
    return out;
  });
  expect(Object.fromEntries(stored)).toEqual(Object.fromEntries(files.map((f) => [f.name, sha(f.buffer)])));
  // playback: drum-sound stems of a rendered pattern hold the original waveforms
  // (the kit was loaded onto the project DOWNBEAT opened with: its electro demo)
  await d.evaluate(() => (window as any).__downbeat.library.ready());
  await d.getByTestId('audio-tab-export').click();
  await d.getByTestId('exp-cycles').selectOption('2');
  await d.getByTestId('exp-outputs-both').click();
  await d.getByTestId('exp-stems-sounds').click();
  const [render] = await Promise.all([d.waitForEvent('download'), d.getByTestId('exp-go').click()]);
  const stems = readZipStored(readFileSync((await render.path())!));
  const kickStem = [...stems].find(([n]) => /_sound-.*kick/i.test(n));
  expect(kickStem, [...stems.keys()].join(', ')).toBeTruthy();
  expect(match(readWav16(kickStem![1]).channels[0]!, KIT[0]![1])).toBeGreaterThan(0.95);
  const snareStem = [...stems].find(([n]) => /_sound-.*snare/i.test(n))!;
  expect(match(readWav16(snareStem[1]).channels[0]!, KIT[1]![1])).toBeGreaterThan(0.9);
  console.log(`DOWNBEAT: ${stored.length} samples stored, bytes identical; kick stem ${kickStem![0]} correlation ${match(readWav16(kickStem![1]).channels[0]!, KIT[0]![1]).toFixed(4)}; snare stem ${snareStem[0]} ${match(readWav16(snareStem[1]).channels[0]!, KIT[1]![1]).toFixed(4)}; assigned ${JSON.stringify(assigned)}`);

  // ------------------------------------------------------------- 3. back: DOWNBEAT exports, The Breakery imports
  await d.getByTestId('audio-tab-kits').click();
  const [fromDownbeat] = await Promise.all([d.waitForEvent('download'), d.getByTestId('kit-export').click()]);
  const fileB = readFileSync((await fromDownbeat.path())!);
  const manifestB = JSON.parse(readZipStored(fileB).get('manifest.json')!.toString());
  expect(manifestB.generator.app).toBe('downbeat');
  expect(manifestB.kit.instruments.map((i: any) => i.role)).toContain('snare-ghost'); // carried through DOWNBEAT
  expect(dErrors).toEqual([]);

  const b2 = await breakery(browser); // a fresh profile: none of the first one's storage
  expect(await b2.evaluate(() => (window as any).breakery.library.listSamples().then((s: any[]) => s.length))).toBe(0);
  await bTab(b2, 'KITS');
  await b2.locator('input[type=file][accept*="breakery-kit"]').setInputFiles({ name: fromDownbeat.suggestedFilename(), mimeType: 'application/zip', buffer: fileB });
  await expect.poll(() => b2.evaluate(() => (window as any).breakery.ingredients.items.length)).toBe(10);
  const back = await b2.evaluate(() => Object.fromEntries((window as any).breakery.ingredients.items.map((i: any) => [i.name, i.cat])));
  expect(back).toEqual(Object.fromEntries(KIT.map(([n, , c]) => [n, c])));
  const b2Stems = await breakeryStems(b2);
  const found: string[] = [];
  for (const [cat, idx] of [['kick', 0], ['snare', 1], ['ghost', 2]] as const) {
    const stem = [...b2Stems].find(([n]) => new RegExp(`[_-]${cat}\\.wav$`, 'i').test(n));
    expect(stem, `${cat} stem in ${[...b2Stems.keys()].join(', ')}`).toBeTruthy();
    const c = match(stem![1], KIT[idx]![1]);
    expect(c, cat).toBeGreaterThan(0.9);
    found.push(`${stem![0]} ${c.toFixed(4)}`);
  }
  console.log(`Breakery from DOWNBEAT's file: categories ${JSON.stringify(back)}; stem correlations: ${found.join('; ')}`);
});
