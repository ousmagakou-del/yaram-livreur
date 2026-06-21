-- ════════════════════════════════════════════════════════════════════
-- YARAM — Update _push_on_order_status_change → call send-push (not OneSignal)
-- ════════════════════════════════════════════════════════════════════
--
-- Le trigger existant (vit en prod, pas dans le repo) appelle pg_net.http_post
-- vers `…/functions/v1/send-push-notification` avec un body OneSignal-shaped.
--
-- Cette migration remplace ce comportement :
--   - Endpoint cible : send-push (router APNs + WebPush)
--   - Header `x-internal-secret` = INTERNAL_PUSH_SECRET (au lieu de body field)
--   - Body : { user_id, title, body, data: { order_id, status }, type: 'order_status' }
--
-- L'edge function `send-push-notification` (OneSignal) est conservée pour
-- la transition — c'est cette migration qui bascule définitivement le trigger.
--
-- Hypothèses :
--   - `public.internal_config` (key text PK, value text)
--     contient : 'supabase_url' et 'internal_push_secret'
--   - Si supabase_url n'existe pas → fallback hardcodé du projet.
-- ════════════════════════════════════════════════════════════════════

-- Templates push (titre/body) par status — keep close to client-side ORDER_STATUS_TEMPLATES.
-- On centralise ici parce que le trigger n'a pas accès au JS templates.
CREATE OR REPLACE FUNCTION public._push_on_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url               text;
  v_secret            text;
  v_title             text;
  v_body              text;
  v_short_id          text;
  v_payload           jsonb;
BEGIN
  -- Skip si pas de changement de status
  IF TG_OP = 'UPDATE' AND COALESCE(NEW.status,'') = COALESCE(OLD.status,'') THEN
    RETURN NEW;
  END IF;

  -- Skip si pas d'user_id (commande orpheline)
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_short_id := substr(NEW.id::text, 1, 12);

  -- Templates par status (miroir de src/lib/pushAdmin.js ORDER_STATUS_TEMPLATES)
  v_title := CASE NEW.status
    WHEN 'awaiting_verification' THEN '⏱ Paiement reçu'
    WHEN 'paid'                  THEN '✅ Paiement reçu !'
    WHEN 'confirmed'             THEN '✈️ Précommande confirmée'
    WHEN 'preparing'             THEN '👩‍🍳 On prépare ta commande'
    WHEN 'ready'                 THEN '📦 Commande prête'
    WHEN 'shipped'               THEN '🛵 En route !'
    WHEN 'awaiting_cash'         THEN '💵 Prépare ton règlement'
    WHEN 'awaiting_confirm'      THEN '✍️ Confirme la réception'
    WHEN 'client_confirmed'      THEN '🎉 Réception confirmée'
    WHEN 'delivered'             THEN '🎉 Livré !'
    WHEN 'cancelled'             THEN '❌ Commande annulée'
    WHEN 'refused'               THEN '⚠️ Paiement refusé'
    WHEN 'disputed'              THEN '🆘 Commande contestée'
    WHEN 'awaiting_supplier'     THEN '🌍 Commande chez le fournisseur'
    WHEN 'in_transit_intl'       THEN '✈️ Colis en transit'
    WHEN 'arrived_local'         THEN '📍 Colis au Sénégal'
    WHEN 'awaiting_balance'      THEN '💰 Solde à régler'
    ELSE NULL
  END;

  -- Aucun template → on n'envoie rien (status non géré côté UX)
  IF v_title IS NULL THEN
    RETURN NEW;
  END IF;

  v_body := CASE NEW.status
    WHEN 'awaiting_verification' THEN 'On vérifie ton virement, livraison déclenchée dès confirmation.'
    WHEN 'paid'                  THEN 'Ta commande ' || v_short_id || ' est confirmée. On la prépare !'
    WHEN 'confirmed'             THEN 'Acompte reçu. Ton import est lancé chez le fournisseur.'
    WHEN 'preparing'             THEN 'Ta commande ' || v_short_id || ' est en cours de préparation à la pharmacie.'
    WHEN 'ready'                 THEN 'Ta commande ' || v_short_id || ' est prête, le livreur va bientôt partir.'
    WHEN 'shipped'               THEN 'Ton livreur est en route. Tu peux le suivre en temps réel.'
    WHEN 'awaiting_cash'         THEN 'Le livreur est là. Prépare la somme à régler.'
    WHEN 'awaiting_confirm'      THEN 'Valide la réception de ta commande pour clôturer.'
    WHEN 'client_confirmed'      THEN 'Merci pour ta confirmation !'
    WHEN 'delivered'             THEN 'Ta commande est livrée. Profite bien de tes produits ! 💚'
    WHEN 'cancelled'             THEN 'Ta commande a été annulée. Si tu as une question, contacte-nous sur WhatsApp.'
    WHEN 'refused'               THEN 'Recontacte-nous WhatsApp pour régler le souci.'
    WHEN 'disputed'              THEN 'Notre équipe va te recontacter rapidement.'
    WHEN 'awaiting_supplier'     THEN 'On a passé la commande, on te tient au courant.'
    WHEN 'in_transit_intl'       THEN 'Ton colis voyage vers le Sénégal.'
    WHEN 'arrived_local'         THEN 'Bientôt entre tes mains !'
    WHEN 'awaiting_balance'      THEN 'Le solde de ta commande est à payer.'
    ELSE ''
  END;

  -- URL + secret depuis internal_config (fallback projet hardcodé)
  SELECT value INTO v_url   FROM public.internal_config WHERE key = 'supabase_url';
  SELECT value INTO v_secret FROM public.internal_config WHERE key = 'internal_push_secret';
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://qxhhnrnworwrnwmqekmb.supabase.co';
  END IF;
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING '[_push_on_order_status_change] internal_push_secret missing in internal_config — skip';
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'user_id', NEW.user_id,
    'type',    'order_status',
    'title',   v_title,
    'body',    v_body,
    'data',    jsonb_build_object(
      'order_id', NEW.id::text,
      'status',   NEW.status,
      'url',      'https://yaram.app/order/' || NEW.id::text
    )
  );

  -- Best-effort fire-and-forget. Si pg_net pas dispo → on log, on n'échoue pas.
  BEGIN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', v_secret
      ),
      body    := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[_push_on_order_status_change] net.http_post failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Re-attach le trigger (DROP+CREATE pour idempotence).
DROP TRIGGER IF EXISTS push_on_order_status_change ON public.orders;
CREATE TRIGGER push_on_order_status_change
AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public._push_on_order_status_change();
