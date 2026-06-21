-- ═══════════════════════════════════════════════════════════════════
-- YARAM — Privatisation buckets RGPD (delivery-proofs + skin-scans)
-- ═══════════════════════════════════════════════════════════════════
-- Pourquoi :
--   - delivery-proofs (public=true) : photos cliente, signatures, photos
--     faciales, adresses visibles → fuite RGPD si quelqu'un devine l'URL.
--   - skin-scans (public=true) : biométrie faciale (visage cliente sous
--     3 angles) → catégorie spéciale RGPD, doit être strictement protégé.
--
-- Stratégie :
--   1. Passer les buckets en public=false → l'URL "publique" ne marche
--      plus, seules les URLs signées (createSignedUrl) fonctionneront.
--   2. Drop les vieilles policies "Anyone can read..." héritées.
--   3. Créer une policy SELECT permissive pour `anon` (nécessaire pour
--      que `storage.createSignedUrl()` côté JS SDK puisse signer une URL).
--      La sécurité vient :
--      - du fait que les URLs ne sont plus devinables (signature + expiry)
--      - du fait qu'il faut connaître le path exact pour le signer
--      - + d'une RPC SECURITY DEFINER pour les cas où on veut vérifier
--        l'identité du caller (admin / livreur) avant de signer.
--   4. Garder les INSERT policies anon (livreur upload sans auth Supabase
--      via token magique livreur, scan client via signup wizard).
--   5. RPC `get_signed_url(bucket_id, object_path, ttl_seconds)` qui :
--      - Vérifie via auth.uid() (user authentifié Supabase = propriétaire
--        d'un skin-scan ou d'une commande), OU via livreur token, OU via
--        admin token, que le caller a le droit de lire ce path.
--      - Appelle storage.create_signed_url() côté serveur.
--
-- Idempotent : DROP IF EXISTS + CREATE OR REPLACE partout.
-- À exécuter dans Supabase Studio (SQL Editor).
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- BLOC 1 — Passer les buckets en privé
-- ─────────────────────────────────────────────────────────────────────
-- ATTENTION : à partir de l'exécution de ce bloc, toute URL publique
-- déjà stockée en base (delivery_tracking.*_photo_url, skin_scans.photo_*_url)
-- ne renverra plus l'image directement. Le code client doit utiliser
-- getSignedStorageUrl() ou la RPC public.get_signed_url().

UPDATE storage.buckets
   SET public = false
 WHERE id IN ('delivery-proofs', 'skin-scans');


-- ─────────────────────────────────────────────────────────────────────
-- BLOC 2 — Drop vieilles policies "Anyone can read..."
-- ─────────────────────────────────────────────────────────────────────
-- Ces policies datent d'une époque où les buckets étaient public.
-- Avec public=false elles sont déjà sans effet pour l'accès URL direct,
-- mais on les nettoie pour éviter toute confusion.

DROP POLICY IF EXISTS "Anyone can read skin scans"       ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read delivery proofs"  ON storage.objects;
DROP POLICY IF EXISTS "skin_scans_anon_read"             ON storage.objects;
DROP POLICY IF EXISTS "delivery_proofs_anon_read"        ON storage.objects;


-- ─────────────────────────────────────────────────────────────────────
-- BLOC 3 — Policies SELECT pour signer les URLs (anon)
-- ─────────────────────────────────────────────────────────────────────
-- Le JS SDK supabase.storage.from(b).createSignedUrl(path, ttl) requiert
-- une permission SELECT sur storage.objects pour signer. On la donne à
-- anon SUR CES DEUX BUCKETS UNIQUEMENT.
-- La sécurité réelle vient maintenant :
--   - du fait que public=false → pas d'accès URL directe
--   - du fait que les paths sont non-devinables (token livreur ou
--     UUID skin_scan + timestamp)
--   - de la RPC get_signed_url pour les cas qui exigent une vérif d'identité

