# Audit complet YARAM — Synthèse 10 agents

**Date** : juin 2026
**Périmètre** : app cliente (React + Capacitor iOS), admin, pharma, livreur, sécurité, DB, notifications, paiements, iOS/PWA, perf/code.
**Méthodo** : 10 agents READ-ONLY en parallèle, ~250 findings remontés, consolidés et priorisés ici.

---

## Résumé exécutif

YARAM tient debout, mais elle a **17 bugs critiques** qui exposent à de la perte d'argent ou du rejet App Store, **~30 bugs élevés** qui dégradent l'expérience pharma/livreur/admin, et une **dette technique conséquente** (54 RPC fantômes, schéma DB non versionné). Les fixes urgents demandent ~3-5 jours de dev concentré. Le hardening complet ~3-4 semaines.

La bonne nouvelle : aucun secret critique fuite côté client, le squelette d'auth Supabase est sain, l'infrastructure iOS est correctement configurée hormis quelques détails de certification.

---

## 🔴 CRITIQUES — à fixer cette semaine (perte d'argent / sécurité / App Store)

### Paiement (le plus dangereux)

**1. Wave merchant link = montant falsifiable + "J'ai payé" bypassable.**
`Payment.jsx:332` — l'URL `https://pay.wave.com/m/.../sn?amount=` est éditable par le user. Combiné à `client_mark_order_paid` qui ne vérifie aucune preuve de paiement, n'importe qui peut commander 200 000 FCFA, payer 100 via Wave (montant modifié), cliquer "J'ai payé" et obtenir la livraison. **Exploit trivial.** À fixer immédiatement.

**2. PayTech IPN ne vérifie pas le montant reçu vs commande.**
`paytech-webhook/index.ts:115` — passe en `paid` sans comparer `item_price` à `order.total`. Replay attack possible.

**3. PayTech webhook traite mal les preorders.**
`paytech-webhook/index.ts:115-117` — ligne `is_preorder ? 'paid' : 'paid'` (bug commentaire/code identique). Pour une commande import, l'acompte 50% bascule en `paid` complet → **le solde 50% n'est jamais réclamé, tu perds la moitié du CA preorder**.

**4. PayTech envoie `order.total` même pour les preorders.**
`Payment.jsx:209` — le client paye 100% au lieu de l'acompte 50%. Combiné avec #3, état DB incohérent et risque de double-charge à la livraison.

**5. Cleanup 24h annule commandes COD légitimes.**
`MIGRATION_CLEANUP_PENDING_ORDERS.sql:45` — toute commande `pending_payment > 24h` est cancelled. Mais le COD reste `pending_payment` jusqu'à `cash_collected`, donc une commande livrée le lendemain est marquée `cancelled` automatiquement.

**6. `client_mark_order_paid` exécutable depuis curl.**
N'importe quel user authentifié peut faire `SELECT client_mark_order_paid('order-id')` directement et obtenir paid sans payer.

### Sécurité / RGPD

**7. Bucket `delivery-proofs` public + signatures/photos clientes.**
`STORAGE_BUCKETS_FIX.sql:7,32` — accessible sans auth. Conflit avec loi 2008-12 Sénégal et standards RGPD.

**8. Bucket `skin-scans` public + photos faciales biométriques.**
Pire que #7 vu la sensibilité des données.

**9. `site_settings` policy `USING(true) WITH CHECK(true)`.**
N'importe qui peut modifier commission, deliveryFee, support email depuis la console navigateur.

**10. Token livreur = `Math.random()` 40 bits, sans expiration.**
`DeliveriesSection.jsx:46` — brute-forçable. Une fois la livraison terminée, le token reste actif à vie.

### Notifications cassées

**11. Edge function `send-email` n'existe pas dans le repo.**
Tous les emails (welcome, orderConfirmed, orderShipped, pharmacy) échouent silencieusement. Soit elle est en prod mais non versionnée (dette), soit elle n'a jamais existé et tu n'as pas envoyé d'emails depuis le début (à confirmer).

**12. Push preorder envoyé avec mauvais payload.**
`preorderNotify.js:186` envoie `user_ids` (pluriel) mais l'edge function attend `user_id` → 400 silencieux. Aucune push preorder n'est jamais arrivée.

**13. Welcome email + WhatsApp dupliqués au signup.**
`Onboarding.jsx:191` et `App.jsx:315` envoient tous les deux le même message à la nouvelle utilisatrice.

### App Store

**14. Permission micro déclarée sans usage.**
`Info.plist:78` — la description admet "non utilisé actuellement". **Apple rejette systématiquement.** À supprimer avant prochaine submission.

**15. Sign in with Apple obligatoire si Google OAuth présent.**
Tu as Google OAuth → tu DOIS proposer Sign in with Apple, sinon rejet en review. Pas encore implémenté.

**16. Universal Links cassés.**
`App.entitlements` — capability commentée mais AASA déployé. Les liens emails `/order/X` ouvrent Safari au lieu de l'app.

