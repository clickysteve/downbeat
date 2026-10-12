import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installFakeMidi } from './fake-midi';

type Msg = { bytes: number[]; t: number };
type FakeMidi = { sent: Msg[]; reset(): void; sendIn(b: number[]): void; clockStart(bpm: number): void; clockStop(): void; unplugOut(): void; replugOut(): void };

const midi = (page: Page) => ({
  sent: () => page.evaluate(() => (window as unknown as { __midi: FakeMidi }).__midi.sent.slice()),
  reset: () => page.evaluate(() => (window as unknown as { __midi: FakeMidi }).__midi.reset()),
  sendIn: (b: number[]) => page.evaluate((x) => (window as unknown as { __midi: FakeMidi }).__midi.sendIn(x), b),
  clockStart: (bpm: number) => page.evaluate((x) => (window as unknown as { __midi: FakeMidi }).__midi.clockStart(x), bpm),
  clockStop: () => page.evaluate(() => (window as unknown as { __midi: FakeMidi }).__midi.clockStop()),
  unplugOut: () => page.evaluate(() => (window as unknown as { __midi: FakeMidi }).__midi.unplugOut()),
});

const isOn = (m: Msg) => (m.bytes[0]! & 0xf0) === 0x90 && m.bytes[2]! > 0;
const isOff = (m: Msg) => (m.bytes[0]! & 0xf0) === 0x80;

function hanging(msgs: Msg[]): string[] {
  const held = new Map<string, number>();
  const sorted = msgs.map((m, i) => ({ m, i })).sort((a, b) => a.m.t - b.m.t || a.i - b.i);
  for (const { m } of sorted) {
    const k = `${m.bytes[0]! & 0x0f}:${m.bytes[1]}`;
    if (isOn(m)) held.set(k, 1);
    else if (isOff(m)) held.set(k, 0);
  }
  return [...held].filter(([, v]) => v > 0).map(([k]) => k);
}

async function boot(page: Page, opts: { clear?: boolean } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(installFakeMidi);
  if (opts.clear !== false) {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('downbeat.test.booted')) {
        localStorage.clear();
        sessionStorage.setItem('downbeat.test.booted', '1');
      }
    });
  }
  await page.goto('/');
  await expect(page.getByTestId('grid')).toBeVisible();
  return errors;
}

/** Start from a known empty pattern: new project, then clear it. */
async function freshProject(page: Page) {
  await page.getByTestId('open-file').click();
  await page.getByTestId('new-project').click();
  await page.getByTestId('voice-KICK').click();
  await page.getByTestId('tab-pattern').click();
  await page.getByRole('button', { name: 'CLEAR ALL' }).click();
}

async function routeToMidi(page: Page) {
  await page.getByTestId('open-midi').click();
  await page.getByTestId('enable-midi').click();
  await expect(page.getByTestId('midi-message')).toHaveText('MIDI ready');
  await page.getByTestId('dlg-output-midi').click();
  await page.getByTestId('midi-out').selectOption('fake-out');
  await page.getByTestId('dialog-close').click();
}

test('boots cleanly with a demo, a grid of voices and the Classic panels', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('.vl')).toHaveCount(10);
  await expect(page.getByTestId('tab-voice')).toBeVisible();
  await expect(page.getByTestId('tab-evolve')).toHaveCount(0);
  await expect(page.getByTestId('mode-classic')).toHaveClass(/on/);
  expect(errors).toEqual([]);
});

