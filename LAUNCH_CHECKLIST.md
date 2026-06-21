# 🚀 YARAM — Checklist de lancement

> Document généré le 2026-06-21. À jour avec toutes les modifs récentes (premium home v5 + audit perf + Service Worker + split lib + Sentry + emails Resend + pages légales + contrats).

---

## ✅ Ce qui est FAIT côté code (rien à toucher)

### Front-end (React + Vite)
- Refonte premium Home + ordre des sections (Marques → Hero → Cat → Banner → Coupon → Widget BP → International → Pharmacies → Pour toi)
- Widget Bons plans flottant (popup fermable + silence 48h)
- Boutique internationale premium avec marquee de marques + shine + image fond uploadable
- Hero 3 lignes XXL cyclées toutes les 2,6 s (configurable depuis Admin)
- TabBar : bouton scan visage non clippé + nouvelle icône AR + face
- FAB WhatsApp retiré → seulement sur Profile → Support
- Lazy load 28 sections Admin (chunk 293 KB → 13 KB, −95 %)
- Lazy `@zxing/browser` (468 KB) sorti du bundle initial
- Service Worker custom (4 buckets : precache / assets / images / api)
- Split `lib/supabase.js` en 16 modules domaine (tree-shaking)
- 22 keys React fixées (re-renders fantômes éliminés)
- 6 pages avec skeleton loaders au lieu de "Chargement…"
- 28 `<img>` avec `loading="lazy" decoding="async"`
- Admin queries plafonnées (`.limit()` + colonnes ciblées)
- 5 composants `memo()` (ProductTile, HeroBanner, BannerCarousel, BonsPlansCarousel, InternationalShowcase)
- Sentry intégré (silent si VITE_SENTRY_DSN non set)
- 5 templates emails Resend prêts (welcome / order confirmation / status update / reset password / payment verified)
- 3 pages légales rédigées (Privacy RGPD, CGV/CGU, Mentions légales)
- 2 contrats type rédigés (Pharmacie partenaire, Livreur freelance)

### Performance attendue après déploiement
- Time to first paint LTE : ~1,2-1,6 s (vs ~3-3,5 s avant)
- Time to interactive : ~2,5-3 s (vs ~4-5 s avant)
- App fonctionne offline ~5 min grâce au SW
- Admin se charge en <100 ms

---

## ⚠️ Ce qu'il RESTE à faire (actions externes — pas du code)

### 🔥 Bloquant ABSOLU — sans ça l'app ne marche pas vraiment

#### 1. Résoudre les placeholders légaux
Les 3 pages légales et les 2 contrats utilisent des placeholders entre crochets. Il faut tous les remplir avant lancement :

| Placeholder | Valeur à mettre |
|---|---|
| `[RAISON_SOCIALE]` | ex. YARAM SAS |
| `[FORME_JURIDIQUE]` | SAS / SARL / SUARL |
| `[CAPITAL]` | capital social en FCFA |
| `[SIEGE]` | adresse complète Dakar |
| `[RCCM]` | numéro Registre du Commerce |
| `[NINEA]` | identifiant fiscal |
| `[REPRESENTANT_LEGAL]` | nom + prénom |
| `[DIRECTEUR_PUBLICATION]` | nom + prénom |

Fichiers à modifier :
- `src/pages/Privacy.jsx`
- `src/pages/Terms.jsx`
- `src/pages/MentionsLegales.jsx`
- `contracts/Contrat_Partenariat_Pharmacie_YARAM.docx`
- `contracts/Contrat_Prestation_Livreur_YARAM.docx`

**Faire relire par un juriste sénégalais OHADA avant signature avec des partenaires réels.**

#### 2. Variables d'environnement Supabase
À set via le dashboard Supabase → Edge Functions → Secrets :

```
RESEND_API_KEY=re_xxxxxxxxxxxxx           # obligatoire pour les emails
RESEND_FROM=YARAM <contact@yaram.app>    # optionnel (defaults)
```

À set via Supabase → Settings → API (déjà fait normalement) :
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

#### 3. Variables d'environnement Cloudflare Pages
Dashboard Cloudflare Pages → yaram → Settings → Environment variables → Production :

