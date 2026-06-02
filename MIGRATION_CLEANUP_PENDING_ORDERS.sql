-- ════════════════════════════════════════════════════════
-- YARAM — Auto-cleanup des commandes non payées > 24h
-- ════════════════════════════════════════════════════════
-- Quand un user crée une commande mais n'achève jamais le paiement Wave,
-- la commande reste en status 'pending_payment' indéfiniment.
-- Cette migration ajoute un job pg_cron qui passe en 'cancelled' toute
-- commande en pending_payment depuis plus de 24h.
--
-- Bénéfices :
--   1. Libère le stock réservé (si tu tracks le stock)
--   2. Nettoie le tableau admin (moins de bruit)
--   3. Permet à l'user de re-tenter sans dupliquer la commande
--
-- IMPORTANT : pg_cron doit être activé dans Supabase :
--   Dashboard → Database → Extensions → cherche "pg_cron" → enable
-- ════════════════════════════════════════════════════════

-- 1. Active l'extension pg_cron (nécessite admin)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Fonction qui fait le cleanup (RPC + cron)
CREATE OR REPLACE FUNCTION cleanup_stale_pending_orders()
RETURNS TABLE (
  cancelled_count INT,
  total_amount NUMERIC,
  oldest_order_age_hours NUMERIC
)
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  v_cancelled_count INT;
  v_total NUMERIC;
  v_oldest_hours NUMERIC;
BEGIN
  -- Compte avant pour le report
  SELECT COUNT(*), COALESCE(SUM(total), 0),
         COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 3600, 0)
  INTO v_cancelled_count, v_total, v_oldest_hours
  FROM orders
  WHERE status = 'pending_payment'
    AND created_at < NOW() - INTERVAL '24 hours';

  -- Update : cancellation
  UPDATE orders
  SET status = 'cancelled',
      cancelled_at = NOW(),
      cancellation_reason = 'auto_pending_payment_24h_timeout'
  WHERE status = 'pending_payment'
    AND created_at < NOW() - INTERVAL '24 hours';

  -- Log dans une table audit (si elle existe)
  BEGIN
    INSERT INTO admin_logs (action, details, created_at)
    VALUES (
      'auto_cleanup_pending_orders',
      jsonb_build_object(
        'cancelled_count', v_cancelled_count,
        'total_amount', v_total,
        'oldest_hours', v_oldest_hours
      ),
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Si admin_logs n'existe pas, on s'en moque
    NULL;
  END;

  RETURN QUERY SELECT v_cancelled_count, v_total, v_oldest_hours;
END;
$$;

-- 3. Donne accès à la fonction (pour appel manuel admin)
GRANT EXECUTE ON FUNCTION cleanup_stale_pending_orders() TO authenticated;

-- 4. Ajoute les colonnes cancelled_at + cancellation_reason si pas déjà là
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- 5. Programme le cron : toutes les heures à xx:00
-- (pour run plus souvent : '*/15 * * * *' = toutes les 15 min)
SELECT cron.schedule(
  'yaram-cleanup-pending-orders',  -- nom du job
  '0 * * * *',                      -- toutes les heures
  $$ SELECT cleanup_stale_pending_orders(); $$
);

-- 6. Vérification : voir tous les jobs cron actifs
SELECT 'Job cleanup planifié ✅' AS status,
       jobname, schedule, active
FROM cron.job
WHERE jobname = 'yaram-cleanup-pending-orders';

-- 7. (Optionnel) Test immédiat de la fonction
-- SELECT * FROM cleanup_stale_pending_orders();
