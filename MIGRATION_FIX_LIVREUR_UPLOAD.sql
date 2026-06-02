-- ═══════════════════════════════════════════════════════════════════
-- YARAM — Fix urgent : RLS bucket delivery-proofs
-- ═══════════════════════════════════════════════════════════════════
-- Symptôme : livreur tape "Photo de la pharmacie (à l'arrivée)"
--           → toast "Erreur upload : new row violates row-level security policy"
--
-- Cause : le bucket delivery-proofs n'a aucune policy INSERT pour anon.
--         Le livreur accède via un token magique (pas Supabase Auth),
--         donc Supabase le voit comme role anon → INSERT refusé.
--
-- Fix : créer les policies anon INSERT + UPDATE + SELECT sur ce bucket.
--       Les autres buckets recevront le même traitement si nécessaire,
--       mais ici on cible JUSTE le bug livreur urgent.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. INSERT anon (uploader la photo) ───
DROP POLICY IF EXISTS "delivery_proofs_anon_insert" ON storage.objects;
CREATE POLICY "delivery_proofs_anon_insert"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'delivery-proofs');

-- ─── 2. UPDATE anon (le code utilise upsert: true qui peut UPDATE) ───
DROP POLICY IF EXISTS "delivery_proofs_anon_update" ON storage.objects;
CREATE POLICY "delivery_proofs_anon_update"
  ON storage.objects
  FOR UPDATE
  TO anon
  USING (bucket_id = 'delivery-proofs')
  WITH CHECK (bucket_id = 'delivery-proofs');

-- ─── 3. SELECT anon (pour relire après upload, getPublicUrl) ───
-- Pas strictement nécessaire si le bucket est public=true, mais ceinture+bretelles.
DROP POLICY IF EXISTS "delivery_proofs_anon_select" ON storage.objects;
CREATE POLICY "delivery_proofs_anon_select"
  ON storage.objects
  FOR SELECT
  TO anon
  USING (bucket_id = 'delivery-proofs');

-- ─── 4. Vérification ───
-- Après exécution, lance ça pour confirmer que les 3 policies sont là :
SELECT
  policyname,
  cmd,
  roles,
  qual
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE 'delivery_proofs_%'
ORDER BY cmd;

-- Tu dois voir 3 lignes :
--   delivery_proofs_anon_insert | INSERT | {anon}
--   delivery_proofs_anon_select | SELECT | {anon}
--   delivery_proofs_anon_update | UPDATE | {anon}
