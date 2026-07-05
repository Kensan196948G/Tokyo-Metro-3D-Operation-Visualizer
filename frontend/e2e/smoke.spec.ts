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

  // 9 metro + 5 JR lines listed, grouped under two operator headers
  await expect(page.locator('#line-list .line-row')).toHaveCount(14);
  await expect(page.locator('#line-list .line-group-head')).toHaveCount(2);

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

  // Station search: typing shows incremental results with line badges
  await page.locator('#search').fill('銀座');
  await expect(page.locator('#search-res .sr-item').first()).toBeVisible();
  await page.locator('#search').fill('');

  // Group master toggle: JR-East off -> its 5 rows dim, back on -> restored
  const jrToggle = page.locator('[data-group-toggle="JR-East"]');
  await jrToggle.click();
  await expect(page.locator('#line-list .line-row.off')).toHaveCount(5);
  await page.locator('[data-group-toggle="JR-East"]').click();
  await expect(page.locator('#line-list .line-row.off')).toHaveCount(0);

  // Camera preset buttons fly without errors
  await page.locator('.viewbtns button[data-view="top"]').click();
  await page.locator('.viewbtns button[data-view="bird"]').click();

  // Visual artifact for humans (uploaded from CI)
  await page.screenshot({ path: 'e2e-scene.png' });
});

test('driver cab mode enters and exits', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#train-count')).toHaveText(/^[1-9]\d*$/);

  // Whole-network driver button → cab overlay on, HUD populated
  await page.locator('#drive-btn').click();
  await expect(page.locator('#cab')).toHaveClass(/on/);
  await expect(page.locator('#cab-line')).not.toHaveText('—');
  await expect(page.locator('#cab-kmh')).toHaveText(/^\d+$/);

  // Cab view artifact for humans — wait past the early train refresh (3s)
  // so the screenshot catches the train in motion.
  await page.waitForTimeout(4200);
  await page.screenshot({ path: 'e2e-cab.png' });

  // ESC returns to the model view
  await page.keyboard.press('Escape');
  await expect(page.locator('#cab')).not.toHaveClass(/on/);
});

test('stations API is consistent with the scene', async ({ request }) => {
  const res = await request.get('/api/stations');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.data.length).toBeGreaterThanOrEqual(250);
});
