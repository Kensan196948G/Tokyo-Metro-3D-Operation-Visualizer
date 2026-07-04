import { test, expect } from '@playwright/test';

/**
 * Smoke E2E against the single-service deployment (backend serving
 * frontend/dist). Runs in CI where headless Chromium works; the local dev
 * host has a known Chrome crash (Issue #9).
 */
test('3D visualizer boots and shows live data', async ({ page }) => {
  await page.goto('/');

  // Header + API connectivity indicator
  await expect(page.locator('#header h1')).toContainText('東京メトロ');
  await expect(page.locator('#api-status')).toHaveText('接続中');

  // All 9 lines listed in the route panel
  await expect(page.locator('#route-list .route-item')).toHaveCount(9);

  // WebGL canvas mounted
  await expect(page.locator('#canvas-container canvas')).toBeVisible();

  // Trains fetched and listed
  await expect(page.locator('#train-list .train-item').first()).toBeVisible();

  // Route toggle interaction: unchecking hides nothing in DOM but must not error
  const firstToggle = page.locator('#route-list .route-item input').first();
  await firstToggle.uncheck();
  await firstToggle.check();

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