### Crashs visibles

**17. `Payment.jsx:124` crash si timeout.**
`result?.error` accédé sur `result` null (timeout gagne la Promise.race). Le code que je t'ai écrit cette semaine a justement ce bug à corriger.

---

## 🟠 ÉLEVÉS — à fixer ce mois

### Pharma

- **PIN 4 chiffres brute-forceable** — 10 000 combos, pas de rate limit visible côté serveur. Passer à 6 chiffres + lockout 15min après 5 essais.
- **Inventory race conditions** — `toggleAvailable` et `updateStock` font optimistic update sans check error. 2 onglets ouverts = corruption silencieuse du stock.
- **Workflow zombie** — impossible de refuser après accepter. Si la pharma se rend compte de la rupture en préparant, elle ne peut plus refuser via UI → drame côté livreur et cliente.
- **Image produit fail silencieux** — `uploadProductImage` retourne null sans dire pourquoi. Pharma croit que c'est ok, produit créé sans photo, placeholder en prod.
- **WhatsApp envoyé même si update DB fail** — déjà partiellement fixé pour accept/refuse/ready, mais pas pour upload produit ni `updateStock`.

### Admin

- **`forceDeliver` (impact commission) sans audit log.** Pas de trace de qui a fait quoi.
- **Stats charge 10 000 commandes côté JS au lieu de SQL** — sera devenu inutilisable avec 50k commandes.
- **Recherche order limitée à la page courante** — taper un n° de commande en page 3 = "rien trouvé".
- **Bulk inventory update en série sans Promise.all** — 200 produits = 200 round-trips, peut prendre 60s+, et toast succès même si tout fail.
- **ReviewsSection moderate() sans token admin ni confirm** — modération qui bypass potentiellement la RLS.
- **BannersSection update silent fail** — UI dit "OK" même si la RLS bloque.
- **ImportsSection mélange RPC et update direct** — incohérent avec ProductsSection qui passe par RPC. Vulnérabilité potentielle.

### App cliente

- **Onboarding 4 champs obligatoires au signup** — friction qui tue ta conversion. Demander juste email + password, le reste après.
- **`Checkout.jsx:197` leak les messages Supabase bruts au paiement** — "rpc_failed" au moment crucial = utilisatrice partie.
- **Bouton "Confirmer commande" actif sans adresse** — l'utilisatrice ne comprend pas pourquoi ça plante.
- **`Cart.jsx:88` NaN propagé dans subtotal** — un item corrompu fait planter le total visuel.
- **`Product.jsx:278` badge promo "-Infinity%"** si old_price = 0.
- **Loyalty credit peut dépasser le subtotal** → total négatif possible théoriquement.
- **`Addresses.jsx:177` spinner bloqué si onSave reject** — bouton "Enregistrer" coincé après erreur réseau.
- **`Orders.jsx:54` condition refresh inversée** — page Commandes ne se rafraîchit pas au retour.

### Livreur

- **`livreur_update_order` whitelist refuse `cash_collected`** — le marquage cash plante toujours côté flow `updateStatus`. (À fixer avec les bonnes RPC versionnées.)
- **`delivery_tracking.status` sans CHECK constraint** — un typo peut corrompre silencieusement.

### Performance

- **Bundle Admin 271 kB monolithique** — toutes les sections chargées même si tu vas juste sur Stats. Split par lazy().
- **ZXing 457 kB import complet** — n'importer que `BrowserMultiFormatReader` économise ~200 kB.
- **`ProductTile` non memoé** — re-render à chaque changement parent dans Home/Search/Favorites. Une ligne = gain massif.
- **Pas d'images Supabase Storage transformées** — `?width=400&quality=70` réduirait les images de 5-10x.

---

## 🟡 MOYENS — à fixer ce trimestre

- **54 RPC fantômes** (pharma, admin, client, livreur) — non versionnées dans le repo. Risque de drift si DB doit être restaurée.
- **`addresses` sans RLS visible** — un user peut potentiellement lire/modifier les adresses d'autres users.
- **`admin_logs` référencée mais structure inconnue** — pas de CREATE TABLE versionné.
- **Indexes manquants** — `orders.user_id`, `orders.status`, `favorites.user_id`, `notifications.user_id` non indexés. À 100k commandes ça commencera à ramer.
- **Triggers `updated_at` manquants** sur pharmacies, products, orders, users_profile.
- **OneSignal API v1 Players déprécié** — code marche encore mais devra migrer vers User Model API.
- **Service Worker actif en WebView Capacitor** — peut shadow les bundles JS embarqués. Conditionner l'enregistrement à `!Capacitor.isNativePlatform()`.
- **AppDelegate ne gère pas push lancée depuis app fermée** — payload perdu sur cold launch.
- **Console.log oubliés (~21)** — à gater derrière `import.meta.env.DEV`.
- **Pas de `prefers-reduced-motion` respecté** — animations qui tournent même si accessibilité demande pause.
- **Contrastes `--ink-soft` < 4.5:1** sur boutons secondaires.
- **`armv7` legacy dans Info.plist** — inutile depuis iOS 11.
- **`app_version` hardcodé 1.0.3** dans `push.js:167` alors qu'on est à 1.0.5. Analytics fausses.
- **Empty states `Chargement…` plats** sur 5+ pages — passer en skeleton.
- **Recherche sans résultat sans suggestion** — `Search.jsx:278`.

