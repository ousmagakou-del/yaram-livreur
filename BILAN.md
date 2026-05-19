# YARAM — Bilan & handoff

Marketplace beauté pour la peau africaine, lancement Sénégal.
État du projet au **19 mai 2026**.

---

## 1. Vue d'ensemble

**Domaine** : `yaram.app` (hébergé Cloudflare Pages, DB Supabase, déploiement auto via GitHub Actions)

**Stack** :
- Frontend : React 19 + Vite 8 (Rolldown) + PWA
- Backend : Supabase (Postgres 17 + Auth + Storage + Edge Functions Deno)
- CDN : Cloudflare Pages + Pages Functions (edge compute pour SEO/sitemap dynamiques)
- Auth client : Supabase Auth (email/password + Google OAuth + magic link)
- Auth admin : système maison à token signé (admin_sessions table)
- Auth pharma : système maison à token signé (pharma_sessions table)
- Auth livreur : delivery_token par livraison
- Emails : Resend (5 templates transactionnels + 4 templates Supabase Auth brandés)
- Notifications : WhatsApp via Twilio + Push browser
- Monitoring : Sentry (frontend errors)
- Backup : edge function `backup-db` quotidienne via GitHub Actions cron
- Tests : Playwright (28+ tests E2E sur prod à chaque push)

**Acteurs** :
1. **Cliente** : achète des produits beauté, scan IA peau, suivi livraison
2. **Pharmacie** : valide commandes, gère son inventaire, soumet ses produits
3. **Livreur** : reçoit lien WhatsApp par livraison, GPS sharing, preuve de remise
4. **Admin** : full CRUD, validation produits, finances, modération

---

## 2. Architecture sécurité — les 14 verrous RLS

### Tables verrouillées (anon ne peut PAS lire/écrire directement)

| Table / Opération | Verrou |
|---|---|
| `users_profile` SELECT/INSERT | auth.uid()=id only |
| `audit_log` SELECT/INSERT | bloqué, admin via RPC |
| `push_subscriptions` SELECT | bloqué, admin via RPC |
| `staff` manage/read | bloqué, admin via RPC |
| `pharmacies.pin` UPDATE | column-level GRANT exclu |
| `pharmacies` INSERT/DELETE | bloqué, admin via RPC |
| `deliveries` (full) | bloqué, table inutilisée |
| `site_settings` write | bloqué, admin via RPC |
| `promo_codes` manage | bloqué, admin via RPC |
| `commission_payments` (full) | bloqué, RPC pharma/admin |
| `orders` SELECT | own user ou via RPC |
| `orders` UPDATE | bloqué, 4 RPCs client/pharma/livreur/admin |
| `products` INSERT/UPDATE/DELETE | bloqué, admin+pharma via RPC |
| `inventory` manage | bloqué, admin+pharma via RPC |

### Architecture : tout passe par RPCs SECURITY DEFINER

**Admin** : login crée un `admin_sessions.token`, stocké en sessionStorage, passé à chaque RPC.
**Pharma** : `pharma_sessions.token` (12h), même pattern.
**Livreur** : delivery_token unique par livraison, présent dans l'URL `/?livreur=TOKEN`.

### RPCs principales (~35 fonctions)

**Admin** : `admin_start_session`, `admin_end_session`, `_check_admin_session`, `admin_list_orders`, `admin_list_orders_full`, `admin_update_order`, `admin_list_users`, `admin_list_users_full`, `admin_list_loyalty_users`, `admin_list_user_orders`, `admin_users_stats`, `admin_dashboard_counts`, `admin_list_commissions`, `admin_list_audit_log`, `admin_list_push_subscriptions`, `admin_list_staff`, `admin_upsert_staff`, `admin_delete_staff`, `admin_list_promos`, `admin_upsert_promo`, `admin_delete_promo`, `admin_update_site_settings`, `admin_create_pharmacy`, `admin_delete_pharmacy`, `admin_set_pharmacy_pin`, `admin_upsert_product`, `admin_delete_product`, `admin_validate_product`, `admin_upsert_inventory`

**Pharma** : `pharma_start_session`, `pharma_end_session`, `_check_pharma_session`, `pharma_list_orders`, `pharma_update_order`, `pharma_get_stats`, `pharma_get_commissions`, `pharma_change_pin`, `pharma_upsert_product`, `pharma_delete_product`, `pharma_upsert_inventory`

**Livreur** : `livreur_load_delivery`, `livreur_update_tracking`, `livreur_update_order`

**Client** : `client_get_order_by_id`, `client_get_order_by_token`, `client_mark_order_paid`, `client_confirm_delivery`, `client_dispute_delivery`, `client_rate_order`, `resolve_referral_code`, `my_referrals`, `verify_pharmacy_pin`, `increment_promo_uses`, `public_best_sellers`

---

## 3. Edge Functions

