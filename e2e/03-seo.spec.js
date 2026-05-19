import { test, expect } from '@playwright/test';

test.describe('SEO & meta', () => {
  test('Home : meta description + canonical', async ({ page }) => {
    await page.goto('/');
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc).toBeTruthy();
    expect(desc.length).toBeGreaterThan(50);

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(/yaram\.app/);
  });

  test('Home : JSON-LD Organization', async ({ page }) => {
    await page.goto('/');
    const ldJson = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(ldJson).toContain('Organization');
    expect(ldJson).toContain('YARAM');
  });

  test('Open Graph tags presents', async ({ page }) => {
    await page.goto('/');
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content');
    expect(ogTitle).toBeTruthy();
    expect(ogImage).toMatch(/yaram\.app/);
    expect(ogUrl).toMatch(/yaram\.app/);
  });

  test('Sitemaps dynamiques OK', async ({ page }) => {
    // Sitemap index principal
    const idx = await page.request.get('/sitemap.xml');
    expect([200, 301, 302]).toContain(idx.status());

    // Sitemap produits (Cloudflare Function)
    const prods = await page.request.get('/sitemap-products.xml');
    expect(prods.status()).toBe(200);
    const xml = await prods.text();
    expect(xml).toContain('<urlset');
  });
});
