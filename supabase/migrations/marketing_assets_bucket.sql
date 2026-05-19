-- ════════════════════════════════════════════════════════
-- YARAM — Bucket Storage pour les images de campagnes WhatsApp
-- ════════════════════════════════════════════════════════
-- Bucket PUBLIC (samabot.app doit pouvoir fetch l'URL).
-- Upload uniquement via la RPC admin_get_marketing_upload_token
-- (qu'on n'a pas besoin de créer : on contrôle côté frontend via le token admin).
--
-- À exécuter UNE FOIS dans Supabase Dashboard → SQL Editor.
-- ════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketing-assets',
  'marketing-assets',
  true, -- public : les URLs sont accessibles sans auth
  10 * 1024 * 1024, -- max 10 MB par fichier
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10 * 1024 * 1024,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- ─── Policies ────────────────────────────────────────────
-- READ : tout le monde peut lire (bucket public)
DROP POLICY IF EXISTS "marketing assets read" ON storage.objects;
CREATE POLICY "marketing assets read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'marketing-assets');

-- INSERT : seul un admin connecté (= user authentifié avec session active) peut upload.
-- On vérifie via la table admin_sessions (le token admin doit être actif).
-- Le frontend pass le token admin dans les headers via la lib Supabase.
DROP POLICY IF EXISTS "marketing assets admin write" ON storage.objects;
CREATE POLICY "marketing assets admin write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'marketing-assets'
    AND EXISTS (
      SELECT 1 FROM admin_sessions
      WHERE expires_at > now()
    )
  );

-- DELETE : pareil, admin seulement (pour nettoyer les vieilles campagnes)
DROP POLICY IF EXISTS "marketing assets admin delete" ON storage.objects;
CREATE POLICY "marketing assets admin delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'marketing-assets'
    AND EXISTS (
      SELECT 1 FROM admin_sessions
      WHERE expires_at > now()
    )
  );
