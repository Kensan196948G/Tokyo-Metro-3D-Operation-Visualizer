import { test, expect } from '@playwright/test';

/**
 * Smoke E2E against the single-service deployment (backend serving
 * frontend/dist). Runs in CI where headless Chromium works; the local dev
 * host has a known Chrome crash (Issue #9).
 *
 * Selectors target the reference-styled UI (Issue #15): brand wordmark,
 * `#line-list .line-row` line panel, `#train-count` live counter.
 */
test('3D visualizer boots and shows live data', async ({ page }) => {
  await page.goto('/');

  // Brand + subtitle (東京メトロ) and API connectivity indicator
  await expect(page.locator('.brand h1')).toContainText('METRO');
  await expect(page.locator('.brand p')).toContainText('東京メトロ');
  await expect(page.locator('#api-status')).toHaveText('接続中');

  // All 9 lines listed in the control panel
  await expect(page.locator('#line-list .line-row')).toHaveCount(9);

  // WebGL canvas mounted
  await expect(page.locator('#canvas-container canvas')).toBeVisible();

  // Trains fetched — live counter shows a positive number
  await expect(page.locator('#train-count')).toHaveText(/^[1-9]\d*$/);

  // Line toggle interaction: clicking a row flips its .off state twice
  const firstRow = page.locator('#line-list .line-row').first();
  await firstRow.click();
  await expect(firstRow).toHaveClass(/off/);
  await firstRow.click();
  await expect(firstRow).not.toHaveClass(/off/);

  // Visual artifact for humans (uploaded from CI)
  await page.screenshot({ path: 'e2e-scene.png' });
});

test('stations API is consistent with the scene', async ({ request }) => {
  const res = await request.get('/api/stations');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.data.length).toBeGreaterThanOrEqual(170);
});
