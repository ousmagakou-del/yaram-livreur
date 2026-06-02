-- ════════════════════════════════════════════════════════
-- YARAM — Migration FCM : adapter user_devices pour FCM tokens
-- ════════════════════════════════════════════════════════
--
-- À exécuter dans Supabase SQL editor.
-- Ajoute la colonne fcm_token + index unique. Garde l'ancienne colonne
-- onesignal_player_id pour compat (au cas où des vieilles installs
-- traînent), mais on ne l'utilise plus à partir de maintenant.
-- ════════════════════════════════════════════════════════

-- 1. Ajoute la colonne fcm_token
ALTER TABLE user_devices
  ADD COLUMN IF NOT EXISTS fcm_token TEXT;

-- 2. Index unique sur fcm_token (utilisé par upsert dans register-push-device)
CREATE UNIQUE INDEX IF NOT EXISTS user_devices_fcm_token_key
  ON user_devices(fcm_token)
  WHERE fcm_token IS NOT NULL;

-- 3. Index pour fetch rapide par user
CREATE INDEX IF NOT EXISTS user_devices_user_id_fcm_idx
  ON user_devices(user_id)
  WHERE fcm_token IS NOT NULL AND push_enabled = true;

-- 4. RPC : désactiver push pour un device par registration_id (au lieu de player_id)
CREATE OR REPLACE FUNCTION set_device_push_enabled(
  p_registration_id UUID,
  p_enabled BOOLEAN
) RETURNS VOID AS $$
BEGIN
  UPDATE user_devices
  SET push_enabled = p_enabled,
      last_seen_at = NOW()
  WHERE id = p_registration_id
    AND user_id = auth.uid();  -- security : seul le owner peut modifier
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_device_push_enabled(UUID, BOOLEAN) TO authenticated;

-- 5. (Optionnel) Voir l'état des devices après migration
-- SELECT
--   COUNT(*) FILTER (WHERE fcm_token IS NOT NULL) AS fcm_devices,
--   COUNT(*) FILTER (WHERE onesignal_player_id IS NOT NULL) AS old_onesignal_devices,
--   COUNT(*) FILTER (WHERE push_enabled = true) AS active_devices
-- FROM user_devices;
