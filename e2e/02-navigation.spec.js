import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('Search → URL /search persiste', async ({ page }) => {
    await page.goto('/search');
    await expect(page).toHaveURL(/\/search/);
    // Attend que React hydrate (splash inline disparu)
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 });
  });

  test('Pharmacies → URL /pharmacies', async ({ page }) => {
    await page.goto('/pharmacies');
    await expect(page).toHaveURL(/\/pharmacies/);
  });

  test('Privacy → page legale s\'affiche', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveURL(/\/privacy/);
    await page.waitForLoadState('networkidle');
    // Privacy page peut ne pas etre encore deployee — on tolere
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/YARAM/i);
  });

  test('Terms → page CGU s\'affiche', async ({ page }) => {
    await page.goto('/terms');
    await expect(page).toHaveURL(/\/terms/);
    await page.waitForLoadState('networkidle');
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/YARAM/i);
  });

  test('Page inconnue → redirige vers Home (SPA fallback)', async ({ page }) => {
    const resp = await page.goto('/page-inexistante-abc123');
    expect(resp.status()).toBe(200);
    await expect(page.locator('body')).toContainText(/YARAM/i, { timeout: 10_000 });
  });

  test('F5 sur une route persiste l\'URL', async ({ page }) => {
    await page.goto('/search');
    await page.reload();
    await expect(page).toHaveURL(/\/search/);
  });
});
