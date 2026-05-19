# Déploiement de `send-whatsapp-bulk`

Edge function qui envoie des messages WhatsApp en bulk via WaSenderAPI.

## 1. Migration SQL (1 fois)

Va dans Supabase Dashboard → **SQL Editor** → colle et exécute :

```
supabase/migrations/wasender_campaigns.sql
```

(Crée la table `marketing_campaigns` + la RPC `admin_list_campaigns`.)

## 2. Configure les secrets Supabase

Dashboard → **Edge Functions** → **Secrets** → ajoute :

| Clé | Valeur | Obligatoire ? |
|---|---|---|
| `WASENDER_API_KEY` | Ta clé API depuis wasenderapi.com | **OUI** |
| `WASENDER_API_URL` | `https://wasenderapi.com/api/send-message` | Non (default OK) |
| `WASENDER_RATE_MS` | `2500` (= 2.5 sec entre 2 envois) | Non (default OK) |

⚠️ Si tu utilises un autre service (UltraMsg, Whapi, Wassenger), ajuste `WASENDER_API_URL` et adapte le body de la requête dans `index.ts` (chaque service a son propre format).

## 3. Déploie la fonction

Depuis ton terminal Mac :

```bash
cd /Users/ousmanegakou/Documents/diaara

# Première fois : installe la CLI Supabase si pas déjà fait
brew install supabase/tap/supabase

# Login (1 fois)
supabase login

# Lien avec ton projet (1 fois)
supabase link --project-ref qxhhnrnworwrnwmqekmb

# Déploie l'edge function
supabase functions deploy send-whatsapp-bulk
```

Ou alternative : via Dashboard → **Edge Functions** → **New function** → colle le contenu de `index.ts`.

## 4. Teste depuis le terminal (recommandé avant prod)

```bash
# Récupère ton token admin actif :
# - Connecte-toi à yaram.app/?admin
# - Console navigateur : JSON.parse(sessionStorage.getItem('yaram-admin-session')).token

curl -X POST "https://qxhhnrnworwrnwmqekmb.supabase.co/functions/v1/send-whatsapp-bulk" \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "TON_TOKEN_ADMIN",
    "campaign_name": "Test depuis curl",
    "recipients": [
      { "phone": "221774388766", "text": "🧪 Test YARAM depuis edge function" }
    ]
  }'
```

Attendu :
```json
{
  "success": true,
  "campaign_id": "...",
  "sent": 1,
  "failed": 0,
  "total": 1,
  "details": [{ "phone": "221774388766", "status": "sent", "message_id": "..." }]
}
```

## 5. Teste depuis l'interface YARAM

1. `yaram.app/?admin`
2. Onglet **Marketing**
3. Sélectionne 1 ou 2 clientes (avec téléphone valide)
4. Vérifie que **Méthode d'envoi** = `WaSender (bulk auto)`
5. Clique **Envoyer aux X**
6. Confirme la popup
7. La progress bar s'affiche, puis le bilan : `✅ X envoyés · Y échecs`

## ⚠️ Bonnes pratiques anti-ban WhatsApp

- **Pas plus de 100-200 messages/jour** vers nouveaux numéros (premiers 30 jours)
- **Pas plus de 500/jour** après réchauffement du numéro
- **Ne pas envoyer 2 campagnes en parallèle** (le délai 2.5s peut casser)
- **Évite les contenus marketing évidents** : pas de "GAGNEZ 10000€", pas de liens raccourcis bit.ly
- **Préviens tes users** qu'ils peuvent recevoir des messages YARAM (consentement RGPD)

## 🔍 Voir l'historique des campagnes

Les campagnes sont loggées dans `marketing_campaigns`. Pour voir depuis SQL Editor :

```sql
SELECT name, sent_count, failed_count, status, created_at
FROM marketing_campaigns
ORDER BY created_at DESC
LIMIT 20;
```

Pour voir le détail d'échecs d'une campagne :

```sql
SELECT name, details
FROM marketing_campaigns
WHERE id = 'campaign-uuid-ici';
```

(Le `details` est un JSON `[{ phone, status, message_id?, error? }, ...]`.)

## 🔄 Si tu changes de service WhatsApp

Si tu passes de WaSenderAPI à UltraMsg/Whapi/Wassenger, change dans `index.ts` :

```typescript
// AVANT (WaSenderAPI) :
body: JSON.stringify({ to: phone, text: r.text })

// EXEMPLE UltraMsg :
body: new URLSearchParams({
  token: WASENDER_KEY,
  to: phone,
  body: r.text,
})

// EXEMPLE Whapi.cloud :
body: JSON.stringify({ to: phone + "@s.whatsapp.net", body: r.text })
```

Puis re-déploie : `supabase functions deploy send-whatsapp-bulk`.