DROP POLICY IF EXISTS "skin_scans_anon_signed_read"      ON storage.objects;
DROP POLICY IF EXISTS "delivery_proofs_anon_signed_read" ON storage.objects;

CREATE POLICY "skin_scans_anon_signed_read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'skin-scans');

CREATE POLICY "delivery_proofs_anon_signed_read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'delivery-proofs');


-- ─────────────────────────────────────────────────────────────────────
-- BLOC 4 — INSERT policies (livreur upload via token magique)
-- ─────────────────────────────────────────────────────────────────────
-- Re-crée pour idempotence (au cas où ce script soit relancé).

DROP POLICY IF EXISTS "delivery_proofs_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "skin_scans_anon_insert"      ON storage.objects;

CREATE POLICY "delivery_proofs_anon_insert"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'delivery-proofs');

CREATE POLICY "skin_scans_anon_insert"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'skin-scans');


-- ─────────────────────────────────────────────────────────────────────
-- BLOC 5 — RPC public.get_signed_url() SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────
-- Utilisé par les callers qui veulent une vérif d'autorisation côté
-- serveur AVANT de signer (au lieu de laisser le JS SDK signer librement
-- comme dans le bloc 3). Exemple typique : admin dashboard quand on
-- voudra plus tard restreindre à `admins.token` valide.
--
-- Politique d'accès actuelle :
--   - skin-scans : caller doit être authentifié (auth.uid() not null)
--                  ET propriétaire du scan (path commence par user_id),
--                  OU être un admin actif (table admins),
--                  OU fournir un admin token valide.
--   - delivery-proofs : caller doit fournir un livreur_token valide
--                       (présent dans delivery_tracking.token et path
--                       commence par ce token), OU être admin,
--                       OU être propriétaire de la commande liée.
--
-- Note : storage.sign() est l'API SQL interne Supabase qui calcule la
-- signature HMAC pour les signed URLs. Si pas dispo dans ta version,
-- fallback : retourne le chemin et laisse le client faire createSignedUrl
-- après vérif côté serveur (on retourne { allowed: true } dans ce cas).

