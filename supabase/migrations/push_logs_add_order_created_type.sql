-- ════════════════════════════════════════════════════════
-- YARAM — Patch push_logs : ajoute le type 'order_created'
-- ════════════════════════════════════════════════════════
-- Suite à l'ajout du push "Commande confirmée" envoyé au moment où l'user
-- finalise sa commande (COD ou retour PayTech), on étend le CHECK constraint
-- de push_logs.type pour autoriser cette nouvelle valeur.
--
-- Idempotent : peut être ré-exécuté sans erreur.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.push_logs
  DROP CONSTRAINT IF EXISTS push_logs_type_check;

ALTER TABLE public.push_logs
  ADD CONSTRAINT push_logs_type_check
  CHECK (type IN (
    'manual',
    'order_status',
    'order_created',
    'replenishment',
    'reengagement',
    'anniversary',
    'scan_refresh',
    'welcome'
  ));
