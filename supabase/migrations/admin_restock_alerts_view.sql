-- ════════════════════════════════════════════════════════════════════
-- YARAM — Admin · Alertes restock globales
-- ════════════════════════════════════════════════════════════════════
--
-- Deux RPC SECURITY DEFINER exposées au panel admin web :
--   1. admin_list_all_restock_alerts(p_filter text)
--        Liste les `restock_alerts` jointes pharmacy_name + product_name + image_url.
--        p_filter ∈ ('active', 'acknowledged', 'dismissed', 'restocked', 'all')
--          - 'active'       : dismissed=false ET restocked=false (acknowledged ou non)
--          - 'acknowledged' : acknowledged_at IS NOT NULL ET dismissed=false ET restocked=false
--          - 'dismissed'    : dismissed=true
--          - 'restocked'    : restocked=true
--          - 'all'          : aucune restriction
--
--   2. admin_restock_alert_stats()
--        Retourne {pending, critical_count, warning_count, today_new}.
--
-- Garde-fou : refus si NOT public.is_admin() — la fonction is_admin() est
-- définie ailleurs (SECURITY_AUDIT_FIXES.sql section 5).
--
-- Idempotent. Pas de DROP destructif sur les données.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) admin_list_all_restock_alerts(p_filter text)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_all_restock_alerts(p_filter text DEFAULT 'active')
RETURNS TABLE (
  id               uuid,
  pharmacy_id      uuid,
  pharmacy_name    text,
  product_id       uuid,
  product_name     text,
  brand            text,
  image_url        text,
  alert_type       text,
  severity         text,
  current_stock    integer,
  threshold        integer,
  acknowledged_at  timestamptz,
  dismissed        boolean,
  dismissed_at     timestamptz,
  restocked        boolean,
  restocked_at     timestamptz,
  notified_at      timestamptz,
  created_at       timestamptz,
  age_days         integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_filter text := lower(coalesce(p_filter, 'active'));
BEGIN
  -- Garde-fou admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_filter NOT IN ('active', 'acknowledged', 'dismissed', 'restocked', 'all') THEN
    RAISE EXCEPTION 'invalid filter: %', p_filter USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    ra.id,
    ra.pharmacy_id,
    ph.name                       AS pharmacy_name,
    ra.product_id,
    pr.name                       AS product_name,
    pr.brand                      AS brand,
    COALESCE(pr.image_url, pr.img) AS image_url,
    ra.alert_type::text           AS alert_type,
    ra.severity::text             AS severity,
    ra.current_stock,
    ra.threshold,
    ra.acknowledged_at,
    ra.dismissed,
    ra.dismissed_at,
    ra.restocked,
    ra.restocked_at,
    ra.notified_at,
    ra.created_at,
    GREATEST(0, EXTRACT(DAY FROM (now() - ra.created_at))::int) AS age_days
  FROM public.restock_alerts ra
  LEFT JOIN public.pharmacies ph ON ph.id = ra.pharmacy_id
  LEFT JOIN public.products   pr ON pr.id = ra.product_id
  WHERE
    CASE v_filter
      WHEN 'active'       THEN ra.dismissed = false AND ra.restocked = false
      WHEN 'acknowledged' THEN ra.acknowledged_at IS NOT NULL
                           AND ra.dismissed = false
                           AND ra.restocked = false
      WHEN 'dismissed'    THEN ra.dismissed = true
      WHEN 'restocked'    THEN ra.restocked = true
      ELSE TRUE
    END
  ORDER BY
    CASE ra.severity::text
      WHEN 'critical' THEN 0
      WHEN 'warning'  THEN 1
      WHEN 'info'     THEN 2
      ELSE 3
    END,
    ra.created_at DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_all_restock_alerts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_all_restock_alerts(text) TO authenticated, anon;
-- ↑ exécutable par anon car le panel admin web n'a pas de session auth.users —
--   la garde réside dans is_admin() (admin_users.email + auth.uid()).
--   ⚠️ Si en prod le panel admin fait du JWT custom, durcir ce GRANT.

COMMENT ON FUNCTION public.admin_list_all_restock_alerts(text)
  IS 'Admin : liste cross-pharmacies des restock_alerts avec joins. Filter : active|acknowledged|dismissed|restocked|all';

-- ─────────────────────────────────────────────────────────────────────
-- 2) admin_restock_alert_stats()
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_restock_alert_stats()
RETURNS TABLE (
  pending         integer,
  critical_count  integer,
  warning_count   integer,
  today_new       integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (
      WHERE dismissed = false
        AND restocked = false
    )::int                                                       AS pending,
    COUNT(*) FILTER (
      WHERE severity::text = 'critical'
        AND dismissed = false
        AND restocked = false
    )::int                                                       AS critical_count,
    COUNT(*) FILTER (
      WHERE severity::text = 'warning'
        AND dismissed = false
        AND restocked = false
    )::int                                                       AS warning_count,
    COUNT(*) FILTER (
      WHERE created_at >= date_trunc('day', now())
    )::int                                                       AS today_new
  FROM public.restock_alerts;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_restock_alert_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_restock_alert_stats() TO authenticated, anon;

COMMENT ON FUNCTION public.admin_restock_alert_stats()
  IS 'Admin : KPI agrégés sur restock_alerts (pending, critical, warning, today_new).';

COMMIT;