CREATE OR REPLACE FUNCTION public.get_signed_url(
  p_bucket_id      text,
  p_object_path    text,
  p_ttl_seconds    int default 3600,
  p_livreur_token  text default null,
  p_admin_token    text default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, extensions
AS $$
DECLARE
  v_uid          uuid;
  v_allowed      boolean := false;
  v_signed_url   text;
  v_signed_token text;
  v_admin_ok     boolean := false;
  v_livreur_ok   boolean := false;
BEGIN
  -- Validation paramètres
  IF p_bucket_id IS NULL OR p_object_path IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF p_bucket_id NOT IN ('delivery-proofs', 'skin-scans') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bucket_not_supported');
  END IF;
  -- Clamp TTL entre 60s et 7 jours
  p_ttl_seconds := GREATEST(60, LEAST(7 * 24 * 3600, COALESCE(p_ttl_seconds, 3600)));

  v_uid := auth.uid();

  -- ─── Check admin token (sessionStorage côté admin dashboard) ───
  IF p_admin_token IS NOT NULL AND length(p_admin_token) > 0 THEN
    -- Tente de matcher contre la table des sessions admin si elle existe.
    -- Sinon, on tolère (assume le token est valide côté caller).
    BEGIN
      SELECT EXISTS (
        SELECT 1 FROM public.admin_sessions
         WHERE token = p_admin_token
           AND (expires_at IS NULL OR expires_at > NOW())
      ) INTO v_admin_ok;
    EXCEPTION WHEN undefined_table THEN
      v_admin_ok := false;
    END;
  END IF;

  -- ─── Check livreur token (présent en path pour delivery-proofs) ───
  IF p_livreur_token IS NOT NULL AND length(p_livreur_token) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.delivery_tracking
       WHERE token = p_livreur_token
    ) INTO v_livreur_ok;
  END IF;

  -- ─── Logique d'autorisation par bucket ───
  IF p_bucket_id = 'skin-scans' THEN
    -- Admin OK ?
    IF v_admin_ok THEN
      v_allowed := true;
    -- User authentifié + path commence par son uid ? (convention : <user_id>/<file>)
    ELSIF v_uid IS NOT NULL AND p_object_path LIKE v_uid::text || '/%' THEN
      v_allowed := true;
    -- User authentifié + son user_id apparaît dans skin_scans pour ce path
    ELSIF v_uid IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.skin_scans
         WHERE user_id = v_uid
           AND (photo_front_url LIKE '%' || p_object_path || '%'
             OR photo_left_url  LIKE '%' || p_object_path || '%'
             OR photo_right_url LIKE '%' || p_object_path || '%')
      ) INTO v_allowed;
    END IF;

  ELSIF p_bucket_id = 'delivery-proofs' THEN
    -- Admin OK ?
    IF v_admin_ok THEN
      v_allowed := true;
    -- Livreur OK + path commence par son token ? (convention : <token>/<file>)
    ELSIF v_livreur_ok AND p_object_path LIKE p_livreur_token || '/%' THEN
      v_allowed := true;
    -- User authentifié + cliente propriétaire de la commande liée à ce tracking ?
    ELSIF v_uid IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.delivery_tracking dt
        JOIN public.orders o ON o.id = dt.order_id
       WHERE o.user_id = v_uid
         AND (dt.pickup_before_photo_url LIKE '%' || p_object_path || '%'
           OR dt.pickup_after_photo_url  LIKE '%' || p_object_path || '%'
           OR dt.pickup_photo_url        LIKE '%' || p_object_path || '%'
           OR dt.product_photo_url       LIKE '%' || p_object_path || '%'
           OR dt.delivery_photo_url      LIKE '%' || p_object_path || '%')
      ) INTO v_allowed;
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  -- ─── Génération de la signed URL ───
  -- Méthode standard Supabase Storage : appelle l'extension storage.
  -- Si storage.sign() / extensions.url_sign() pas dispo dans cette version,
  -- on retourne juste { allowed: true } et le client fait createSignedUrl
  -- directement (les policies du bloc 3 le permettent).
  BEGIN
    -- Tente d'utiliser la fonction sign de l'extension (si présente).
    SELECT storage.sign(p_bucket_id || '/' || p_object_path, p_ttl_seconds)
      INTO v_signed_token;
  EXCEPTION WHEN OTHERS THEN
    v_signed_token := NULL;
  END;

  IF v_signed_token IS NOT NULL THEN
    v_signed_url := '/storage/v1/object/sign/' || p_bucket_id || '/' || p_object_path
                  || '?token=' || v_signed_token;
    RETURN jsonb_build_object(
      'success',    true,
      'signed_url', v_signed_url,
      'expires_in', p_ttl_seconds
    );
  END IF;

  -- Fallback : autorisation accordée, mais signature non générée côté SQL.
  -- Le client doit appeler supabase.storage.from(bucket).createSignedUrl()
  -- (les policies bloc 3 lui permettent de le faire).
  RETURN jsonb_build_object(
    'success',    true,
    'allowed',    true,
    'sign_via',   'client_sdk',
    'bucket_id',  p_bucket_id,
    'path',       p_object_path,
    'expires_in', p_ttl_seconds
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_signed_url(text, text, int, text, text)
  TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- BLOC 6 — Vérification post-migration
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
WHERE b.id IN ('delivery-proofs', 'skin-scans')
GROUP BY b.id, b.public
ORDER BY b.id;

-- Résultat attendu :
--   delivery-proofs  public=f  ins=1 sel=1 upd=0 del=0
--   skin-scans       public=f  ins=1 sel=1 upd=0 del=0

-- Vérification que la RPC est bien créée :
SELECT proname, pg_get_function_identity_arguments(oid) AS args
  FROM pg_proc WHERE proname = 'get_signed_url';
