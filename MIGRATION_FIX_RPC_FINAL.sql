-- ═══════════════════════════════════════════════════════════════════
-- YARAM — Fix DÉFINITIF RPC livreur (colonnes réelles)
-- ═══════════════════════════════════════════════════════════════════
-- Schéma RÉEL de delivery_tracking (vérifié) :
--   id, order_id, delivery_token, delivery_person_name, delivery_person_phone,
--   current_lat, current_lng, last_update, status, created_at,
--   pickup_photo_url, product_photo_url, delivery_photo_url,
--   delivery_signature, delivery_pin,
--   pickup_at, picked_at, in_route_at, arrived_at, delivered_at,
--   scanned_barcodes
--
-- ➜ Manquent en DB mais utilisées par Livreur.jsx :
--    pickup_before_photo_url, pickup_after_photo_url
-- ➜ On les ajoute via ALTER TABLE IF NOT EXISTS (idempotent).
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 1 : Ajouter les colonnes manquantes (idempotent)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.delivery_tracking
  ADD COLUMN IF NOT EXISTS pickup_before_photo_url text,
  ADD COLUMN IF NOT EXISTS pickup_after_photo_url  text;


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 2 : DROP des versions cassées
-- ─────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.livreur_update_tracking(text, jsonb);
DROP FUNCTION IF EXISTS public.livreur_update_order(text, jsonb);


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 3 : RPC livreur_update_tracking — colonnes RÉELLES uniquement
-- ─────────────────────────────────────────────────────────────────────
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
BEGIN
  -- Vérifier token
  SELECT id INTO v_id
    FROM public.delivery_tracking
   WHERE delivery_token = p_token
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'tracking_not_found');
  END IF;

  -- UPDATE strict : UNIQUEMENT colonnes qui existent en DB.
  -- Le code livreur envoie current_lat/current_lng (pas livreur_lat/lng).
  UPDATE public.delivery_tracking
     SET status                   = COALESCE(p_patch->>'status', status),
         last_update              = COALESCE((p_patch->>'last_update')::timestamptz, NOW()),
         scanned_barcodes         = COALESCE(p_patch->'scanned_barcodes', scanned_barcodes),
         current_lat              = COALESCE((p_patch->>'current_lat')::numeric, current_lat),
         current_lng              = COALESCE((p_patch->>'current_lng')::numeric, current_lng),
         pickup_before_photo_url  = COALESCE(p_patch->>'pickup_before_photo_url', pickup_before_photo_url),
         pickup_after_photo_url   = COALESCE(p_patch->>'pickup_after_photo_url', pickup_after_photo_url),
         pickup_photo_url         = COALESCE(p_patch->>'pickup_photo_url', pickup_photo_url),
         product_photo_url        = COALESCE(p_patch->>'product_photo_url', product_photo_url),
         delivery_photo_url       = COALESCE(p_patch->>'delivery_photo_url', delivery_photo_url),
         delivery_signature       = COALESCE(p_patch->>'delivery_signature', delivery_signature),
         delivery_pin             = COALESCE(p_patch->>'delivery_pin', delivery_pin)
   WHERE id = v_id;

  RETURN jsonb_build_object('success', true, 'tracking_id', v_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 4 : RPC livreur_update_order — colonnes orders (déjà fait)
-- ─────────────────────────────────────────────────────────────────────
-- ATTENTION : si tu as déjà ajouté cash_received / confirmation_token /
-- awaiting_confirm_at avec le mega SQL précédent, c'est OK. Sinon les
-- ALTER TABLE IF NOT EXISTS ci-dessous les ajoutent.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cash_received       boolean,
  ADD COLUMN IF NOT EXISTS cash_received_at    timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_token  text,
  ADD COLUMN IF NOT EXISTS awaiting_confirm_at timestamptz;


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
  v_cash_received boolean;
  v_cash_received_at timestamptz;
  v_confirm_token text;
  v_awaiting_at timestamptz;
BEGIN
  -- delivery_token (le vrai nom de colonne)
  SELECT order_id INTO v_order_id
    FROM public.delivery_tracking
   WHERE delivery_token = p_token
   LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'tracking_not_found');
  END IF;

  v_new_status        := p_patch->>'status';
  v_cash_received     := (p_patch->>'cash_received')::boolean;
  v_cash_received_at  := (p_patch->>'cash_received_at')::timestamptz;
  v_confirm_token     := p_patch->>'confirmation_token';
  v_awaiting_at       := (p_patch->>'awaiting_confirm_at')::timestamptz;

  IF v_new_status IS NOT NULL AND v_new_status NOT IN ('shipped', 'awaiting_cash', 'awaiting_confirm', 'delivered') THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_not_allowed_for_livreur',
                              'attempted', v_new_status);
  END IF;

  UPDATE public.orders
     SET status              = COALESCE(v_new_status, status),
         cash_received       = COALESCE(v_cash_received, cash_received),
         cash_received_at    = COALESCE(v_cash_received_at, cash_received_at),
         confirmation_token  = COALESCE(v_confirm_token, confirmation_token),
         awaiting_confirm_at = COALESCE(v_awaiting_at, awaiting_confirm_at)
   WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'new_status', v_new_status);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 5 : Permissions
-- ─────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.livreur_update_tracking(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.livreur_update_order(text, jsonb)    TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 6 : TEST en direct avec ton vrai token
-- ─────────────────────────────────────────────────────────────────────
-- Doit retourner : {"success": true, "tracking_id": "..."}
SELECT livreur_update_tracking('LIV-0IZX3GDY', '{"status": "picking"}'::jsonb);
