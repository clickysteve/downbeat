/**
 * KITS from the interface, in Chromium with real IndexedDB: import samples into the library,
 * preview, assign, save a kit, export it (the real download is opened: a manifest and playable
 * WAVs), reload (the kit and the sounds survive, UNSAVED is remembered), load a kit with the
 * keyboard after confirming, import a portable kit from another application (roles DOWNBEAT
 * lacks are kept), delete with confirmation. Typing in the dialog never touches the transport.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { writeKitArchive } from '@slopfactory/core/kits';
import { closedHatWav, kickWav, readWav16, readZipStored, snareWav, wav16 } from './audio-fixtures';
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
        indexedDB.deleteDatabase('downbeat-kit-library');
        sessionStorage.setItem('downbeat.test.booted', '1');
      }
    });
  }
  await page.goto('/');
  await expect(page.getByTestId('grid')).toBeVisible();
  await page.evaluate(() => (window as any).__downbeat.kitsReady);
  return errors;
}

const sound = (page: Page, voice: string, step = 0) => page.evaluate(([v, s]) => {
  const a = (window as any).__downbeat;
  return a.sound(`${a.project.voices.find((x: any) => x.name === v).id}#${s}`);
}, [voice, step] as const);
const patterns = (page: Page) => page.evaluate(() => JSON.stringify((window as any).__downbeat.project.patterns));
const transport = (page: Page) => page.evaluate(() => (window as any).__downbeat.transport);
const files = (...f: [string, Buffer][]) => f.map(([name, buffer]) => ({ name, mimeType: 'audio/wav', buffer }));

async function openKits(page: Page) {
  await page.getByTestId('open-kits').click();
  await expect(page.getByTestId('kits-dialog')).toBeVisible();
}

test('kits: library, assign, save, export, reload, load, import and delete from the interface', async ({ page }) => {
  const errors = await boot(page);
  await openKits(page);

  // ------------------------------------------------------------- the sample library
  await page.getByTestId('library-files').setInputFiles(files(['kick.wav', kickWav()], ['snare.wav', snareWav()], ['hat.wav', closedHatWav()]));
  await expect(page.getByTestId('sample-kick.wav')).toBeVisible();
  await expect(page.getByTestId('library-list').getByRole('option')).toHaveCount(3);
  await page.getByTestId('preview-kick.wav').click();
  await expect.poll(() => page.evaluate(() => (window as any).__downbeat.audition.active)).toBe(true);
  expect(await transport(page)).toBe('stopped'); // a preview is not playback

  await page.getByTestId('sample-kick.wav').click();
  await page.getByTestId('assign-KICK').click();
  await page.getByTestId('library-assign').click();
  await expect.poll(async () => (await sound(page, 'KICK')).name).toBe('kick.wav');

  // ------------------------------------------------------------- save (typing a space never plays)
  const name = page.getByTestId('kit-name');
  await name.fill('');
  await name.pressSequentially('Test Kit');
  expect(await transport(page)).toBe('stopped');
  await page.getByTestId('kit-save').click();
  await expect(page.getByTestId('kit-Test Kit')).toBeVisible();
  await expect(page.getByTestId('kits-dialog')).toContainText('CURRENT KIT · SAVED');

  // a change makes it unsaved
  await page.getByTestId('sample-snare.wav').click();
  await page.getByTestId('assign-SNARE 1').click();
  await page.getByTestId('library-assign').click();
  await expect(page.getByTestId('kits-dialog')).toContainText('UNSAVED CHANGES');

  // ------------------------------------------------------------- export: a real, playable file
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('kit-export').click()]);
  expect(dl.suggestedFilename()).toBe('Test Kit.kit.zip');
  const zip = readZipStored(readFileSync((await dl.path())!));
  const manifest = JSON.parse(zip.get('manifest.json')!.toString('utf8'));
  expect(manifest).toMatchObject({ format: 'slopfactory-kit', version: 1, generator: { app: 'downbeat' }, kit: { name: 'Test Kit' } });
  expect(manifest.kit.instruments.map((i: any) => [i.role, i.label])).toEqual([['kick', 'KICK'], ['snare', 'SNARE 1']]);
  for (const s of manifest.samples) {
    const w = readWav16(zip.get(s.file)!);
    expect(w.channels[0]!.length).toBeGreaterThan(1000);
  }

  // ------------------------------------------------------------- reload: kits and sounds survive
  await page.evaluate(() => (window as any).__downbeat.flushAutosave());
  await page.reload();
  await expect(page.getByTestId('grid')).toBeVisible();
  await page.evaluate(() => (window as any).__downbeat.kitsReady);
  expect((await sound(page, 'SNARE')).name).toBe('snare.wav');
  await openKits(page);
  await expect(page.getByTestId('kit-Test Kit')).toBeVisible();
  await expect(page.getByTestId('kits-dialog')).toContainText('UNSAVED CHANGES');
  await expect(page.getByTestId('library-list').getByRole('option')).toHaveCount(3);

  // ------------------------------------------------------------- load with the keyboard, after confirming
  const before = await patterns(page);
  await page.getByTestId('kit-Test Kit').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('kit-detail')).toBeVisible();
  await expect(page.getByTestId('kit-mapping')).toContainText('KICK ← KICK: kick.wav');
  await page.getByTestId('kit-others-internal').click();
  await page.getByTestId('kit-load').click();
  await expect(page.getByTestId('kit-confirm')).toBeVisible();
  await page.getByTestId('kit-confirm-ok').click();
  await expect.poll(async () => (await sound(page, 'SNARE')).source).toBe('internal');
  expect((await sound(page, 'KICK')).name).toBe('kick.wav');
  expect(await patterns(page)).toBe(before);
  await expect(page.getByTestId('kits-dialog')).toContainText('CURRENT KIT · SAVED');

  // ------------------------------------------------------------- a kit from another application
  const k = new Uint8Array(kickWav());
  const sd = new Uint8Array(wav16([Float32Array.from({ length: 3000 }, (_, i) => Math.sin(i / 3) * Math.exp(-i / 500) * 0.5)]));
  const id = async (b: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex');
  const s1 = { id: await id(k), name: 'bd.wav', type: 'audio/wav', size: k.length, added: 0, bytes: k.slice().buffer };
  const s2 = { id: await id(sd), name: 'ghost.wav', type: 'audio/wav', size: sd.length, added: 0, bytes: sd.slice().buffer };
  const foreign = writeKitArchive({ name: 'Breaks', instruments: [{ role: 'kick', label: 'KICK', samples: [{ sample: s1.id, name: 'bd.wav' }] }, { role: 'snare-ghost', label: 'GHOST', samples: [{ sample: s2.id, name: 'ghost.wav' }] }] }, [s1, s2], { app: 'the-breakery' });
  await page.getByTestId('kit-file').setInputFiles({ name: 'Breaks.kit.zip', mimeType: 'application/zip', buffer: Buffer.from(foreign) });
  await expect(page.getByTestId('kit-Breaks')).toBeVisible();
  await expect.poll(async () => (await sound(page, 'KICK')).name).toBe('bd.wav');
  await page.getByTestId('kit-Breaks').click();
  await expect(page.getByTestId('kit-mapping')).toContainText('GHOST: not played here; 1 sample kept in the kit and the library');

  // ------------------------------------------------------------- delete, after confirming; samples stay
  await page.getByTestId('kit-delete').click();
  await page.getByTestId('kit-confirm-cancel').click();
  await expect(page.getByTestId('kit-Breaks')).toBeVisible();
  await page.getByTestId('kit-delete').click();
  await page.getByTestId('kit-confirm-ok').click();
  await expect(page.getByTestId('kit-Breaks')).toHaveCount(0);
  await expect(page.getByTestId('sample-ghost.wav')).toBeVisible();

  // ------------------------------------------------------------- Escape closes; Space plays again
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('kits-dialog')).toHaveCount(0);
  await page.locator('body').press('Space');
  await expect.poll(() => transport(page)).toBe('playing');
  await page.locator('body').press('Space');
  expect(errors).toEqual([]);
});
