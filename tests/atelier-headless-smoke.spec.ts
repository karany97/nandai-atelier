// atelier-headless-smoke.spec.ts
// Headless cacheless smoke test for https://atelier.nandai.org/
// Run: npx playwright test tests/atelier-headless-smoke.spec.ts
//
// Verifies (per Karan's spec 2026-05-16):
//   - PIN gate (1971) accepts and lands on the SPA
//   - Bundle loaded (<title> + React root w/ Atelier markers)
//   - Cache-Control header on root response is fully cache-bust
//   - Settings drawer opens (Cmd+,) and renders 6 sections
//   - Computer pane opens (Cmd+\) and exposes the DriverConsole input
//   - Goal submit hits driver, gets 202 + task_id, SSE connects <5s
//
// All artifacts on failure → tests/artifacts/

import { test, expect, type Page, type Response } from '@playwright/test';

const ATELIER_URL = 'https://atelier.nandai.org/';
const PIN = '1971';
const SETTINGS_SECTIONS = [
  /Local gateway/i,        // "Connection"  → Section title="Local gateway — Nandai-One"
  /Opus bridge/i,          // Section title="Opus bridge — Claude Code (Max sub)"
  /Computer/i,             // Section title="Computer — live desktop pane"
  /Model parameters/i,
  /System prompt/i,
  /Data & privacy/i,       // "Memory" maps to the data/privacy section (clear-memory lives here)
];

