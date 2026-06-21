-- =====================================================================
-- MIGRATION: RLS Hardening
-- =====================================================================
-- Purpose: Enable Row Level Security on all sensitive tables and create
--          proper policies to prevent cross-user data access.
--
-- Idempotent: Yes (uses DROP POLICY IF EXISTS + CREATE)
-- Safe to re-run: Yes
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ENABLE RLS ON ALL SENSITIVE TABLES
-- ---------------------------------------------------------------------
-- ENABLE ROW LEVEL SECURITY is idempotent — no-op if already enabled.

ALTER TABLE IF EXISTS public.addresses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.favorites          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.skin_scans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users_profile      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_promos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.promo_impressions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.admin_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.delivery_tracking  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.orders             ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 2. ADDRESSES — user can only access their own addresses
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "addresses_select_own"  ON public.addresses;
DROP POLICY IF EXISTS "addresses_insert_own"  ON public.addresses;
DROP POLICY IF EXISTS "addresses_update_own"  ON public.addresses;
DROP POLICY IF EXISTS "addresses_delete_own"  ON public.addresses;

CREATE POLICY "addresses_select_own"
  ON public.addresses
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "addresses_insert_own"
  ON public.addresses
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "addresses_update_own"
  ON public.addresses
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "addresses_delete_own"
  ON public.addresses
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 3. FAVORITES — user can only access their own favorites
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "favorites_select_own"  ON public.favorites;
DROP POLICY IF EXISTS "favorites_insert_own"  ON public.favorites;
DROP POLICY IF EXISTS "favorites_update_own"  ON public.favorites;
DROP POLICY IF EXISTS "favorites_delete_own"  ON public.favorites;

CREATE POLICY "favorites_select_own"
  ON public.favorites
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "favorites_insert_own"
  ON public.favorites
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "favorites_update_own"
  ON public.favorites
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "favorites_delete_own"
  ON public.favorites
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4. NOTIFICATIONS — user can only access their own notifications
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_select_own"  ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_own"  ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own"  ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_own"  ON public.notifications;

CREATE POLICY "notifications_select_own"
  ON public.notifications
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT is typically done via service_role (backend), but allow user too
CREATE POLICY "notifications_insert_own"
  ON public.notifications
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notifications_update_own"
  ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notifications_delete_own"
  ON public.notifications
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 5. SKIN_SCANS — user can only access their own scans
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "skin_scans_select_own"  ON public.skin_scans;
DROP POLICY IF EXISTS "skin_scans_insert_own"  ON public.skin_scans;
DROP POLICY IF EXISTS "skin_scans_update_own"  ON public.skin_scans;
DROP POLICY IF EXISTS "skin_scans_delete_own"  ON public.skin_scans;

CREATE POLICY "skin_scans_select_own"
  ON public.skin_scans
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "skin_scans_insert_own"
  ON public.skin_scans
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "skin_scans_update_own"
  ON public.skin_scans
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "skin_scans_delete_own"
  ON public.skin_scans
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 6. USERS_PROFILE — user can only access their own profile (id = uid)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "users_profile_select_own"  ON public.users_profile;
DROP POLICY IF EXISTS "users_profile_insert_own"  ON public.users_profile;
DROP POLICY IF EXISTS "users_profile_update_own"  ON public.users_profile;
DROP POLICY IF EXISTS "users_profile_delete_own"  ON public.users_profile;

CREATE POLICY "users_profile_select_own"
  ON public.users_profile
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users_profile_insert_own"
  ON public.users_profile
  FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_profile_update_own"
  ON public.users_profile
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_profile_delete_own"
  ON public.users_profile
  FOR DELETE
  USING (auth.uid() = id);

-- ---------------------------------------------------------------------
-- 7. APP_PROMOS — read public, write service_role only
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "app_promos_select_public"   ON public.app_promos;
DROP POLICY IF EXISTS "app_promos_insert_service"  ON public.app_promos;
DROP POLICY IF EXISTS "app_promos_update_service"  ON public.app_promos;
DROP POLICY IF EXISTS "app_promos_delete_service"  ON public.app_promos;

-- Anyone (anon + authenticated) can read promos
CREATE POLICY "app_promos_select_public"
  ON public.app_promos
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only service_role can write (skips RLS entirely, but we enforce explicitly)
CREATE POLICY "app_promos_insert_service"
  ON public.app_promos
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "app_promos_update_service"
  ON public.app_promos
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "app_promos_delete_service"
  ON public.app_promos
  FOR DELETE
  TO service_role
  USING (true);

-- ---------------------------------------------------------------------
-- 8. PROMO_IMPRESSIONS — anyone can INSERT, user can SELECT only own
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "promo_impressions_insert_any"   ON public.promo_impressions;
DROP POLICY IF EXISTS "promo_impressions_select_own"   ON public.promo_impressions;

-- Anyone (including anonymous) can log impressions
CREATE POLICY "promo_impressions_insert_any"
  ON public.promo_impressions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Authenticated users can only read their own impressions
CREATE POLICY "promo_impressions_select_own"
  ON public.promo_impressions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 9. PAYMENT_LOGS — service_role only (sensitive financial data)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "payment_logs_select_service"  ON public.payment_logs;
DROP POLICY IF EXISTS "payment_logs_insert_service"  ON public.payment_logs;

CREATE POLICY "payment_logs_select_service"
  ON public.payment_logs
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "payment_logs_insert_service"
  ON public.payment_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- No UPDATE or DELETE policies — payment logs are append-only

-- ---------------------------------------------------------------------
-- 10. ADMIN_SESSIONS — service_role only (admin auth data)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_sessions_all_service"  ON public.admin_sessions;

CREATE POLICY "admin_sessions_all_service"
  ON public.admin_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 11. DELIVERY_TRACKING — RLS enabled, access via RPC (no public policy)
-- ---------------------------------------------------------------------
-- Access is gated by SECURITY DEFINER RPCs that validate the delivery_token.
-- Service_role retains full access by default (bypasses RLS).
-- We add a permissive SELECT policy for service_role for clarity.

DROP POLICY IF EXISTS "delivery_tracking_all_service"  ON public.delivery_tracking;

CREATE POLICY "delivery_tracking_all_service"
  ON public.delivery_tracking
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 12. ORDERS — user can only access their own orders
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "orders_select_own"     ON public.orders;
DROP POLICY IF EXISTS "orders_insert_own"     ON public.orders;
DROP POLICY IF EXISTS "orders_update_own"     ON public.orders;
DROP POLICY IF EXISTS "orders_all_service"    ON public.orders;

CREATE POLICY "orders_select_own"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "orders_insert_own"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Limited user UPDATE (e.g. cancel) — backend handles status transitions
CREATE POLICY "orders_update_own"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service_role has full control (status updates, webhooks, admin)
CREATE POLICY "orders_all_service"
  ON public.orders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================================
-- END OF RLS HARDENING
-- =====================================================================
-- Verify with:
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname = 'public' AND tablename IN (
--      'addresses','favorites','notifications','skin_scans',
--      'users_profile','app_promos','promo_impressions',
--      'payment_logs','admin_sessions','delivery_tracking','orders'
--    );
--
--   SELECT schemaname, tablename, policyname, cmd, roles
--     FROM pg_policies
--    WHERE schemaname = 'public'
--    ORDER BY tablename, policyname;
-- =====================================================================
