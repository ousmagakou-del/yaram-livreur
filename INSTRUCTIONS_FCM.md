# YARAM — Migration FCM : étapes finales

## ✅ Code déjà fait (par Claude)

- `package.json` → remplacé `@capacitor/push-notifications` par `@capacitor-firebase/messaging` + `@capacitor-firebase/app`
- `src/lib/push.js` → réécrit pour utiliser FCM via `@capacitor-firebase/messaging`
- `ios/App/App/AppDelegate.swift` → ajout `FirebaseApp.configure()`
- `ios/App/App/GoogleService-Info.plist` → ajouté + référencé dans pbxproj
- `supabase/functions/register-push-device/index.ts` → stocke fcm_token au lieu de OneSignal player_id
- `supabase/functions/send-push-notification/index.ts` → envoie via FCM HTTP v1 API
- `MIGRATION_FCM.sql` → migration de la table user_devices
- `build-ios.sh` → ajoute `npm install` au début pour les nouveaux plugins

## 🔧 Ce que tu dois faire

### 1. Migration SQL (2 min)

Ouvre Supabase → SQL Editor → colle le contenu de `MIGRATION_FCM.sql` → Run.

### 2. Récupérer le service account Firebase (5 min)

Le serveur a besoin d'un compte de service Firebase pour signer les JWT et appeler l'API FCM.

a. Va sur https://console.firebase.google.com/project/yaram-7912f/settings/serviceaccounts/adminsdk
b. Clique **Generate new private key** → confirme
c. Un fichier JSON est téléchargé (ex: `yaram-7912f-firebase-adminsdk-xxxxx.json`)
d. Ouvre le fichier dans un éditeur de texte
e. Copie TOUT le contenu (du `{` au `}`)

### 3. Ajouter le secret dans Supabase (2 min)

a. Va sur https://supabase.com/dashboard/project/[ton-project-ref]/functions
b. Onglet **Secrets** (ou **Edge Functions → Settings → Secrets**)
c. Clique **Add new secret**
d. **Name** : `FCM_SERVICE_ACCOUNT_JSON`
e. **Value** : colle tout le JSON
f. Save

### 4. Build + Upload (15 min)

```bash
cd ~/Documents/diaara
bash build-ios.sh
```

Ouvre Transporter, drag-and-drop `~/Documents/diaara/build/App.ipa`, **Deliver**.

Build **1.0.3 (23)** apparaîtra dans App Store Connect — toujours avec le logo Y vert (icônes inchangées).

### 5. Test sur iPhone

a. TestFlight → YARAM → **Update**
b. Force-quit l'app (swipe up + close)
c. Relance YARAM, login
d. 3 sec après login → popup **"YARAM voudrait t'envoyer des notifications"** → **Autoriser**
e. Profil → **🔧 [DEBUG] Tester push iOS** → tape dessus
   - Tu verras un alert avec le FCM token (chaîne ~152 caractères, commence par `e...` ou similaire)
   - Status : `ok: true, fcmToken: "..."`
f. Vérifie dans Supabase :
   - Table `user_devices` doit avoir une nouvelle ligne avec ton `fcm_token` rempli
g. Test envoi : depuis Admin → Notifications → broadcast à toi-même
   - Tu dois recevoir la notif sur ton iPhone (même si l'app est fermée)

## ⚠️ Si le popup ne sort pas

Si après login le popup système n'apparaît pas :
1. Vérifie iOS : Réglages → YARAM → est-ce que tu vois Notifications maintenant ?
2. Si oui mais désactivé → active manuellement
3. Si pas du tout listé → relance le bouton DEBUG, l'erreur exacte sera dans l'alert

## 📊 Architecture finale

```
┌─────────────┐    FCM token     ┌──────────────────┐
│ iOS YARAM   │ ───────────────→ │ register-push-   │
│ (Firebase   │                  │ device           │
│ Messaging   │                  │ → user_devices   │
│ SDK)        │                  └──────────────────┘
└─────────────┘                          ↓
                                  ┌──────────────────┐
                                  │ Supabase DB      │
                                  │ user_devices     │
                                  │ .fcm_token       │
                                  └──────────────────┘
                                          ↑
                                          │
┌─────────────┐    send notif    ┌──────────────────┐
│ Admin /     │ ───────────────→ │ send-push-       │
│ trigger DB  │                  │ notification     │
└─────────────┘                  │ → FCM HTTP v1    │
                                 └──────────────────┘
                                          │
                                          ↓
                                  ┌──────────────────┐
                                  │ Google FCM       │
                                  │ → APNs (iOS)     │
                                  │ → device iPhone  │
                                  └──────────────────┘
```

Plus de OneSignal. Direct iOS → Firebase → APNs → iPhone.
