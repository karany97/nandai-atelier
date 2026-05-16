/**
 * 02-tool-call.spec.ts — the "108 tools" demo.
 *
 * Captures: send a message that requires a tool call (e.g. "remember that
 * I prefer dark mode"), watch the tool-call card render with verbatim
 * JSON args + result. This is the proof-of-life for the MCP tool bridge.
 *
 * Output: videos/02-tool-call/<test-hash>.webm
 */

import { test, expect } from '@playwright/test';

const ATELIER_URL = process.env.ATELIER_URL ?? 'http://localhost:5173';
const PIN_COOKIE  = process.env.ATELIER_PIN_COOKIE;

test.describe('Atelier — tool call', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('send a memory-tool message, watch the tool card render', async ({
    page,
    context,
  }) => {
    if (PIN_COOKIE) {
      await context.addCookies([{
        name: 'gate', value: PIN_COOKIE, url: ATELIER_URL,
      }]);
    }
    await context.addInitScript(() => {
      localStorage.setItem('nandai-chat:theme', 'light');
    });

    await page.goto(ATELIER_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    // Confirm tools loaded (the connection pill mentions a tool count)
    await expect(page.getByText(/tools.*loaded/i)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);

    const composer = page.getByRole('textbox', { name: /message/i });
    await composer.click();
    await composer.type('Remember that I prefer dark mode and warm colors.', { delay: 35 });
    await page.waitForTimeout(400);
    await composer.press('Enter');

    // Wait for the tool-call card to render — it has the tool name + args
    const toolCard = page.getByText(/memory\.add_observations|create_entities/i).first();
    await expect(toolCard).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_200);

    // Expand the tool card to show the verbatim result JSON
    await toolCard.click();
    await page.waitForTimeout(2_500);
  });
});
