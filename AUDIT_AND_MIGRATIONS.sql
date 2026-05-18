-- ═══════════════════════════════════════════════════════════════════
-- YARAM — SCRIPT D'AUDIT RLS + MIGRATIONS EN ATTENTE
-- ═══════════════════════════════════════════════════════════════════
--
-- À lancer dans Supabase Studio → SQL Editor, sur le projet YARAM.
-- Le script est structuré en 2 parties :
--
--   PARTIE 1 — AUDIT (read-only) : t'affiche l'état des RLS, policies,
--              fuites potentielles. Lance ça d'abord pour faire un diagnostic.
--
--   PARTIE 2 — MIGRATIONS : applique les fix (RPCs, GRANT pin, RLS users_profile,
--              policies storage, table site_settings). Lance ça après audit.
--
-- Chaque bloc est idempotent (IF NOT EXISTS / OR REPLACE) → safe a relancer.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- ░░░ PARTIE 1 — AUDIT (read-only) ░░░
-- Copie-colle les requêtes une par une dans Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1.1 LISTE DES TABLES + STATUT RLS ──────────────────────────────
-- Repère vite les tables qui n'ont pas RLS activée (= lisibles/écrivables par tous)
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_active,
  CASE WHEN rowsecurity THEN '✅ RLS ON' ELSE '🚨 RLS OFF (public !)' END AS status
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rowsecurity ASC, tablename ASC;

-- ─── 1.2 LISTE DES POLICIES PAR TABLE ──────────────────────────────
-- Pour chaque table, quelles règles existent et pour quel rôle
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ─── 1.3 TABLES SANS AUCUNE POLICY (RLS activée mais aucune règle) ──
-- Si RLS est ON mais 0 policy = NO ACCESS pour anon/authenticated.
-- Si RLS est OFF = tout le monde a accès (dangereux pour donnees sensibles).
SELECT
  t.tablename,
  t.rowsecurity,
  COUNT(p.policyname) AS nb_policies,
  CASE
    WHEN NOT t.rowsecurity THEN '🚨 RLS DESACTIVEE (tout public)'
    WHEN COUNT(p.policyname) = 0 THEN '⚠️ RLS ON mais 0 policy (rien lisible cote client)'
    ELSE '✅ ' || COUNT(p.policyname) || ' policies'
  END AS diagnostic
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = t.schemaname
WHERE t.schemaname = 'public'
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.rowsecurity ASC, nb_policies ASC;

-- ─── 1.4 COLUMN-LEVEL GRANTS (pour verifier la protection PIN pharmacies) ──
-- Doit montrer que `pin` n'est PAS dans les colonnes SELECTables par anon
SELECT
  table_schema,
  table_name,
  column_name,
  privilege_type,
  grantee
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'pharmacies'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type = 'SELECT'
ORDER BY column_name;

-- ─── 1.5 RPCs CRITIQUES (verifier qu'elles existent) ───────────────
SELECT
  proname AS function_name,
  CASE prosecdef WHEN true THEN '✅ SECURITY DEFINER' ELSE '⚠️ INVOKER' END AS security,
  pg_get_function_arguments(oid) AS args
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'verify_pharmacy_pin',
    'admin_set_pharmacy_pin',
    'verify_admin_pin',
    'change_admin_pin',
    'create_admin',
    'toggle_admin_active',
    'add_loyalty_points',
    'has_received_whatsapp',
    'log_whatsapp',
    'generate_referral_code'
  )
ORDER BY proname;

-- ─── 1.6 STORAGE BUCKETS + LEURS POLICIES ──────────────────────────
SELECT
  b.id AS bucket,
  b.public,
  COUNT(p.policyname) AS nb_policies,
  string_agg(p.policyname || ' (' || p.cmd || ')', ', ') AS policies
FROM storage.buckets b
LEFT JOIN pg_policies p ON p.tablename = 'objects'
  AND p.schemaname = 'storage'
  AND p.qual LIKE '%' || b.id || '%'
GROUP BY b.id, b.public
ORDER BY b.id;

-- ─── 1.7 SANITY CHECK PIN (le pin ne doit JAMAIS etre lisible par anon) ──
-- Doit retourner une ERREUR "permission denied for column pin" si ta GRANT est OK.
-- Si ça retourne des donnees → ta protection PIN est CASSEE.
-- ⚠️ Decommente pour tester (a faire en role anon) :
-- SET ROLE anon;
-- SELECT pin FROM pharmacies LIMIT 1;
-- RESET ROLE;


-- ═══════════════════════════════════════════════════════════════════
-- ░░░ PARTIE 2 — MIGRATIONS (à appliquer si pas déjà fait) ░░░
-- ═══════════════════════════════════════════════════════════════════

-- ─── 2.1 GRANT SELECT colonnes pharmacies (cache le pin aux clients) ──
-- Liste à AJUSTER selon les colonnes réelles de ta DB
-- (vérifie d'abord avec : SELECT column_name FROM information_schema.columns
--                          WHERE table_schema='public' AND table_name='pharmacies';)
DO $$
BEGIN
  REVOKE SELECT ON pharmacies FROM anon, authenticated;
  GRANT SELECT (
    id, name, tagline, owner_name, manager_name,
    city, neighborhood, address, lat, lng,
    phone, whatsapp, notification_email, notification_phone,
    hours, delivery_hours,
    logo, cover, description,
    commission,
    active, rating, review_count,
    pin_set_at, created_at, updated_at
  ) ON pharmacies TO anon, authenticated;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GRANT pharmacies: %', SQLERRM;