| Function | Rôle |
|---|---|
| `send-whatsapp` | Wrapper Twilio WhatsApp |
| `analyze-skin` | Scan IA peau (Gemini Vision) |
| `order-notify` | Notif commande (WhatsApp) |
| `pi-spi-gateway` | Test paiement Pi-Spi |
| `verify-barcode` | Lookup code-barre |
| `ping-sitemap` | Notifie Bing IndexNow après publication |
| `send-email` | Wrapper Resend (2 modes : direct ou par order_id) |
| `backup-db` | Dump JSON des 26 tables → bucket `db-backups` |
| `delete-my-account` | Suppression compte RGPD (anonymise orders + delete auth user) |
| `export-my-data` | Export RGPD (JSON download de 7 tables) |

### Secrets requis (Supabase Project Settings → Edge Functions → Secrets)

- `RESEND_API_KEY` : clé Resend (`re_xxx`)
- `RESEND_FROM` : `YARAM <noreply@yaram.app>`
- `BACKUP_TOKEN` : token aléatoire pour cron backup
- `TWILIO_*` : credentials Twilio WhatsApp
- `GEMINI_API_KEY` : pour analyze-skin

---

## 4. Emails transactionnels

**Templates côté custom (lib/emails.js + send-email edge function)** :
- `welcome` : à l'inscription (signup email ou Google OAuth via flag `welcomed_at`)
- `orderConfirmed` : checkout finalisé
- `orderShipped` : livreur clic "in_route"
- `orderDelivered` : cliente clic "Confirmer la livraison"
- `pharmacyNewOrder` : envoyé à chaque pharma de l'order

**Templates côté Supabase Auth (brandés YARAM)** :
- Confirm signup
- Magic Link
- Reset Password
- Change Email Address

---

## 5. Backup DB

- **Edge function** `backup-db` dump 26 tables en JSON → bucket `db-backups`
- **Cron quotidien** via GitHub Actions (`.github/workflows/daily-backup.yml`) à **04:00 GMT**
- Tu peux lancer manuellement depuis https://github.com/ousmagakou-del/diaara/actions
- Récupérer un backup : Supabase Dashboard → Storage → bucket `db-backups` → télécharger le JSON

---

## 6. Tests E2E

**Setup** : Playwright + 6 fichiers de tests dans `e2e/`

| Fichier | Couverture |
|---|---|
| 01-home | Home charge, SW, manifest, robots.txt |
| 02-navigation | Routes, F5 persiste, SPA fallback, /privacy /terms |
| 03-seo | Meta, canonical, OG, JSON-LD, sitemaps |
| 04-rls-security | **Anti-régression RLS** — vérifie les 14 verrous |
| 05-search-product | Catalogue + fiche produit |
| 06-pwa-perf | Icones, FCP < 3s, pas d'erreur console |

**CI** : workflow `.github/workflows/e2e-tests.yml` relance les tests sur https://yaram.app à chaque push sur main.

**Lancer localement** : `npm run test:e2e:prod`

---

## 7. RGPD

**Pages** : `/privacy`, `/terms`, `/delete_account`

**Profile.jsx** propose :
- 📥 Télécharger mes données (RGPD article 20)
- 🔒 Politique de confidentialité
- 📄 Conditions générales
- 🗑️ Supprimer mon compte (flow 2 étapes, irréversible)

**Suppression** : la function `delete-my-account` anonymise les orders (`user_id → null`, `address → '[Supprimé]'`) pour la compta sénégalaise (10 ans), puis supprime tout le reste (profile, favorites, addresses, skin_scans, loyalty, push_subs, reviews, auth user).

**Buckets privés** : `skin-scans` et `delivery-proofs` (photos visages + signatures clients). Affichage via composant `<SignedImage>` qui génère une URL signée 7 jours.

---

## 8. Performance

- **Splash inline** dans `index.html` visible en 50ms (avant React)
- **Lazy loading** : 12 pages lazy-loaded (Admin, Pharma, Livreur, Scan, Checkout, Payment, etc.)
- **manualChunks Vite** : vendor-react, vendor-supabase, vendor-zxing isolés
- **Service Worker v9** : network-first HTML/JS, cache-first images (7j), stale-while-revalidate Supabase GET
- **Home cache** persisté en sessionStorage (5 min) — refresh = instant
- **Polling au lieu de realtime** pour orders (RLS bloque le change feed)
- **Realtime broadcast** `yaram-new-orders` channel pour notifs instant admin/pharma sans toucher RLS

---

## 9. Ce qui reste avant launch sérieux

### 🔴 Critique (bloquant)
1. **Vrai paiement Wave/OM/Stripe** — aujourd'hui le checkout est en démo (`setTimeout(1500)`). Sans gateway réel, aucune vraie transaction. Bloqué côté compte marchand (3-5j Wave, ou IBAN Sénégal pour Stripe).

