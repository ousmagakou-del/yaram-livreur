-- ═══════════════════════════════════════════════════════════════════
-- YARAM — RPC livreur_update_tracking + livreur_update_order
-- ═══════════════════════════════════════════════════════════════════
-- Symptôme : bouton "Je suis là" sur la page livreur ne fait rien.
--            Pareil sur "Photo avant", "Confirmer", etc.
--
-- Cause : les RPC livreur_update_tracking et livreur_update_order
--         sont appelées par Livreur.jsx mais n'ont aucune définition
--         SQL versionnée dans le code. Probablement créées à la main
--         à un moment puis perdues/cassées.
--
-- Sécurité : le livreur ne s'authentifie pas via Supabase Auth — il
--            accède via un token magique unique (delivery_tracking.token).
--            Les RPC sont SECURITY DEFINER et :
--            1. Vérifient que le token existe
--            2. Whitelistent les champs modifiables (pas n'importe quoi)
-- ═══════════════════════════════════════════════════════════════════


-- ─── DROP des anciennes versions (si elles existent en void/autre type) ───
-- Postgres refuse de changer le type de retour via CREATE OR REPLACE,
-- donc on DROP explicitement avant.
DROP FUNCTION IF EXISTS public.livreur_update_tracking(text, jsonb);
DROP FUNCTION IF EXISTS public.livreur_update_order(text, jsonb);


-- ─── RPC 1 : livreur_update_tracking ───
-- Permet au livreur de mettre à jour son delivery_tracking (status,
-- photos, GPS, scans). Champs whitelistés.
CREATE OR REPLACE FUNCTION public.livreur_update_tracking(
  p_token text,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_last_update timestamptz;
  v_scanned jsonb;
  v_livreur_lat numeric;
  v_livreur_lng numeric;
  v_gps_updated_at timestamptz;
  v_pickup_before_photo_url text;
  v_pickup_after_photo_url text;
  v_pickup_photo_url text;
  v_product_photo_url text;
  v_delivery_photo_url text;
  v_livreur_notes text;
BEGIN
  -- 1. Vérifier que le token existe
  SELECT id INTO v_id
    FROM public.delivery_tracking
   WHERE token = p_token
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'tracking_not_found');
  END IF;

  -- 2. Extraire les champs whitelistés depuis le patch
  v_status                   := p_patch->>'status';
  v_last_update              := (p_patch->>'last_update')::timestamptz;
  v_scanned                  := p_patch->'scanned_barcodes';
  v_livreur_lat              := (p_patch->>'livreur_lat')::numeric;
  v_livreur_lng              := (p_patch->>'livreur_lng')::numeric;
  v_gps_updated_at           := (p_patch->>'gps_updated_at')::timestamptz;
  v_pickup_before_photo_url  := p_patch->>'pickup_before_photo_url';
  v_pickup_after_photo_url   := p_patch->>'pickup_after_photo_url';
  v_pickup_photo_url         := p_patch->>'pickup_photo_url';
  v_product_photo_url        := p_patch->>'product_photo_url';
  v_delivery_photo_url       := p_patch->>'delivery_photo_url';
  v_livreur_notes            := p_patch->>'livreur_notes';

  -- 3. UPDATE : COALESCE pour ne toucher qu'aux champs présents dans le patch
  UPDATE public.delivery_tracking
     SET status                   = COALESCE(v_status, status),
         last_update              = COALESCE(v_last_update, NOW()),
         scanned_barcodes         = COALESCE(v_scanned, scanned_barcodes),
         livreur_lat              = COALESCE(v_livreur_lat, livreur_lat),
         livreur_lng              = COALESCE(v_livreur_lng, livreur_lng),
         gps_updated_at           = COALESCE(v_gps_updated_at, gps_updated_at),
         pickup_before_photo_url  = COALESCE(v_pickup_before_photo_url, pickup_before_photo_url),
         pickup_after_photo_url   = COALESCE(v_pickup_after_photo_url, pickup_after_photo_url),
         pickup_photo_url         = COALESCE(v_pickup_photo_url, pickup_photo_url),
         product_photo_url        = COALESCE(v_product_photo_url, product_photo_url),
         delivery_photo_url       = COALESCE(v_delivery_photo_url, delivery_photo_url),
         livreur_notes            = COALESCE(v_livreur_notes, livreur_notes)
   WHERE id = v_id;

  RETURN jsonb_build_object('success', true, 'tracking_id', v_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ─── RPC 2 : livreur_update_order ───
-- Permet au livreur de mettre à jour le status de SA commande
-- (et uniquement le status, pas n'importe quoi sur orders).
CREATE OR REPLACE FUNCTION public.livreur_update_order(
  p_token text,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id text;
  v_new_status text;
BEGIN
  -- 1. Trouver l'order_id à partir du token livreur
  SELECT order_id INTO v_order_id
    FROM public.delivery_tracking
   WHERE token = p_token
   LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'tracking_not_found');
  END IF;

  -- 2. Extraire le status depuis le patch (seul champ autorisé pour le livreur)
  v_new_status := p_patch->>'status';
  IF v_new_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_status_in_patch');
  END IF;

  -- 3. Whitelist des transitions de status autorisées pour un livreur
  IF v_new_status NOT IN ('shipped', 'awaiting_confirm', 'delivered') THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_not_allowed_for_livreur',
                              'attempted', v_new_status);
  END IF;

  -- 4. UPDATE
  UPDATE public.orders
     SET status = v_new_status
   WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'new_status', v_new_status);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ─── Permissions ───
GRANT EXECUTE ON FUNCTION public.livreur_update_tracking(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.livreur_update_order(text, jsonb)    TO anon, authenticated;


-- ─── Vérification ───
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
WHERE p.proname IN ('livreur_update_tracking', 'livreur_update_order')
ORDER BY p.proname;

-- Tu dois voir 2 lignes :
--   livreur_update_order    | p_token text, p_patch jsonb
--   livreur_update_tracking | p_token text, p_patch jsonb
