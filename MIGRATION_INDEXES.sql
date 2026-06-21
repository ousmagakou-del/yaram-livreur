-- =====================================================================
-- MIGRATION: Critical Indexes
-- =====================================================================
-- Purpose: Add indexes on frequently queried columns to improve
--          read performance, especially for orders, favorites,
--          notifications, delivery tracking, and product searches.
--
-- Idempotent: Yes (uses CREATE INDEX IF NOT EXISTS)
-- Safe to re-run: Yes
-- Note: Use CONCURRENTLY in production if tables already have rows,
--       but CONCURRENTLY cannot run inside a transaction block.
--       This file is written without CONCURRENTLY to remain transactional.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. EXTENSIONS
-- ---------------------------------------------------------------------
-- pg_trgm enables trigram GIN indexes for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- 2. ORDERS — heavy read access by user / status / date
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_user_id
  ON public.orders (user_id);

CREATE INDEX IF NOT EXISTS idx_orders_status
  ON public.orders (status);

CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON public.orders (created_at DESC);

-- Composite index for "my orders by status" queries
CREATE INDEX IF NOT EXISTS idx_orders_user_status
  ON public.orders (user_id, status);

-- GIN trigram on order ID for partial / fuzzy lookup (admin search)
-- The id column is uuid; cast to text via expression index.
CREATE INDEX IF NOT EXISTS idx_orders_id_trgm
  ON public.orders
  USING gin ((id::text) gin_trgm_ops);

-- Pharmacy IDs (array column) — GIN index for "orders containing pharmacy X"
-- Wrapped in DO block because GIN on array requires the column to exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'orders'
       AND column_name = 'pharmacy_ids'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_pharmacy_ids
             ON public.orders USING gin (pharmacy_ids)';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. FAVORITES
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_favorites_user_id
  ON public.favorites (user_id);

-- ---------------------------------------------------------------------
-- 4. NOTIFICATIONS
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications (user_id);

-- ---------------------------------------------------------------------
-- 5. DELIVERY_TRACKING
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_order_id
  ON public.delivery_tracking (order_id);

-- delivery_token must be unique (one token per tracking record)
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_tracking_token
  ON public.delivery_tracking (delivery_token);

-- ---------------------------------------------------------------------
-- 6. PRODUCTS
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_pharmacy_id
  ON public.products (pharmacy_id);

CREATE INDEX IF NOT EXISTS idx_products_category
  ON public.products (category);

-- ---------------------------------------------------------------------
-- 7. PAYMENT_LOGS
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payment_logs_order_id
  ON public.payment_logs (order_id);

-- =====================================================================
-- END OF INDEXES
-- =====================================================================
-- Verify with:
--   SELECT schemaname, tablename, indexname, indexdef
--     FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND indexname LIKE 'idx_%'
--    ORDER BY tablename, indexname;
--
-- Check index usage after a few days:
--   SELECT relname AS table_name, indexrelname AS index_name,
--          idx_scan, idx_tup_read, idx_tup_fetch
--     FROM pg_stat_user_indexes
--    WHERE schemaname = 'public'
--    ORDER BY idx_scan DESC;
-- =====================================================================
