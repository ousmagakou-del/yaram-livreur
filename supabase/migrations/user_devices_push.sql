-- ════════════════════════════════════════════════════════
-- YARAM — Table user_devices pour push notifications (OneSignal)
-- ════════════════════════════════════════════════════════
-- Chaque user peut avoir plusieurs devices (iPhone perso + iPad + autre iPhone).
-- On stocke le OneSignal player_id de chaque device pour pouvoir envoyer
-- des pushs ciblés depuis l'edge function backend.
--
-- À exécuter UNE FOIS dans Supabase Dashboard → SQL Editor.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  onesignal_player_id text NOT NULL,    -- OneSignal "subscription ID"
  platform           text NOT NULL DEFAULT 'ios'
                     CHECK (platform IN ('ios', 'android', 'web')),
  push_enabled       boolean NOT NULL DEFAULT true,
  language           text DEFAULT 'fr',
  app_version        text,              -- ex "1.0.2"
  device_model       text,              -- ex "iPhone 17 Pro"
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Un même player_id ne peut être lié qu'à 1 user à la fois
  -- (si l'user change : on update push_enabled = false et on insert le nouveau)
  CONSTRAINT user_devices_player_unique UNIQUE (onesignal_player_id)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user
  ON user_devices (user_id, push_enabled, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_devices_platform
  ON user_devices (platform, push_enabled);

-- RLS : l'user peut voir/update SES propres devices, personne d'autre
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

-- READ : l'user peut lire ses propres devices
DROP POLICY IF EXISTS "user_devices read own" ON user_devices;
CREATE POLICY "user_devices read own"
  ON user_devices FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT : l'user peut créer un device pour lui-même
DROP POLICY IF EXISTS "user_devices insert own" ON user_devices;
CREATE POLICY "user_devices insert own"
  ON user_devices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE : l'user peut modifier ses propres devices (toggle push_enabled, update last_seen_at)
DROP POLICY IF EXISTS "user_devices update own" ON user_devices;
CREATE POLICY "user_devices update own"
  ON user_devices FOR UPDATE
  USING (auth.uid() = user_id);

-- DELETE : l'user peut désinscrire un device
DROP POLICY IF EXISTS "user_devices delete own" ON user_devices;
CREATE POLICY "user_devices delete own"
  ON user_devices FOR DELETE
  USING (auth.uid() = user_id);

-- ─── RPC pour upsert d'un device (appelé depuis le client) ───
-- Évite les conflits si l'app re-register le même player_id à chaque boot.
CREATE OR REPLACE FUNCTION public.register_device(
  p_player_id text,
  p_platform text DEFAULT 'ios',
  p_app_version text DEFAULT NULL,
  p_device_model text DEFAULT NULL,
  p_language text DEFAULT 'fr'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_device_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- Upsert : si le player_id existe déjà → update user_id (case device repris par autre user)
  INSERT INTO user_devices (user_id, onesignal_player_id, platform, app_version, device_model, language, last_seen_at)
  VALUES (v_user_id, p_player_id, p_platform, p_app_version, p_device_model, p_language, now())
  ON CONFLICT (onesignal_player_id) DO UPDATE SET
    user_id      = v_user_id,
    platform     = EXCLUDED.platform,
    app_version  = EXCLUDED.app_version,
    device_model = EXCLUDED.device_model,
    language     = EXCLUDED.language,
    push_enabled = true,
    last_seen_at = now()
  RETURNING id INTO v_device_id;

  RETURN v_device_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_device(text, text, text, text, text) TO authenticated;

-- ─── RPC pour disable push (toggle dans settings user) ───
CREATE OR REPLACE FUNCTION public.set_device_push_enabled(
  p_player_id text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  UPDATE user_devices
  SET push_enabled = p_enabled,
      last_seen_at = now()
  WHERE onesignal_player_id = p_player_id
    AND user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_device_push_enabled(text, boolean) TO authenticated;

-- ─── (Future) Log des pushs envoyés pour analytics ───
CREATE TABLE IF NOT EXISTS public.push_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid,                 -- nullable : si broadcast à tous
  player_id       text,                 -- nullable : si broadcast
  notification_id text,                 -- ID OneSignal retourné par leur API
  type            text NOT NULL DEFAULT 'manual'
                  CHECK (type IN ('manual', 'order_status', 'replenishment', 'reengagement', 'anniversary', 'scan_refresh', 'welcome')),
  title           text,
  message         text,
  url             text,
  status          text NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'failed', 'queued')),
  error_text      text,
  sent_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_logs_sent_at ON push_logs (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_logs_user_type ON push_logs (user_id, type, sent_at DESC);

ALTER TABLE push_logs ENABLE ROW LEVEL SECURITY;
-- Pas de policy = seul service_role (edge function) peut lire/écrire
