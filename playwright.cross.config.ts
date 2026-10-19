import { defineConfig, devices } from '@playwright/test';

// The cross-application portability test (tests/cross-app): DOWNBEAT and The Breakery, both
// built, served on two origins. BREAKERY_DIR is a checkout of The Breakery with `npm run build`
// done. Not part of CI (it needs the other application); run by hand: npm run test:cross.
const breakery = process.env.BREAKERY_DIR ?? '../the-breakery';

export default defineConfig({
  testDir: 'tests/cross-app',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: process.env.DOWNBEAT_CHROMIUM ? { executablePath: process.env.DOWNBEAT_CHROMIUM } : {},
    acceptDownloads: true,
  },
  webServer: [
    { command: 'npx vite preview --host 127.0.0.1 --port 4317 --strictPort', url: 'http://127.0.0.1:4317', reuseExistingServer: false },
    { command: 'npx vite preview --host 127.0.0.1 --port 4318 --strictPort', cwd: breakery, url: 'http://127.0.0.1:4318', reuseExistingServer: false },
  ],
});
