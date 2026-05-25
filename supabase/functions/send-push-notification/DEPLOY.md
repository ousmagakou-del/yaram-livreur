# Déploiement Push Notifications iOS (OneSignal) pour YARAM

Système complet de push notifications iOS via OneSignal :
- Auto push sur change de status commande (paid, shipped, delivered, etc.)
- Broadcast manuel depuis l'admin (promo flash, nouveaux produits)
- Hook automatique via Capacitor init au boot

## Architecture

```
┌─────────────────────────────────────────┐
│ iPhone (Capacitor) → OneSignal SDK      │
│  - request permission                   │
│  - get player_id                        │
│  - register in DB (table user_devices)  │
└─────────────────────────────────────────┘
                  ↑
                  │ register_device RPC
                  ↓
┌─────────────────────────────────────────┐
│ Supabase                                │
│  - user_devices (player_id par user)    │
│  - push_logs (analytics)                │
└─────────────────────────────────────────┘
                  ↑
                  │ trigger
                  ↓
┌─────────────────────────────────────────┐
│ Edge function send-push-notification    │
│  → OneSignal REST API                   │
│       → APNs                            │
│           → iPhone notif lock screen    │
└─────────────────────────────────────────┘
```

## 1. Migration SQL (1 fois)

[SQL Editor](https://supabase.com/dashboard/project/qxhhnrnworwrnwmqekmb/sql/new) → colle `supabase/migrations/user_devices_push.sql` → **Run**.

Crée :
- Table `user_devices` (1 row par device, lié à `auth.users.id`)
- Table `push_logs` (1 row par push envoyé)
- RPC `register_device(player_id, platform, app_version, device_model, language)` pour upsert depuis le client
- RPC `set_device_push_enabled(player_id, enabled)` pour toggle

## 2. Secrets Supabase

[Edge Functions Secrets](https://supabase.com/dashboard/project/qxhhnrnworwrnwmqekmb/functions) :

| Clé | Valeur | Source |
|---|---|---|
| `ONESIGNAL_APP_ID` | `8ea329a7-538c-427f-9df7-f09a22046cb1` | OneSignal Settings → Keys & IDs |
| `ONESIGNAL_REST_KEY` | `os_v2_app_...` (long token) | OneSignal Settings → Keys & IDs |
| `INTERNAL_PUSH_SECRET` | (optionnel) | Génère avec `openssl rand -hex 32` |

L'`INTERNAL_PUSH_SECRET` permet à une autre edge function (ex: `send-customer-reminders`) d'appeler `send-push-notification` sans token admin. Pour l'instant pas critique.

## 3. Deploy l'edge function

Dashboard → Edge Functions → **Create function** :
- Nom : `send-push-notification` (exactement)
- Code : copie `supabase/functions/send-push-notification/index.ts`
- Deploy

Ou CLI :
```bash
supabase functions deploy send-push-notification --project-ref qxhhnrnworwrnwmqekmb
```

## 4. Installer le plugin Capacitor + activer Push Notifications dans Xcode

### Étape 4.1 — Installer le plugin

```bash
cd /Users/ousmanegakou/Documents/diaara
npm install @onesignal/onesignal-capacitor
npx cap sync ios
```

### Étape 4.2 — Activer Push Notifications capability dans Xcode

1. Ouvre `ios/App/App.xcworkspace` (ou `App.xcodeproj` si pas de workspace)
2. Sélectionne le projet **App** → target **App** → onglet **Signing & Capabilities**
3. Bouton **"+ Capability"** en haut à gauche
4. Cherche **"Push Notifications"** → double-clique pour l'ajouter
5. Bouton **"+ Capability"** → ajoute aussi **"Background Modes"**
6. Dans **Background Modes**, coche **"Remote notifications"**
7. ⌘S pour sauvegarder

⚠️ Cette modification ajoute la capability **APNs** au build. Sans ça, iOS refuse les notifs push.

### Étape 4.3 — Vérifier que ça compile

Build dans Xcode (⌘B). Doit pass sans erreur.

## 5. Bump version + Archive + Upload (1.0.2)

```bash
cd /Users/ousmanegakou/Documents/diaara
npm run build
npx cap sync ios
cd ios/App
agvtool new-marketing-version 1.0.2
agvtool new-version -all 9
cd ../..
```

Xcode :
1. **Product → Clean Build Folder** (⇧⌘K)
2. **Any iOS Device (arm64)** comme cible
3. **Product → Archive**
4. Organizer → **Distribute App → App Store Connect → Upload**

## 6. Sur App Store Connect

1. Crée la version **1.0.2** (bouton **+ Version** dans le menu gauche de ta fiche)
2. Sélectionne le build **1.0.2 (9)** après upload (10-30 min)
3. **Release Notes** :

```
Nouveautés :
• Notifications push : reçois en temps réel le statut de tes
  commandes (paiement confirmé, livraison en cours…)
• Promotions exclusives directement sur ton iPhone
• Diverses corrections et améliorations

Note : tu peux gérer tes notifications dans Réglages → YARAM.
```

4. **Add for Review** → soumets

⏱ Apple Review : **24-48h** typiquement pour une update.

## 7. Test rapide (après publication 1.0.2)

### Test #1 — Verify subscription après login
1. Sur ton iPhone, désinstalle + réinstalle YARAM (pour reset les permissions)
2. Ouvre l'app, fais ton onboarding/login
3. Tu dois voir la popup système iOS **"YARAM Notifications"** → tap **"Autoriser"**
4. Vérifie dans Supabase SQL Editor :
   ```sql
   SELECT user_id, onesignal_player_id, platform, last_seen_at
   FROM user_devices
   ORDER BY created_at DESC
   LIMIT 5;
   ```
   Tu dois voir ton device avec ton user_id.

### Test #2 — Push de test depuis l'admin
1. Va dans `yaram.app/?admin` → menu **"🔔 Push iOS"** (nouvelle section)
2. Tape un titre + message
3. Clique **"Envoyer à toutes les clientes iOS"**
4. Confirme
5. Sous 10 sec, ton iPhone doit recevoir la notif sur l'écran de verrouillage

### Test #3 — Auto-push status commande
1. Admin → Commandes → trouve une commande de toi
2. Clique **"Avancer"** pour passer au statut suivant
3. Push notif arrive sur ton iPhone : "✅ Paiement reçu !"

## 8. Monitoring

```sql
-- Push envoyés ce mois par type
SELECT type, status, COUNT(*) AS nb
FROM push_logs
WHERE sent_at > now() - interval '30 days'
GROUP BY type, status
ORDER BY type, status;

-- Échecs récents
SELECT user_id, type, title, error_text, sent_at
FROM push_logs
WHERE status = 'failed'
ORDER BY sent_at DESC
LIMIT 50;

-- Devices actifs par platform
SELECT platform, push_enabled, COUNT(*) AS nb
FROM user_devices
GROUP BY platform, push_enabled
ORDER BY platform, push_enabled;
```

## 🛠 Troubleshooting

### "no_active_devices" quand on tape Envoyer
- L'user n'a pas encore donné la permission iOS
- Ou il a refusé / désinscrit
- Solution : invite-le à ré-autoriser dans Réglages iOS → YARAM → Notifications

### Le push arrive sur OneSignal mais pas sur l'iPhone
- Vérifie que la capability "Push Notifications" est bien activée dans Xcode
- Vérifie que le build uploadé contient bien le plugin (npx cap sync avant Archive)
- Vérifie sur OneSignal Dashboard → Audience → ton device est listé

### "onesignal_error" 401 unauthorized
- REST API Key invalide / a expiré → re-génère sur OneSignal Settings

### Test sur TestFlight ne marche pas mais App Store oui (ou inversement)
- Vérifier sur Apple Developer que la clé APNs a bien **"Sandbox & Production"** activé (pas juste Sandbox)

## 🚀 Évolutions futures

- [ ] Notification push depuis le système de rappels (Replenishment, etc.) en complément WhatsApp
- [ ] Settings page : toggle push notif on/off dans le profil user
- [ ] Push avec image (rich notification) — supporté par OneSignal
- [ ] Push interactif avec boutons (Liked / Not Liked, Confirm / Cancel)
- [ ] Géofencing (envoyer push quand l'user est proche d'une pharmacie partenaire)