test('create a pattern: paint, erase, flam, undo', async ({ page }) => {
  await boot(page);
  await freshProject(page);
  const cell = page.getByTestId('cell-KICK-0');
  await expect(cell).toHaveAttribute('data-state', 'empty');
  await cell.click();
  await expect(cell).toHaveAttribute('data-state', /hit/);
  await page.keyboard.press('5');
  await page.getByTestId('cell-SNARE-4').click();
  await expect(page.getByTestId('cell-SNARE-4').locator('.hit.acc')).toHaveCount(1);
  // Drag paints a run.
  const a = await page.getByTestId('cell-CL HAT-0').boundingBox();
  const b = await page.getByTestId('cell-CL HAT-7').boundingBox();
  await page.keyboard.press('2');
  await page.mouse.move(a!.x + 5, a!.y + 5);
  await page.mouse.down();
  await page.mouse.move(b!.x + 5, b!.y + 5, { steps: 12 });
  await page.mouse.up();
  for (let i = 0; i < 8; i++) await expect(page.getByTestId(`cell-CL HAT-${i}`)).toHaveAttribute('data-state', /hit/);
  // Right-click erases; Alt-click flams.
  await page.getByTestId('cell-CL HAT-7').click({ button: 'right' });
  await expect(page.getByTestId('cell-CL HAT-7')).toHaveAttribute('data-state', 'empty');
  await page.getByTestId('cell-KICK-0').click({ modifiers: ['Alt'] });
  await expect(page.getByTestId('cell-KICK-0').locator('.fl')).toHaveCount(1);
  // Undo the flam, the erase and the run.
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('cell-KICK-0').locator('.fl')).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('cell-CL HAT-7')).toHaveAttribute('data-state', /hit/);
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('cell-CL HAT-3')).toHaveAttribute('data-state', 'empty');
});

test('space plays and stops, Return plays and pauses, and the top bar does not move', async ({ page }) => {
  await boot(page);
  const body = page.locator('body');
  const layout = () =>
    page.evaluate(() =>
      ['play', 'tempo', 'position', 'mode-classic', 'mode-extended', 'open-midi', 'open-file'].map((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.width)];
      }),
    );
  const atRest = await layout();
  await page.keyboard.press(' ');
  await expect(body).toHaveAttribute('data-transport', 'playing');
  expect(await layout()).toEqual(atRest);
  await page.keyboard.press(' ');
  await expect(body).toHaveAttribute('data-transport', 'stopped');
  await page.keyboard.press('Enter');
  await expect(body).toHaveAttribute('data-transport', 'playing');
  await expect(page.getByTestId('play')).toHaveText('PAUSE');
  expect(await layout()).toEqual(atRest);
  await page.keyboard.press('Enter');
  await expect(body).toHaveAttribute('data-transport', 'paused');
  await expect(page.getByTestId('play')).toHaveText('CONTINUE');
  expect(await layout()).toEqual(atRest);
  await page.keyboard.press('Enter');
  await expect(body).toHaveAttribute('data-transport', 'playing');
  // A mouse click leaves focus on the button; Return still drives the transport.
  await page.getByTestId('mode-classic').click();
  await page.keyboard.press('Enter');
  await expect(body).toHaveAttribute('data-transport', 'paused');
  await page.keyboard.press(' ');
  await expect(body).toHaveAttribute('data-transport', 'playing');
  await page.keyboard.press(' ');
  await expect(body).toHaveAttribute('data-transport', 'stopped');
});

test('play and stop: notes reach the MIDI output on time, stop leaves nothing hanging', async ({ page }) => {
  await boot(page);
  await freshProject(page);
  for (const s of [0, 4, 8, 12]) await page.getByTestId(`cell-KICK-${s}`).click();
  await routeToMidi(page);
  await midi(page).reset();
  await page.getByTestId('play').click();
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'playing');
  await expect(page.getByTestId('play')).toHaveText('PAUSE');
  await page.waitForTimeout(2200);
  await page.getByTestId('stop').click();
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'stopped');
  const sent = await midi(page).sent();
  const kicks = sent.filter((m) => isOn(m) && m.bytes[1] === 36 && (m.bytes[0]! & 0x0f) === 9);
  expect(kicks.length).toBeGreaterThanOrEqual(3);
  const gaps = kicks.slice(1).map((k, i) => k.t - kicks[i]!.t);
  for (const g of gaps) expect(Math.abs(g - 500)).toBeLessThan(1); // quarter notes at 120 BPM, exact timestamps
  expect(hanging(sent)).toEqual([]);
});

