-- ═══════════════════════════════════════════════════════════════════
-- YARAM — Storage Buckets : Fix policies
-- À exécuter dans Supabase Studio (SQL Editor)
-- Idempotent : DROP IF EXISTS avant chaque CREATE
-- ═══════════════════════════════════════════════════════════════════
-- Découverte de l'audit 1.6 :
--   - Aucun bucket n'a de policy INSERT (cause probable du bug "Erreur upload")
--   - product-images : UPDATE/DELETE ouverts à anon (vandalisme possible)
--   - skin-scans + delivery-proofs en public=true (RGPD)
--   - category-icons : policies dupliquées
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- BLOC A — INSERT policies pour TOUS les buckets (unblock uploads)
-- ─────────────────────────────────────────────────────────────────────
-- NB : tant que l'admin/pharma/livreur n'utilisent pas Supabase Auth,
--      on doit autoriser anon pour INSERT. Une fois l'auth réelle en
--      place (BILAN.md tâche restante), on restreint à authenticated.

DROP POLICY IF EXISTS "banner_images_anon_insert"   ON storage.objects;
DROP POLICY IF EXISTS "brand_logos_anon_insert"     ON storage.objects;
DROP POLICY IF EXISTS "category_icons_anon_insert"  ON storage.objects;
DROP POLICY IF EXISTS "product_images_anon_insert"  ON storage.objects;
DROP POLICY IF EXISTS "delivery_proofs_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "review_photos_anon_insert"   ON storage.objects;
DROP POLICY IF EXISTS "skin_scans_anon_insert"      ON storage.objects;

CREATE POLICY "banner_images_anon_insert"   ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'banner-images');
CREATE POLICY "brand_logos_anon_insert"     ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'brand-logos');
CREATE POLICY "category_icons_anon_insert"  ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'category-icons');
CREATE POLICY "product_images_anon_insert"  ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "delivery_proofs_anon_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'delivery-proofs');
CREATE POLICY "review_photos_anon_insert"   ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'review-photos');
CREATE POLICY "skin_scans_anon_insert"      ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'skin-scans');


-- ─────────────────────────────────────────────────────────────────────
-- BLOC B — Hardening product-images (stop vandalisme)
-- ─────────────────────────────────────────────────────────────────────
-- On retire "Anyone can update" + "Anyone can delete" qui exposent
-- le catalogue au vandalisme. Les pharmacies passeront par une RPC
-- ou par service_role côté serveur pour modifier/supprimer.
-- Le SELECT public reste pour que les images s'affichent partout.

DROP POLICY IF EXISTS "Anyone can update product images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete product images" ON storage.objects;

-- (Si plus tard tu mets en place Supabase Auth pour les pharmas, recrée
--  ces policies en restreignant à `authenticated` + check du owner)


-- ─────────────────────────────────────────────────────────────────────
-- BLOC C — Cleanup doublons category-icons
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "category-icons authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "category-icons authenticated delete" ON storage.objects;
-- On garde "category-icons update" et "category-icons delete"
-- + on ajoutera "category-icons anon insert" via Bloc A


-- ─────────────────────────────────────────────────────────────────────
-- BLOC D — Privatiser skin-scans (RGPD : photos visages)
-- ─────────────────────────────────────────────────────────────────────
-- ATTENTION : passer ce bucket en privé invalide les URLs publiques
-- déjà stockées en DB (table scans / scan_results). Vérifie le code
-- avant : il doit utiliser createSignedUrl(...) au lieu de getPublicUrl(...).
--
-- Pour activer ce bloc, décommente les 2 lignes ci-dessous APRÈS avoir
-- migré le code client vers createSignedUrl.
--
-- UPDATE storage.buckets SET public = false WHERE id = 'skin-scans';
-- DROP POLICY IF EXISTS "Anyone can read skin scans" ON storage.objects;
--
-- Et créer à la place :
-- CREATE POLICY "skin_scans_anon_signed_read" ON storage.objects
--   FOR SELECT TO anon
--   USING (bucket_id = 'skin-scans');
-- (Les signed URLs bypass les policies SELECT, donc ce SELECT peut
--  même être supprimé entièrement une fois la migration faite.)


-- ─────────────────────────────────────────────────────────────────────
-- BLOC E — Privatiser delivery-proofs (signatures + adresses visibles)
-- ─────────────────────────────────────────────────────────────────────
-- Même logique que skin-scans. À activer après migration code livreur
-- + admin vers signed URLs.
--
-- UPDATE storage.buckets SET public = false WHERE id = 'delivery-proofs';
-- DROP POLICY IF EXISTS "Anyone can read delivery proofs" ON storage.objects;


-- ─────────────────────────────────────────────────────────────────────
-- BLOC F — Verification (re-run la 1.6 après pour confirmer)
-- ─────────────────────────────────────────────────────────────────────

SELECT
  b.id AS bucket,
  b.public,
  COUNT(p.policyname) FILTER (WHERE p.cmd = 'INSERT') AS nb_insert,
  COUNT(p.policyname) FILTER (WHERE p.cmd = 'SELECT') AS nb_select,
  COUNT(p.policyname) FILTER (WHERE p.cmd = 'UPDATE') AS nb_update,
  COUNT(p.policyname) FILTER (WHERE p.cmd = 'DELETE') AS nb_delete
FROM storage.buckets b
LEFT JOIN pg_policies p
  ON p.schemaname = 'storage'
 AND p.tablename  = 'objects'
 AND (p.qual ILIKE '%' || b.id || '%' OR p.with_check ILIKE '%' || b.id || '%')
GROUP BY b.id, b.public
ORDER BY b.id;

-- Resultat attendu après ce script :
--   banner-images    public=t  ins=1 sel=1 upd=1 del=1
--   brand-logos      public=t  ins=1 sel=1 upd=1 del=1
--   category-icons   public=t  ins=1 sel=1 upd=1 del=1   ← passé de 5 à 4 policies
--   delivery-proofs  public=t  ins=1 sel=1 upd=1 del=0
--   product-images   public=t  ins=1 sel=1 upd=0 del=0   ← UPDATE/DELETE retirés
--   review-photos    public=t  ins=1 sel=1 upd=0 del=0
--   skin-scans       public=t  ins=1 sel=1 upd=0 del=0
