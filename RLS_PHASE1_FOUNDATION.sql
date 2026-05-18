-- ═══════════════════════════════════════════════════════════════════
-- YARAM — RLS Phase 1 : Foundation session admin
-- À exécuter dans Supabase Studio
-- ═══════════════════════════════════════════════════════════════════
-- S'appuie sur l'existant :
--   - Table public.admin_users (déjà en place, avec PIN hashé)
--   - RPC verify_admin_pin(p_email, p_pin) (déjà en place)
--   - Table admin_logs (déjà en place)
--
-- Ajoute uniquement la pièce manquante : un système de TOKEN SIGNÉ
-- côté serveur, pour que les futures RPCs admin puissent vérifier
-- qu'une requête vient bien d'un admin authentifié.
--
-- AUCUN BREAKING CHANGE. L'app continue de fonctionner exactement
-- comme avant. Le code adminLogin() actuel n'est pas modifié.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- 1. Extension pgcrypto (pour gen_random_bytes)
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ─────────────────────────────────────────────────────────────────────
-- 2. Table admin_sessions
-- ─────────────────────────────────────────────────────────────────────
-- Chaque login admin crée une ligne ici avec un token aléatoire 256 bits.
-- Le token est ce que le client passera dans chaque RPC admin.

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  token        text PRIMARY KEY,
  admin_id     uuid NOT NULL,
  admin_email  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '8 hours'),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text,
  ip_hint      text
);

CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON public.admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx   ON public.admin_sessions(admin_id);

ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
-- AUCUNE policy → table inaccessible en REST direct. Accès uniquement
-- via les RPCs SECURITY DEFINER ci-dessous.


-- ─────────────────────────────────────────────────────────────────────
-- 3. RPC admin_start_session(email, pin) → { token, admin, expires_at }
-- ─────────────────────────────────────────────────────────────────────
-- Wrapper autour de verify_admin_pin qui ajoute la création d'un token.
-- À appeler depuis adminLogin() dans lib/adminAuth.js.

CREATE OR REPLACE FUNCTION public.admin_start_session(
  p_email      text,
  p_pin        text,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row    record;
  v_token  text;
BEGIN
  -- Reutilise la verif existante (déjà bcrypt-hashée et SECURITY DEFINER)
  SELECT * INTO v_row
  FROM public.verify_admin_pin(lower(trim(p_email)), p_pin)
  LIMIT 1;

  IF v_row IS NULL OR v_row.result_id IS NULL THEN
    -- Ralentit brute-force
    PERFORM pg_sleep(1);
    RAISE EXCEPTION 'invalid_credentials';
  END IF;

  -- Genere token aleatoire 256 bits hex
  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.admin_sessions (token, admin_id, admin_email, user_agent)
  VALUES (v_token, v_row.result_id, v_row.result_email, p_user_agent);

  -- Cleanup sessions expirees (housekeeping)
  DELETE FROM public.admin_sessions WHERE expires_at < now();

  RETURN jsonb_build_object(
    'token',       v_token,
    'admin_id',    v_row.result_id,
    'admin_email', v_row.result_email,
    'admin_name',  v_row.result_name,
    'admin_role',  v_row.result_role,
    'permissions', v_row.result_permissions,
    'expires_at',  (now() + interval '8 hours')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_start_session(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_start_session(text, text, text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 4. RPC admin_end_session(token)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_end_session(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  DELETE FROM public.admin_sessions WHERE token = p_token;
$$;

REVOKE ALL ON FUNCTION public.admin_end_session(text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_end_session(text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 5. RPC interne _check_admin_session(token) → uuid admin_id
-- ─────────────────────────────────────────────────────────────────────
-- Helper utilisé par TOUTES les futures RPCs admin pour valider le token.
-- Met aussi à jour last_used_at (sliding window).

CREATE OR REPLACE FUNCTION public._check_admin_session(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RAISE EXCEPTION 'invalid_session';
  END IF;

  UPDATE public.admin_sessions
  SET last_used_at = now()
  WHERE token = p_token
    AND expires_at > now()
  RETURNING admin_id INTO v_admin_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'invalid_session';
  END IF;

  RETURN v_admin_id;
END;
$$;

REVOKE ALL ON FUNCTION public._check_admin_session(text) FROM public;
-- Pas de GRANT EXECUTE : usage interne par les RPCs SECURITY DEFINER uniquement.


-- ─────────────────────────────────────────────────────────────────────
-- 6. Premier exemple : RPC admin_list_orders(token, limit, offset)
-- ─────────────────────────────────────────────────────────────────────
-- Servira de modèle pour toutes les futures RPCs admin.
-- Remplace la lecture directe de `orders` dans OrdersSection.jsx.

CREATE OR REPLACE FUNCTION public.admin_list_orders(
  p_token  text,
  p_limit  int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id                 uuid,
  order_number       text,
  status             text,
  customer_name      text,
  customer_phone     text,
  customer_address   text,
  pharmacy_id        uuid,
  total_amount       numeric,
  payment_method     text,
  created_at         timestamptz,
  delivered_at       timestamptz,
  full_count         bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public._check_admin_session(p_token);

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.status,
    o.customer_name,
    o.customer_phone,
    o.customer_address,
    o.pharmacy_id,
    o.total_amount,
    o.payment_method,
    o.created_at,
    o.delivered_at,
    COUNT(*) OVER () AS full_count
  FROM public.orders o
  ORDER BY o.created_at DESC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_orders(text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_orders(text, int, int) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 7. VÉRIFICATION FINALE
-- ─────────────────────────────────────────────────────────────────────
-- Une fois ce script exécuté, teste avec ton compte admin existant :
--
-- SELECT public.admin_start_session('ton.email@example.com', 'TON_PIN', 'test');
--   → doit retourner { token: "abc...", admin_id, admin_email, admin_name,
--                      admin_role, permissions, expires_at }
--
-- Puis avec le token retourné :
-- SELECT * FROM public.admin_list_orders('TON_TOKEN', 5, 0);
--   → doit retourner jusqu'à 5 commandes avec full_count
--
-- Sans token valide :
-- SELECT * FROM public.admin_list_orders('faux_token', 5, 0);
--   → doit lever 'invalid_session'


-- ═══════════════════════════════════════════════════════════════════
-- DONE — Foundation installée, zéro breaking change
-- ═══════════════════════════════════════════════════════════════════
-- Phase 2 (suivante) :
--   - Créer ~15 RPCs admin_xxx supplémentaires
--   - Refactor lib/adminAuth.js pour appeler admin_start_session et
--     stocker le token dans sessionStorage
--   - Refactor chaque section admin pour utiliser les RPCs au lieu de
--     supabase.from('xxx').select()
--
-- Phase 3 :
--   - DROP des policies "Anyone can ..." dangereuses (orders read all,
--     users_profile read, commission_payments, etc.)
-- ═══════════════════════════════════════════════════════════════════
