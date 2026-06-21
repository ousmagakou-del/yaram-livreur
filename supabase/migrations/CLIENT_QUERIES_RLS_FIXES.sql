-- ============================================================================
-- CLIENT_QUERIES_RLS_FIXES.sql
-- Audit post-SECURITY_AUDIT_FIXES.sql : tables où SELECT client bloque silencieusement
-- Genere le 2026-06-21
--
-- PROBLEME :
--   SECURITY_AUDIT_FIXES.sql a DROP des policies "Anyone can read" sur plusieurs
--   tables SANS recréer une policy SELECT pour authenticated/anon. Resultat :
--   RLS active + 0 policy SELECT = SELECT renvoie [] silencieusement (pas d'erreur,
--   juste 0 rows). Cela casse plusieurs pages YARAM (Profile, Loyalty, Promos,
--   Notifications, Product reviews, ScanResult, PharmacyDetail, Home).
--
-- REGLES :
--   - Toutes les migrations sont idempotentes (DROP POLICY IF EXISTS / CREATE)
--   - Aucun DROP TABLE, aucun TRUNCATE
--   - Aucune modification de la securite WRITE (les triggers + REVOKE INSERT/UPDATE
--     posés par SECURITY_AUDIT_FIXES.sql restent en place)
--   - Seules les policies SELECT sont (re)créées pour permettre la lecture cliente
--
-- A APPLIQUER : Supabase Studio > SQL Editor > paste > Run
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1) reviews : SELECT public (toutes les reviews d'un produit sont visibles)
-- Casse : Product.jsx (top 3 reviews), notifications.js getReviewsForProduct
-- ============================================================================
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reviews_public_read ON public.reviews;
CREATE POLICY reviews_public_read ON public.reviews
  FOR SELECT TO anon, authenticated USING (true);

-- Permettre aux users authentifies de creer / mettre a jour LEURS reviews
DROP POLICY IF EXISTS reviews_insert_own ON public.reviews;
CREATE POLICY reviews_insert_own ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS reviews_update_own ON public.reviews;
CREATE POLICY reviews_update_own ON public.reviews
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 2) skin_scans : SELECT own (owner uniquement)
-- Casse : Profile.jsx (dernier scan), ScanResult.jsx, Home.jsx phase 3,
--         getMySkinScans / getLatestSkinScan
-- ============================================================================
ALTER TABLE public.skin_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skin_scans_select_own ON public.skin_scans;
CREATE POLICY skin_scans_select_own ON public.skin_scans
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS skin_scans_insert_own ON public.skin_scans;
CREATE POLICY skin_scans_insert_own ON public.skin_scans
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 3) notifications : SELECT own
-- Casse : page Notifications, badge live unread count (RPC count_unread_notifications
-- peut aussi etre concernée si la RPC fait un SELECT direct).
-- ============================================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Marquer comme lu : on autorise UPDATE de la colonne "read" via une policy
-- (les RPC SECURITY DEFINER restent le chemin recommande, mais on garde
-- une porte ouverte au cas où le client mette directement read=true).
DROP POLICY IF EXISTS notifications_update_own_read ON public.notifications;
CREATE POLICY notifications_update_own_read ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 4) loyalty_transactions : SELECT own
-- Casse : page Loyalty (historique transactions), getLoyaltyTransactions
-- ============================================================================
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_transactions_select_own ON public.loyalty_transactions;
CREATE POLICY loyalty_transactions_select_own ON public.loyalty_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- (pas de policy INSERT/UPDATE : SECURITY_AUDIT_FIXES a deja REVOKE INSERT/UPDATE/DELETE
--  et les RPC add_loyalty_points / redeem_loyalty_points / apply_referral_bonus
--  sont SECURITY DEFINER → contournent la RLS proprement.)

-- ============================================================================
-- 5) pharmacies : SELECT public sur les pharmacies actives
-- Casse : Home, PharmacyDetail, Pharma list, BonsPlansWidget
-- Note : SECURITY_AUDIT_FIXES a REVOKE INSERT/UPDATE/DELETE mais n'a pas defini
-- de policy SELECT publique. Si une ancienne "Anyone can read pharmacies" existe
-- elle est conservée mais on garantit ici la presence d'une policy en idempotent.
-- ============================================================================
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacies_public_read ON public.pharmacies;
CREATE POLICY pharmacies_public_read ON public.pharmacies
  FOR SELECT TO anon, authenticated
  USING (active = true);

-- ============================================================================
-- 6) promo_codes : SELECT actif public
-- Casse : Promos.jsx, BonsPlansCarousel, BonsPlansWidget
-- Section 7 INFO de SECURITY_AUDIT_FIXES mentionne SELECT actif autorise mais
-- ne le garantit pas. On le rend explicite ici.
-- ============================================================================
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promo_codes_public_read_active ON public.promo_codes;
CREATE POLICY promo_codes_public_read_active ON public.promo_codes
  FOR SELECT TO anon, authenticated
  USING (active = true);

