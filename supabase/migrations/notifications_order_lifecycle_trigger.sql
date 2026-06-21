-- ═══════════════════════════════════════════════════════════════════
-- YARAM — Trigger : journal des notifications de cycle de commande
-- ═══════════════════════════════════════════════════════════════════
-- À chaque UPDATE de orders.status (transition d'état), insère une
-- ligne dans public.notifications pour le user concerné, afin de bâtir
-- un VRAI journal persistant des activités commande/paiement/livraison.
--
-- Idempotent : la fonction & le trigger sont DROP/CREATE OR REPLACE.
--
-- Compat schéma `notifications` (colonnes existantes utilisées) :
--   id (default gen_random_uuid)
--   user_id  uuid not null
--   title    text
--   body     text
--   icon     text          (optionnel)
--   url      text          (deep-link interne, ex: /order/<id>)
--   type     text          ('order_status')
--   read     boolean default false
--   sent_at  timestamptz default now()
--
-- IMPORTANT : si une colonne diffère, AJUSTE le INSERT avant d'appliquer.
-- À EXÉCUTER dans Supabase SQL Editor (admin).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._notify_on_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_title text;
  v_body  text;
  v_icon  text := NULL;
  v_url   text;
BEGIN
  -- Aucune transition réelle → on ne fait rien.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Pas de user → impossible de créer la notif (skip silencieusement).
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ─── Mapping libellés par statut (français, ton YARAM) ───
  -- Cf. orders_status_check (MIGRATION_MEGA_FIX_STATUSES_AND_WHITELISTS.sql)
  CASE NEW.status
    WHEN 'pending_payment'      THEN v_title := 'Paiement en attente';          v_body := 'On attend la confirmation de ton paiement.';
    WHEN 'paid'                 THEN v_title := 'Paiement validé';              v_body := 'On prépare ta commande maintenant !';
    WHEN 'confirmed'            THEN v_title := 'Acompte reçu';                 v_body := 'Ton import est lancé, on te tient au courant.';
    WHEN 'preparing'            THEN v_title := 'Commande en préparation';     v_body := 'Ta pharmacie prépare tes produits.';
    WHEN 'ready'                THEN v_title := 'Commande prête';               v_body := 'Le livreur va passer la récupérer.';
    WHEN 'shipped'              THEN v_title := 'Commande en route';            v_body := 'Ton livreur est en chemin !';
    WHEN 'in_delivery'          THEN v_title := 'Livreur en route';             v_body := 'Ton livreur arrive bientôt.';
    WHEN 'awaiting_cash'        THEN v_title := 'Livreur arrivé';               v_body := 'Prépare le règlement, ton livreur est là.';
    WHEN 'awaiting_confirm'     THEN v_title := 'Confirme ta réception';        v_body := 'Valide la réception pour clôturer la commande.';
    WHEN 'client_confirmed'     THEN v_title := 'Réception confirmée';          v_body := 'Merci ! On finalise la commande.';
    WHEN 'delivered'            THEN v_title := 'Commande livrée';              v_body := 'Merci pour ton achat, à très vite sur YARAM !';
    WHEN 'awaiting_supplier'    THEN v_title := 'Commande chez le fournisseur'; v_body := 'On a passé la commande à l''international.';
    WHEN 'in_transit_intl'      THEN v_title := 'Colis en transit';             v_body := 'Ton colis voyage vers le Sénégal.';
    WHEN 'arrived_local'        THEN v_title := 'Colis arrivé au Sénégal';      v_body := 'Bientôt entre tes mains !';
    WHEN 'awaiting_balance'     THEN v_title := 'Solde à régler';               v_body := 'Le solde de ta commande est à payer.';
    WHEN 'cancelled'            THEN v_title := 'Commande annulée';             v_body := 'Ta commande a été annulée.';
    WHEN 'refused'              THEN v_title := 'Paiement refusé';              v_body := 'Recontacte-nous sur WhatsApp si besoin.';
    WHEN 'disputed'             THEN v_title := 'Commande contestée';           v_body := 'Notre équipe va te recontacter.';
    ELSE
      RETURN NEW; -- statut inconnu → on n'insère rien
  END CASE;

  v_url := '/order/' || NEW.id::text;

  -- Insertion en bypass RLS (SECURITY DEFINER). RLS sur INSERT exige
  -- auth.uid()=user_id → un trigger n'a pas d'uid, donc SECURITY DEFINER
  -- est nécessaire ici. La policy SELECT reste appliquée côté client.
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, icon, url, read, sent_at)
    VALUES (NEW.user_id, 'order_status', v_title, v_body, v_icon, v_url, false, now());
  EXCEPTION WHEN OTHERS THEN
    -- Ne jamais bloquer la transition d'état d'une commande à cause d'une notif.
    RAISE WARNING '[_notify_on_order_status_change] insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END
$fn$;

-- ─── Trigger (drop-and-recreate, idempotent) ──────────────────────────
DROP TRIGGER IF EXISTS trg_notify_on_order_status_change ON public.orders;

CREATE TRIGGER trg_notify_on_order_status_change
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public._notify_on_order_status_change();

-- ─── Permissions de la fonction ──────────────────────────────────────
REVOKE ALL ON FUNCTION public._notify_on_order_status_change() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._notify_on_order_status_change() TO authenticated, service_role;

-- ─── Sanity check ────────────────────────────────────────────────────
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trg_notify_on_order_status_change';
