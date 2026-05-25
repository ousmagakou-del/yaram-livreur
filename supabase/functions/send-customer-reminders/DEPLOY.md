# Déploiement du système de rappels clients YARAM

Système qui envoie automatiquement 4 types de rappels WhatsApp aux clientes,
chaque jour à 9h00 UTC via GitHub Actions cron + edge function Supabase.

## 🎯 Les 4 types de rappels

| Type | Quand il se déclenche | Anti-doublon | Message |
|---|---|---|---|
| **replenishment** | Quand 80-95% de `usage_duration_days` d'un produit acheté est écoulé | Pas re-envoyé pour ce produit avant 90j | "Ton sérum acheté il y a 50j va bientôt finir, voilà -10%" |
| **reengagement** | User qui n'a pas commandé depuis 60+ jours | Max 1× par 90 jours | "Ça fait un moment, voilà -15% pour revenir" |
| **anniversary** | Pile 1 an après la 1ère commande | 1× dans la vie | "Joyeux 1 an chez YARAM, voilà -20%" |
| **scan_refresh** | User dont le dernier scan IA date de 90+ jours | Max 1× par 120 jours | "Ton dernier scan date d'il y a 95j, refais-en un" |

## 1. Migration SQL (1 fois)

[Supabase SQL Editor](https://supabase.com/dashboard/project/qxhhnrnworwrnwmqekmb/sql/new)

Colle le contenu de `supabase/migrations/customer_reminders.sql` → **Run**.

Cela :
- Ajoute `usage_duration_days` (INT, défaut 60) à `products`
- Met à jour les défauts par catégorie (sérum 60j, parfum 180j, etc.)
- Crée la table `reminder_logs` (anti-doublon)
- Crée la RPC `admin_reminder_stats(token, days)` pour le dashboard admin

## 2. Configure les secrets Supabase

[Dashboard → Edge Functions → Secrets](https://supabase.com/dashboard/project/qxhhnrnworwrnwmqekmb/functions)

| Clé | Valeur |
|---|---|
| `REMINDER_CRON_TOKEN` | Génère un UUID aléatoire : `openssl rand -hex 32` |
| `WASENDER_API_KEY` | (déjà setup pour Marketing) |

Le `REMINDER_CRON_TOKEN` empêche que n'importe qui sur Internet puisse trigger l'envoi de tes rappels en spam. Seul ton GitHub Actions le connaîtra.

## 3. Déploie l'edge function

Via Dashboard web (recommandé si CLI Supabase pas configurée) :

1. Edge Functions → **+ Create a new function**
2. Nom : `send-customer-reminders` (**exactement** ce nom, sinon le cron ne le trouve pas)
3. Code : colle le contenu de `supabase/functions/send-customer-reminders/index.ts`
4. **Deploy function**

Ou via CLI :
```bash
cd /Users/ousmanegakou/Documents/diaara
supabase functions deploy send-customer-reminders --project-ref qxhhnrnworwrnwmqekmb
```

## 4. Configure le secret GitHub Actions

[Repo GitHub → Settings → Secrets and variables → Actions](https://github.com/ousmagakou-del/diaara/settings/secrets/actions)

Bouton **New repository secret** :

| Nom | Valeur |
|---|---|
| `REMINDER_CRON_TOKEN` | **Exactement** la même valeur que celle posée dans Supabase ci-dessus |

## 5. Active le workflow GitHub Actions

Le fichier `.github/workflows/customer-reminders.yml` est déjà en place. Il :
- Tourne tous les jours à 9h UTC (cron `0 9 * * *`)
- Peut être déclenché manuellement depuis l'onglet **Actions** → **Customer Reminders (daily)** → **Run workflow**

## 6. Premier test (dry run)

Avant d'envoyer des vrais messages, fais un **dry run** depuis GitHub Actions :

1. Onglet **Actions** → workflow **Customer Reminders (daily)**
2. Bouton **Run workflow**
3. Inputs :
   - `types` : (laisse vide pour tous)
   - `dry_run` : ☑ coche
4. **Run**

Tu verras dans les logs :
```json
{
  "success": true,
  "dry_run": true,
  "stats": {
    "replenishment": { "sent": 3, "failed": 0, "skipped": 0 },
    "reengagement": { "sent": 12, "failed": 0, "skipped": 0 },
    "anniversary": { "sent": 0, "failed": 0, "skipped": 0 },
    "scan_refresh": { "sent": 5, "failed": 0, "skipped": 0 }
  },
  "total_sent": 20
}
```

Ça te dit "j'aurais envoyé 20 messages" sans rien envoyer. Parfait pour vérifier les volumes.

## 7. Premier vrai run

Si le dry run a l'air sain (volumes raisonnables, pas 5000 messages d'un coup) :

1. Re-run du workflow sans cocher `dry_run`
2. Surveille `reminder_logs` dans Supabase pour voir les envois :

```sql
SELECT type, status, COUNT(*) AS nb, MAX(sent_at) AS last_sent
FROM reminder_logs
WHERE sent_at > now() - interval '24 hours'
GROUP BY type, status
ORDER BY type, status;
```

## 🔍 Monitoring

### Dashboard simple (depuis SQL Editor)

```sql
-- Rappels envoyés ce mois par type
SELECT type, channel, status, COUNT(*) AS nb
FROM reminder_logs
WHERE sent_at > now() - interval '30 days'
GROUP BY type, channel, status
ORDER BY type, channel, status;

-- Détail des dernières échecs
SELECT user_id, type, error_text, sent_at
FROM reminder_logs
WHERE status = 'failed'
ORDER BY sent_at DESC
LIMIT 50;

-- Conversion : combien ont commandé dans les 7 jours après leur rappel
SELECT
  rl.type,
  COUNT(DISTINCT rl.user_id) AS rappels_envoyes,
  COUNT(DISTINCT o.user_id) AS users_qui_ont_commande,
  ROUND(100.0 * COUNT(DISTINCT o.user_id) / NULLIF(COUNT(DISTINCT rl.user_id), 0), 1) AS conversion_pct
FROM reminder_logs rl
LEFT JOIN orders o
  ON o.user_id = rl.user_id
  AND o.created_at BETWEEN rl.sent_at AND rl.sent_at + interval '7 days'
WHERE rl.status = 'sent'
  AND rl.sent_at > now() - interval '60 days'
GROUP BY rl.type;
```

### RPC admin (utilisable depuis le dashboard admin futur)

```js
const { data } = await supabase.rpc('admin_reminder_stats', {
  p_token: adminToken,
  p_days: 30,
});
```

## ⚠️ Bonnes pratiques anti-ban WhatsApp

L'edge function fait déjà :
- **2 sec** de délai entre 2 envois
- Vérification anti-doublon (pas re-envoyé pour le même contexte)
- Skip silencieux si pas de téléphone valide

Mais à toi de :
- Surveiller le volume quotidien (idéalement < 200 messages/jour au début)
- Désactiver le cron si tu vois des plaintes / désinscriptions massives
- Si > 100 envois/jour réguliers → envisager migration vers WhatsApp Business Cloud API officielle

## 🛠 Pour désactiver temporairement

Le plus simple :
1. Va sur GitHub → onglet **Actions**
2. Sélectionne le workflow **Customer Reminders (daily)**
3. Bouton **"..." → Disable workflow**

Pour réactiver : même menu → **Enable workflow**.

## 🎨 Personnaliser les templates

Les 4 templates de messages sont dans `index.ts` (fonctions `tplReplenishment`, `tplReengagement`, `tplAnniversary`, `tplScanRefresh`).

Pour modifier, édite le fichier et redéploie l'edge function. Variables disponibles :
- `firstName` (prénom client)
- `productName`, `brand`, `daysAgo`, `productUrl` (replenishment)

## 🚀 Évolutions futures

À ajouter plus tard (pas urgent) :
- [ ] Envoi par email en plus de WhatsApp si user a opt-in email
- [ ] Templates stockés en DB (modifiables sans redéploie)
- [ ] A/B testing : 50% du temps message A, 50% message B → comparer conversion
- [ ] Rappel "favori en promo" (un produit dans wishlist passe en promo)
- [ ] Notification push native iOS via OneSignal (en plus de WhatsApp)
