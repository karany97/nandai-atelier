// Minimal Playwright config for the atelier headless smoke suite.
// Karan's rule (2026-05-16): smoke tests run headless, cacheless, instant-reflect.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'tests/artifacts/report', open: 'never' }]],
  outputDir: 'tests/artifacts',
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Cache-bust at the protocol level: every request gets fresh bytes.
    extraHTTPHeaders: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    },
    bypassCSP: false,
  },
  projects: [
    { name: 'chromium-headless', use: { ...devices['Desktop Chrome'] } },
  ],
});
