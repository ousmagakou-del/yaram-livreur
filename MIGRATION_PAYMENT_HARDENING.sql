-- ═══════════════════════════════════════════════════════════════════
-- YARAM — Payment hardening : anti-fraude Wave + RPC client_mark_order_paid
-- ═══════════════════════════════════════════════════════════════════
--
-- PROBLÈME RÉSOLU :
-- L'URL Wave (https://pay.wave.com/m/.../sn?amount=XXX) est éditable
-- côté client. Un user peut commander 200 000 FCFA, payer 100 FCFA via
-- Wave, cliquer "J'ai payé" et — avec l'ancienne RPC — passer
-- directement en status='paid' → livraison déclenchée → fraude.
--
-- SOLUTION : nouveau statut 'awaiting_verification' entre 'pending_payment'
-- et 'paid'. La RPC client_mark_order_paid écrit 'awaiting_verification',
-- jamais 'paid'. C'est l'admin qui passe manuellement en 'paid' une fois
-- le virement Wave/OM vraiment vérifié.
--
-- Le statut 'paid' reste valide pour :
--   1. Cash on delivery (vérification physique à la livraison)
--   2. PayTech webhook authentifié (IPN signé SHA256)
--   3. Action admin manuelle après vérif Wave/OM
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Documenter le nouveau statut (pour les autres devs) ───
-- Les statuts existants : pending_payment | paid | confirmed | shipped | delivered | cancelled
-- Nouveau : awaiting_verification — preuve client mais pas encore validée par admin

COMMENT ON COLUMN public.orders.status IS
  'Workflow : pending_payment → awaiting_verification (Wave/OM) | paid (COD/PayTech) → confirmed (preorder import en attente) → shipped → delivered. Branches : cancelled.';

-- ─── 2. RPC client_mark_order_paid : écrit awaiting_verification au lieu de paid ───
-- On garde la signature pour ne pas casser Payment.jsx (qui appelle updateOrderStatus).
-- Mais en interne, pour Wave/OM/Card, on stocke 'awaiting_verification'.
-- COD reste 'paid' (vérif à la livraison).

CREATE OR REPLACE FUNCTION public.client_mark_order_paid(p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_order record;
  v_target_status text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, user_id, status, payment_method
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  IF v_order.user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_your_order');
  END IF;

  IF v_order.status NOT IN ('pending_payment', 'pending') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'order_not_pending',
      'current_status', v_order.status
    );
  END IF;

  -- ─── ANTI-FRAUDE : Wave/OM/Card → awaiting_verification (admin doit vérifier) ───
  -- COD reste 'paid' car la vérif a lieu à la livraison physique.
  IF v_order.payment_method = 'cod' THEN
    v_target_status := 'paid';
  ELSE
    v_target_status := 'awaiting_verification';
  END IF;

  UPDATE public.orders
     SET status = v_target_status,
         -- payment_confirmed_at uniquement si status='paid' (COD)
         payment_confirmed_at = CASE
           WHEN v_target_status = 'paid' THEN NOW()
           ELSE payment_confirmed_at
         END,
         -- track quand le client a déclaré avoir payé (pour SLA admin)
         client_marked_paid_at = NOW()
   WHERE id = p_order_id
     AND user_id = v_uid
     AND status IN ('pending_payment', 'pending');

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'new_status', v_target_status
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ─── 3. Nouvelle colonne pour le SLA admin ───
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS client_marked_paid_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.client_marked_paid_at IS
  'Timestamp où le client a cliqué "J''ai payé". Utilisé par le dashboard admin pour prioriser les vérifs Wave/OM (FIFO).';

-- ─── 4. Index pour le dashboard admin : awaiting_verification en attente ───
CREATE INDEX IF NOT EXISTS idx_orders_awaiting_verification
  ON public.orders(client_marked_paid_at)
  WHERE status = 'awaiting_verification';

-- ─── 5. RPC admin pour confirmer manuellement le paiement ───
-- L'admin checke son app Wave/OM, voit le virement réel (montant + ref),
-- et appelle cette RPC pour passer en 'paid'.
CREATE OR REPLACE FUNCTION public.admin_confirm_payment(
  p_order_id text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_admin boolean;
  v_order record;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Vérifier admin : adapte le predicate à ton schéma (profile.role / app_metadata)
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid
      AND role IN ('admin', 'super_admin')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_admin');
  END IF;

  SELECT id, status, is_preorder
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  IF v_order.status NOT IN ('awaiting_verification', 'pending_payment') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'order_not_awaiting',
      'current_status', v_order.status
    );
  END IF;

  UPDATE public.orders
     SET status = CASE WHEN v_order.is_preorder THEN 'confirmed' ELSE 'paid' END,
         payment_confirmed_at = NOW(),
         payment_verified_by = v_uid,
         payment_verification_note = p_note,
         deposit_paid_at = CASE
           WHEN v_order.is_preorder THEN NOW()
           ELSE deposit_paid_at
         END
   WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_verified_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS payment_verification_note TEXT;

-- ─── 6. RPC admin pour rejeter un paiement (montant insuffisant détecté) ───
CREATE OR REPLACE FUNCTION public.admin_reject_payment(
  p_order_id text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_admin boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND role IN ('admin', 'super_admin')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_admin');
  END IF;

  UPDATE public.orders
     SET status = 'pending_payment',
         client_marked_paid_at = NULL,
         payment_verification_note = COALESCE(p_reason, 'rejected_by_admin')
   WHERE id = p_order_id
     AND status = 'awaiting_verification';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_awaiting');
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ─── 7. Grants ───
GRANT EXECUTE ON FUNCTION public.client_mark_order_paid(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_payment(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_payment(text, text) TO authenticated;

-- ─── 8. Vérification ───
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
WHERE p.proname IN ('client_mark_order_paid', 'admin_confirm_payment', 'admin_reject_payment')
ORDER BY p.proname;

-- ─── 9. Compteur des commandes en attente de vérif ───
SELECT
  COUNT(*) AS awaiting_verification_count,
  COALESCE(SUM(total), 0) AS awaiting_amount,
  MIN(client_marked_paid_at) AS oldest_pending
FROM public.orders
WHERE status = 'awaiting_verification';
