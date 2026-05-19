import { test, expect } from '@playwright/test';

// L'app YARAM utilise React + navigation custom : les liens produits ne sont
// PAS forcement des <a href="/product/X"> mais des <div onClick={navigate}>.
// Donc on teste plutot via les images de produits (qui sont systematiques).

test.describe('Catalogue', () => {
  test('Search rend des elements produits', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');
    // Attend au moins une image qui ressemble a un produit (img dans le DOM hydrate)
    await page.waitForFunction(
      () => document.querySelectorAll('img').length > 0,
      { timeout: 15_000 }
    );
    const imgCount = await page.locator('img').count();
    expect(imgCount).toBeGreaterThan(0);
  });

  test('Home affiche le contenu hydrate', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // #root contient du contenu apres hydratation React
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 });
    const rootHtml = await page.locator('#root').innerHTML();
    expect(rootHtml.length).toBeGreaterThan(500); // au moins du contenu
  });
});
