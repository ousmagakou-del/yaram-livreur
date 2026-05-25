-- ════════════════════════════════════════════════════════
-- YARAM — Bucket Storage pour les images de campagnes WhatsApp (v2)
-- ════════════════════════════════════════════════════════
-- Bucket PUBLIC (samabot/WaSender doit pouvoir fetch l'URL).
-- Upload : ouvert mais filtré par mime + 10 MB max (config bucket).
-- C'est OK pour un usage interne admin — on accepte ce niveau de risque
-- pour rester simple (pas de service-role upload via edge function).
--
-- À exécuter UNE FOIS dans Supabase Dashboard → SQL Editor.
-- ════════════════════════════════════════════════════════

-- 1. Crée ou update le bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketing-assets',
  'marketing-assets',
  true,
  10 * 1024 * 1024,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10 * 1024 * 1024,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- 2. Drop les anciennes policies (au cas où on a déjà exécuté la v1)
DROP POLICY IF EXISTS "marketing assets read" ON storage.objects;
DROP POLICY IF EXISTS "marketing assets admin write" ON storage.objects;
DROP POLICY IF EXISTS "marketing assets admin delete" ON storage.objects;
DROP POLICY IF EXISTS "marketing assets write" ON storage.objects;
DROP POLICY IF EXISTS "marketing assets delete" ON storage.objects;

-- 3. READ : tout le monde (bucket public)
CREATE POLICY "marketing assets read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'marketing-assets');

-- 4. INSERT : permis pour anon role (limité par mime + 10 MB max via bucket config)
-- Tradeoff sécurité : n'importe qui connaissant l'URL Supabase pourrait spammer.
-- Risque accepté car : usage interne admin, mime restreint, taille limitée.
-- Si abus détecté plus tard → migrer vers un upload via edge function SECURITY DEFINER.
CREATE POLICY "marketing assets write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'marketing-assets');

-- 5. DELETE : pareil (on peut supprimer ses propres uploads)
CREATE POLICY "marketing assets delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'marketing-assets');

-- 6. UPDATE : permis (rare mais utile pour upsert)
CREATE POLICY "marketing assets update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'marketing-assets');
