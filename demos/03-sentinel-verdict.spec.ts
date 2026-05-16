/**
 * 03-sentinel-verdict.spec.ts — the Sentinel explainer demo.
 *
 * Captures: after a reply finishes, the audit pill renders. Click it to
 * expand the 8-axis breakdown. This is the visual that backs the
 * "Sentinel — the 8-axis verdict daemon" section of the README.
 *
 * Output: videos/03-sentinel-verdict/<test-hash>.webm
 */

import { test, expect } from '@playwright/test';

const ATELIER_URL = process.env.ATELIER_URL ?? 'http://localhost:5173';
const PIN_COOKIE  = process.env.ATELIER_PIN_COOKIE;

test.describe('Atelier — Sentinel verdict', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('reply finishes, audit pill renders, expand to 8-axis breakdown', async ({
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

    const composer = page.getByRole('textbox', { name: /message/i });
    await composer.click();
    await composer.type('Explain quantum tunneling in 4 sentences.', { delay: 35 });
    await page.waitForTimeout(400);
    await composer.press('Enter');

    // Wait for the audit pill to appear (only shows after stream finishes)
    const auditPill = page
      .locator('button')
      .filter({ hasText: /verdict|sentinel|audit/i })
      .first();
    await expect(auditPill).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_500);

    // Click to expand
    await auditPill.click();
    await page.waitForTimeout(1_800);

    // The 8 axes should now be visible — wait a beat for the camera
    await expect(
      page.getByText(/factuality|instruction-following|tool-correctness/i).first()
    ).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(3_000);
  });
});