```
VITE_SUPABASE_URL=https://qxhhnrnworwrnwmqekmb.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxxxxxxxxx
VITE_POSTHOG_KEY=phc_xxxxxxxxxx          # optionnel pour analytics
VITE_POSTHOG_HOST=https://eu.i.posthog.com
VITE_SENTRY_DSN=https://xxx@sentry.io/xx # optionnel pour error tracking
VITE_APP_VERSION=1.0.5
```

Redeploy après ajout des vars.

#### 4. Tester un VRAI paiement
Avec 100 FCFA réels (compte test) :
1. Créer une commande
2. Sélectionner Wave
3. Payer via Wave réel
4. L'utilisateur marque comme payé dans l'app → status `awaiting_verification`
5. Admin valide la confirmation
6. Vérifier email de confirmation reçu (Resend)
7. Suivi de commande s'update

À répéter pour OM et cash à la livraison.

#### 5. Catalogue produits réel
Aujourd'hui beaucoup de données sont des seeds. Avant lancement :
- Importer le vrai catalogue (CSV via admin ou edge function)
- Photos produits HD compressées (WebP idéalement)
- Descriptions complètes
- Stocks réels par pharmacie partenaire
- Catégories définitives

---

### 📱 Bloquant iOS (App Store)

#### 6. Rebuild iOS 1.0.5
```bash
cd ~/Documents/diaara
bash build-ios.sh
```
Puis dans Xcode :
- Product → Archive
- Distribute App → App Store Connect → Upload
- Aller sur App Store Connect → soumettre à review

Délai validation Apple : ~24-72 h.

#### 7. Sign in with Apple (obligatoire si Google OAuth présent)
1. Apple Developer Portal → Identifiers
2. Créer un Services ID `app.yaram.signin`
3. Créer une Key (.p8) → noter Key ID
4. Configurer Supabase Studio → Authentication → Providers → Apple :
   - Services ID
   - Team ID `6779DNV7Y5`
   - Key ID
   - Private Key (.p8 content)

Sans ça → rejet App Store car Google OAuth proposé.

#### 8. Screenshots App Store
Tailles requises :
- 6.7" : 1290 × 2796 (iPhone 14 Pro Max)
- 6.5" : 1242 × 2688 (iPhone 11 Pro Max)
- 5.5" : 1242 × 2208 (iPhone 8 Plus)

6 screens minimum par taille :
1. Home (avec hero animé)
2. Scan IA visage
3. Fiche produit
4. Panier + paiement
5. Suivi commande temps réel
6. Profil + fidélité

Outils : utiliser https://screenshots.pro ou Figma + mockups iPhone.

#### 9. Capture splash + texte App Store
- Nom : YARAM — Beauté pour ta peau
- Sous-titre : Marketplace beauté Sénégal
- Description : ~2000 caractères vantant les features
- Mots-clés : beauté, pharmacie, sénégal, dakar, cosmétiques, scan peau, IA, livraison

#### 10. Privacy Policy URL
Apple exige une URL hébergée publiquement. Mettre dans App Store Connect :
- Privacy URL : `https://yaram.app/privacy`
- Support URL : `https://yaram.app/help`
- Marketing URL : `https://yaram.app`

---

### 🏪 Lancement business — Partenaires & contenu

#### 11. Onboarder les pharmacies partenaires
- Signer contrat (template `contracts/Contrat_Partenariat_Pharmacie_YARAM.docx`)
- Créer compte pharma dans Admin (depuis `/?pharma`)
- Sessions formation 1 h (comment recevoir commande, ETA, refuser, marquer prêt)
- Upload du stock initial
- Test de bout en bout (commande factice)

#### 12. Recruter et onboarder livreurs
- Signer contrat (template `contracts/Contrat_Prestation_Livreur_YARAM.docx`)
- Vérifier statut indépendant (NINEA ou registre)
- Créer compte livreur (`/?livreur`)
- Formation app (1 h)
- Test livraison réelle

#### 13. Légal officiel
- Inscrire YARAM SAS au RCCM Dakar (si pas fait)
- Obtenir NINEA
- Déclarer activité à la CDP (Commission de Protection des Données Sénégal)
- Autorisation pharmaceutique si vente médicaments OTC (ARP Sénégal)
- Souscrire assurance RC produit et livraison

