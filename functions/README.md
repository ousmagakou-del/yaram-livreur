# Cloudflare Pages Functions

Ce dossier contient les fonctions edge déployées avec l'app sur Cloudflare Pages.
Elles s'exécutent **avant** que le SPA soit servi et permettent de générer du
HTML/XML dynamique sans avoir besoin de SSR.

## Fonctions actuelles

| Route                            | Rôle                                              |
|----------------------------------|---------------------------------------------------|
| `/sitemap-products.xml`          | Sitemap dynamique : toutes les fiches produits   |
| `/sitemap-pharmacies.xml`        | Sitemap dynamique : toutes les pharmacies actives |
| `/product/:id`                   | og: tags + JSON-LD Product **pour les bots**     |
| `/pharmacy/:id`                  | og: tags + JSON-LD Pharmacy **pour les bots**    |

Les humains qui ouvrent `/product/123` voient le SPA React normal. Seuls les
bots scrapers (Facebook, WhatsApp, Twitter, Google, etc., détectés via le
User-Agent) reçoivent le HTML enrichi avec les bonnes méta-tags et JSON-LD.

## Variables d'environnement (Cloudflare Pages settings)

À configurer dans **Cloudflare Dashboard → Pages → diaara → Settings → Environment variables**
pour les environnements **Production** ET **Preview** :

| Variable             | Valeur                                                  |
|----------------------|---------------------------------------------------------|
| `SUPABASE_URL`       | `https://qxhhnrnworwrnwmqekmb.supabase.co`              |
| `SUPABASE_ANON_KEY`  | (la clé anon publique — la même que dans le client JS)  |

Si non configurées, les fonctions utilisent un fallback hardcodé (cf `_lib.js`).
**Pour la production, configure-les côté Cloudflare** pour pouvoir roter la clé
sans devoir redéployer le code.

## Tester en local (optionnel)

Cloudflare Pages Functions tournent dans Wrangler :

```bash
npm install -g wrangler
npm run build
wrangler pages dev dist --compatibility-date=2024-01-01
```

Puis tester :
- http://localhost:8788/sitemap-products.xml
- `curl -A "facebookexternalhit/1.1" http://localhost:8788/product/[un-id]` → doit retourner du HTML avec les bons og:

## Tester en prod

```bash
# Sitemap (visible direct dans le navigateur)
open https://yaram.app/sitemap-products.xml

# og: dynamique (simule un bot)
curl -A "facebookexternalhit/1.1" https://yaram.app/product/[un-id] | grep og:

# Outil officiel Facebook :
# https://developers.facebook.com/tools/debug/?q=https://yaram.app/product/[un-id]
```

## Bots reconnus

Le User-Agent est matché contre cette regex (`_lib.js`) :
```
facebookexternalhit | whatsapp | twitterbot | linkedinbot | telegrambot
slackbot | discordbot | googlebot | bingbot | applebot | duckduckbot
baiduspider | yandex
```

## Performance / cache

- Sitemap : `Cache-Control: public, max-age=3600` (1 h cache edge + client)
- og: dynamique : `Cache-Control: public, max-age=300` (5 min, frais sans hammerer Supabase)

Cloudflare cache les réponses au niveau edge, donc le 2e bot qui scrape la
même URL dans la même heure ne hit pas Supabase.

## Ce qui n'est PAS géré (limites connues)

- **Images OG dynamiques** : on sert `p.img` direct. Si tu veux une image OG
  composée (photo produit + logo YARAM + prix surimprimé), il faut un service
  comme `@vercel/og` ou un Cloudflare Worker dédié à la génération d'images.
- **Bot detection** : basée sur User-Agent. Si Facebook change son UA, il
  faudra ajouter la nouvelle string à la regex.
