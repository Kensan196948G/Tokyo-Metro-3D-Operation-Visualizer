import { test, expect, type Page } from '@playwright/test';

async function scenePixels(page: Page): Promise<number[]> {
  return page.locator('#canvas-container canvas').evaluate(canvas => new Promise<number[]>(resolve => {
    requestAnimationFrame(() => {
      const copy = document.createElement('canvas');
      copy.width = 160;
      copy.height = 100;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(canvas as HTMLCanvasElement, 0, 0, 160, 100);
      resolve(Array.from(ctx.getImageData(0, 0, 160, 100).data));
    });
  }));
}

async function expectScene(page: Page): Promise<number[]> {
  const pixels = await scenePixels(page);
  const colors = new Set<string>();
  for (let i = 0; i < pixels.length; i += 4) colors.add(pixels.slice(i, i + 3).join(','));
  expect(colors.size).toBeGreaterThan(30);
  return pixels;
}

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
  await page.waitForTimeout(4000);
  const before = await expectScene(page);
  await page.waitForTimeout(1500);
  expect(await expectScene(page)).not.toEqual(before);

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

for (const malformed of [false, true]) test(`API failure preserves trains and recovers (malformed=${malformed})`, async ({ page }) => {
  test.setTimeout(55_000);
  await page.goto('/');
  await expect(page.locator('#train-count')).toHaveText(/^[1-9]\d*$/);
  const count = await page.locator('#train-count').textContent();
  const updated = await page.locator('#last-update').textContent();
  await page.route('**/api/realtime/trains', route => route.fulfill(malformed
    ? { json: { ok: true, data: {}, meta: { stale: false } } }
    : { status: 503, body: '{}' }));
  await expect(page.locator('#api-status')).toHaveText('未接続', { timeout: 20_000 });
  await expect(page.locator('#train-count')).toHaveText(count!);
  await expect(page.locator('#last-update')).toHaveText(updated!);
  await page.unroute('**/api/realtime/trains');
  await expect(page.locator('#api-status')).toHaveText('接続中', { timeout: 20_000 });
});

test('initial API failure recovers routes without reloading the page', async ({ page }) => {
  test.setTimeout(55_000);
  await page.route('**/api/stations', route => route.fulfill({ status: 503, body: '{}' }));
  // Initialization waits for every request, each with a 10-second timeout.
  await page.route('**/api/route-shapes', async route => {
    await new Promise(resolve => setTimeout(resolve, 6500));
    await route.continue();
  }, { times: 1 });
  await page.goto('/');
  await expect(page.locator('#api-status')).toHaveText('未接続', { timeout: 20_000 });
  await page.unroute('**/api/stations');
  await expect(page.locator('#line-list .line-row')).toHaveCount(14, { timeout: 20_000 });
  await expect(page.locator('#api-status')).toHaveText('接続中');
});

test('empty realtime data remains empty and station-based stale data is identified', async ({ page }) => {
  await page.route('**/api/realtime/trains', route => route.fulfill({ json: {
    ok: true, data: [], meta: { stale: false, generatedAt: new Date().toISOString() },
  } }));
  await page.goto('/');
  await expect(page.locator('#api-status')).toHaveText('接続中');
  await expect(page.locator('#train-count')).toHaveText('0');
  await expect(page.locator('#data-src')).toContainText('SOURCE');
  await page.unroute('**/api/realtime/trains');
  await page.route('**/api/realtime/trains', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.data = body.data.slice(0, 1).map((train: Record<string, unknown>) => ({
      ...train, positionSource: 'station-based',
    }));
    body.meta.stale = true;
    await route.fulfill({ json: body });
  });
  await expect(page.locator('#data-src')).toHaveText('STALE 前回データ', { timeout: 20_000 });
});

test('mobile viewport supports keyboard search and a visible scene', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#api-status')).toHaveText('接続中');
  await expect(page.locator('#canvas-container canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  const before = await expectScene(page);
  await page.locator('#search').fill('銀座');
  await expect(page.locator('#search-res')).toHaveClass(/show/);
  await page.locator('#search').press('Enter');
  await expect(page.locator('#search-res')).not.toHaveClass(/show/);
  await page.waitForTimeout(1800);
  expect(await expectScene(page)).not.toEqual(before);
  const bar = await page.locator('#timebar').boundingBox();
  expect(bar!.x).toBeGreaterThanOrEqual(0);
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'e2e-mobile.png' });
});
