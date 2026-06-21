-- =====================================================================
-- MIGRATION_LIVREUR_TOKEN_SECURE.sql
-- ---------------------------------------------------------------------
-- Securise les delivery_token livreur :
--   1. Ajoute une colonne d'expiration (delivery_token_expires_at)
--   2. Met une fenetre de transition de 7 jours pour les tokens existants
--   3. Met a jour les RPC livreur (load / update_tracking / update_order)
--      pour rejeter les tokens expires
--   4. Ajoute admin_rotate_livreur_token : permet a un admin de
--      regenerer un token cryptographiquement secure (16 bytes hex)
--      avec une duree de vie de 24h.
--
-- Hypotheses :
--   - table delivery_tracking(order_id, delivery_token, status, ...)
--   - fonction livreur_load_delivery(p_token text) RETURNS jsonb
--   - fonction livreur_update_tracking(p_token text, ...) RETURNS jsonb
--   - fonction livreur_update_order(p_token text, ...) RETURNS jsonb
--   - fonction admin_session_valid() RETURNS boolean (cookie/JWT admin)
--   - pgcrypto disponible pour gen_random_bytes
-- =====================================================================

BEGIN;

-- 0. Extension necessaire pour gen_random_bytes
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- 1. Colonne d'expiration
-- =====================================================================
ALTER TABLE delivery_tracking
  ADD COLUMN IF NOT EXISTS delivery_token_expires_at timestamptz;

-- Index pour filtrer rapidement les tokens encore valides
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_token_valid
  ON delivery_tracking (delivery_token, delivery_token_expires_at)
  WHERE delivery_token IS NOT NULL;

-- =====================================================================
-- 2. Transition douce : tokens existants -> expire dans 7 jours
--    On ne touche pas aux livraisons deja terminees ou annulees.
-- =====================================================================
UPDATE delivery_tracking
SET delivery_token_expires_at = NOW() + INTERVAL '7 days'
WHERE delivery_token_expires_at IS NULL
  AND status NOT IN ('delivered', 'cancelled');

-- =====================================================================
-- 3. livreur_load_delivery : rejette token expire
-- =====================================================================
CREATE OR REPLACE FUNCTION livreur_load_delivery(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tracking delivery_tracking%ROWTYPE;
  v_order    jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT * INTO v_tracking
  FROM delivery_tracking
  WHERE delivery_token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  -- Check expiration
  IF v_tracking.delivery_token_expires_at IS NOT NULL
     AND v_tracking.delivery_token_expires_at < NOW() THEN
    RETURN jsonb_build_object('error', 'token_expired');
  END IF;

  SELECT to_jsonb(o.*) INTO v_order
  FROM orders o
  WHERE o.id = v_tracking.order_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'tracking', to_jsonb(v_tracking),
    'order',    v_order
  );
END;
$$;

GRANT EXECUTE ON FUNCTION livreur_load_delivery(text) TO anon, authenticated;

-- =====================================================================
-- 4. livreur_update_tracking : meme check
-- =====================================================================
CREATE OR REPLACE FUNCTION livreur_update_tracking(
  p_token   text,
  p_patch   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tracking delivery_tracking%ROWTYPE;
  v_updated  delivery_tracking%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT * INTO v_tracking
  FROM delivery_tracking
  WHERE delivery_token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  IF v_tracking.delivery_token_expires_at IS NOT NULL
     AND v_tracking.delivery_token_expires_at < NOW() THEN
    RETURN jsonb_build_object('error', 'token_expired');
  END IF;

  -- Mise a jour controlee : on n'autorise qu'un sous-ensemble de cles
  UPDATE delivery_tracking
  SET status       = COALESCE(p_patch->>'status', status),
      latitude     = COALESCE((p_patch->>'latitude')::numeric, latitude),
      longitude    = COALESCE((p_patch->>'longitude')::numeric, longitude),
      proof_url    = COALESCE(p_patch->>'proof_url', proof_url),
      notes        = COALESCE(p_patch->>'notes', notes),
      updated_at   = NOW()
  WHERE delivery_token = p_token
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object('tracking', to_jsonb(v_updated));
END;
$$;

GRANT EXECUTE ON FUNCTION livreur_update_tracking(text, jsonb) TO anon, authenticated;

-- =====================================================================
-- 5. livreur_update_order : meme check
-- =====================================================================
CREATE OR REPLACE FUNCTION livreur_update_order(
  p_token   text,
  p_patch   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tracking delivery_tracking%ROWTYPE;
  v_order    jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT * INTO v_tracking
  FROM delivery_tracking
  WHERE delivery_token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  IF v_tracking.delivery_token_expires_at IS NOT NULL
     AND v_tracking.delivery_token_expires_at < NOW() THEN
    RETURN jsonb_build_object('error', 'token_expired');
  END IF;

  -- Champs orders que le livreur peut toucher : status, delivered_at
  UPDATE orders
  SET status       = COALESCE(p_patch->>'status', status),
      delivered_at = COALESCE((p_patch->>'delivered_at')::timestamptz, delivered_at),
      updated_at   = NOW()
  WHERE id = v_tracking.order_id
  RETURNING to_jsonb(orders.*) INTO v_order;

  RETURN jsonb_build_object('order', v_order);
END;
$$;

GRANT EXECUTE ON FUNCTION livreur_update_order(text, jsonb) TO anon, authenticated;

-- =====================================================================
-- 6. admin_rotate_livreur_token
--    Regenere un token livreur crypto-secure (16 bytes hex = 128 bits)
--    avec une expiration courte (24h). Reserve aux admins.
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_rotate_livreur_token(
  p_old_token text,
  p_order_id  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin   boolean;
  v_new_token  text;
  v_tracking   delivery_tracking%ROWTYPE;
BEGIN
  -- Verification admin (s'appuie sur la fonction admin_session_valid existante)
  BEGIN
    v_is_admin := admin_session_valid();
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'admin_session_valid() introuvable : impossible de rotater le token sans verification admin';
  END;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  -- Identifie la ligne a rotater (par token courant OU par order_id)
  SELECT * INTO v_tracking
  FROM delivery_tracking
  WHERE (p_old_token IS NOT NULL AND delivery_token = p_old_token)
     OR (p_order_id  IS NOT NULL AND order_id        = p_order_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'tracking_not_found');
  END IF;

  -- Generation cryptographiquement secure (128 bits)
  v_new_token := 'LIV-' || upper(encode(gen_random_bytes(16), 'hex'));

  UPDATE delivery_tracking
  SET delivery_token             = v_new_token,
      delivery_token_expires_at  = NOW() + INTERVAL '24 hours',
      updated_at                 = NOW()
  WHERE order_id = v_tracking.order_id;

  RETURN jsonb_build_object(
    'token',      v_new_token,
    'expires_at', NOW() + INTERVAL '24 hours',
    'order_id',   v_tracking.order_id
  );
END;
$$;

-- Pas de GRANT a anon : seul un client utilisant la session admin
-- (typiquement service_role + admin_session_valid()) doit pouvoir appeler.
GRANT EXECUTE ON FUNCTION admin_rotate_livreur_token(text, text) TO authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK manuel si besoin :
--   ALTER TABLE delivery_tracking DROP COLUMN delivery_token_expires_at;
--   DROP FUNCTION admin_rotate_livreur_token(text, text);
--   (et restaurer les versions precedentes de livreur_load_delivery,
--    livreur_update_tracking, livreur_update_order)
-- =====================================================================
