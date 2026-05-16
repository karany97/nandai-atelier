/**
 * playwright.config.ts — demo-recording config for atelier.
 *
 * Optimized for video capture (not test-suite running). Single browser,
 * headed, 1280×720 viewport, video saved per-test with deterministic naming.
 *
 * Run a single demo:
 *   pnpm exec playwright test demos/01-quick-start.spec.ts --config demos/playwright.config.ts
 *
 * Run all demos:
 *   pnpm exec playwright test demos/ --config demos/playwright.config.ts
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,           // one demo at a time so the video output is clean
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 90_000,

  use: {
    baseURL: process.env.ATELIER_URL ?? 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
    headless: false,              // run with a visible browser so we can see what's recorded
    actionTimeout: 10_000,
    navigationTimeout: 30_000,

    // Always record video — these specs ARE the demos
    video: {
      mode: 'on',
      size: { width: 1280, height: 720 },
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  outputDir: '../videos',          // → repo-root/videos/<test-name>/video.webm

  projects: [
    {
      name: 'chromium',
      use: {
        channel: 'chrome',         // use real Chrome so fonts + emoji render same as live
      },
    },
  ],
});
