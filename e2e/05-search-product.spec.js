import { test, expect } from '@playwright/test';

test.describe('Catalogue', () => {
  test('Search affiche des resultats', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');
    // Attend qu'au moins 1 fiche produit apparaisse (timeout 10s)
    const productCards = page.locator('a[href*="/product/"], [class*="product"], [class*="card"]');
    await expect(productCards.first()).toBeVisible({ timeout: 10_000 });
  });

  test('Click produit ouvre la fiche detaillee', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');
    // Trouve le premier lien produit et click
    const firstProduct = page.locator('a[href*="/product/"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 10_000 });
    const href = await firstProduct.getAttribute('href');
    await firstProduct.click();
    await expect(page).toHaveURL(href);
  });

  test('Fiche produit a un JSON-LD Product', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');
    const firstProduct = page.locator('a[href*="/product/"]').first();
    if (await firstProduct.count() === 0) test.skip();
    await firstProduct.click();
    await page.waitForLoadState('networkidle');

    const ldJsonElements = page.locator('script[type="application/ld+json"]');
    const count = await ldJsonElements.count();
    let hasProductLd = false;
    for (let i = 0; i < count; i++) {
      const content = await ldJsonElements.nth(i).textContent();
      if (content && content.includes('Product')) { hasProductLd = true; break; }
    }
    expect(hasProductLd).toBe(true);
  });
});
