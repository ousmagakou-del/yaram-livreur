# YARAM · Setup PostHog Analytics

Guide pas à pas pour activer le tracking PostHog en production.

---

## 1. Créer un compte PostHog

1. Aller sur https://posthog.com
2. Cliquer sur **Get started free** (1 million d'events / mois gratuits, largement suffisant pour démarrer)
3. Choisir la région **EU** lors de la création du compte → important pour la conformité RGPD (données hébergées en Europe, pas aux USA)

---

## 2. Créer un projet "YARAM"

1. Dans le dashboard PostHog, cliquer sur **+ New project**
2. Nom : `YARAM`
3. Plateforme : **Web** (la même clé fonctionne pour iOS via Capacitor, c'est le même JS bundle)

---

## 3. Récupérer la Project API Key

1. Dans PostHog : **Project Settings → Project API Key**
2. Format : `phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
3. Noter aussi l'API host : `https://eu.i.posthog.com` (région EU)

---

## 4. Configurer les variables d'environnement Cloudflare Pages

1. Aller sur Cloudflare Pages → projet **yaram** → **Settings → Environment variables**
2. Ajouter pour **Production** (et Preview si souhaité) :

```
VITE_POSTHOG_KEY = phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_POSTHOG_HOST = https://eu.i.posthog.com
```

3. Sauvegarder.

---

## 5. Configurer pour les builds iOS / Capacitor (optionnel)

Pour que le tracking soit actif sur les builds iOS locaux, ajouter dans `/Users/ousmanegakou/Documents/diaara/.env.local` :

```
VITE_POSTHOG_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_POSTHOG_HOST=https://eu.i.posthog.com
```

⚠️ Ne PAS commit `.env.local` (déjà dans `.gitignore` normalement).

---

## 6. Redéployer

- Cloudflare Pages : push sur `main` → build auto avec les nouvelles env vars
- iOS : `npm run build && npx cap sync ios && npx cap open ios` puis Archive dans Xcode

⚠️ **Important** : PostHog n'envoie des events QUE en `MODE === 'production'` (cf. `src/lib/analytics.js`). En `npm run dev`, rien n'est envoyé → tu peux dev sans polluer les stats.

---

## 7. Events trackés automatiquement

L'app envoie ces events à PostHog :

### Lifecycle
- `app_opened` (boot)
- `$pageview` (chaque navigation, avec `{ route }`)

### Auth
- `signup_started` / `signup_completed` / `signup_failed` ({ method: email|google|apple })
- `login_started` / `login_completed` / `login_failed`

### Browsing
- `home_viewed`
- `category_clicked` ({ category, name })
- `pharmacy_clicked` ({ pharmacy_id, pharmacy_name })
- `banner_clicked` ({ banner_id, link_type, link_target })
- `product_viewed` ({ product_id, name, brand, price, category })

### Cart
- `product_added_to_cart` ({ product_id, name, price, qty, pharmacy_id })
- `product_removed_from_cart` ({ product_id })
- `cart_viewed` ({ items_count, total, has_preorder })

### Checkout / Payment
- `checkout_started` ({ items_count, total, payment_method })
- `promo_code_applied` ({ code, discount_amount })
- `promo_code_failed` ({ code, reason })
- `order_completed` ({ order_id, total, payment_method })
- `payment_started` ({ order_id, method, amount })
- `payment_succeeded` ({ order_id, method, amount, status })
- `payment_failed` ({ order_id, method, reason })

### Identité user
- À login : `identify(user_id, { email, first_name, city, created_at })`
- À logout : `reset()` (anonymise la session)

---

## 8. Premiers Insights à créer dans PostHog

Une fois les events qui arrivent (compter ~5-10 min après le 1er déploiement), créer ces vues :

### Funnel "Acquisition → Achat"
**Insights → New Funnel** :
1. `app_opened`
2. `signup_completed` OU `login_completed`
3. `product_viewed`
4. `product_added_to_cart`
5. `checkout_started`
6. `payment_succeeded`

→ Tu verras où ça drop. Probablement entre cart→checkout (friction adresse).

### Funnel Onboarding pure
1. `signup_started` → `signup_completed` → `home_viewed`

### Retention curve
- **Insights → Retention** : event `home_viewed`, fenêtre = 7 jours.

### Top products viewed
- **Insights → Trends** : event `product_viewed`, breakdown par `name` ou `product_id`.

### Top categories
- Trends event `category_clicked`, breakdown par `category`.

### Top pharmacies
- Trends event `pharmacy_clicked`, breakdown par `pharmacy_name`.

### Promo code performance
- Trends event `promo_code_applied`, breakdown par `code`.

### Payment method split
- Trends event `payment_succeeded`, breakdown par `method`.

---

## 9. Cohorts utiles

### "Acheteuses fidèles" (3+ commandes)
**Cohorts → New cohort** → condition :
- Event `payment_succeeded` performed **at least 3 times** in **last 90 days**.

### "Drop-off panier" (panier vu sans checkout sur 7j)
- Event `cart_viewed` performed **at least 1 time** in last 7 days
- AND event `checkout_started` performed **= 0 times** in last 7 days

→ Cible parfaite pour une campagne WhatsApp "ton panier t'attend".

### "Power scanners"
- Event `scan_completed` performed **at least 5 times** ever.

### "Cherrypickers promo"
- Event `promo_code_applied` performed **at least 3 times** in last 30 days
- → Filtre pour A/B test : retirer certains codes pour ce groupe.

---

## 10. Vérifier que ça marche

1. Ouvrir https://yaram.app en prod sur ton mobile
2. Naviguer Home → Product → Cart
3. Dans PostHog → **Activity** (live events stream)
4. Tu dois voir tes events arriver en temps réel avec ton `distinct_id` (anonyme tant que pas login).
5. Login → tu verras `identify` puis tous tes events suivants attachés à ton `user_id` (et tes events précédents auto-mergés via alias).

---

## 11. Privacy / RGPD

- Région EU activée → données hébergées en Allemagne (Frankfurt).
- `respect_dnt: true` → on désactive automatiquement si l'user a Do Not Track activé dans son browser.
- `session_recording: { maskAllInputs: true }` → si tu actives le replay plus tard, les champs input (email, password, phone) sont masqués automatiquement.
- `autocapture: false` → on ne track que les events explicites listés ci-dessus, jamais de capture aveugle des clicks.

Pour activer le **session replay** (optionnel, 5000 sessions / mois gratuites) :
- PostHog → Project Settings → Recordings → Enable.
- Côté code : changer `session_recording: { ... }` en `{ recordCrossOriginIframes: false, maskAllInputs: true }` et ajouter `disable_session_recording: false`.

---

## 12. Coûts à surveiller

- Tier gratuit : **1M events/mois + 5K sessions replay/mois**.
- Avec ~1000 users actifs/mois × ~30 events chacun = 30K events → très loin du plafond.
- Si dépassement : passe à $0.000248 / event au-delà = ~$25 pour 100K events bonus.

---

## 13. Désactivation rapide en cas de problème

Si tu veux killer PostHog instantanément (bug, fuite data, etc.) :
- Cloudflare Pages → supprimer la var `VITE_POSTHOG_KEY` → redeploy → `initAnalytics()` devient no-op.
- Aucune ligne de code à toucher.
