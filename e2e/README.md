# Tests E2E YARAM

Tests Playwright qui valident les flows critiques en navigateur réel.

## Lancer les tests

### Local (sur ton serveur dev)

```bash
npm install              # installe @playwright/test
npx playwright install   # télécharge les browsers (une seule fois)
npm run test:e2e         # lance tous les tests
npm run test:e2e:ui      # mode UI interactif (debugger visuel)
```

### Contre la prod

```bash
npm run test:e2e:prod    # BASE_URL=https://yaram.app
```

### Un seul fichier

```bash
npx playwright test e2e/04-rls-security.spec.js
```

### Un seul test

```bash
npx playwright test -g "anon ne peut PAS lire users_profile"
```

## Couverture actuelle

| Fichier | Quoi |
|---|---|
| 01-home.spec.js | Home charge, SW enregistre, manifest, robots.txt |
| 02-navigation.spec.js | Routes /search /pharmacies /privacy /terms + F5 + fallback SPA |
| 03-seo.spec.js | Meta description, canonical, OG, JSON-LD, sitemaps |
| 04-rls-security.spec.js | **Anti-regression RLS** — verifie que les 14 verrous tiennent |
| 05-search-product.spec.js | Catalogue + fiche produit + JSON-LD Product |
| 06-pwa-perf.spec.js | Icones PWA, FCP < 3s, pas d'erreur console |

## Ajouter un test

Crée `e2e/07-mon-test.spec.js` :

```js
import { test, expect } from '@playwright/test';

test('mon test', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
});
```

## CI

`.github/workflows/e2e-tests.yml` lance les smoke tests sur https://yaram.app à chaque push sur `main`. Si un test échoue, le job GitHub passe rouge et tu reçois une notif email.

Rapport HTML disponible dans Actions → run → Artifacts → `playwright-report`.

## Pourquoi ces tests-là

- **RLS** : c'est la fuite la plus catastrophique potentielle. Si quelqu'un re-introduit "Anyone can read" par erreur dans une future migration, le test 04 le détecte immédiatement.
- **SPA fallback** : F5 sur /product/abc doit servir index.html (sinon 404). Test 02.
- **SEO** : JSON-LD et meta tags sont fragiles, faciles à casser sans s'en rendre compte. Test 03.
- **PWA icones** : référencés dans le manifest, si un est manquant → install PWA cassé. Test 06.
