-- ═══════════════════════════════════════════════════════════════════
-- YARAM — Fix critique : colonne 'token' n'existe pas
-- ═══════════════════════════════════════════════════════════════════
-- Symptôme exact (capturé dans le navigateur du livreur) :
--   {error: 'column "token" does not exist', success: false}
--
-- Cause : mes RPC précédentes utilisent WHERE token = p_token mais
--         la vraie colonne dans delivery_tracking s'appelle
--         delivery_token. Confirmé par le code admin qui lit déjà
--         tracking.delivery_token.
--
-- Fix : DROP + CREATE des 2 RPC avec le bon nom de colonne.
-- À exécuter en une fois dans Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════


-- ─── DROP des versions cassées ───
DROP FUNCTION IF EXISTS public.livreur_update_tracking(text, jsonb);
DROP FUNCTION IF EXISTS public.livreur_update_order(text, jsonb);


-- ═══════════════════════════════════════════════════════════════════
-- RPC 1 : livreur_update_tracking — VRAI nom de colonne
-- ═══════════════════════════════════════════════════════════════════
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
  -- ─── FIX : delivery_token (pas token) ───
  SELECT id INTO v_id
    FROM public.delivery_tracking
   WHERE delivery_token = p_token
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'tracking_not_found');
  END IF;

  UPDATE public.delivery_tracking
     SET status                   = COALESCE(p_patch->>'status', status),
         last_update              = COALESCE((p_patch->>'last_update')::timestamptz, NOW()),
         scanned_barcodes         = COALESCE(p_patch->'scanned_barcodes', scanned_barcodes),
         livreur_lat              = COALESCE(
                                      (p_patch->>'current_lat')::numeric,
                                      (p_patch->>'livreur_lat')::numeric,
                                      livreur_lat),
         livreur_lng              = COALESCE(
                                      (p_patch->>'current_lng')::numeric,
                                      (p_patch->>'livreur_lng')::numeric,
                                      livreur_lng),
         gps_updated_at           = COALESCE((p_patch->>'gps_updated_at')::timestamptz, gps_updated_at),
         pickup_before_photo_url  = COALESCE(p_patch->>'pickup_before_photo_url', pickup_before_photo_url),
         pickup_after_photo_url   = COALESCE(p_patch->>'pickup_after_photo_url', pickup_after_photo_url),
         pickup_photo_url         = COALESCE(p_patch->>'pickup_photo_url', pickup_photo_url),
         product_photo_url        = COALESCE(p_patch->>'product_photo_url', product_photo_url),
         delivery_photo_url       = COALESCE(p_patch->>'delivery_photo_url', delivery_photo_url),
         delivery_signature       = COALESCE(p_patch->>'delivery_signature', delivery_signature),
         delivery_pin             = COALESCE(p_patch->>'delivery_pin', delivery_pin),
         livreur_notes            = COALESCE(p_patch->>'livreur_notes', livreur_notes)
   WHERE id = v_id;

  RETURN jsonb_build_object('success', true, 'tracking_id', v_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- RPC 2 : livreur_update_order — VRAI nom de colonne
-- ═══════════════════════════════════════════════════════════════════
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
  -- ─── FIX : delivery_token (pas token) ───
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


-- ─── Permissions ───
GRANT EXECUTE ON FUNCTION public.livreur_update_tracking(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.livreur_update_order(text, jsonb)    TO anon, authenticated;


-- ─── Vérification : test direct ───
-- Remplace LIV-XXXXX par un vrai delivery_token de ta DB
SELECT livreur_update_tracking('LIV-0IZX3GDY', '{"status": "picking", "last_update": "2026-06-01T23:00:00Z"}'::jsonb);

-- Doit retourner : {"success": true, "tracking_id": "..."}