test('fills: generated notes appear on the grid and in the MIDI output, without writing into the pattern', async ({ page }) => {
  await boot(page);
  await freshProject(page);
  await page.keyboard.press('5');
  await page.getByTestId('cell-SNARE-4').click();
  await page.getByTestId('cell-SNARE-12').click();
  await page.getByTestId('voice-SNARE').click();
  await page.getByTestId('tab-fill').click();
  await page.getByTestId('fill-on').click();
  await page.getByTestId('fill-amount').fill('100');
  await page.getByTestId('fill-sound').selectOption({ label: 'MID TOM' });
  await expect(page.locator('[data-testid^="cell-SNARE-"] .g').first()).toBeVisible();
  await expect(page.getByTestId('cell-SNARE-11')).toHaveAttribute('data-state', /gen/);
  await expect(page.getByTestId('cell-SNARE-11')).not.toHaveAttribute('data-state', /hit/);
  await routeToMidi(page);
  await midi(page).reset();
  await page.getByTestId('play').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('stop').click();
  const sent = await midi(page).sent();
  expect(sent.filter((m) => isOn(m) && m.bytes[1] === 47).length).toBeGreaterThan(3); // MID TOM plays the fill
  await expect(page.getByTestId('feed')).toBeVisible();
});

test('density: suppressed hits are shown, fewer notes play, the source is kept', async ({ page }) => {
  await boot(page);
  await freshProject(page);
  const a = await page.getByTestId('cell-CL HAT-0').boundingBox();
  const b = await page.getByTestId('cell-CL HAT-15').boundingBox();
  await page.mouse.move(a!.x + 5, a!.y + 5);
  await page.mouse.down();
  await page.mouse.move(b!.x + 5, b!.y + 5, { steps: 20 });
  await page.mouse.up();
  await page.getByTestId('voice-CL HAT').click();
  await page.getByTestId('tab-time').click();
  await page.getByTestId('density').fill('40');
  await expect(page.locator('[data-testid^="cell-CL HAT-"][data-state*="sup"]').first()).toBeVisible();
  const sup = await page.locator('[data-testid^="cell-CL HAT-"][data-state*="sup"]').count();
  expect(sup).toBeGreaterThan(3);
  await page.getByTestId('density').fill('100');
  await expect(page.locator('[data-testid^="cell-CL HAT-"][data-state*="sup"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="cell-CL HAT-"][data-state^="hit"]')).toHaveCount(16);
});