---

## 🔵 Cosmétiques (quand t'auras le temps)

- Phone number sans préfixe +221 garanti
- Localisation Dakar (FCFA inconsistant entre `formatPrice()` et `toLocaleString`)
- Acronyme "INCI" non expliqué pour débutantes
- Carousel banners sans pause au hover
- `key={index}` dans plusieurs listes admin
- `BannerCarousel.jsx` dead code
- Doublon `Payment.jsx` vs `Payments.jsx` à clarifier

---

## Plan d'action priorisé

**Sprint 1 (3 jours) — Stop the bleeding paiement**

1. Désactiver le bouton Wave direct ou ajouter un statut `awaiting_verification` entre `pending_payment` et `paid` — fix #1, #6
2. Fix PayTech webhook : vérifier le montant + traiter preorder différemment — fix #2, #3, #4
3. Exclure COD du cleanup 24h — fix #5
4. Privatiser `delivery-proofs` et `skin-scans` buckets + signed URLs — fix #7, #8
5. Drop la policy `USING(true)` sur `site_settings`, RPC `admin_update_site_settings` à la place — fix #9

**Sprint 2 (2 jours) — Notifications + crashs**

6. Créer la vraie edge function `send-email` ou faire le diagnostic de pourquoi celle en prod n'a jamais été versionnée — fix #11
7. Fix le payload push preorder + WhatsApp — fix #12
8. Dédupliquer welcome — fix #13
9. Fix le crash Payment.jsx sur timeout — fix #17
10. Sanitize NaN dans Cart/Checkout, division par zéro Product — fix bugs 13-14 critiques

**Sprint 3 (3 jours) — App Store ready**

11. Supprimer permission micro Info.plist — fix #14
12. Implémenter Sign in with Apple — fix #15
13. Réactiver Associated Domains + valider Universal Links — fix #16
14. Build 1.0.5 + soumission

**Sprint 4 (5 jours) — Pharma + Admin hardening**

15. PIN pharma 6 chiffres + lockout
16. Inventory race conditions : RPC transactionnelle
17. Workflow zombie : autoriser refus après accept
18. Audit log admin sur actions destructives
19. Stats en SQL agrégé
20. Recherche order full-table

**Sprint 5 (1 semaine) — Dette technique**

21. Versionner les 54 RPC en `supabase/migrations/`
22. Indexes manquants + triggers updated_at
23. RLS addresses
24. Split bundle Admin par section lazy
25. memo(ProductTile) + Supabase Storage transforms
26. Token livreur 128 bits crypto + expiration 24h
27. Sign in with Apple si pas déjà fait

---

## Effort estimé

- **Bugs critiques (#1-17)** : 5 jours de dev concentré
- **Bugs élevés** : 8-10 jours
- **Bugs moyens** : 10-12 jours
- **Total pour mise à niveau complète** : ~4 semaines à 1 dev

---

## Mes recommandations honnêtes

**À faire en priorité absolue** : les bugs #1-5 (paiement). Tant que ces failles existent, n'importe quelle personne un peu technique peut commander gratuitement. Stop le bleeding avant de scaler.

**Ensuite vise App Store ready** (#14-16). Une release rejected fait perdre 1 semaine de momentum.

**Le reste (élevés + moyens)** peut s'étaler sur 2-3 mois sans urgence existentielle, mais à faire avant tout pivot ou grosse acquisition payée.

**Les buckets publics avec photos clientes** (#7-8) sont en zone grise légale au Sénégal. À régler avant que quelqu'un te demande des comptes ou qu'un compétiteur te dénonce à la CNDP.

---

## Annexe — Fichiers SQL/code à créer

Pour ranger toutes ces dettes proprement :

- `supabase/migrations/2026_06_canonical_schema.sql` (tables + colonnes définitives)
- `supabase/migrations/2026_06_rpc_admin.sql` (les 28 RPC admin manquantes)
- `supabase/migrations/2026_06_rpc_pharma.sql` (les 11 RPC pharma)
- `supabase/migrations/2026_06_rpc_client.sql` (client_*)
- `supabase/migrations/2026_06_rpc_livreur.sql` (consolidées)
- `supabase/migrations/2026_06_rls_policies.sql` (RLS canonique)
- `supabase/migrations/2026_06_indexes.sql`
- `supabase/migrations/2026_06_triggers.sql`
- `supabase/functions/send-email/index.ts` (à créer si manquant)

Si tu veux, je peux te générer le squelette de chacun de ces fichiers dans une session suivante — une heure suffit pour avoir tout en place.
