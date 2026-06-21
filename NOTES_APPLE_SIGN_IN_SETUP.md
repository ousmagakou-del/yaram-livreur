# Sign in with Apple — Setup YARAM

Guide pas-à-pas pour activer Sign in with Apple. Le code JS + plugin Capacitor
est déjà en place. Il reste : la config Apple Developer + Supabase + build iOS.

> **Pourquoi c'est obligatoire** : Apple Review Guideline **4.8** — toute app qui
> propose un login social (Google, Facebook, etc.) DOIT aussi proposer Sign in
> with Apple. Sinon **rejet en review iOS** à coup sûr.

---

## 1. Apple Developer Portal

Va sur https://developer.apple.com/account → **Certificates, Identifiers & Profiles**.

### 1.1 Activer Sign In With Apple sur l'App ID iOS

1. Sidebar → **Identifiers**
2. Cherche l'App ID `app.yaram` (Type: App IDs)
3. Clique dessus → scroll jusqu'à **Capabilities**
4. Coche **Sign In with Apple**
5. Clique **Edit** à droite → laisse "Enable as a primary App ID" → **Save**
6. Bouton **Save** en haut à droite

> Note : si Xcode te demande de regénérer le provisioning profile après ça,
> c'est normal. Va dans Xcode → Signing & Capabilities → Try Again.

### 1.2 Créer un Services ID (pour le flow Web OAuth)

Le Services ID = l'identifiant utilisé par le flow OAuth web (et par Supabase
côté serveur pour valider les tokens).

1. Sidebar → **Identifiers** → bouton **+** en haut
2. Choisis **Services IDs** → Continue
3. Description : `YARAM Sign in with Apple`
4. Identifier : **`app.yaram.signin`** (convention : bundle ID + .signin)
5. Continue → Register
6. Re-clique sur le Services ID qu'on vient de créer
7. Coche **Sign In with Apple** → bouton **Configure**
8. Primary App ID : sélectionne `app.yaram`
9. Domains and Subdomains : `yaram.app`
10. Return URLs : `https://qxhhnrnworwrnwmqekmb.supabase.co/auth/v1/callback`
11. **Next** → **Done** → **Continue** → **Save**

### 1.3 Créer une Key Sign in with Apple

La Key est utilisée par Supabase pour signer les requêtes serveur vers Apple.

1. Sidebar → **Keys** → bouton **+**
2. Key Name : `YARAM Apple Sign-In Key`
3. Coche **Sign in with Apple** → bouton **Configure**
4. Primary App ID : `app.yaram`
5. **Save** → **Continue** → **Register**
6. **TÉLÉCHARGE le fichier `.p8`** — il ne sera téléchargeable **qu'une seule fois**.
   Stocke-le dans 1Password / un gestionnaire de mots de passe.
7. Note bien **le Key ID** (10 caractères, affiché sur la page) — on en aura besoin
   pour Supabase.

### 1.4 Récupérer ton Team ID

- Visible en haut à droite du portail Developer, à côté de ton nom
  (ex : `ABC12DEF34`).
- Aussi dans Membership → Team ID.

---

## 2. Supabase Dashboard

Va sur https://supabase.com/dashboard/project/qxhhnrnworwrnwmqekmb

1. Sidebar → **Authentication** → **Providers**
2. Cherche **Apple** dans la liste → bascule **Enable**
3. Remplis :

   | Champ | Valeur |
   |---|---|
   | **Services ID** (pour le flow web) | `app.yaram.signin` |
   | **Secret Key (for OAuth)** | Team ID + Key ID + contenu `.p8` (voir ci-dessous) |
   | **Authorized Client IDs** (pour le flow iOS natif) | `app.yaram` |

4. Pour la Secret Key, Supabase propose 2 modes :
   - **Option A — Manuelle (recommandé)** : tu colles le contenu brut du `.p8` +
     Team ID + Key ID. Supabase signe lui-même les JWT à chaque requête (rolling).
   - **Option B — JWT pré-signé** : tu génères un JWT toi-même (valable 6 mois max).

   Pour Option A, Supabase demande :
   - **Team ID** : ton Team ID Apple (ex `ABC12DEF34`)
   - **Key ID** : le Key ID de la Key qu'on vient de créer
   - **Private Key** : copie-colle le contenu **entier** du fichier `.p8`
     (avec les lignes `-----BEGIN PRIVATE KEY-----` et `-----END PRIVATE KEY-----`)

5. Clique **Save**

> ⚠️ **Authorized Client IDs** : c'est ce champ qui permet au flow iOS natif de
> fonctionner. Sans lui, Supabase refusera l'identityToken envoyé depuis l'app
> avec une erreur "audience mismatch". Mets bien le **bundle ID iOS**
> (`app.yaram`), PAS le Services ID.

