-- ════════════════════════════════════════════════════════════════════
-- YARAM — admin oversight RPCs for Tier 3 verify_requests
-- ════════════════════════════════════════════════════════════════════
--
-- Contexte
-- --------
-- Tier 3 = pharmacien humain valide après une analyse IA initiale.
-- Le flow :
--   1) user scanne un produit douteux  → row dans verify_requests, status='pending_ai'
--   2) Edge Function Gemini Vision     → ai_verdict, ai_confidence, ai_notes,
--                                         detected_brand, detected_product_id,
--                                         status='ai_done'
--   3) (optionnel) user paie le Tier 3 → amount_paid > 0, paid_at, assigne
--                                         pharmacist_id; status='pending_pharmacist'
--   4) pharmacien répond via app mobile → pharmacist_verdict, pharmacist_notes,
--                                         responded_at, status='completed'
--   5) si verdict='counterfeit' → declenche un counterfeit_report
--
-- L'admin n'agit JAMAIS sur le verdict ici. Il a juste un panneau
-- d'observation : qui a payé, qui attend, qui a fini, combien de
-- contrefaçons par jour, combien de revenu Tier 3 cumulé.
--
-- Les RPCs sont SECURITY DEFINER + check is_admin().
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- admin_list_verify_requests(p_filter)
-- ───────────────────────────────────────────────────────────────────
-- p_filter ∈ ('all', 'pending_pharmacist', 'ai_done', 'completed', 'suspect')
--   - 'pending_pharmacist' : status = 'pending_pharmacist'
--   - 'ai_done'            : status = 'ai_done' (Tier 1/2, IA seule)
--   - 'completed'          : status = 'completed'
--   - 'suspect'            : verdict (pharmacist OR ai) = 'counterfeit'
--   - 'all' (default)      : tout
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_verify_requests(p_filter text DEFAULT 'all')
RETURNS TABLE (
  id               uuid,
  created_at       timestamptz,
  status           text,
  barcode          text,
  photo_urls       jsonb,
  ai_verdict       text,
  ai_confidence    numeric,
  ai_notes         text,
  detected_brand   text,
  detected_product_id uuid,
  product_name     text,
  pharmacist_id    uuid,
  pharmacist_name  text,
  pharmacist_verdict text,
  pharmacist_notes text,
  responded_at     timestamptz,
  amount_paid      numeric,
  paid_at          timestamptz,
  user_id          uuid,
  user_name        text,
  user_email       text,
  user_phone       text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    vr.id,
    vr.created_at,
    vr.status,
    vr.barcode,
    vr.photo_urls,
    vr.ai_verdict,
    vr.ai_confidence,
    vr.ai_notes,
    vr.detected_brand,
    vr.detected_product_id,
    p.name              AS product_name,
    vr.pharmacist_id,
    ph.name             AS pharmacist_name,
    vr.pharmacist_verdict,
    vr.pharmacist_notes,
    vr.responded_at,
    vr.amount_paid,
    vr.paid_at,
    vr.user_id,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''),
             up.first_name,
             'Utilisateur') AS user_name,
    up.email            AS user_email,
    up.phone            AS user_phone
  FROM public.verify_requests vr
  LEFT JOIN public.users_profile up ON up.user_id = vr.user_id
  LEFT JOIN public.pharmacies    ph ON ph.id      = vr.pharmacist_id
  LEFT JOIN public.products      p  ON p.id       = vr.detected_product_id
  WHERE
    CASE COALESCE(p_filter, 'all')
      WHEN 'pending_pharmacist' THEN vr.status = 'pending_pharmacist'
      WHEN 'ai_done'            THEN vr.status = 'ai_done'
      WHEN 'completed'          THEN vr.status = 'completed'
      WHEN 'suspect'            THEN COALESCE(vr.pharmacist_verdict, vr.ai_verdict) = 'counterfeit'
      ELSE TRUE
    END
  ORDER BY vr.created_at DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_verify_requests(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_verify_requests(text) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- admin_get_verify_request(p_id)
-- Détail complet : tous les champs IA + pharmacien + user
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_verify_request(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT to_jsonb(row) INTO v
  FROM (
    SELECT
      vr.id,
      vr.created_at,
      vr.status,
      vr.barcode,
      vr.photo_urls,

      -- IA
      vr.ai_verdict,
      vr.ai_confidence,
      vr.ai_notes,
      vr.ai_raw,
      vr.detected_brand,
      vr.detected_product_id,
      p.name  AS product_name,
      p.brand AS product_brand,
      p.img   AS product_img,

      -- Pharmacien
      vr.pharmacist_id,
      ph.name         AS pharmacist_name,
      ph.city         AS pharmacist_city,
      vr.pharmacist_verdict,
      vr.pharmacist_notes,
      vr.responded_at,

      -- Paiement
      vr.amount_paid,
      vr.paid_at,
      vr.payment_method,

      -- User
      vr.user_id,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''),
               up.first_name, 'Utilisateur') AS user_name,
      up.email AS user_email,
      up.phone AS user_phone,

      -- Counterfeit report lié (si verdict counterfeit)
      cr.id    AS counterfeit_report_id,
      cr.status AS counterfeit_report_status
    FROM public.verify_requests vr
    LEFT JOIN public.users_profile up    ON up.user_id = vr.user_id
    LEFT JOIN public.pharmacies    ph    ON ph.id      = vr.pharmacist_id
    LEFT JOIN public.products      p     ON p.id       = vr.detected_product_id
    LEFT JOIN public.counterfeit_reports cr ON cr.verify_request_id = vr.id
    WHERE vr.id = p_id
    LIMIT 1
  ) row;

  IF v IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_verify_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_verify_request(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- admin_verify_request_stats()
-- 5 KPIs + revenu
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_verify_request_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_total              bigint;
  v_pending_pharmacist bigint;
  v_ai_done            bigint;
  v_completed_today    bigint;
  v_counterfeit_today  bigint;
  v_total_revenue      numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*)                                                            INTO v_total              FROM public.verify_requests;
  SELECT COUNT(*) FILTER (WHERE status = 'pending_pharmacist')               INTO v_pending_pharmacist FROM public.verify_requests;
  SELECT COUNT(*) FILTER (WHERE status = 'ai_done')                          INTO v_ai_done            FROM public.verify_requests;
  SELECT COUNT(*) FILTER (
    WHERE status = 'completed'
      AND responded_at >= date_trunc('day', NOW())
  )                                                                          INTO v_completed_today    FROM public.verify_requests;
  SELECT COUNT(*) FILTER (
    WHERE COALESCE(pharmacist_verdict, ai_verdict) = 'counterfeit'
      AND COALESCE(responded_at, created_at) >= date_trunc('day', NOW())
  )                                                                          INTO v_counterfeit_today  FROM public.verify_requests;
  SELECT COALESCE(SUM(amount_paid), 0)                                       INTO v_total_revenue      FROM public.verify_requests WHERE paid_at IS NOT NULL;

  RETURN jsonb_build_object(
    'total',              v_total,
    'pending_pharmacist', v_pending_pharmacist,
    'ai_done',            v_ai_done,
    'completed_today',    v_completed_today,
    'counterfeit_today',  v_counterfeit_today,
    'total_revenue',      v_total_revenue
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verify_request_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_verify_request_stats() TO authenticated, service_role;

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- Notes d'intégration
-- ────────────────────────────────────────────────────────────────────
-- 1) Les colonnes utilisées côté verify_requests :
--      id, created_at, status, barcode, photo_urls (jsonb),
--      ai_verdict, ai_confidence, ai_notes, ai_raw, detected_brand,
--      detected_product_id, pharmacist_id, pharmacist_verdict,
--      pharmacist_notes, responded_at, amount_paid, paid_at,
--      payment_method, user_id
--    Si certaines n'existent pas dans le schéma actuel, ajouter :
--      ALTER TABLE verify_requests
--        ADD COLUMN IF NOT EXISTS ai_raw         jsonb,
--        ADD COLUMN IF NOT EXISTS payment_method text;
--
-- 2) users_profile DOIT être joinable via user_id (cf ReviewsSection
--    qui fait `users_profile!user_id`). Les colonnes attendues :
--      first_name, last_name, email, phone, user_id
--
-- 3) ATTENTION FLOW DÉSACTIVATION PRODUIT AUTO :
--    `admin_verify_counterfeit(p_id, p_verdict='confirmed', p_notes)` côté
--    counterfeit_reports met `products.active = false` quand le produit
--    cible est identifié. Le front affiche déjà un warning, mais NE
--    JAMAIS supprimer le warning : un confirm sans notes est interdit.
-- ════════════════════════════════════════════════════════════════════