test.describe('atelier.nandai.org — headless cacheless smoke', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    // Force a clean storageState every test — no PIN cookie leaks across runs.
    storageState: { cookies: [], origins: [] },
  });

  test('full flow: gate → bundle → settings → computer → driver', async ({ page, context }) => {
    // ───── 1. Capture root response for Cache-Control assertion ─────
    let rootResponse: Response | null = null;
    page.on('response', (resp) => {
      const url = resp.url();
      // The SPA root after the gate redirect (status 200, content-type html)
      if (
        (url === ATELIER_URL || url === ATELIER_URL.replace(/\/$/, '')) &&
        resp.status() === 200
      ) {
        rootResponse = resp;
      }
    });

    // ───── 2. Navigate to the gate ─────
    const gateResp = await page.goto(ATELIER_URL, { waitUntil: 'domcontentloaded' });
    expect(gateResp, 'initial navigation should return a response').not.toBeNull();
    // The gate 302s to /pin?next=/, Playwright follows it
    await expect(page).toHaveURL(/\/pin/);

    // ───── 3. Submit the PIN ─────
    // mythos-gate form: <input name="pin" type="password"> + hidden next=/ + submit
    const pinInput = page.locator('input[name="pin"]');
    await expect(pinInput, 'PIN input should be visible').toBeVisible();
    await pinInput.fill(PIN);
    await Promise.all([
      page.waitForURL(ATELIER_URL, { timeout: 15_000 }),
      page.locator('form button[type="submit"]').click(),
    ]);

    // ───── 4. Verify the React bundle loaded ─────
    // index.html sets <title>Destiny Atelier</title>
    await expect(page).toHaveTitle(/Destiny Atelier|Nandai OS/);
    // #root is mounted by main.tsx — React must populate it
    const root = page.locator('#root');
    await expect(root, '#root should mount').toBeVisible();
    // SPA-specific marker: the "Skip to chat input" a11y link in App.tsx
    await expect(
      page.locator('a[href="#chat-input"]'),
      'A11y skip-link from App.tsx should render'
    ).toHaveCount(1);
    // Wait for the chat composer to settle (proxy for bundle hydration done)
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // ───── 5. Cache-Control must be cache-bust ─────
    expect(rootResponse, 'root 200 response should have been observed').not.toBeNull();
    const cc = (rootResponse as Response).headers()['cache-control'];
    expect(
      cc,
      'Cache-Control on root must be set so theme/UI changes reflect instantly'
    ).toBe('no-store, no-cache, must-revalidate, max-age=0');

    // ───── 6. Open Settings drawer via Cmd+, (Meta on macOS, Ctrl on Linux/Win) ─────
    // App.tsx binds both metaKey & ctrlKey, so Control+, works headlessly cross-OS.
    await page.keyboard.press('Control+,');
    const drawer = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(drawer, 'Settings drawer should open').toBeVisible({ timeout: 3_000 });
    // Title from SettingsDrawer.tsx:88 — <h2>Atelier · Settings</h2>
    await expect(drawer.locator('h2', { hasText: /Atelier · Settings/ })).toBeVisible();

    // ───── 7. All 6 required settings sections render ─────
    for (const re of SETTINGS_SECTIONS) {
      await expect(
        drawer.locator('h3').filter({ hasText: re }),
        `Settings section matching ${re} should render`
      ).toHaveCount(1);
    }

    // ───── 8. Close Settings (Escape) and open Computer pane (Cmd+\) ─────
    await page.keyboard.press('Escape');
    await expect(drawer, 'Settings should close on Escape').toBeHidden({ timeout: 2_000 });

    await page.keyboard.press('Control+\\');
    const computerPane = page.locator('aside[aria-label*="Computer"]');
    await expect(computerPane, 'Computer pane should open via Cmd+\\').toBeVisible({ timeout: 3_000 });

    // ───── 9. DriverConsole goal input present (recent commit ff8e167) ─────
    // DriverConsole.tsx: <input aria-label="Goal for the AI" placeholder="Tell the AI what to do…">
    const goalInput = computerPane.locator('input[aria-label="Goal for the AI"]');
    // The empty-state hint or the console must be visible — either path works
    // as long as the goal input is reachable.
    const emptyStateHeader = computerPane.locator('h3', {
      hasText: /Driver ready \(no visual desktop yet\)|No Computer configured/,
    });
    await expect
      .soft(emptyStateHeader, 'ComputerPane should render its empty-state header')
      .toBeVisible({ timeout: 3_000 });

    // If no driverUrl is configured in the deployed bundle, the goal input
    // won't render at all (DriverConsole is only mounted when cfg.driverUrl).
    // We assert visibility and capture the discrepancy clearly.
    await expect(
      goalInput,
      'DriverConsole goal input must be reachable for the smoke test'
    ).toBeVisible({ timeout: 3_000 });

    // ───── 10. Submit a no-op goal and verify driver wiring ─────
    // Capture the POST to /api/task — must return 202 with a JSON task_id.
    const taskRespP = page.waitForResponse(
      (r) => /\/api\/task$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 10_000 }
    );
    await goalInput.fill('smoke-test do not act');
    await page.locator('button[aria-label="Run task on desktop"]').click();
    const taskResp = await taskRespP;
    expect(taskResp.status(), 'driver /api/task should return 202').toBe(202);
    const taskBody = await taskResp.json();
    expect(taskBody, 'response body should contain a task_id').toHaveProperty('task_id');
    expect(typeof taskBody.task_id, 'task_id should be a string').toBe('string');

    // ───── 11. SSE stream connects within 5 s ─────
    const sseResp = await page.waitForResponse(
      (r) => new RegExp(`/api/task/${taskBody.task_id}/stream`).test(r.url()),
      { timeout: 5_000 }
    );
    expect(sseResp.status(), 'SSE stream should respond 200').toBe(200);
    expect(
      sseResp.headers()['content-type'] || '',
      'SSE response must be text/event-stream'
    ).toMatch(/text\/event-stream/);

    // ───── 12. Close cleanly ─────
    await context.close();
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== 'passed') {
      const path = testInfo.outputPath(`failure-${Date.now()}.png`);
      try {
        await page.screenshot({ path, fullPage: true });
        testInfo.attachments.push({ name: 'failure-screenshot', path, contentType: 'image/png' });
      } catch {
        /* page may already be closed */
      }
    }
  });
});