test('Extended: evolution mutates while playing, the monitor shows the generation, SOURCE and CLASSIC return to the original', async ({ page }) => {
  await boot(page);
  await page.getByTestId('side-mode-pattern').click();
  await page.getByTestId('mode-extended').click();
  await expect(page.getByTestId('tab-evolve')).toBeVisible();
  await page.getByTestId('tab-evolve').click();
  await page.getByTestId('evolve-on').click();
  await page.getByTestId('evolve-every-dec').click();
  await page.getByTestId('evolve-strength').fill('90');
  await page.getByTestId('tempo').fill('240');
  await page.getByTestId('tempo').press('Enter');
  await page.getByTestId('play').click();
  await expect(page.getByTestId('now-generation')).not.toHaveText(/SOURCE|–/, { timeout: 8000 });
  await expect(page.locator('.cell[data-state*="added"], .cell[data-state*="changed"], .cell[data-state*="sup"]').first()).toBeVisible();
  await expect(page.getByTestId('feed')).toContainText('GEN');
  await page.getByTestId('source').click();
  await expect(page.getByTestId('grid-banner')).toContainText('SOURCE ONLY');
  await page.getByTestId('source').click();
  await page.getByTestId('mode-classic').click();
  await expect(page.getByTestId('tab-evolve')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(page.locator('.cell[data-state*="added"], .cell[data-state*="changed"]')).toHaveCount(0);
  await page.getByTestId('stop').click();
});

test('Extended: Euclid, breeding audition, morph and rules work from the interface', async ({ page }) => {
  await boot(page);
  await page.getByTestId('mode-extended').click();
  // Euclid into the cowbell.
  await page.getByTestId('voice-COWBELL').click();
  await page.getByTestId('tab-euclid').click();
  await page.getByTestId('eu-hits').fill('5');
  await page.getByTestId('eu-hits').press('Enter');
  await page.getByTestId('eu-apply').click();
  await expect(page.locator('[data-testid^="cell-COWBELL-"][data-state^="hit"]')).toHaveCount(5);
  // Breed with the second pattern and keep the child.
  await page.getByTestId('tab-breed').click();
  await page.getByTestId('breed-audition').click();
  await expect(page.getByTestId('grid-banner')).toContainText('AUDITION');
  await page.getByTestId('breed-keep').click();
  await expect(page.locator('.prow')).toHaveCount(3);
  // A rule.
  await page.getByTestId('tab-rules').click();
  await page.getByTestId('add-rule').click();
  await expect(page.getByTestId('rule-0')).toBeVisible();
  // Morph while playing.
  await page.getByTestId('play').click();
  await page.getByTestId('tab-morph').click();
  await page.getByTestId('morph-bars-4').click();
  await page.getByTestId('morph-start').click();
  await expect(page.getByTestId('feed')).toContainText('MORPH', { timeout: 6000 });
  await page.getByTestId('stop').click();
});

test('save, reload (autosave) and reopen from the browser library', async ({ page }) => {
  await boot(page);
  await freshProject(page);
  await page.getByTestId('cell-KICK-3').click();
  await page.getByTestId('open-file').click();
  await page.getByTestId('project-name').fill('MY GROOVE');
  await page.getByTestId('save-library').click();
  await page.getByTestId('dialog-close').click();
  await page.getByTestId('cell-KICK-5').click();
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByTestId('cell-KICK-3')).toHaveAttribute('data-state', /hit/);
  await expect(page.getByTestId('cell-KICK-5')).toHaveAttribute('data-state', /hit/);
  await page.getByTestId('open-file').click();
  await page.getByTestId('open-MY GROOVE').click();
  await expect(page.getByTestId('cell-KICK-3')).toHaveAttribute('data-state', /hit/);
  await expect(page.getByTestId('cell-KICK-5')).toHaveAttribute('data-state', 'empty');
});

test('export a project and a MIDI file, import the project back', async ({ page }) => {
  await boot(page);
  await page.getByTestId('open-file').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-project').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.downbeat\.json$/);
  const path = await dl.path();
  const text = readFileSync(path!, 'utf8');
  expect(JSON.parse(text).format).toBe('downbeat-project');
  const [mid] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-performance').click()]);
  expect(mid.suggestedFilename()).toMatch(/\.mid$/);
  const bytes = readFileSync((await mid.path())!);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('MThd');
  await page.getByTestId('demo-poly').click();
  await expect(page.getByTestId('pattern-CYCLES')).toBeVisible();
  await page.getByTestId('open-file').click();
  await page.getByTestId('import-project').setInputFiles({ name: 'p.downbeat.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByTestId('pattern-ELECTRO A')).toBeVisible();
});

test('palettes change colours (never the music) and persist', async ({ page }) => {
  await boot(page);
  await page.getByTestId('open-palette').click();
  await page.getByTestId('palette-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(0, 0, 0)');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'dark');
  // In the 1-bit palette every filled control must still be readable.
  await page.getByTestId('open-palette').click();
  await page.getByTestId('palette-classic').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('s-SNARE').click();
  await page.getByTestId('lock').click();
  for (const sel of ['.vl.sel .name', '.tool.sel', '.vl button.ms.on[data-k="s"]', '.perf button.on[data-testid="lock"]', '.banner', '.mode .seg button.on']) {
    const c = await page.locator(sel).first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return [cs.color, cs.backgroundColor];
    });
    expect(c[0], sel).not.toBe(c[1]);
  }
});

