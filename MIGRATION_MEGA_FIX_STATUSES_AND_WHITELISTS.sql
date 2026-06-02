-- ═══════════════════════════════════════════════════════════════════
-- YARAM — MEGA FIX : status constraint + RPC whitelists
-- ═══════════════════════════════════════════════════════════════════
-- Corrige 3 bugs critiques d'un seul coup :
--
-- 1. orders_status_check refuse 9 statuts utilisés par admin/livreur/pharma
--    → Erreur "violates check constraint" sur chaque clic "Avancer"
--
-- 2. livreur_update_tracking ignore silencieusement GPS, signature, PIN
--    → Position GPS jamais persistée, signature/PIN livraison jamais sauvés
--
-- 3. livreur_update_order ignore cash_received, confirmation_token
--    → Cash jamais marqué reçu, lien WhatsApp client cassé (token absent en DB)
--
-- À EXÉCUTER en une fois dans Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 1 : Check constraint orders.status (union de tous les flows)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  -- Flow paiement
  'pending_payment',     -- Wave/OM en attente de confirmation
  'pending',             -- compat preorder
  'paid',                -- confirmé par client (client_mark_order_paid)
  'confirmed',           -- compat preorder (acompte reçu)
  -- Flow préparation / livraison
  'preparing',           -- pharma accepte (pharma_update_order action='accept')
  'ready',               -- pharma marque prête
  'shipped',             -- livreur en route
  'in_delivery',         -- compat ancien flow
  'awaiting_cash',       -- livreur arrivé, attend cash
  'awaiting_confirm',    -- livré, attend confirmation cliente
  'client_confirmed',    -- cliente a confirmé
  'delivered',           -- terminé OK
  -- Flow preorder import
  'awaiting_supplier',
  'in_transit_intl',
  'arrived_local',
  'awaiting_balance',
  -- États terminaux négatifs
  'cancelled',
  'refused',
  'disputed'
));


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 2 : RPC livreur_update_tracking — whitelist élargie
-- ─────────────────────────────────────────────────────────────────────
-- Ajouts vs version précédente :
--   - current_lat / current_lng (le code envoie ces noms, PAS livreur_lat/lng)
--   - delivery_signature (base64 data URL signature livraison)
--   - delivery_pin (PIN 4 chiffres confirmation client)
-- ─────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.livreur_update_tracking(text, jsonb);

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
   WHERE token = p_token
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'tracking_not_found');
  END IF;

  -- UPDATE avec COALESCE sur TOUS les champs whitelistés.
  -- On supporte les DEUX noms (livreur_lat/current_lat) pour compat.
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


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 3 : RPC livreur_update_order — accepte aussi cash + confirm_token
-- ─────────────────────────────────────────────────────────────────────
-- Ajouts vs version précédente :
--   - cash_received (bool) + cash_received_at (timestamptz)
--   - confirmation_token (text) + awaiting_confirm_at (timestamptz)
-- Status reste whitelisté pour éviter qu'un livreur ne se déclare admin.
-- ─────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.livreur_update_order(text, jsonb);

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
  -- 1. Trouver l'order_id à partir du token livreur
  SELECT order_id INTO v_order_id
    FROM public.delivery_tracking
   WHERE token = p_token
   LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'tracking_not_found');
  END IF;

  -- 2. Extraire tous les champs whitelistés
  v_new_status        := p_patch->>'status';
  v_cash_received     := (p_patch->>'cash_received')::boolean;
  v_cash_received_at  := (p_patch->>'cash_received_at')::timestamptz;
  v_confirm_token     := p_patch->>'confirmation_token';
  v_awaiting_at       := (p_patch->>'awaiting_confirm_at')::timestamptz;

  -- 3. Si status présent, valider qu'il est dans la whitelist livreur
  IF v_new_status IS NOT NULL AND v_new_status NOT IN ('shipped', 'awaiting_cash', 'awaiting_confirm', 'delivered') THEN
    RETURN jsonb_build_object('success', false, 'error', 'status_not_allowed_for_livreur',
                              'attempted', v_new_status);
  END IF;

  -- 4. UPDATE
  UPDATE public.orders
     SET status              = COALESCE(v_new_status, status),
         cash_received       = COALESCE(v_cash_received, cash_received),
         cash_received_at    = COALESCE(v_cash_received_at, cash_received_at),
         confirmation_token  = COALESCE(v_confirm_token, confirmation_token),
         awaiting_confirm_at = COALESCE(v_awaiting_at, awaiting_confirm_at)
   WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'new_status', v_new_status);

EXCEPTION WHEN OTHERS THEN
  -- Le SQLERRM peut révéler "column X does not exist" si les colonnes
  -- cash_received / confirmation_token / awaiting_confirm_at n'existent pas
  -- encore sur la table orders. Voir Partie 4 ci-dessous.
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 4 : Ajouter les colonnes manquantes sur orders si besoin
-- ─────────────────────────────────────────────────────────────────────
-- Si la RPC livreur_update_order échoue avec "column X does not exist",
-- c'est que ces colonnes n'ont jamais été ajoutées. Idempotent (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cash_received       boolean;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cash_received_at    timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS confirmation_token  text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS awaiting_confirm_at timestamptz;

-- Pareil pour delivery_tracking au cas où signature/pin manquent
ALTER TABLE public.delivery_tracking ADD COLUMN IF NOT EXISTS delivery_signature text;
ALTER TABLE public.delivery_tracking ADD COLUMN IF NOT EXISTS delivery_pin       text;


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 5 : Permissions
-- ─────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.livreur_update_tracking(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.livreur_update_order(text, jsonb)    TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- PARTIE 6 : Vérification
-- ─────────────────────────────────────────────────────────────────────
-- Tu dois voir 2 RPC + 19 statuts autorisés.

SELECT
  conname AS constraint_name,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE conname = 'orders_status_check';

SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
WHERE p.proname IN ('livreur_update_tracking', 'livreur_update_order')
ORDER BY p.proname;
