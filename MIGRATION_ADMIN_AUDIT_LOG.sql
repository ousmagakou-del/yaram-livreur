-- ═══════════════════════════════════════════════════════════════════
-- YARAM — Admin audit log : table admin_logs + RPC admin_log_action
-- ═══════════════════════════════════════════════════════════════════
-- Objectif : tracer QUI (admin_id) a fait QUOI (action) sur QUEL OBJET
-- (target_type/target_id), avec snapshot before/after en jsonb.
--
-- La table admin_logs existait deja partiellement (utilisee par
-- adminAuth.js et cleanup_stale_pending_orders), mais sans colonnes
-- target_type / target_id / before / after / ip_address.
-- => migration idempotente : CREATE TABLE IF NOT EXISTS + ALTER ADD
--    COLUMN IF NOT EXISTS pour les nouveaux champs.
--
-- RLS : seul service_role lit en direct ; anon/auth ne lit RIEN, mais
-- peut INSERT via la RPC admin_log_action (SECURITY DEFINER) qui
-- verifie le token admin.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 1 : Table admin_logs
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    text,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

-- Si la table existait deja avec un schema partiel, on rajoute les
-- colonnes manquantes (idempotent — ne casse rien).
ALTER TABLE public.admin_logs
  ADD COLUMN IF NOT EXISTS admin_id    text,
  ADD COLUMN IF NOT EXISTS target_type text,
  ADD COLUMN IF NOT EXISTS target_id   text,
  ADD COLUMN IF NOT EXISTS before      jsonb,
  ADD COLUMN IF NOT EXISTS after       jsonb,
  ADD COLUMN IF NOT EXISTS ip_address  text,
  ADD COLUMN IF NOT EXISTS user_agent  text,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT NOW();

-- Indexes : on filtre principalement par admin, par action, et tri
-- desc sur created_at pour le dashboard audit.
CREATE INDEX IF NOT EXISTS admin_logs_admin_id_idx   ON public.admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS admin_logs_action_idx     ON public.admin_logs(action);
CREATE INDEX IF NOT EXISTS admin_logs_created_at_idx ON public.admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_logs_target_idx     ON public.admin_logs(target_type, target_id);


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 2 : RLS — service_role seul lecteur direct
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

-- Pas de policy SELECT/INSERT pour anon/auth => acces uniquement via
-- les RPC SECURITY DEFINER ci-dessous.
-- service_role bypass RLS par defaut.

-- Au cas ou une vieille policy permissive trainerait, on la dégage.
DROP POLICY IF EXISTS "admin_logs_select_all"   ON public.admin_logs;
DROP POLICY IF EXISTS "admin_logs_insert_all"   ON public.admin_logs;
DROP POLICY IF EXISTS "admin_logs_public_read"  ON public.admin_logs;


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 3 : RPC admin_log_action — point d'entree pour tracer une action
-- ─────────────────────────────────────────────────────────────────────
-- Verifie le token via _check_admin_session (defini dans
-- RLS_PHASE1_FOUNDATION.sql) puis ecrit la ligne avec admin_id derive
-- du token (jamais p_admin_id fourni par le client : non spoofable).

CREATE OR REPLACE FUNCTION public.admin_log_action(
  p_token       text,
  p_action      text,
  p_target_type text DEFAULT NULL,
  p_target_id   text DEFAULT NULL,
  p_before      jsonb DEFAULT NULL,
  p_after       jsonb DEFAULT NULL,
  p_user_agent  text  DEFAULT NULL,
  p_ip_address  text  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_log_id   uuid;
BEGIN
  -- Throw 'invalid_session' si token KO. On ne loggue PAS si l'appel
  -- est non-authentifie : empeche le bruit/spam.
  v_admin_id := public._check_admin_session(p_token);

  IF p_action IS NULL OR length(trim(p_action)) = 0 THEN
    RAISE EXCEPTION 'action_required';
  END IF;

  INSERT INTO public.admin_logs (
    admin_id, action, target_type, target_id,
    before, after, ip_address, user_agent
  ) VALUES (
    v_admin_id::text, p_action, p_target_type, p_target_id,
    p_before, p_after, p_ip_address, p_user_agent
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_log_action(text, text, text, text, jsonb, jsonb, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_log_action(text, text, text, text, jsonb, jsonb, text, text)
  TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 4 : (Optionnel) RPC admin_list_audit_log — lecture cote admin
-- ─────────────────────────────────────────────────────────────────────
-- adminApi.js reference deja cette RPC. On s'assure qu'elle existe et
-- qu'elle s'aligne sur le schema etendu.

CREATE OR REPLACE FUNCTION public.admin_list_audit_log(
  p_token  text,
  p_limit  int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id          uuid,
  admin_id    text,
  action      text,
  target_type text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public._check_admin_session(p_token);

  RETURN QUERY
  SELECT l.id, l.admin_id, l.action, l.target_type, l.target_id,
         l.before, l.after, l.ip_address, l.user_agent, l.created_at
  FROM public.admin_logs l
  ORDER BY l.created_at DESC
  LIMIT GREATEST(LEAST(p_limit, 500), 1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_audit_log(text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_audit_log(text, int, int)
  TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- FIN — verifier dans Studio :
--   SELECT * FROM public.admin_logs ORDER BY created_at DESC LIMIT 10;
--   SELECT public.admin_log_action('<token>', 'test_action', 'order', 'abc',
--          '{"x":1}'::jsonb, '{"x":2}'::jsonb, 'ua', NULL);
-- ═══════════════════════════════════════════════════════════════════
