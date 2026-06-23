-- =====================================================================
-- MIGRATION P0 #2 — RLS lockdown des tables admin sensibles
-- =====================================================================
-- Date    : 2026-06-22
-- Auteur  : Yaram Top 5 P0 fixes
-- Audit   : voir AUDIT_COMPLET_YARAM.md + session local_84216a91-…
--
-- Objet :
--   1. Créer les RPC SECURITY DEFINER manquantes pour brands, categories,
--      banners, app_promos. Ces RPC remplacent les UPDATE/INSERT/DELETE
--      directs faits depuis l'admin et toutes vérifient le token admin
--      via _check_admin_session(p_token).
--   2. RESTRICTION ÉCRITURE (anon/authenticated) — drop des policies
--      permissives. Le SELECT public est gardé (les apps lisent le
--      catalogue, les bannières, les categories…).
--   3. App_promos : table déjà bien protégée par MIGRATION_RLS_HARDENING.sql
--      (anon SELECT seul, écriture service_role) → on ajoute juste la RPC
--      pour l'admin.
--
-- ⚠️ ORDRE D'EXÉCUTION CRITIQUE :
--   a. Lance d'abord cette migration (elle crée les RPC).
--   b. Déploie le front (BrandsSection + CategoriesSection passent par RPC).
--   c. Décommente la PARTIE 6 ci-dessous et relance la migration pour
--      finir le lockdown (drop des policies permissives write).
--
-- Idempotent  : OUI (DROP IF EXISTS / CREATE OR REPLACE).
-- Re-runnable : OUI.
--
-- Rollback :
--   DROP FUNCTION IF EXISTS public.admin_upsert_brand(text, uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.admin_delete_brand(text, uuid);
--   DROP FUNCTION IF EXISTS public.admin_upsert_category(text, uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.admin_delete_category(text, uuid);
--   DROP FUNCTION IF EXISTS public.admin_upsert_banner(text, uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.admin_delete_banner(text, uuid);
--   DROP FUNCTION IF EXISTS public.admin_upsert_app_promo(text, uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.admin_delete_app_promo(text, uuid);
--   -- + ré-ouvrir les policies si elles ont été drop en PARTIE 6.
-- =====================================================================

-- ─── 0. RLS ON sur les tables ciblées (idempotent) ────────────────────
ALTER TABLE IF EXISTS public.brands         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.banners        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_promos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.site_settings  ENABLE ROW LEVEL SECURITY;

-- ─── 1. SELECT public (idempotent — pas de changement métier) ─────────
DROP POLICY IF EXISTS "brands_select_public"     ON public.brands;
CREATE POLICY "brands_select_public"
  ON public.brands FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "categories_select_public" ON public.categories;
CREATE POLICY "categories_select_public"
  ON public.categories FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "banners_select_public"    ON public.banners;
CREATE POLICY "banners_select_public"
  ON public.banners FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "products_select_public"   ON public.products;
CREATE POLICY "products_select_public"
  ON public.products FOR SELECT TO anon, authenticated USING (true);


-- ─── 2. RPC admin_upsert_brand / admin_delete_brand ───────────────────
CREATE OR REPLACE FUNCTION public.admin_upsert_brand(
  p_token   text,
  p_id      uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_id       uuid;
BEGIN
  v_admin_id := public._check_admin_session(p_token);
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'payload_invalid');
  END IF;
  IF coalesce(p_payload->>'name', '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'name_required');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.brands (name, country, city, img, tagline, story, local)
    VALUES (
      p_payload->>'name',
      NULLIF(p_payload->>'country', ''),
      NULLIF(p_payload->>'city', ''),
      NULLIF(p_payload->>'img', ''),
      NULLIF(p_payload->>'tagline', ''),
      NULLIF(p_payload->>'story', ''),
      coalesce((p_payload->>'local')::boolean, false)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.brands SET
      name    = p_payload->>'name',
      country = NULLIF(p_payload->>'country', ''),
      city    = NULLIF(p_payload->>'city', ''),
      img     = CASE WHEN p_payload ? 'img' THEN NULLIF(p_payload->>'img', '') ELSE img END,
      tagline = NULLIF(p_payload->>'tagline', ''),
      story   = NULLIF(p_payload->>'story', ''),
      local   = coalesce((p_payload->>'local')::boolean, false)
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_brand(text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_upsert_brand(text, uuid, jsonb) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.admin_delete_brand(
  p_token text,
  p_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_admin_id uuid;
BEGIN
  v_admin_id := public._check_admin_session(p_token);
  DELETE FROM public.brands WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_brand(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_delete_brand(text, uuid) TO anon, authenticated;


-- ─── 3. RPC admin_upsert_category / admin_delete_category ─────────────
CREATE OR REPLACE FUNCTION public.admin_upsert_category(
  p_token   text,
  p_id      uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_id       uuid;
BEGIN
  v_admin_id := public._check_admin_session(p_token);
  IF coalesce(p_payload->>'name', '') = '' OR coalesce(p_payload->>'slug', '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'name_and_slug_required');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.categories (name, slug, bg_color, text_color, display_order, active, icon_url)
    VALUES (
      p_payload->>'name',
      p_payload->>'slug',
      coalesce(p_payload->>'bg_color',   '#F4F4F2'),
      coalesce(p_payload->>'text_color', '#1A1A1A'),
      coalesce((p_payload->>'display_order')::int, 999),
      coalesce((p_payload->>'active')::boolean, true),
      NULLIF(p_payload->>'icon_url', '')
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.categories SET
      name          = p_payload->>'name',
      slug          = p_payload->>'slug',
      bg_color      = coalesce(p_payload->>'bg_color',   bg_color),
      text_color    = coalesce(p_payload->>'text_color', text_color),
      display_order = coalesce((p_payload->>'display_order')::int, display_order),
      active        = coalesce((p_payload->>'active')::boolean, active),
      icon_url      = CASE WHEN p_payload ? 'icon_url' THEN NULLIF(p_payload->>'icon_url', '') ELSE icon_url END
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_category(text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_upsert_category(text, uuid, jsonb) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.admin_delete_category(
  p_token text,
  p_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_admin_id uuid;
BEGIN
  v_admin_id := public._check_admin_session(p_token);
  DELETE FROM public.categories WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_category(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_delete_category(text, uuid) TO anon, authenticated;


-- ─── 4. RPC admin_upsert_banner / admin_delete_banner ─────────────────
CREATE OR REPLACE FUNCTION public.admin_upsert_banner(
  p_token   text,
  p_id      uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_id       uuid;
BEGIN
  v_admin_id := public._check_admin_session(p_token);
  IF coalesce(p_payload->>'title', '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'title_required');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.banners (
      title, subtitle, sponsor_name, image_url, bg_color, text_color,
      cta_text, link_type, link_target, display_order, active, end_date
    )
    VALUES (
      p_payload->>'title',
      NULLIF(p_payload->>'subtitle', ''),
      NULLIF(p_payload->>'sponsor_name', ''),
      NULLIF(p_payload->>'image_url', ''),
      coalesce(p_payload->>'bg_color',   '#1F8B4C'),
      coalesce(p_payload->>'text_color', '#FFFFFF'),
      coalesce(p_payload->>'cta_text',   'Voir plus'),
      coalesce(p_payload->>'link_type',  'none'),
      NULLIF(p_payload->>'link_target', ''),
      coalesce((p_payload->>'display_order')::int, 99),
      coalesce((p_payload->>'active')::boolean, true),
      NULLIF(p_payload->>'end_date', '')::timestamptz
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.banners SET
      title         = coalesce(p_payload->>'title', title),
      subtitle      = CASE WHEN p_payload ? 'subtitle'     THEN NULLIF(p_payload->>'subtitle','')     ELSE subtitle END,
      sponsor_name  = CASE WHEN p_payload ? 'sponsor_name' THEN NULLIF(p_payload->>'sponsor_name','') ELSE sponsor_name END,
      image_url     = CASE WHEN p_payload ? 'image_url'    THEN NULLIF(p_payload->>'image_url','')    ELSE image_url END,
      bg_color      = coalesce(p_payload->>'bg_color',   bg_color),
      text_color    = coalesce(p_payload->>'text_color', text_color),
      cta_text      = coalesce(p_payload->>'cta_text',   cta_text),
      link_type     = coalesce(p_payload->>'link_type',  link_type),
      link_target   = CASE WHEN p_payload ? 'link_target' THEN NULLIF(p_payload->>'link_target','') ELSE link_target END,
      display_order = coalesce((p_payload->>'display_order')::int, display_order),
      active        = coalesce((p_payload->>'active')::boolean, active),
      end_date      = CASE WHEN p_payload ? 'end_date' THEN NULLIF(p_payload->>'end_date','')::timestamptz ELSE end_date END,
      updated_at    = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_banner(text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_upsert_banner(text, uuid, jsonb) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.admin_delete_banner(
  p_token text,
  p_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_admin_id uuid;
BEGIN
  v_admin_id := public._check_admin_session(p_token);
  DELETE FROM public.banners WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_banner(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_delete_banner(text, uuid) TO anon, authenticated;


-- ─── 5. RPC admin_upsert_app_promo / admin_delete_app_promo ───────────
-- app_promos a déjà ses policies write = service_role uniquement (cf.
-- MIGRATION_RLS_HARDENING.sql §7). On ajoute juste les wrappers pour
-- que l'admin puisse écrire via RPC sans avoir besoin de service_role.

CREATE OR REPLACE FUNCTION public.admin_upsert_app_promo(
  p_token   text,
  p_id      uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_id       uuid;
BEGIN
  v_admin_id := public._check_admin_session(p_token);

  IF p_id IS NULL THEN
    INSERT INTO public.app_promos (
      title, subtitle, image_url, link_url, link_type,
      display_order, active, starts_at, ends_at, audience
    )
    VALUES (
      p_payload->>'title',
      NULLIF(p_payload->>'subtitle', ''),
      NULLIF(p_payload->>'image_url', ''),
      NULLIF(p_payload->>'link_url', ''),
      coalesce(p_payload->>'link_type', 'none'),
      coalesce((p_payload->>'display_order')::int, 99),
      coalesce((p_payload->>'active')::boolean, true),
      NULLIF(p_payload->>'starts_at', '')::timestamptz,
      NULLIF(p_payload->>'ends_at',   '')::timestamptz,
      NULLIF(p_payload->>'audience', '')
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.app_promos SET
      title         = coalesce(p_payload->>'title', title),
      subtitle      = CASE WHEN p_payload ? 'subtitle'  THEN NULLIF(p_payload->>'subtitle','')  ELSE subtitle END,
      image_url     = CASE WHEN p_payload ? 'image_url' THEN NULLIF(p_payload->>'image_url','') ELSE image_url END,
      link_url      = CASE WHEN p_payload ? 'link_url'  THEN NULLIF(p_payload->>'link_url','')  ELSE link_url END,
      link_type     = coalesce(p_payload->>'link_type', link_type),
      display_order = coalesce((p_payload->>'display_order')::int, display_order),
      active        = coalesce((p_payload->>'active')::boolean, active),
      starts_at     = CASE WHEN p_payload ? 'starts_at' THEN NULLIF(p_payload->>'starts_at','')::timestamptz ELSE starts_at END,
      ends_at       = CASE WHEN p_payload ? 'ends_at'   THEN NULLIF(p_payload->>'ends_at','')::timestamptz   ELSE ends_at END,
      audience      = CASE WHEN p_payload ? 'audience'  THEN NULLIF(p_payload->>'audience','')   ELSE audience END
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_app_promo(text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_upsert_app_promo(text, uuid, jsonb) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.admin_delete_app_promo(
  p_token text,
  p_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_admin_id uuid;
BEGIN
  v_admin_id := public._check_admin_session(p_token);
  DELETE FROM public.app_promos WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_app_promo(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_delete_app_promo(text, uuid) TO anon, authenticated;


-- =====================================================================
-- PARTIE 6 — LOCKDOWN final des policies (drop des permissives)
-- =====================================================================
-- ⚠️ À EXÉCUTER UNIQUEMENT APRÈS DÉPLOIEMENT du front qui passe par les
-- RPC ci-dessus. Sinon BrandsSection / CategoriesSection / BannersSection
-- vont se prendre des "row-level security policy" sur leurs UPDATE.
--
-- Décommente ce bloc et relance ce fichier.
-- =====================================================================
--
-- DROP POLICY IF EXISTS "brands_write_all"          ON public.brands;
-- DROP POLICY IF EXISTS "brands_anon_write"         ON public.brands;
-- DROP POLICY IF EXISTS "brands_insert_anon"        ON public.brands;
-- DROP POLICY IF EXISTS "brands_update_anon"        ON public.brands;
-- DROP POLICY IF EXISTS "brands_delete_anon"        ON public.brands;
-- DROP POLICY IF EXISTS "categories_write_all"      ON public.categories;
-- DROP POLICY IF EXISTS "categories_anon_write"     ON public.categories;
-- DROP POLICY IF EXISTS "categories_insert_anon"    ON public.categories;
-- DROP POLICY IF EXISTS "categories_update_anon"    ON public.categories;
-- DROP POLICY IF EXISTS "categories_delete_anon"    ON public.categories;
-- DROP POLICY IF EXISTS "banners_write_all"         ON public.banners;
-- DROP POLICY IF EXISTS "banners_anon_write"        ON public.banners;
-- DROP POLICY IF EXISTS "banners_insert_anon"       ON public.banners;
-- DROP POLICY IF EXISTS "banners_update_anon"       ON public.banners;
-- DROP POLICY IF EXISTS "banners_delete_anon"       ON public.banners;
-- DROP POLICY IF EXISTS "products_write_all"        ON public.products;
-- DROP POLICY IF EXISTS "products_anon_write"       ON public.products;
-- DROP POLICY IF EXISTS "products_insert_anon"      ON public.products;
-- DROP POLICY IF EXISTS "products_update_anon"      ON public.products;
-- DROP POLICY IF EXISTS "products_delete_anon"      ON public.products;
--
-- -- service_role conserve un accès complet (edge functions, scripts) :
-- DROP POLICY IF EXISTS "brands_write_service"     ON public.brands;
-- CREATE POLICY "brands_write_service"     ON public.brands     FOR ALL TO service_role USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "categories_write_service" ON public.categories;
-- CREATE POLICY "categories_write_service" ON public.categories FOR ALL TO service_role USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "banners_write_service"    ON public.banners;
-- CREATE POLICY "banners_write_service"    ON public.banners    FOR ALL TO service_role USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "products_write_service"   ON public.products;
-- CREATE POLICY "products_write_service"   ON public.products   FOR ALL TO service_role USING (true) WITH CHECK (true);
--
-- =====================================================================
-- Vérification post-lockdown :
--   SELECT tablename, policyname, cmd, roles
--     FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('brands','categories','banners','products','site_settings','app_promos')
--    ORDER BY tablename, cmd;
-- =====================================================================
-- END P0 #2
-- =====================================================================
