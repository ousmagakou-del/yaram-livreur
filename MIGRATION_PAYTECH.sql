-- ════════════════════════════════════════════════════════
-- YARAM — Migration PayTech
-- ════════════════════════════════════════════════════════
-- Ajoute les colonnes nécessaires pour tracker les paiements PayTech
-- (provider, session token, méthode utilisée, téléphone client, confirmation timestamp)
-- + table payment_logs pour analytics
-- ════════════════════════════════════════════════════════

-- 1. Colonnes PayTech sur orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_provider TEXT,           -- 'paytech' | 'manual' (futur : 'wave-direct', 'om-direct')
  ADD COLUMN IF NOT EXISTS payment_session_token TEXT,      -- token PayTech (utile pour matcher l'IPN)
  ADD COLUMN IF NOT EXISTS payment_session_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paytech_payment_method TEXT,     -- 'Wave' | 'Orange Money' | 'Free Money' | 'Card'
  ADD COLUMN IF NOT EXISTS paytech_client_phone TEXT;

-- Index pour matching IPN rapide
CREATE INDEX IF NOT EXISTS orders_payment_session_token_idx
  ON orders(payment_session_token)
  WHERE payment_session_token IS NOT NULL;

-- 2. Table payment_logs pour analytics (toutes les transactions, succès et échecs)
CREATE TABLE IF NOT EXISTS payment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                  -- 'paytech', 'wave', 'om', 'manual'
  event_type TEXT NOT NULL,                -- 'sale_complete', 'sale_cancel', 'manual_confirm'
  amount NUMERIC,
  payment_method TEXT,                     -- 'Wave', 'Orange Money', etc.
  client_phone TEXT,
  raw_payload JSONB,                       -- payload brut du webhook (debug)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_logs_order_id_idx ON payment_logs(order_id);
CREATE INDEX IF NOT EXISTS payment_logs_created_at_idx ON payment_logs(created_at DESC);

-- 3. RLS : payment_logs accessible UNIQUEMENT en service role (côté serveur)
ALTER TABLE payment_logs ENABLE ROW LEVEL SECURITY;
-- Pas de policy = pas d'accès anon/auth. Seul le service role lit/écrit.

-- 4. Vérification
SELECT 'Migration PayTech OK ✅' AS status,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'orders'
          AND column_name IN ('payment_provider', 'payment_session_token', 'paytech_payment_method')) AS new_cols_orders,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name = 'payment_logs') AS payment_logs_exists;
