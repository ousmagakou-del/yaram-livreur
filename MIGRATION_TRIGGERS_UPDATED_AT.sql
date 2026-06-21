-- =====================================================================
-- MIGRATION: updated_at triggers
-- =====================================================================
-- Purpose: Automatically maintain `updated_at` timestamps on row UPDATE
--          for the main mutable tables. Adds the column if missing.
--
-- Idempotent: Yes
--   - ADD COLUMN IF NOT EXISTS
--   - CREATE OR REPLACE FUNCTION
--   - DROP TRIGGER IF EXISTS + CREATE TRIGGER
--
-- Safe to re-run: Yes
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SHARED FUNCTION
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_updated_at_column() IS
  'Generic trigger function: sets NEW.updated_at = NOW() before any UPDATE.';

-- ---------------------------------------------------------------------
-- 2. PHARMACIES
-- ---------------------------------------------------------------------
ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_pharmacies_updated_at ON public.pharmacies;

CREATE TRIGGER trg_pharmacies_updated_at
  BEFORE UPDATE ON public.pharmacies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 3. PRODUCTS
-- ---------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 4. ORDERS
-- ---------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 5. USERS_PROFILE
-- ---------------------------------------------------------------------
ALTER TABLE public.users_profile
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_users_profile_updated_at ON public.users_profile;

CREATE TRIGGER trg_users_profile_updated_at
  BEFORE UPDATE ON public.users_profile
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 6. APP_PROMOS
-- ---------------------------------------------------------------------
ALTER TABLE public.app_promos
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_app_promos_updated_at ON public.app_promos;

CREATE TRIGGER trg_app_promos_updated_at
  BEFORE UPDATE ON public.app_promos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- END OF UPDATED_AT TRIGGERS
-- =====================================================================
-- Verify with:
--   SELECT event_object_table AS table_name, trigger_name, action_timing,
--          event_manipulation
--     FROM information_schema.triggers
--    WHERE trigger_schema = 'public'
--      AND trigger_name LIKE 'trg_%_updated_at'
--    ORDER BY event_object_table;
--
-- Smoke test:
--   UPDATE public.pharmacies SET name = name WHERE id = '<some-id>';
--   SELECT id, updated_at FROM public.pharmacies WHERE id = '<some-id>';
--   -- updated_at should be NOW().
-- =====================================================================
