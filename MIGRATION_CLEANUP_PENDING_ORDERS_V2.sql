-- ════════════════════════════════════════════════════════════
-- YARAM — Cleanup pending orders V2 (fix faux positifs)
-- ════════════════════════════════════════════════════════════
--
-- BUG V1 :
-- La V1 annulait TOUTES les commandes en 'pending_payment' > 24h, incluant :
--   1. Les commandes COD (cash à la livraison) légitimes. Pour le cash,
--      'pending_payment' = "en attente de livraison + paiement". Le user
--      n'a RIEN à confirmer côté app → la commande restait éternellement
--      en pending_payment et était annulée à tort.
--   2. (V1 ne connaissait pas) Les nouvelles commandes 'awaiting_verification'
--      où le client a cliqué "J'ai payé" mais l'admin n'a pas encore vérifié
--      le virement Wave/OM. Avec V2, on protège ces commandes pendant 48h
--      pour laisser le temps à l'admin de checker.
--
-- V2 :
--   • EXCLUT payment_method='cod' (jamais cancellé par le job)
--   • EXCLUT status='awaiting_verification' < 48h (SLA admin)
--   • EXCLUT is_preorder=true + status='confirmed' (acompte payé, on attend l'import)
--   • Garde le cancel 24h pour pending_payment Wave/OM/Card non confirmés
--   • Cancel awaiting_verification > 48h (le client a déclaré mais le virement
--     n'est jamais arrivé → fraude tentée ou abandon)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cleanup_stale_pending_orders()
RETURNS TABLE (
  cancelled_pending_count INT,
  cancelled_awaiting_count INT,
  total_amount NUMERIC,
  oldest_order_age_hours NUMERIC
)
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  v_pending_count INT := 0;
  v_awaiting_count INT := 0;
  v_total NUMERIC := 0;
  v_oldest_hours NUMERIC := 0;
BEGIN
  -- ─── 1. Stats avant cleanup ───
  SELECT COUNT(*), COALESCE(SUM(total), 0),
         COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 3600, 0)
    INTO v_pending_count, v_total, v_oldest_hours
    FROM orders
   WHERE status = 'pending_payment'
     AND created_at < NOW() - INTERVAL '24 hours'
     -- ⚠️ EXCLUSION COD : jamais cancel le cash, l'user paie à la livraison
     AND COALESCE(payment_method, '') <> 'cod';

  -- ─── 2. Cancel pending_payment > 24h (sauf COD) ───
  UPDATE orders
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancellation_reason = 'auto_pending_payment_24h_timeout'
   WHERE status = 'pending_payment'
     AND created_at < NOW() - INTERVAL '24 hours'
     AND COALESCE(payment_method, '') <> 'cod';

  -- ─── 3. Cancel awaiting_verification > 48h (admin a eu le temps de vérifier) ───
  -- Si le user a cliqué "J'ai payé" il y a + de 48h ET l'admin n'a pas
  -- confirmé, c'est qu'il n'y a aucun virement Wave/OM correspondant.
  -- → fraude tentée ou commande abandonnée. On annule.
  SELECT COUNT(*)
    INTO v_awaiting_count
    FROM orders
   WHERE status = 'awaiting_verification'
     AND COALESCE(client_marked_paid_at, created_at) < NOW() - INTERVAL '48 hours';

  UPDATE orders
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancellation_reason = 'auto_awaiting_verification_48h_timeout'
   WHERE status = 'awaiting_verification'
     AND COALESCE(client_marked_paid_at, created_at) < NOW() - INTERVAL '48 hours';

  -- ─── 4. Log audit ───
  BEGIN
    INSERT INTO admin_logs (action, details, created_at)
    VALUES (
      'auto_cleanup_pending_orders_v2',
      jsonb_build_object(
        'cancelled_pending_count', v_pending_count,
        'cancelled_awaiting_count', v_awaiting_count,
        'total_amount', v_total,
        'oldest_hours', v_oldest_hours
      ),
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN QUERY SELECT v_pending_count, v_awaiting_count, v_total, v_oldest_hours;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_stale_pending_orders() TO authenticated;

-- ─── 5. Re-programme le cron (si V1 déjà installée, on remplace) ───
-- pg_cron : unschedule l'ancien si présent, re-schedule.
DO $$
BEGIN
  PERFORM cron.unschedule('yaram-cleanup-pending-orders');
EXCEPTION WHEN OTHERS THEN
  NULL; -- pas grave si le job n'existait pas
END $$;

SELECT cron.schedule(
  'yaram-cleanup-pending-orders',
  '0 * * * *',                      -- toutes les heures
  $$ SELECT cleanup_stale_pending_orders(); $$
);

-- ─── 6. Vérification ───
SELECT 'Cleanup V2 installé ✅' AS status,
       jobname, schedule, active
  FROM cron.job
 WHERE jobname = 'yaram-cleanup-pending-orders';

-- ─── 7. Stats actuelles (preview de ce que le prochain run ferait) ───
SELECT
  'pending_payment > 24h (hors COD)' AS bucket,
  COUNT(*) AS count,
  COALESCE(SUM(total), 0) AS amount
  FROM orders
 WHERE status = 'pending_payment'
   AND created_at < NOW() - INTERVAL '24 hours'
   AND COALESCE(payment_method, '') <> 'cod'
UNION ALL
SELECT
  'awaiting_verification > 48h' AS bucket,
  COUNT(*),
  COALESCE(SUM(total), 0)
  FROM orders
 WHERE status = 'awaiting_verification'
   AND COALESCE(client_marked_paid_at, created_at) < NOW() - INTERVAL '48 hours'
UNION ALL
SELECT
  'COD préservés (jamais auto-cancel)' AS bucket,
  COUNT(*),
  COALESCE(SUM(total), 0)
  FROM orders
 WHERE status = 'pending_payment'
   AND payment_method = 'cod';

-- ─── 8. Test manuel ───
-- SELECT * FROM cleanup_stale_pending_orders();
