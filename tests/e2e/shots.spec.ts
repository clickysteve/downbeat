/**
 * Documentation screenshots of the real build. Skipped unless SHOTS=1:
 *   SHOTS=1 npx playwright test shots
 */
import { expect, test } from '@playwright/test';
import { installFakeMidi } from './fake-midi';

test.skip(!process.env.SHOTS, 'screenshots only on request');

test('documentation screenshots', async ({ page }) => {
  await page.addInitScript(installFakeMidi);
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('grid')).toBeVisible();
  const shot = (name: string, el?: string) => (el ? page.locator(el).first().screenshot({ path: `docs/images/${name}.png` }) : page.screenshot({ path: `docs/images/${name}.png` }));

  // 1. The electro demo, stopped: the grid with its preview.
  await page.getByTestId('voice-SNARE').click();
  await page.getByTestId('tab-fill').click();
  await shot('classic-fill', '[data-testid="grid-panel"]');

  // 2. Jungle demo playing in EXTENDED mode.
  await page.getByTestId('open-file').click();
  await page.getByTestId('demo-jungle').click();
  await page.getByTestId('tab-evolve').click();
  await page.getByTestId('play').click();
  await page.waitForTimeout(7000);
  await shot('downbeat');
  await page.getByTestId('play').click();
  await shot('extended-evolve', '[data-testid="panels"]');
  await page.getByTestId('stop').click();

  // 3. Polymetric demo playing: per-row playheads.
  await page.getByTestId('open-file').click();
  await page.getByTestId('demo-poly').click();
  await page.getByTestId('play').click();
  await page.waitForTimeout(3100);
  await page.getByTestId('play').click();
  await shot('polymeter', '[data-testid="grid-panel"]');
  await page.getByTestId('stop').click();

  // 4. MIDI dialog.
  await page.getByTestId('open-midi').click();
  await page.getByTestId('enable-midi').click();
  await page.getByTestId('dlg-output-both').click();
  await page.getByTestId('midi-out').selectOption('fake-out');
  await shot('midi', '[data-testid="midi-dialog"]');
  await page.getByTestId('dialog-close').click();

  // 5. A fresh project being written.
  await page.getByTestId('open-file').click();
  await page.getByTestId('new-project').click();
  await shot('new-project', '[data-testid="grid-panel"]');
});
