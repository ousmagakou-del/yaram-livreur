-- ════════════════════════════════════════════════════════
-- YARAM — Migration : feature "Boutique internationale" (preorder import)
-- Date : 2026-05-25
-- ════════════════════════════════════════════════════════
-- Cette migration ajoute :
--   • 5 colonnes à products (is_imported, lead_time_days, origin_country, supplier_url, supplier_cost)
--   • 8 colonnes à orders (is_preorder, deposit/balance, dates clés)
--   • 4 nouveaux statuts orders (awaiting_supplier, in_transit_intl, arrived_local, awaiting_balance)
--   • Index pour requêtes rapides
--   • RPC calculate_preorder_breakdown pour calculs côté front
--
-- Exécution : Supabase Dashboard → SQL Editor → New Query → coller → Run
-- ════════════════════════════════════════════════════════

-- ═══ 1. PRODUCTS : colonnes import ═══

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_imported BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_time_days INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS origin_country TEXT DEFAULT 'SN',
  ADD COLUMN IF NOT EXISTS supplier_url TEXT,
  ADD COLUMN IF NOT EXISTS supplier_cost NUMERIC(12,2);

COMMENT ON COLUMN products.is_imported IS 'true = produit importé (USA, EU, etc.), false = stock local Dakar';
COMMENT ON COLUMN products.lead_time_days IS 'Délai en jours entre commande et livraison Dakar (15 par défaut pour import)';
COMMENT ON COLUMN products.origin_country IS 'Code pays origine : SN, US, FR, NG, ZA, etc.';
COMMENT ON COLUMN products.supplier_url IS 'URL Amazon/Ulta/Sephora/etc. où on commande (admin only)';
COMMENT ON COLUMN products.supplier_cost IS 'Prix coûtant fournisseur (en FCFA) - utilisé pour calculer marge';

CREATE INDEX IF NOT EXISTS idx_products_imported ON products(is_imported) WHERE is_imported = true;
CREATE INDEX IF NOT EXISTS idx_products_origin ON products(origin_country);

-- ═══ 2. ORDERS : colonnes preorder ═══

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_preorder BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS balance_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supplier_order_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_dakar_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expected_arrival_date DATE,
  ADD COLUMN IF NOT EXISTS supplier_notes TEXT;

COMMENT ON COLUMN orders.is_preorder IS 'true si commande contient au moins 1 produit import';
COMMENT ON COLUMN orders.deposit_amount IS 'Montant de l acompte 50% (en FCFA)';
COMMENT ON COLUMN orders.balance_amount IS 'Solde 50% à régler à l arrivée Dakar';
COMMENT ON COLUMN orders.supplier_order_date IS 'Date à laquelle YARAM a commandé chez le fournisseur';
COMMENT ON COLUMN orders.arrived_dakar_at IS 'Date d arrivée du produit à Dakar';
COMMENT ON COLUMN orders.expected_arrival_date IS 'Date estimée d arrivée Dakar = order_date + max(lead_time_days)';
COMMENT ON COLUMN orders.supplier_notes IS 'Notes internes YARAM (tracking URL, fournisseur, etc.)';

CREATE INDEX IF NOT EXISTS idx_orders_preorder ON orders(is_preorder) WHERE is_preorder = true;
CREATE INDEX IF NOT EXISTS idx_orders_expected_arrival ON orders(expected_arrival_date) WHERE is_preorder = true;

-- ═══ 3. STATUTS ORDERS : étendre les valeurs autorisées ═══
-- Note : si tu as une CHECK constraint sur status, faut la mettre à jour.
-- Statuts existants : pending, confirmed, preparing, in_delivery, delivered, cancelled
-- Nouveaux ajoutés : awaiting_supplier, in_transit_intl, arrived_local, awaiting_balance

DO $$
BEGIN
  -- Si une CHECK constraint existe sur status, on la drop d abord
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'orders' AND column_name = 'status'
  ) THEN
    EXECUTE 'ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check';
  END IF;

  -- Recrée avec les nouveaux statuts
  EXECUTE 'ALTER TABLE orders ADD CONSTRAINT orders_status_check
    CHECK (status IN (
      ''pending'',
      ''confirmed'',
      ''preparing'',
      ''in_delivery'',
      ''delivered'',
      ''cancelled'',
      ''awaiting_supplier'',
      ''in_transit_intl'',
      ''arrived_local'',
      ''awaiting_balance''
    ))';
END $$;

-- ═══ 4. RPC : calcul du breakdown pour une commande preorder ═══

CREATE OR REPLACE FUNCTION calculate_preorder_breakdown(
  p_total NUMERIC,
  p_deposit_percent NUMERIC DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  deposit NUMERIC;
  balance NUMERIC;
BEGIN
  deposit := ROUND(p_total * p_deposit_percent / 100);
  balance := p_total - deposit;

  RETURN jsonb_build_object(
    'total', p_total,
    'deposit_percent', p_deposit_percent,
    'deposit_amount', deposit,
    'balance_amount', balance
  );
END $$;

-- ═══ 5. RPC : marquer order comme preorder avec calcul auto ═══

CREATE OR REPLACE FUNCTION mark_order_as_preorder(
  p_order_id UUID,
  p_max_lead_time_days INT DEFAULT 15,
  p_deposit_percent NUMERIC DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total NUMERIC;
  v_breakdown jsonb;
BEGIN
  SELECT total INTO v_total FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  v_breakdown := calculate_preorder_breakdown(v_total, p_deposit_percent);

  UPDATE orders
  SET
    is_preorder = true,
    deposit_amount = (v_breakdown->>'deposit_amount')::NUMERIC,
    balance_amount = (v_breakdown->>'balance_amount')::NUMERIC,
    expected_arrival_date = (NOW() + (p_max_lead_time_days || ' days')::INTERVAL)::DATE
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'breakdown', v_breakdown,
    'expected_arrival_date', (NOW() + (p_max_lead_time_days || ' days')::INTERVAL)::DATE
  );
END $$;

-- ═══ 6. EXEMPLE : marque quelques produits comme imports pour tester ═══
-- (à adapter selon ton catalogue)

-- UPDATE products
-- SET is_imported = true, lead_time_days = 15, origin_country = 'US'
-- WHERE brand IN ('Black Opal', 'Fenty Beauty', 'The Lip Bar', 'Mented Cosmetics');

-- UPDATE products
-- SET is_imported = true, lead_time_days = 15, origin_country = 'NG'
-- WHERE brand IN ('Liha Beauty', 'R&R Luxury', '54 Thrones');

-- ═══ 7. VÉRIFICATION ═══

SELECT
  'Migration import preorder : ' ||
  (SELECT COUNT(*) FROM products WHERE is_imported = true) || ' produits import, ' ||
  (SELECT COUNT(*) FROM orders WHERE is_preorder = true) || ' commandes preorder' AS status;