test('MIDI routing: clock out sends 24 PPQN and transport; unplugging the device is survived', async ({ page }) => {
  const errors = await boot(page);
  await routeToMidi(page);
  await page.getByTestId('clock-out').click();
  await midi(page).reset();
  await page.getByTestId('play').click();
  await page.waitForTimeout(1200);
  await page.getByTestId('play').click(); // pause
  await page.waitForTimeout(200);
  const sent = await midi(page).sent();
  expect(sent.filter((m) => m.bytes[0] === 0xfa).length).toBe(1);
  expect(sent.filter((m) => m.bytes[0] === 0xfc).length).toBe(1);
  const clocks = sent.filter((m) => m.bytes[0] === 0xf8).map((m) => m.t);
  const per = 60000 / (124 * 24);
  for (let i = 1; i < clocks.length; i++) expect(Math.abs(clocks[i]! - clocks[i - 1]! - per)).toBeLessThan(0.01);
  await page.getByTestId('play').click(); // continue
  await page.waitForTimeout(300);
  expect((await midi(page).sent()).filter((m) => m.bytes[0] === 0xfb).length).toBe(1);
  await midi(page).unplugOut();
  await expect(page.getByTestId('midi-status')).toHaveText('OUT LOST');
  await page.waitForTimeout(300);
  await page.getByTestId('stop').click();
  expect(errors).toEqual([]);
});

test('external clock: clock alone does not start; Start / Stop / Continue drive the transport', async ({ page }) => {
  await boot(page);
  await routeToMidi(page);
  await page.getByTestId('open-midi').click();
  await page.getByTestId('midi-in').selectOption('fake-in');
  await page.getByTestId('clock-source-external').click();
  await page.getByTestId('dialog-close').click();
  await expect(page.getByTestId('sync-status')).toHaveText('EXT WAITING');
  await midi(page).clockStart(120);
  await expect(page.getByTestId('sync-status')).toHaveText('EXT CLOCK');
  await midi(page).reset();
  await page.waitForTimeout(500);
  expect((await midi(page).sent()).filter(isOn)).toEqual([]);
  await midi(page).sendIn([0xfa]);
  await expect(page.getByTestId('sync-status')).toHaveText('EXT RUNNING');
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'playing');
  await page.waitForTimeout(1200);
  expect((await midi(page).sent()).filter(isOn).length).toBeGreaterThan(4);
  await midi(page).sendIn([0xfc]);
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'paused');
  await page.waitForTimeout(200);
  expect(hanging(await midi(page).sent())).toEqual([]);
  await midi(page).sendIn([0xfb]);
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'playing');
  await midi(page).clockStop();
  await expect(page.getByTestId('sync-status')).toHaveText('EXT LOST', { timeout: 3000 });
});

test('drum map: change a voice\'s MIDI note by typing, by name and by LEARN; MIDI output follows', async ({ page }) => {
  const errors = await boot(page);
  await freshProject(page);
  await page.getByTestId('cell-KICK-0').click();
  await routeToMidi(page);
  await page.getByTestId('open-midi').click();
  await expect(page.getByTestId('drum-map')).toBeVisible();
  // Type a number.
  await page.getByTestId('dm-note-KICK').fill('48');
  await page.getByTestId('dm-note-KICK').press('Enter');
  await expect(page.getByTestId('dm-note-KICK-name')).toHaveText('C2');
  // A name, and a semitone step.
  await page.getByTestId('dm-note-SNARE').fill('E1');
  await page.getByTestId('dm-note-SNARE').press('Enter');
  await page.getByTestId('dm-note-SNARE-inc').click();
  await expect(page.getByTestId('dm-note-SNARE')).toHaveValue('41');
  // A bad entry is refused and the field restored.
  await page.getByTestId('dm-note-CLAP').fill('nonsense');
  await page.getByTestId('dm-note-CLAP').press('Enter');
  await expect(page.getByTestId('dm-note-CLAP')).toHaveValue('39');
  // Channel.
  await page.getByTestId('dm-ch-KICK').selectOption('3');
  // LEARN from the MIDI input.
  await page.getByTestId('midi-in').selectOption('fake-in');
  await page.getByTestId('dm-note-CL HAT-learn').click();
  await expect(page.getByTestId('dm-note-CL HAT-learn')).toHaveClass(/on/);
  await midi(page).sendIn([0x99, 51, 100]);
  await expect(page.getByTestId('dm-note-CL HAT')).toHaveValue('51');
  await expect(page.getByTestId('dm-note-CL HAT-learn')).not.toHaveClass(/on/);
  await page.getByTestId('dialog-close').click();
  // The VOICE tab shows the same note.
  await page.getByTestId('voice-KICK').click();
  await page.getByTestId('tab-voice').click();
  await expect(page.getByTestId('step-1')).toHaveValue('48');
  // Played notes use the new channel and note.
  await midi(page).reset();
  await page.getByTestId('play').click();
  await page.waitForTimeout(800);
  await page.getByTestId('stop').click();
  const ons = (await midi(page).sent()).filter(isOn);
  expect(ons.some((m) => m.bytes[0] === 0x92 && m.bytes[1] === 48)).toBe(true);
  expect(ons.some((m) => m.bytes[1] === 36)).toBe(false);
  expect(errors).toEqual([]);
});

