/**
 * 01-quick-start.spec.ts — the README hero demo.
 *
 * Captures: open atelier, configure Settings with a local gateway URL,
 * send the canonical "what time is it in Tokyo right now?" message,
 * watch it stream a real reply with tool-call usage.
 *
 * Targets the live atelier.example.com deployment (override via
 * `ATELIER_URL` env var). If your deployment is PIN-gated, pass
 * `ATELIER_PIN_COOKIE` so the test can authenticate.
 *
 * Output: videos/01-quick-start/<test-hash>.webm
 */

import { test, expect } from '@playwright/test';

const ATELIER_URL  = process.env.ATELIER_URL  ?? 'http://localhost:5173';
const GATEWAY_URL  = process.env.GATEWAY_URL  ?? 'http://localhost:8008';
const GATEWAY_KEY  = process.env.GATEWAY_KEY  ?? 'sk-replace-me';
const TOOLS_URL    = process.env.TOOLS_URL    ?? 'http://localhost:8051';
const PIN_COOKIE   = process.env.ATELIER_PIN_COOKIE; // optional

test.describe('Atelier — quick start', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('open, configure, send first message, receive streaming reply', async ({
    page,
    context,
  }) => {
    if (PIN_COOKIE) {
      await context.addCookies([
        {
          name: 'gate',
          value: PIN_COOKIE,
          url: ATELIER_URL,
        },
      ]);
    }

    // Force light theme + clear any prior config so the demo starts clean
    await context.addInitScript(() => {
      localStorage.setItem('nandai-chat:theme', 'light');
      localStorage.removeItem('nandai-chat:connection-v2');
    });

    await page.goto(ATELIER_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800); // let the first paint settle for the camera

    // Open Settings drawer
    await page.getByRole('button', { name: /settings/i }).click();
    await page.waitForTimeout(500);

    // Fill the connection fields
    await page.getByPlaceholder(/localhost:8008/).fill(GATEWAY_URL);
    await page.getByPlaceholder(/sk-/).fill(GATEWAY_KEY);

    // (Optional) tools URL
    const toolsInput = page.getByPlaceholder(/tools/);
    if (await toolsInput.count()) {
      await toolsInput.fill(TOOLS_URL);
    }

    await page.waitForTimeout(600);

    // Close the drawer (Escape works, or click the X)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Wait for the connection pill to flip to "online"
    const onlinePill = page.getByText(/Nandai-One online/i);
    await expect(onlinePill).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);

    // Type the canonical message
    const composer = page.getByRole('textbox', { name: /message/i });
    await composer.click();
    await composer.type('What time is it in Tokyo right now?', { delay: 30 });
    await page.waitForTimeout(400);

    // Send
    await composer.press('Enter');

    // Wait for streaming reply — assert the assistant bubble exists and
    // contains a Tokyo-time-shaped substring
    const assistantBubble = page
      .locator('[aria-busy="false"]')
      .filter({ has: page.getByText(/Tokyo|JST|UTC\+9/i) });
    await expect(assistantBubble).toBeVisible({ timeout: 30_000 });

    // Wait an extra beat so the camera captures the final state
    await page.waitForTimeout(2_000);

    // Sentinel pill should appear after the stream finishes
    const sentinelPill = page.getByText(/verdict|sentinel|audit/i).first();
    await expect(sentinelPill).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
  });
});