END $$;

-- ─── 2.2 RPC verify_pharmacy_pin (login pharmacie cote serveur) ────
CREATE OR REPLACE FUNCTION verify_pharmacy_pin(p_id text, p_pin text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(p) - 'pin'
  FROM pharmacies p
  WHERE p.id::text = p_id
    AND p.pin = p_pin
    AND p.active = true;
$$;
GRANT EXECUTE ON FUNCTION verify_pharmacy_pin(text, text) TO anon, authenticated;

-- ─── 2.3 RPC admin_set_pharmacy_pin (reset PIN securise par admin) ──
CREATE OR REPLACE FUNCTION admin_set_pharmacy_pin(
  p_admin_id uuid,
  p_pharmacy_id text,
  p_new_pin text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM admin_users
  WHERE id = p_admin_id AND active = true;

  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Non autorise');
  END IF;
  IF p_new_pin IS NULL OR length(p_new_pin) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PIN trop court');
  END IF;
  UPDATE pharmacies
  SET pin = p_new_pin, pin_set_at = now()
  WHERE id::text = p_pharmacy_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pharmacie introuvable');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_set_pharmacy_pin(uuid, text, text) TO anon, authenticated;

-- ─── 2.4 Table site_settings (admin paramètres en DB) ──────────────
CREATE TABLE IF NOT EXISTS public.site_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_read_all" ON public.site_settings;
CREATE POLICY "settings_read_all" ON public.site_settings
  FOR SELECT USING (true);

-- ⚠️ Permissive pour MVP — à durcir en prod via RPC SECURITY DEFINER avec check admin
DROP POLICY IF EXISTS "settings_write_temp" ON public.site_settings;
CREATE POLICY "settings_write_temp" ON public.site_settings
  FOR ALL USING (true) WITH CHECK (true);

-- ─── 2.5 RLS users_profile (signup persiste phone/first_name) ──────
-- Si la table n'a pas RLS, l'utilisatrice ne peut pas upsert sa propre row
ALTER TABLE users_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_profile_own_select" ON users_profile;
CREATE POLICY "users_profile_own_select" ON users_profile
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "users_profile_own_insert" ON users_profile;
CREATE POLICY "users_profile_own_insert" ON users_profile
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "users_profile_own_update" ON users_profile;
CREATE POLICY "users_profile_own_update" ON users_profile
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ─── 2.6 Storage buckets policies (uploads admin) ──────────────────
-- Pour CHAQUE bucket utilisé par l'app : banner-images, product-images,
-- brand-logos, category-icons, skin-scans, review-photos, delivery-proofs

DO $$
DECLARE
  bucket_name text;
  buckets text[] := ARRAY[
    'banner-images', 'product-images', 'brand-logos',
    'category-icons', 'skin-scans', 'review-photos', 'delivery-proofs'
  ];
BEGIN
  FOREACH bucket_name IN ARRAY buckets LOOP
    -- Cree le bucket s'il n'existe pas, le rend public
    INSERT INTO storage.buckets (id, name, public)
    VALUES (bucket_name, bucket_name, true)
    ON CONFLICT (id) DO UPDATE SET public = true;
  END LOOP;
END $$;

-- Lecture publique sur tous ces buckets
DROP POLICY IF EXISTS "yaram_buckets_public_read" ON storage.objects;
CREATE POLICY "yaram_buckets_public_read" ON storage.objects
FOR SELECT TO anon, authenticated
USING (bucket_id IN (
  'banner-images', 'product-images', 'brand-logos',
  'category-icons', 'skin-scans', 'review-photos', 'delivery-proofs'
));

-- Upload : permissif pour MVP, à durcir en prod (check role admin via JWT)
DROP POLICY IF EXISTS "yaram_buckets_insert" ON storage.objects;
CREATE POLICY "yaram_buckets_insert" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id IN (
  'banner-images', 'product-images', 'brand-logos',
  'category-icons', 'skin-scans', 'review-photos', 'delivery-proofs'
));

DROP POLICY IF EXISTS "yaram_buckets_update" ON storage.objects;
CREATE POLICY "yaram_buckets_update" ON storage.objects
FOR UPDATE TO anon, authenticated
USING (bucket_id IN (
  'banner-images', 'product-images', 'brand-logos',
  'category-icons', 'skin-scans', 'review-photos', 'delivery-proofs'
))
WITH CHECK (bucket_id IN (
  'banner-images', 'product-images', 'brand-logos',
  'category-icons', 'skin-scans', 'review-photos', 'delivery-proofs'
));

DROP POLICY IF EXISTS "yaram_buckets_delete" ON storage.objects;
CREATE POLICY "yaram_buckets_delete" ON storage.objects
FOR DELETE TO anon, authenticated
USING (bucket_id IN (
  'banner-images', 'product-images', 'brand-logos',
  'category-icons', 'skin-scans', 'review-photos', 'delivery-proofs'
));


-- ═══════════════════════════════════════════════════════════════════
-- ░░░ FIN — Verification finale ░░░
-- Relance la requête 1.1 pour confirmer que toutes les tables critiques ont RLS ON :
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'
--     AND tablename IN ('users_profile','site_settings','pharmacies','orders')
--   ORDER BY tablename;
-- ═══════════════════════════════════════════════════════════════════