### 🟠 Important
2. **Hash PIN pharma avec pgcrypto** : le PIN admin est déjà bcrypt-hashé (table `admin_users.pin_hash`). Vérifier que pharma `pharmacies.pin` l'est aussi (actuellement plain text dans une colonne column-level-protégée).
3. **Validation paiement coté serveur** : webhook Wave/OM pour confirmer paiement avant de marquer order='paid' (anti-fraude).
4. **i18n wolof + anglais** : si tu vises au-delà du francophone Sénégal.

### 🟡 Polish
5. **Photo moderation** : on modère à la main pour l'instant. Quand le volume monte, intégrer SightEngine (1 h).
6. **Tests E2E avancés** : ajouter checkout complet (signup → cart → payment → tracking) — nécessite comptes de test.
7. **App Store / Play Store** : packaging PWA via PWABuilder ou Capacitor.

---

## 10. Variables d'environnement

### Cloudflare Pages (Production)
- `VITE_SUPABASE_URL` : `https://qxhhnrnworwrnwmqekmb.supabase.co`
- `VITE_SUPABASE_ANON_KEY` : (clé anon publique)
- `VITE_SENTRY_DSN` : DSN Sentry pour monitoring

### Cloudflare Pages Functions
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (pour bot-detection og: par produit)

### Supabase Edge Functions Secrets
- `RESEND_API_KEY`, `RESEND_FROM`
- `BACKUP_TOKEN`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`
- `GEMINI_API_KEY`

### GitHub Actions Secrets (repo `ousmagakou-del/diaara`)
- `BACKUP_TOKEN` : pour le workflow daily-backup (SUPABASE_ANON_KEY est inline dans le YAML car publique)

---

## 11. Workflows GitHub

| Workflow | Quand | Quoi |
|---|---|---|
| `daily-backup.yml` | Tous les jours 04:00 GMT | Trigger l'edge function `backup-db` |
| `e2e-tests.yml` | Push sur main | Lance les 28+ tests Playwright sur prod |

---

## 12. Commandes utiles

```bash
# Dev local
npm run dev

# Build production
npm run build

# Lancer les tests E2E
npm run test:e2e:prod              # contre https://yaram.app
npm run test:e2e                   # contre localhost:5173
npm run test:e2e:ui                # mode UI interactif

# Lancer un backup manuel
curl -X POST https://qxhhnrnworwrnwmqekmb.supabase.co/functions/v1/backup-db \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "x-backup-token: <BACKUP_TOKEN>"

# Voir le statut des sessions admin actives
# (depuis Supabase SQL Editor)
SELECT admin_id, admin_email, created_at, expires_at, last_used_at
FROM admin_sessions WHERE expires_at > now();
```

---

## 13. Risques connus

1. **PIN pharma en plain text** dans `pharmacies.pin`. Protégé par column-level GRANT REVOKE mais pas hashé. À hasher avec `crypt()` quand possible.
2. **Pas de paiement réel** — voir #9.
3. **Cloudflare Pages Free tier** : 500 builds/mois, illimité bandwidth. À surveiller.
4. **Supabase Free tier** : 500 MB DB, 1 GB Storage, 2 GB bandwidth/mois, 50 000 MAU. À surveiller quand traction.
5. **Resend Free** : 100 emails/jour, 3000/mois. Upgrade $20/mois pour 50 000.
6. **GitHub Actions Free** : 2 000 min/mois (la CI Playwright prend ~3 min/run, donc OK pour ~600 push/mois).

---

## 14. Contacts & accès

- **Domaine** : `yaram.app` (Cloudflare DNS)
- **Repo** : https://github.com/ousmagakou-del/diaara
- **Cloudflare Pages** : projet `diaara-brg` (ex-nom historique)
- **Supabase project** : `qxhhnrnworwrnwmqekmb` (compte `lilouzgakou@gmail.com`)
- **Sentry** : projet `yaram` (compte à créer si pas fait)
- **Resend** : domaine `yaram.app` vérifié (DKIM + SPF + DMARC)
- **Twilio** : compte WhatsApp Business

**Support contact** : `contact@yaram.app` · WhatsApp `+221 77 438 87 66`

---

## 15. Évolutions futures (idées)

- Migration admin vers vraie Supabase Auth (remplacer PIN sessionStorage) → réduit la surface d'attaque
- Edge function `notify-pharma-new-order` au lieu du broadcast (envoie push + WhatsApp + email en 1 fois)
- App Store packaging via PWABuilder ou Capacitor
- Blog SEO (articles "Comment soigner peau grasse Dakar")
- Programme de parrainage avancé (niveaux, récompenses)
- Click & collect (retirer en pharmacie)
- Click-to-call pharmacie depuis fiche pharmacie

---

**Dernière mise à jour** : 19 mai 2026
**Versions** : SW v9 · Sentry foundation · Resend v6 · 14 verrous RLS · 28+ tests E2E
