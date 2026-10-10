import { defineConfig, devices } from '@playwright/test';

// Locally, use the installed Google Chrome (nothing is downloaded); in CI,
// Playwright's own Chromium (installed by the workflow).
const useChrome = !process.env.CI && !process.env.DOWNBEAT_CHROMIUM;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4317',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    ...(useChrome ? { channel: 'chrome' } : {}),
    launchOptions: process.env.DOWNBEAT_CHROMIUM ? { executablePath: process.env.DOWNBEAT_CHROMIUM } : {},
    acceptDownloads: true,
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4317 --strictPort',
    url: 'http://127.0.0.1:4317',
    reuseExistingServer: !process.env.CI,
  },
});
