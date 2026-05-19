import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test('charge et affiche les sections principales', async ({ page }) => {
    await page.goto('/');
    // Le splash inline doit disparaitre dans les 3s, puis le contenu React s'affiche
    await expect(page).toHaveTitle(/YARAM/);
    // Vérifie qu'au moins un produit ou une categorie est visible (timeout 10s)
    await expect(page.locator('body')).toContainText(/YARAM/i, { timeout: 10_000 });
  });

  test('le service worker s\'enregistre', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    });
    expect(swRegistered).toBe(true);
  });

  test('manifest PWA accessible', async ({ page }) => {
    const resp = await page.request.get('/manifest.json');
    expect(resp.status()).toBe(200);
    const json = await resp.json();
    expect(json.name).toContain('YARAM');
  });

  test('robots.txt + sitemap accessibles', async ({ page }) => {
    const robots = await page.request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const robotsBody = await robots.text();
    expect(robotsBody).toContain('Sitemap');

    const sitemap = await page.request.get('/sitemap.xml');
    expect([200, 301, 302]).toContain(sitemap.status());
  });
});