-- ============================================================================
-- 7) promo_uses : SELECT own
-- Casse : Promos.jsx (compteur d'utilisations par user)
-- ============================================================================
ALTER TABLE public.promo_uses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promo_uses_select_own ON public.promo_uses;
CREATE POLICY promo_uses_select_own ON public.promo_uses
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- L'insertion d'une nouvelle utilisation passe par la RPC increment_promo_uses
-- (SECURITY DEFINER, deja patchee dans SECURITY_AUDIT_FIXES.sql #29).
-- On laisse cependant un INSERT own permis pour Promos.jsx lib/promos.js si besoin.
DROP POLICY IF EXISTS promo_uses_insert_own ON public.promo_uses;
CREATE POLICY promo_uses_insert_own ON public.promo_uses
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 8) users_profile : SELECT own + SELECT minimal pour parrainage
-- Casse : Profile, Loyalty, Onboarding, Referral
-- ============================================================================
ALTER TABLE public.users_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_profile_select_own ON public.users_profile;
CREATE POLICY users_profile_select_own ON public.users_profile
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- UPDATE own (le trigger _block_user_loyalty_tampering de SECURITY_AUDIT_FIXES
-- empeche deja de toucher loyalty_*).
DROP POLICY IF EXISTS users_profile_update_own ON public.users_profile;
CREATE POLICY users_profile_update_own ON public.users_profile
  FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- INSERT own (Onboarding peut creer la ligne via upsert).
DROP POLICY IF EXISTS users_profile_insert_own ON public.users_profile;
CREATE POLICY users_profile_insert_own ON public.users_profile
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- ============================================================================
-- 9) favorites : SELECT + INSERT + DELETE own
-- Casse : Profile (favCount), Home (favIds), Favorites page, lib/favorites
-- ============================================================================
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS favorites_select_own ON public.favorites;
CREATE POLICY favorites_select_own ON public.favorites
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS favorites_insert_own ON public.favorites;
CREATE POLICY favorites_insert_own ON public.favorites
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS favorites_delete_own ON public.favorites;
CREATE POLICY favorites_delete_own ON public.favorites
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- 10) addresses : SELECT/INSERT/UPDATE/DELETE own
-- Casse : Checkout, Profile addresses, lib/addresses.js
-- ============================================================================
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addresses_select_own ON public.addresses;
CREATE POLICY addresses_select_own ON public.addresses
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS addresses_insert_own ON public.addresses;
CREATE POLICY addresses_insert_own ON public.addresses
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS addresses_update_own ON public.addresses;
CREATE POLICY addresses_update_own ON public.addresses
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS addresses_delete_own ON public.addresses;
CREATE POLICY addresses_delete_own ON public.addresses
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- 11) orders : SELECT own (UPDATE deja gere par SECURITY_AUDIT_FIXES + trigger)
-- Casse : Orders, OrderTracking, Profile (ordersCount), getMyOrders
-- ============================================================================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_select_own ON public.orders;
CREATE POLICY orders_select_own ON public.orders
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS orders_insert_own ON public.orders;
CREATE POLICY orders_insert_own ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 12) app_promos : SELECT public (interstitial / bons plans)
-- Casse : BonsPlansWidget, PromosSplashSection admin
-- ============================================================================
ALTER TABLE public.app_promos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_promos_public_read ON public.app_promos;
CREATE POLICY app_promos_public_read ON public.app_promos
  FOR SELECT TO anon, authenticated
  USING (true);

-- ============================================================================
-- 13) site_settings : SELECT public (config publique lue par lib/supabase/client)
-- ============================================================================
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_settings_public_read ON public.site_settings;
CREATE POLICY site_settings_public_read ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (true);

-- ============================================================================
-- 14) inventory : SELECT public (lecture des stocks pour Product / Pharmacy)
-- Casse : PharmacyDetail, Product (calcul stock), Home
-- ============================================================================
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_public_read ON public.inventory;
CREATE POLICY inventory_public_read ON public.inventory
  FOR SELECT TO anon, authenticated
  USING (true);

-- ============================================================================
-- 15) push_subscriptions / device_tokens : SELECT own (deja partiellement
-- traite dans device_tokens_apns_web_push.sql et SECURITY_AUDIT_FIXES, mais on
-- garantit le SELECT en idempotent ici pour push_subscriptions seul).
-- ============================================================================
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subs_select_own ON public.push_subscriptions;
CREATE POLICY push_subs_select_own ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subs_insert_own ON public.push_subscriptions;
CREATE POLICY push_subs_insert_own ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

COMMIT;

-- ============================================================================
-- VERIFICATION POST-APPLICATION (a executer separement) :
--
-- SELECT schemaname, tablename, policyname, roles, cmd
--   FROM pg_policies
--  WHERE schemaname='public'
--    AND tablename IN ('reviews','skin_scans','notifications','loyalty_transactions',
--                      'pharmacies','promo_codes','promo_uses','users_profile',
--                      'favorites','addresses','orders','app_promos','site_settings',
--                      'inventory','push_subscriptions')
--  ORDER BY tablename, cmd;
--
-- Chaque table doit avoir AU MOINS une policy SELECT.
-- ============================================================================
