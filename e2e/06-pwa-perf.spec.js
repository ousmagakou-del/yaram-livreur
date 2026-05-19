import { test, expect } from '@playwright/test';

test.describe('PWA & perf', () => {
  test('icones PWA presents', async ({ page }) => {
    const icons = [
      '/favicon.svg',
      '/favicon-32.png',
      '/icon-192.png',
      '/icon-512.png',
      '/apple-touch-icon.png',
    ];
    for (const icon of icons) {
      const resp = await page.request.get(icon);
      expect.soft(resp.status(), `Icon ${icon} should be 200`).toBe(200);
    }
  });

  test('Home : First Contentful Paint < 3s', async ({ page }) => {
    await page.goto('/');
    const fcp = await page.evaluate(() => new Promise((resolve) => {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            resolve(entry.startTime);
          }
        }
      }).observe({ type: 'paint', buffered: true });
      // fallback si jamais l'event n'est pas declenche
      setTimeout(() => resolve(5000), 5000);
    }));
    expect(fcp).toBeLessThan(3000);
  });

  test('pas d\'erreur console au boot', async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // On tolere quelques warnings reseaux (SW, OG image preview)
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('manifest') &&
      !e.includes('og:image') &&
      !e.toLowerCase().includes('cors')
    );
    expect(criticalErrors).toEqual([]);
  });
});
