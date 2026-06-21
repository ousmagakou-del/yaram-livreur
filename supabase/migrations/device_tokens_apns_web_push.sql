-- ════════════════════════════════════════════════════════════════════
-- YARAM — Table device_tokens (APNs natif + Web Push VAPID)
-- ════════════════════════════════════════════════════════════════════
--
-- Remplace progressivement `user_devices` (qui stockait onesignal_player_id).
-- L'ancienne table reste pour la transition — on n'y touche pas ici.
--
-- Un user peut avoir N devices, chacun étant soit :
--   - type = 'apns'      → apns_token rempli, web_* null
--   - type = 'web_push'  → web_endpoint + web_p256dh + web_auth remplis, apns_token null
--
-- À exécuter UNE FOIS dans Supabase Dashboard → SQL Editor.
-- NOTE : la mise à jour du trigger `_push_on_order_status_change` qui
-- consomme cette table vit dans un fichier séparé
-- (`update_push_trigger_to_send_push.sql`).
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('apns','web_push')),
  apns_token text,
  web_endpoint text,
  web_p256dh text,
  web_auth text,
  platform text,
  app_version text,
  enabled boolean DEFAULT true,
  last_seen_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (user_id, apns_token),
  UNIQUE NULLS NOT DISTINCT (user_id, web_endpoint)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_enabled
  ON public.device_tokens(user_id) WHERE enabled = true;

-- ─── RLS ──────────────────────────────────────────────
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_tokens_select_own ON public.device_tokens;
CREATE POLICY device_tokens_select_own ON public.device_tokens
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS device_tokens_insert_own ON public.device_tokens;
CREATE POLICY device_tokens_insert_own ON public.device_tokens
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS device_tokens_delete_own ON public.device_tokens;
CREATE POLICY device_tokens_delete_own ON public.device_tokens
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- UPDATE policy : l'user peut toggle enabled + refresh last_seen_at sur ses propres rows
DROP POLICY IF EXISTS device_tokens_update_own ON public.device_tokens;
CREATE POLICY device_tokens_update_own ON public.device_tokens
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
