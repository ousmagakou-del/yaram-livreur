-- ═══════════════════════════════════════════════════════════════════
-- YARAM — Storage Buckets : Nettoyage Phase 2
-- À exécuter dans Supabase Studio après STORAGE_BUCKETS_FIX.sql
-- ═══════════════════════════════════════════════════════════════════
-- Découvertes :
--   1. Catch-all yaram_buckets_* sur tout storage.objects neutralisaient
--      le hardening BLOC B sur product-images.
--   2. Mes 7 *_anon_insert sont des doublons (INSERT existait déjà).
--   3. category-icons a encore 2 INSERT identiques.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- BLOC G — Supprimer mes 7 doublons *_anon_insert
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "banner_images_anon_insert"   ON storage.objects;
DROP POLICY IF EXISTS "brand_logos_anon_insert"     ON storage.objects;
DROP POLICY IF EXISTS "category_icons_anon_insert"  ON storage.objects;
DROP POLICY IF EXISTS "product_images_anon_insert"  ON storage.objects;
DROP POLICY IF EXISTS "delivery_proofs_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "review_photos_anon_insert"   ON storage.objects;
DROP POLICY IF EXISTS "skin_scans_anon_insert"      ON storage.objects;


-- ─────────────────────────────────────────────────────────────────────
-- BLOC H — Supprimer les catch-all globaux (CRITIQUE)
-- ─────────────────────────────────────────────────────────────────────
-- Ces 4 policies s'appliquent à TOUS les buckets car elles n'ont pas
-- de restriction bucket_id. Tant qu'elles existent, n'importe quel
-- visiteur anon peut faire CRUD complet sur tout storage.objects —
-- y compris écraser/supprimer les photos produits.
--
-- Après ce DROP, chaque bucket aura uniquement les policies bucket-
-- spécifiques qui restent (vérifié ci-dessous au BLOC J).

DROP POLICY IF EXISTS "yaram_buckets_delete"       ON storage.objects;
DROP POLICY IF EXISTS "yaram_buckets_insert"       ON storage.objects;
DROP POLICY IF EXISTS "yaram_buckets_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "yaram_buckets_update"       ON storage.objects;


-- ─────────────────────────────────────────────────────────────────────
-- BLOC I — Supprimer doublon INSERT category-icons
-- ─────────────────────────────────────────────────────────────────────
-- On garde "category-icons write" (nom plus standard), on drop
-- "category-icons authenticated write" qui fait la meme chose.

DROP POLICY IF EXISTS "category-icons authenticated write" ON storage.objects;


-- ─────────────────────────────────────────────────────────────────────
-- BLOC J — Verification finale (1 ligne = 1 policy, scope par bucket)
-- ─────────────────────────────────────────────────────────────────────

SELECT
  COALESCE(
    (regexp_match(qual,       'bucket_id\s*=\s*''([^'']+)'''))[1],
    (regexp_match(with_check, 'bucket_id\s*=\s*''([^'']+)'''))[1]
  ) AS bucket,
  cmd,
  policyname,
  roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY bucket NULLS LAST, cmd, policyname;

-- Etat attendu après ce script :
--
--   banner-images   INSERT  banner_images_admin_upload      {anon,authenticated}
--   banner-images   SELECT  banner_images_public_read       {anon,authenticated}
--   banner-images   UPDATE  banner_images_admin_update      {anon,authenticated}
--   banner-images   DELETE  banner_images_admin_delete      {anon,authenticated}
--
--   brand-logos     INSERT  brand-logos write               {public}
--   brand-logos     SELECT  brand-logos public read         {public}
--   brand-logos     UPDATE  brand-logos update              {public}
--   brand-logos     DELETE  brand-logos delete              {public}
--
--   category-icons  INSERT  category-icons write            {public}
--   category-icons  SELECT  category-icons public read      {public}
--   category-icons  UPDATE  category-icons update           {public}
--   category-icons  DELETE  category-icons delete           {public}
--
--   delivery-proofs INSERT  Anyone can upload delivery proofs {public}
--   delivery-proofs SELECT  Anyone can read delivery proofs   {public}
--   delivery-proofs UPDATE  Anyone can update delivery proofs {public}
--   (pas de DELETE — voulu, historique non destructible)
--
--   product-images  INSERT  Anyone can upload product images  {public}
--   product-images  SELECT  Anyone can read product images    {public}
--   (plus de UPDATE/DELETE — vandalisme bloqué)
--
--   review-photos   INSERT  Anyone can upload reviews         {public}
--   review-photos   SELECT  Anyone can read reviews           {public}
--
--   skin-scans      INSERT  Anyone can upload skin scans      {public}
--   skin-scans      SELECT  Anyone can read skin scans        {public}
--
--   AUCUNE ligne avec bucket = NULL.