---

## 3. Build & Test iOS

### 3.1 Installer le plugin Capacitor

Dans `/Users/ousmanegakou/Documents/diaara` :

```bash
npm install
npx cap sync ios
```

### 3.2 Vérifier l'entitlement

Le fichier `ios/App/App/App.entitlements` doit contenir :

```xml
<key>com.apple.developer.applesignin</key>
<array>
  <string>Default</string>
</array>
```

C'est déjà censé être en place — vérifie quand même.

### 3.3 Build TestFlight

```bash
npm run build
npx cap sync ios
npx cap open ios
```

Dans Xcode :
1. Sélectionne le target App → Signing & Capabilities
2. Vérifie que **Sign in with Apple** est dans la liste des Capabilities
   (si absent : "+" Capability → Sign in with Apple)
3. Archive → Upload to App Store Connect
4. Distribute → TestFlight

### 3.4 Test sur device

1. Install la build TestFlight sur un iPhone (simulateur **ne marche pas** pour
   Sign in with Apple — il faut un device physique connecté à un Apple ID).
2. Ouvre l'app → écran d'inscription / login
3. Tape **"Continuer avec Apple"**
4. Le sheet biométrique iOS doit s'ouvrir (Face ID / Touch ID + double-clic)
5. Choisis "Share My Email" ou "Hide My Email"
6. → tu dois atterrir loggué dans YARAM

### 3.5 Test web (Safari desktop ou mobile)

1. Va sur https://yaram.app
2. Écran d'inscription → "Continuer avec Apple"
3. Redirect vers `appleid.apple.com` → flow OAuth standard
4. Retour sur yaram.app loggué

---

## 4. Points de vigilance Apple Review

- ✅ Le bouton Apple doit apparaître **au-dessus ou à côté** du bouton Google,
  **jamais en dessous** (Apple HIG). Dans notre code, il est juste au-dessus. OK.
- ✅ Texte du bouton : "Continuer avec Apple" ou "Sign in with Apple" (FR
  acceptée). OK.
- ✅ Logo Apple blanc sur fond noir (ou inverse). OK : `#000` + logo blanc.
- ✅ Hauteur minimum 44px (touch target iOS). OK : 48px.
- ✅ Border-radius cohérent avec les autres boutons. OK : 12px.
- ⚠️ Si l'utilisateur choisit "Hide My Email", Apple envoie un email-relay
  (`xxx@privaterelay.appleid.com`). Notre code Supabase le gère nativement,
  mais l'email **ne sera pas vérifiable** depuis ton domaine sans config DNS.
  Pour les emails transactionnels (welcome, panier abandonné), pense à
  configurer un Sender domain dans Apple Developer → More → Configure
  (optionnel pour passer la review, mais best practice).
- ⚠️ Le **nom** (firstName / lastName) n'est envoyé par Apple **qu'à la
  première connexion**. Si tu ne le persistes pas tout de suite dans
  `users_profile`, tu ne pourras plus le récupérer. Notre flow current
  n'attrape PAS encore le name → si tu veux le faire, c'est dans
  `signInWithApple()` de `src/lib/auth.js` :
  `result.response.givenName` + `result.response.familyName` à upserter
  dans `users_profile` juste après le `signInWithIdToken`.
- ⚠️ Apple exige aussi un moyen pour l'user de **supprimer son compte** in-app
  (Guideline 5.1.1(v)) — Profile → "Supprimer mon compte" doit exister ou
  ajouter avant submit, indépendamment de Sign in with Apple.

---

## 5. Checklist finale avant submit

- [ ] App ID `app.yaram` a "Sign In with Apple" coché
- [ ] Services ID `app.yaram.signin` créé et configuré avec le bon return URL Supabase
- [ ] Key `.p8` téléchargée et stockée en lieu sûr
- [ ] Team ID + Key ID notés
- [ ] Supabase Auth → Apple provider Enabled
- [ ] Authorized Client IDs Supabase = `app.yaram` (bundle ID iOS)
- [ ] Secret Key Supabase remplie (Team ID + Key ID + contenu .p8)
- [ ] `npm install` + `npx cap sync ios` faits
- [ ] Entitlement `com.apple.developer.applesignin` présent dans App.entitlements
- [ ] Test TestFlight OK sur device physique
- [ ] Bouton Apple visible AU-DESSUS du bouton Google sur tous les screens login

Une fois tout coché → tu peux soumettre la build à App Store Review sans
risque de rejet sur la Guideline 4.8.