test('song playback: the grid follows without the banner flashing; FOLLOW off keeps your pattern; long patterns scroll with the playhead', async ({ page }) => {
  const errors = await boot(page);
  // The electro demo: a song of ELECTRO A and ELECTRO B. Make it alternate every bar.
  await page.getByTestId('tab-song').click();
  await page.getByTestId('song-rep-0').fill('1');
  await page.getByTestId('song-rep-0').press('Enter');
  await page.getByTestId('tempo').fill('200');
  await page.getByTestId('tempo').press('Enter');
  // Record the banner on every animation frame while the song plays.
  await page.evaluate(() => {
    const w = window as unknown as { __flashes: string[] };
    w.__flashes = [];
    const tick = () => {
      const b = document.querySelector('[data-testid="grid-banner"]') as HTMLElement | null;
      if (b && !b.hidden) w.__flashes.push(b.textContent ?? '');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByTestId('play').click();
  await page.waitForTimeout(4000);
  const flashes = await page.evaluate(() => (window as unknown as { __flashes: string[] }).__flashes);
  expect(flashes).toEqual([]);
  // The grid followed both patterns.
  await expect(page.getByTestId('follow')).toHaveClass(/on/);
  // Choosing a pattern while the song plays turns FOLLOW off and the view stays put.
  await page.getByTestId('pattern-ELECTRO B').click();
  await expect(page.getByTestId('follow')).not.toHaveClass(/on/);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('pattern-ELECTRO B')).toHaveClass(/sel/);
  await expect(page.getByTestId('grid-banner')).toContainText('YOU ARE EDITING ELECTRO B');
  // FOLLOW on again: back to following the song.
  await page.getByTestId('follow').click();
  await expect(page.getByTestId('follow')).toHaveClass(/on/);
  await page.getByTestId('stop').click();
  // A 64-step pattern at phone width scrolls with the playhead while FOLLOW is on.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('side-mode-pattern').click();
  await page.getByTestId('tab-pattern').click();
  await page.getByTestId('bars-inc').click();
  await page.getByTestId('bars-inc').click();
  await page.getByTestId('bars-inc').click();
  await page.getByTestId('play').click();
  await page.waitForFunction(() => (document.querySelector('.gridwrap') as HTMLElement).scrollLeft > 100, null, { timeout: 8000 });
  await page.getByTestId('stop').click();
  expect(errors).toEqual([]);
});

test('responsive: usable at phone width without horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByTestId('cell-KICK-1').scrollIntoViewIfNeeded();
  await page.getByTestId('cell-KICK-1').click();
  await expect(page.getByTestId('cell-KICK-1')).toHaveAttribute('data-state', /hit/);
  await expect(page.getByTestId('play')).toBeVisible();
});