---

### 📊 Monitoring & analytics

#### 14. PostHog setup
1. Créer projet PostHog (eu.i.posthog.com)
2. Récupérer la clé `phc_xxx`
3. Mettre dans `VITE_POSTHOG_KEY` Cloudflare
4. Tester en prod : events trackés `home_viewed`, `category_clicked`, `product_clicked`, `order_created`, `banner_clicked`

#### 15. Sentry setup
1. Créer projet Sentry (sentry.io)
2. Récupérer DSN
3. Mettre dans `VITE_SENTRY_DSN` Cloudflare
4. Redeploy → erreurs runtime captured

#### 16. Cloudflare monitoring
- Health Check sur `https://yaram.app` (HTTP 200 toutes les 5 min)
- Alertes email si down
- Activer Brotli compression (Settings → Speed)
- Activer Image Resizing si abonnement payant

#### 17. Supabase backups
- Activer backups automatiques (Pro plan)
- Tester restore d'une snapshot
- Mettre en place alerte si stockage > 80 %

---

### 📣 Marketing & lancement public

#### 18. Brief design partenaire cosmétiques
Déjà préparé dans la session précédente — à envoyer à la dame.

#### 19. Comptes réseaux sociaux
- Instagram @yaram.app
- Facebook page YARAM
- TikTok @yaram.app
- Premier post avec lien App Store + Web

#### 20. Push notifications
Côté code :
- Vérifier `src/lib/push.js` — utilise probablement OneSignal ou Firebase
- Si OneSignal → créer compte, set App ID dans env vars
- Si Firebase → setup Firebase Cloud Messaging + uploader le service worker FCM

Côté admin → AdminPushBroadcastSection.jsx (déjà existant) :
- Tester envoi à un device test
- Préparer campagne welcome push

#### 21. Email welcome sequence
Resend permet de programmer une séquence :
- J+0 : welcome (BIENVENUE10) — déjà fait
- J+2 : "Tu n'as pas encore commandé ?" + recommandation scan
- J+7 : "Voici les 3 produits les plus aimés du moment"
- J+30 : "On t'offre un bonus fidélité"

---

## 🎯 Plan d'action en 3 sprints

### Sprint 1 — Cette semaine
- [ ] Remplir tous les placeholders légaux
- [ ] Faire relire pages légales + contrats par juriste
- [ ] Set RESEND_API_KEY Supabase
- [ ] Tester paiement Wave + OM + cash en réel
- [ ] Importer catalogue produits réel
- [ ] Set VITE_POSTHOG_KEY + VITE_SENTRY_DSN Cloudflare

### Sprint 2 — Semaine prochaine
- [ ] Rebuild iOS 1.0.5 + submit App Store
- [ ] Sign in with Apple config
- [ ] Screenshots App Store
- [ ] Signer 3-5 premières pharmacies
- [ ] Recruter 5-10 livreurs

### Sprint 3 — Post-lancement
- [ ] Onboarding email sequence
- [ ] Réseaux sociaux + premier post
- [ ] Push notifications campagne welcome
- [ ] Monitoring Sentry + PostHog actifs
- [ ] Brief marques cosmétiques envoyé

---

## 📁 Fichiers de référence dans le repo

| Fichier | Rôle |
|---|---|
| `contracts/Contrat_Partenariat_Pharmacie_YARAM.docx` | Contrat pharmacie type |
| `contracts/Contrat_Prestation_Livreur_YARAM.docx` | Contrat livreur type |
| `src/pages/Privacy.jsx` | Politique de confidentialité |
| `src/pages/Terms.jsx` | CGV/CGU |
| `src/pages/MentionsLegales.jsx` | Mentions légales |
| `src/lib/email-templates/*.js` | Templates emails Resend |
| `supabase/functions/send-email/index.ts` | Edge function envoi email |
| `src/lib/sentry.js` | Sentry conditionnel |
| `src/lib/sw-register.js` | Enregistrement Service Worker |
| `public/sw.js` | Service Worker custom |
| `build-ios.sh` | Script rebuild iOS |
| `LAUNCH_CHECKLIST.md` | Ce document |

---

**Bon lancement 🚀**
