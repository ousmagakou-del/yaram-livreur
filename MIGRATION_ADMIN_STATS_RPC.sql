-- ═══════════════════════════════════════════════════════════════════
-- YARAM — Admin stats agregees + recherche full-table
-- ═══════════════════════════════════════════════════════════════════
-- Resout deux problemes performance/UX :
--
-- 1. StatsSection chargeait 10 000 commandes en JS et aggregeait cote
--    client => ne tient pas a 50k commandes. On bascule TOUT en SQL
--    via la RPC admin_get_stats() qui retourne un seul jsonb avec
--    les KPI, top 10 produits, top 10 pharmacies, evolution journaliere.
--
-- 2. OrdersSection recherche n'agit que sur la page chargee. On ajoute
--    admin_search_orders() qui WHERE id::text/address->>name/phone
--    sur TOUTE la table, avec pagination.
--
-- Schema oriente reel des `orders` :
--   id uuid, user_id, status text, total/subtotal/shipping numeric,
--   payment_method text, address jsonb, items jsonb[],
--   created_at timestamptz
-- Chaque item jsonb : { productId, name, qty, price, pharmacyId, pharmacyName }
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 1 : RPC admin_get_stats
-- ─────────────────────────────────────────────────────────────────────
-- Retourne un seul jsonb agrege pour la periode [period_start, period_end[.
-- Si period_end est null => now(). Si period_start null => -30j.

CREATE OR REPLACE FUNCTION public.admin_get_stats(
  p_token        text,
  p_period_start timestamptz DEFAULT NULL,
  p_period_end   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_start         timestamptz := COALESCE(p_period_start, now() - interval '30 days');
  v_end           timestamptz := COALESCE(p_period_end,   now());
  v_total_orders  bigint;
  v_total_revenue numeric;
  v_avg_basket    numeric;
  v_unique_clients bigint;
  v_by_status     jsonb;
  v_top_pharmacies jsonb;
  v_top_products  jsonb;
  v_daily         jsonb;
BEGIN
  PERFORM public._check_admin_session(p_token);

  -- ── Bloc KPI globaux ─────────────────────────────────────────────
  SELECT
    COUNT(*)::bigint,
    COALESCE(SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END), 0)::numeric,
    COALESCE(AVG(NULLIF(total, 0)), 0)::numeric,
    COUNT(DISTINCT user_id)::bigint
  INTO v_total_orders, v_total_revenue, v_avg_basket, v_unique_clients
  FROM public.orders
  WHERE created_at >= v_start AND created_at < v_end;

  -- ── Commandes par statut ─────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'status', s.status,
           'count',  s.cnt,
           'revenue', s.rev
         ) ORDER BY s.cnt DESC), '[]'::jsonb)
  INTO v_by_status
  FROM (
    SELECT status,
           COUNT(*)::bigint AS cnt,
           COALESCE(SUM(total), 0)::numeric AS rev
    FROM public.orders
    WHERE created_at >= v_start AND created_at < v_end
    GROUP BY status
  ) s;

  -- ── Top 10 pharmacies par CA (CA = qty * price agrege sur items) ─
  -- On explose les items jsonb et on agrege par pharmacyId.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'pharmacy_id',   p.pharmacy_id,
           'pharmacy_name', p.pharmacy_name,
           'qty',           p.qty,
           'revenue',       p.revenue
         ) ORDER BY p.revenue DESC), '[]'::jsonb)
  INTO v_top_pharmacies
  FROM (
    SELECT
      it->>'pharmacyId'   AS pharmacy_id,
      MAX(it->>'pharmacyName') AS pharmacy_name,
      SUM(COALESCE((it->>'qty')::int, 0))::bigint AS qty,
      SUM(COALESCE((it->>'qty')::numeric, 0) * COALESCE((it->>'price')::numeric, 0))::numeric AS revenue
    FROM public.orders o,
         LATERAL jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) AS it
    WHERE o.created_at >= v_start AND o.created_at < v_end
      AND it->>'pharmacyId' IS NOT NULL
    GROUP BY it->>'pharmacyId'
    ORDER BY revenue DESC
    LIMIT 10
  ) p;

  -- ── Top 10 produits par quantite vendue ──────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', p.product_id,
           'name',       p.name,
           'qty',        p.qty,
           'revenue',    p.revenue
         ) ORDER BY p.qty DESC), '[]'::jsonb)
  INTO v_top_products
  FROM (
    SELECT
      it->>'productId' AS product_id,
      MAX(it->>'name') AS name,
      SUM(COALESCE((it->>'qty')::int, 0))::bigint AS qty,
      SUM(COALESCE((it->>'qty')::numeric, 0) * COALESCE((it->>'price')::numeric, 0))::numeric AS revenue
    FROM public.orders o,
         LATERAL jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) AS it
    WHERE o.created_at >= v_start AND o.created_at < v_end
      AND it->>'productId' IS NOT NULL
    GROUP BY it->>'productId'
    ORDER BY qty DESC
    LIMIT 10
  ) p;

  -- ── Evolution journaliere ────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day',     to_char(d.day, 'YYYY-MM-DD'),
           'count',   d.cnt,
           'revenue', d.rev
         ) ORDER BY d.day ASC), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      date_trunc('day', created_at) AS day,
      COUNT(*)::bigint AS cnt,
      COALESCE(SUM(total), 0)::numeric AS rev
    FROM public.orders
    WHERE created_at >= v_start AND created_at < v_end
    GROUP BY 1
  ) d;

  RETURN jsonb_build_object(
    'period_start',    v_start,
    'period_end',      v_end,
    'total_orders',    v_total_orders,
    'total_revenue',   v_total_revenue,
    'avg_basket',      v_avg_basket,
    'unique_clients',  v_unique_clients,
    'by_status',       v_by_status,
    'top_pharmacies',  v_top_pharmacies,
    'top_products',    v_top_products,
    'daily',           v_daily
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_stats(text, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_stats(text, timestamptz, timestamptz)
  TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 2 : RPC admin_search_orders — recherche full-table
-- ─────────────────────────────────────────────────────────────────────
-- Avant : OrdersSection.jsx filtrait .filter(...) sur la PAGE COURANTE
--         => taper un n° de commande de la page 3 = "rien trouve".
-- Apres : on tape la query au serveur qui scanne TOUTE la table.

CREATE OR REPLACE FUNCTION public.admin_search_orders(
  p_token  text,
  p_query  text,
  p_limit  int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id             uuid,
  status         text,
  user_id        uuid,
  address        jsonb,
  items          jsonb,
  subtotal       numeric,
  shipping       numeric,
  total          numeric,
  payment_method text,
  created_at     timestamptz,
  full_count     bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_q text;
BEGIN
  PERFORM public._check_admin_session(p_token);

  -- Pattern ILIKE : on echappe % et _ pour eviter du wildcard non
  -- desire dans la query utilisateur (ex: si la cliente s'appelle "100%").
  v_q := '%' || replace(replace(COALESCE(p_query, ''), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT
    o.id,
    o.status,
    o.user_id,
    o.address,
    o.items,
    o.subtotal,
    o.shipping,
    o.total,
    o.payment_method,
    o.created_at,
    COUNT(*) OVER () AS full_count
  FROM public.orders o
  WHERE
    p_query IS NOT NULL
    AND length(trim(p_query)) > 0
    AND (
      o.id::text                    ILIKE v_q
      OR (o.address->>'name')       ILIKE v_q
      OR (o.address->>'phone')      ILIKE v_q
      OR (o.address->>'line')       ILIKE v_q
      OR (o.address->>'city')       ILIKE v_q
      OR (o.address->>'neighborhood') ILIKE v_q
    )
  ORDER BY o.created_at DESC
  LIMIT GREATEST(LEAST(p_limit, 200), 1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_orders(text, text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_search_orders(text, text, int, int)
  TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- FIN — test :
--   SELECT public.admin_get_stats('<token>',
--           now() - interval '30 days', now());
--   SELECT * FROM public.admin_search_orders('<token>', '77', 20, 0);
-- ═══════════════════════════════════════════════════════════════════
