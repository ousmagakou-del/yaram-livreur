-- ============================================================================
-- SECURITY_AUDIT_FIXES.sql
-- Audit de securite pre-lancement public YARAM
-- Genere le 2026-06-21
--
-- 33 vulnerabilites identifiees :
--   12 CRITIQUES (compromission totale possible)
--   10 ELEVEES (vol de donnees / fraude)
--    8 MOYENNES (abus mineur / DOS)
--    3 INFOS (hygiene)
--
-- REGLES :
--   - Toutes les migrations sont idempotentes
--   - Aucun DROP TABLE, aucun TRUNCATE
--   - A APPLIQUER PAR SECTIONS en validant chaque section
--   - APRES application : retester admin, checkout, livreur, scan peau
--
-- AVANT D'APPLIQUER : faire un backup ! Certaines policies actuelles permissives
-- peuvent etre utilisees par du code legacy.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 0 — REVOQUER GRANTS PAR DEFAUT SUR TABLES SENSIBLES
-- Probleme : par defaut Supabase donne ALL au role anon et authenticated.
-- ============================================================================

-- 🔴 CRITIQUE #1 — admin_users : RLS off + anon peut SELECT le pin_hash bcrypt
-- POC: const { data } = await supabase.from('admin_users').select('email, pin_hash')
--      → permet bruteforce hors-ligne du PIN 4 chiffres en <1h
REVOKE ALL ON public.admin_users FROM anon, authenticated;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users FORCE ROW LEVEL SECURITY;
-- Pas de policy : seuls service_role et postgres y touchent.
-- Les RPC admin_* utilisent SECURITY DEFINER + _check_admin_session.

-- 🔴 CRITIQUE #2 — admin_sessions : RLS on mais ZERO policy ET grants ALL
REVOKE ALL ON public.admin_sessions FROM anon, authenticated;
ALTER TABLE public.admin_sessions FORCE ROW LEVEL SECURITY;

-- 🔴 CRITIQUE #3 — admin_role_permissions : RLS off, anon ALL
REVOKE ALL ON public.admin_role_permissions FROM anon, authenticated;
ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_permissions FORCE ROW LEVEL SECURITY;

-- 🔴 CRITIQUE #4 — admin_logs
REVOKE ALL ON public.admin_logs FROM anon, authenticated;
ALTER TABLE public.admin_logs FORCE ROW LEVEL SECURITY;

-- 🔴 CRITIQUE #5 — pharma_sessions
REVOKE ALL ON public.pharma_sessions FROM anon, authenticated;
ALTER TABLE public.pharma_sessions FORCE ROW LEVEL SECURITY;

-- 🔴 CRITIQUE #6 — staff (employes pharmacies, infos perso)
REVOKE ALL ON public.staff FROM anon, authenticated;
ALTER TABLE public.staff FORCE ROW LEVEL SECURITY;

-- 🔴 CRITIQUE #7 — payment_logs : raw_payload PayTech (telephones, paiements)
REVOKE ALL ON public.payment_logs FROM anon, authenticated;
ALTER TABLE public.payment_logs FORCE ROW LEVEL SECURITY;

-- 🔴 CRITIQUE #8 — audit_log
REVOKE ALL ON public.audit_log FROM anon, authenticated;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;

-- 🟠 commission_payments, deliveries, marketing_campaigns, push_logs, reminder_logs
REVOKE ALL ON public.commission_payments FROM anon, authenticated;
REVOKE ALL ON public.deliveries          FROM anon, authenticated;
REVOKE ALL ON public.marketing_campaigns FROM anon, authenticated;
REVOKE ALL ON public.push_logs           FROM anon, authenticated;
REVOKE ALL ON public.reminder_logs       FROM anon, authenticated;
ALTER TABLE public.commission_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries          FORCE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.push_logs           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_logs       FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- SECTION 1 — TABLES CATALOGUE (banners / brands / categories / products)
-- POC: supabase.from('products').update({ price: 1 }).eq('id', '...')
-- ============================================================================

-- 🔴 CRITIQUE #9 — banners
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can manage banners" ON public.banners;
DROP POLICY IF EXISTS "Anyone can read banners"   ON public.banners;
DROP POLICY IF EXISTS banners_public_read         ON public.banners;
CREATE POLICY banners_public_read ON public.banners
  FOR SELECT TO anon, authenticated USING (true);

-- 🔴 CRITIQUE #10 — brands
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can manage brands admin" ON public.brands;
DROP POLICY IF EXISTS "Marques visibles publiquement"  ON public.brands;
DROP POLICY IF EXISTS brands_public_read               ON public.brands;
CREATE POLICY brands_public_read ON public.brands
  FOR SELECT TO anon, authenticated USING (true);

-- 🔴 CRITIQUE #11 — categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categories public delete" ON public.categories;
DROP POLICY IF EXISTS "categories public write"  ON public.categories;
DROP POLICY IF EXISTS "categories public read"   ON public.categories;
DROP POLICY IF EXISTS "categories public update" ON public.categories;
DROP POLICY IF EXISTS categories_public_read     ON public.categories;
CREATE POLICY categories_public_read ON public.categories
  FOR SELECT TO anon, authenticated USING (true);

-- 🔴 CRITIQUE #12 — products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone reads products" ON public.products;
DROP POLICY IF EXISTS products_public_read    ON public.products;
CREATE POLICY products_public_read ON public.products
  FOR SELECT TO anon, authenticated USING (active = true);

REVOKE INSERT, UPDATE, DELETE ON public.banners    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.brands     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.products   FROM anon, authenticated;

-- ============================================================================
-- SECTION 2 — TABLES UTILISATEUR : ECRITURE ARBITRAIRE
-- ============================================================================

-- 🔴 CRITIQUE #13 — orders : user peut modifier total/status direct
-- POC: supabase.from('orders').update({ total: 100, status: 'paid' }).eq('id', myOrderId)
DROP POLICY IF EXISTS orders_update_own ON public.orders;
DROP POLICY IF EXISTS "Users update their own orders" ON public.orders;
CREATE POLICY orders_update_own_safe ON public.orders
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status IN ('pending_payment', 'pending'))
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public._block_user_order_field_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF OLD.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not_your_order'; END IF;
  IF NEW.total                 IS DISTINCT FROM OLD.total                 THEN RAISE EXCEPTION 'forbidden:total';                 END IF;
  IF NEW.subtotal              IS DISTINCT FROM OLD.subtotal              THEN RAISE EXCEPTION 'forbidden:subtotal';              END IF;
  IF NEW.shipping              IS DISTINCT FROM OLD.shipping              THEN RAISE EXCEPTION 'forbidden:shipping';              END IF;
  IF NEW.promo_discount        IS DISTINCT FROM OLD.promo_discount        THEN RAISE EXCEPTION 'forbidden:promo_discount';        END IF;
  IF NEW.status                IS DISTINCT FROM OLD.status                THEN RAISE EXCEPTION 'forbidden:status (use RPC client_mark_order_paid)'; END IF;
  IF NEW.payment_confirmed_at  IS DISTINCT FROM OLD.payment_confirmed_at  THEN RAISE EXCEPTION 'forbidden:payment_confirmed_at';  END IF;
  IF NEW.client_marked_paid_at IS DISTINCT FROM OLD.client_marked_paid_at THEN RAISE EXCEPTION 'forbidden:client_marked_paid_at'; END IF;
  IF NEW.cash_received         IS DISTINCT FROM OLD.cash_received         THEN RAISE EXCEPTION 'forbidden:cash_received';         END IF;
  IF NEW.cash_received_at      IS DISTINCT FROM OLD.cash_received_at      THEN RAISE EXCEPTION 'forbidden:cash_received_at';      END IF;
  IF NEW.confirmation_token    IS DISTINCT FROM OLD.confirmation_token    THEN RAISE EXCEPTION 'forbidden:confirmation_token';    END IF;
  IF NEW.client_confirmed      IS DISTINCT FROM OLD.client_confirmed      THEN RAISE EXCEPTION 'forbidden:client_confirmed';      END IF;
  IF NEW.driver_id             IS DISTINCT FROM OLD.driver_id             THEN RAISE EXCEPTION 'forbidden:driver_id';             END IF;
  IF NEW.assigned_pharmacy_id  IS DISTINCT FROM OLD.assigned_pharmacy_id  THEN RAISE EXCEPTION 'forbidden:assigned_pharmacy_id';  END IF;
  IF NEW.payment_verified_by   IS DISTINCT FROM OLD.payment_verified_by   THEN RAISE EXCEPTION 'forbidden:payment_verified_by';   END IF;
  IF NEW.deposit_amount        IS DISTINCT FROM OLD.deposit_amount        THEN RAISE EXCEPTION 'forbidden:deposit_amount';        END IF;
  IF NEW.balance_amount        IS DISTINCT FROM OLD.balance_amount        THEN RAISE EXCEPTION 'forbidden:balance_amount';        END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS trg_block_user_order_field_tampering ON public.orders;
CREATE TRIGGER trg_block_user_order_field_tampering
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public._block_user_order_field_tampering();

-- 🔴 CRITIQUE #14 — users_profile : user peut auto-set ses loyalty_points
-- POC: supabase.from('users_profile').update({ loyalty_points: 999999 }).eq('id', myId)
CREATE OR REPLACE FUNCTION public._block_user_loyalty_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.loyalty_points       IS DISTINCT FROM OLD.loyalty_points       THEN RAISE EXCEPTION 'forbidden:loyalty_points';       END IF;
  IF NEW.loyalty_total_earned IS DISTINCT FROM OLD.loyalty_total_earned THEN RAISE EXCEPTION 'forbidden:loyalty_total_earned'; END IF;
  IF NEW.loyalty_tier         IS DISTINCT FROM OLD.loyalty_tier         THEN RAISE EXCEPTION 'forbidden:loyalty_tier';         END IF;
  IF NEW.referred_by IS DISTINCT FROM OLD.referred_by AND OLD.referred_by IS NOT NULL THEN
    RAISE EXCEPTION 'forbidden:referred_by_already_set';
  END IF;
  IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'forbidden:referral_code';
  END IF;
  IF NEW.welcomed_at IS DISTINCT FROM OLD.welcomed_at AND OLD.welcomed_at IS NOT NULL THEN
    RAISE EXCEPTION 'forbidden:welcomed_at_already_set';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS trg_block_user_loyalty_tampering ON public.users_profile;
CREATE TRIGGER trg_block_user_loyalty_tampering
  BEFORE UPDATE ON public.users_profile
  FOR EACH ROW EXECUTE FUNCTION public._block_user_loyalty_tampering();

-- ============================================================================
-- SECTION 3 — POLICIES "anyone can do anything"
-- ============================================================================

-- 🔴 CRITIQUE #15 — loyalty_transactions : "Anyone can manage loyalty"
-- POC: supabase.from('loyalty_transactions').insert({user_id:myId, points:99999, type:'earn_admin'})
DROP POLICY IF EXISTS "Anyone can manage loyalty" ON public.loyalty_transactions;
DROP POLICY IF EXISTS "loyalty service inserts"   ON public.loyalty_transactions;
REVOKE INSERT, UPDATE, DELETE ON public.loyalty_transactions FROM anon, authenticated;

-- 🔴 CRITIQUE #16 — notifications : "Manage notifs" autorise tout
-- POC: supabase.from('notifications').insert({ user_id: targetId, title:'phish', body:'click'})
DROP POLICY IF EXISTS "Manage notifs" ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_own ON public.notifications;
REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM anon, authenticated;

-- 🔴 CRITIQUE #17 — delivery_tracking : anyone peut update status='delivered'
-- POC: supabase.from('delivery_tracking').update({ status:'delivered' }).eq('order_id', otherId)
DROP POLICY IF EXISTS "Anyone can insert tracking" ON public.delivery_tracking;
DROP POLICY IF EXISTS "Anyone can update tracking" ON public.delivery_tracking;
DROP POLICY IF EXISTS "Anyone can read tracking"   ON public.delivery_tracking;
CREATE POLICY delivery_tracking_read_own ON public.delivery_tracking
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.orders o
            WHERE o.id = delivery_tracking.order_id AND o.user_id = auth.uid())
  );
REVOKE INSERT, UPDATE, DELETE ON public.delivery_tracking FROM anon, authenticated;

-- 🔴 CRITIQUE #18 — pharmacies : anon peut UPDATE n'importe quelle pharmacie
DROP POLICY IF EXISTS pharmacies_anon_update ON public.pharmacies;
REVOKE INSERT, UPDATE, DELETE ON public.pharmacies FROM anon, authenticated;

-- 🟠 ELEVE #19 — reviews : "Anyone write reviews" / "Anyone update"
DROP POLICY IF EXISTS "Anyone write reviews"           ON public.reviews;
DROP POLICY IF EXISTS "Anyone can update reviews admin" ON public.reviews;
DROP POLICY IF EXISTS "Anyone can read reviews admin"  ON public.reviews;

-- 🟠 ELEVE #20 — skin_scans : "Users can read own scans" avec USING=true
DROP POLICY IF EXISTS "Users can read own scans"   ON public.skin_scans;
DROP POLICY IF EXISTS "Users can insert own scans" ON public.skin_scans;

-- 🟠 ELEVE #21 — push_subscriptions : anon_update permet spoof tokens
DROP POLICY IF EXISTS push_subs_anon_delete ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subs_anon_update ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subs_update_own  ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subs_delete_own  ON public.push_subscriptions;
CREATE POLICY push_subs_update_own ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY push_subs_delete_own ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================================
-- SECTION 4 — RPC SECURITY DEFINER MAL VERROUILLEES
-- ============================================================================

-- 🔴 CRITIQUE #22 — add_loyalty_points(DEFINER 3-args) sans check is_admin()
-- POC: supabase.rpc('add_loyalty_points', {p_user_id:myId, p_points:99999, p_reason:'lol'})
CREATE OR REPLACE FUNCTION public.add_loyalty_points(p_user_id uuid, p_points integer, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE new_balance integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_points IS NULL OR p_points = 0 THEN RAISE EXCEPTION 'invalid_points'; END IF;
  IF abs(p_points) > 100000 THEN RAISE EXCEPTION 'amount_too_large'; END IF;

  INSERT INTO public.loyalty_transactions (user_id, type, points, reason)
  VALUES (p_user_id, CASE WHEN p_points > 0 THEN 'earn_admin' ELSE 'adjust_admin' END, p_points, p_reason);

  UPDATE public.users_profile
     SET loyalty_points = COALESCE(loyalty_points, 0) + p_points,
         loyalty_total_earned = COALESCE(loyalty_total_earned, 0) + CASE WHEN p_points > 0 THEN p_points ELSE 0 END
   WHERE id = p_user_id
   RETURNING loyalty_points INTO new_balance;

  RETURN jsonb_build_object('success', true, 'new_balance', new_balance);
END;
$function$;

-- 🔴 CRITIQUE #23 — add_loyalty_points(INVOKER 5-args) : devient inutile car
-- les ecritures directes sont revoquees. On la promeut DEFINER + admin-only.
DROP FUNCTION IF EXISTS public.add_loyalty_points(uuid, integer, text, text, text);
CREATE OR REPLACE FUNCTION public.add_loyalty_points(p_user_id uuid, p_points integer, p_type text, p_reason text DEFAULT NULL::text, p_order_id text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF abs(COALESCE(p_points, 0)) > 100000 THEN RAISE EXCEPTION 'amount_too_large'; END IF;

  INSERT INTO public.loyalty_transactions (user_id, type, points, reason, order_id)
  VALUES (p_user_id, p_type, p_points, p_reason, p_order_id);

  UPDATE public.users_profile
     SET loyalty_points = loyalty_points + p_points,
         loyalty_total_earned = loyalty_total_earned + GREATEST(p_points, 0),
         loyalty_tier = CASE
           WHEN loyalty_total_earned + GREATEST(p_points, 0) >= 100000 THEN 'gold'
           WHEN loyalty_total_earned + GREATEST(p_points, 0) >= 30000  THEN 'silver'
           ELSE 'bronze'
         END
   WHERE id = p_user_id;
END;
$function$;

-- 🔴 CRITIQUE #24 — redeem_loyalty_points accepte p_user_id arbitraire
CREATE OR REPLACE FUNCTION public.redeem_loyalty_points(p_user_id uuid, p_points integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE current_balance integer; fcfa_value integer;
BEGIN
  IF p_user_id IS NULL OR (auth.uid() IS DISTINCT FROM p_user_id AND NOT public.is_admin()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  SELECT COALESCE(loyalty_points, 0) INTO current_balance FROM public.users_profile WHERE id = p_user_id;
  IF current_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;
  IF p_points <= 0 OR p_points > 1000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_points');
  END IF;
  IF current_balance < p_points THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_balance', 'balance', current_balance);
  END IF;
  IF (p_points % 100) != 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'must_be_multiple_of_100');
  END IF;

  fcfa_value := (p_points / 100) * 1000;
  UPDATE public.users_profile SET loyalty_points = loyalty_points - p_points WHERE id = p_user_id;
  INSERT INTO public.loyalty_transactions (user_id, type, points, reason)
  VALUES (p_user_id, 'redeem', -p_points, 'Echange contre ' || fcfa_value || ' FCFA');

  RETURN jsonb_build_object('success', true, 'new_balance', current_balance - p_points, 'fcfa_credit', fcfa_value);
END;
$function$;

-- 🔴 CRITIQUE #25 — client_confirm_delivery sans verif user_id
CREATE OR REPLACE FUNCTION public.client_confirm_delivery(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id text; v_status text; v_owner uuid; v_uid uuid := auth.uid();
BEGIN
  SELECT id, status, user_id INTO v_id, v_status, v_owner
  FROM public.orders WHERE confirmation_token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_token'); END IF;
  IF v_owner IS NOT NULL AND v_uid IS DISTINCT FROM v_owner THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_your_order');
  END IF;
  IF v_status NOT IN ('awaiting_confirm', 'shipped') THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_status', 'current', v_status);
  END IF;
  UPDATE public.orders SET status='delivered', client_confirmed=true,
    client_confirmed_at=now(), updated_at=now() WHERE id=v_id;
  RETURN jsonb_build_object('success', true, 'order_id', v_id);
END;
$function$;

-- 🔴 CRITIQUE #26 — client_dispute_delivery : meme probleme + valider raison
CREATE OR REPLACE FUNCTION public.client_dispute_delivery(p_token text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id text; v_owner uuid; v_uid uuid := auth.uid();
BEGIN
  SELECT id, user_id INTO v_id, v_owner FROM public.orders WHERE confirmation_token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_token'); END IF;
  IF v_owner IS NOT NULL AND v_uid IS DISTINCT FROM v_owner THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_your_order');
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'reason_required');
  END IF;
  UPDATE public.orders SET status='disputed', client_dispute_reason=left(p_reason, 500),
    client_confirmed=false, updated_at=now() WHERE id=v_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 🟠 ELEVE #27 — client_rate_order : fallback token sans check user_id
CREATE OR REPLACE FUNCTION public.client_rate_order(p_id_or_token text, p_rating integer, p_comment text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id text; v_owner uuid; v_uid uuid := auth.uid();
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_rating');
  END IF;
  SELECT id, user_id INTO v_id, v_owner FROM public.orders
   WHERE id = p_id_or_token AND (user_id = v_uid OR (v_uid IS NULL AND user_id IS NULL));
  IF v_id IS NULL THEN
    SELECT id, user_id INTO v_id, v_owner FROM public.orders
     WHERE confirmation_token = p_id_or_token AND (user_id IS NULL OR user_id = v_uid);
  END IF;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found_or_not_owned');
  END IF;
  UPDATE public.orders SET delivery_rating=p_rating,
    delivery_comment=NULLIF(trim(COALESCE(left(p_comment, 1000), '')), ''),
    rated_at=now(), updated_at=now() WHERE id=v_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 🟠 ELEVE #28 — client_get_order_by_token : valider longueur token >=24
CREATE OR REPLACE FUNCTION public.client_get_order_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_token IS NULL OR length(p_token) < 24 THEN RETURN NULL; END IF;
  RETURN (SELECT to_jsonb(o) FROM public.orders o WHERE o.confirmation_token = p_token LIMIT 1);
END;
$function$;

-- 🟡 MOYEN #29 — increment_promo_uses / increment_review_helpful : auth required
CREATE OR REPLACE FUNCTION public.increment_promo_uses(p_promo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  UPDATE public.promo_codes SET uses_count = COALESCE(uses_count, 0) + 1 WHERE id = p_promo_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_review_helpful(review_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  UPDATE public.reviews SET helpful_count = COALESCE(helpful_count, 0) + 1 WHERE id = review_id;
END;
$function$;

-- 🟡 MOYEN #30 — livreur_load_delivery : valider longueur token
CREATE OR REPLACE FUNCTION public.livreur_load_delivery(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_tracking JSONB; v_order JSONB; v_pharmacies JSONB; v_order_id TEXT;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;
  SELECT to_jsonb(dt) INTO v_tracking FROM public.delivery_tracking dt WHERE dt.delivery_token = p_token LIMIT 1;
  IF v_tracking IS NULL THEN
    RETURN jsonb_build_object('tracking', NULL, 'order', NULL, 'pharmacies', '[]'::jsonb, 'error', 'tracking_not_found');
  END IF;
  v_order_id := v_tracking->>'order_id';
  SELECT to_jsonb(o) INTO v_order FROM public.orders o WHERE o.id::TEXT = v_order_id LIMIT 1;
  v_pharmacies := '[]'::jsonb;
  BEGIN
    SELECT COALESCE(jsonb_agg(DISTINCT to_jsonb(ph)), '[]'::jsonb) INTO v_pharmacies
    FROM public.pharmacies ph
    WHERE ph.id::TEXT IN (
      SELECT DISTINCT (oi->>'pharmacy_id') FROM jsonb_array_elements(COALESCE(v_order->'items', '[]'::jsonb)) AS oi
      WHERE oi->>'pharmacy_id' IS NOT NULL AND oi->>'pharmacy_id' != ''
    );
  EXCEPTION WHEN OTHERS THEN v_pharmacies := '[]'::jsonb;
  END;
  RETURN jsonb_build_object('tracking', v_tracking, 'order', v_order, 'pharmacies', v_pharmacies);
END;
$function$;

-- ============================================================================
-- SECTION 5 — is_admin() avec UUID hardcode
-- ============================================================================

-- 🟡 MOYEN #31 — is_admin() contient un UUID hardcode (6b26e15b-...)
-- A retirer apres avoir confirme que le compte admin a un email dans admin_users.
-- Decommenter quand pret :
/*
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.active = true
      AND au.email = COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), '')
  );
$function$;
*/

-- ============================================================================
-- SECTION 6 — STORAGE
-- ============================================================================

-- 🟠 ELEVE #32 — Buckets logos/icons/marketing : DELETE/UPDATE/INSERT ouverts → defacement
DROP POLICY IF EXISTS "brand-logos delete"  ON storage.objects;
DROP POLICY IF EXISTS "brand-logos update"  ON storage.objects;
DROP POLICY IF EXISTS "brand-logos write"   ON storage.objects;
DROP POLICY IF EXISTS "category-icons delete" ON storage.objects;
DROP POLICY IF EXISTS "category-icons update" ON storage.objects;
DROP POLICY IF EXISTS "category-icons write"  ON storage.objects;
DROP POLICY IF EXISTS "marketing assets delete" ON storage.objects;
DROP POLICY IF EXISTS "marketing assets update" ON storage.objects;
DROP POLICY IF EXISTS "marketing assets write"  ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload product images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload reviews"        ON storage.objects;
DROP POLICY IF EXISTS review_photos_authenticated_insert ON storage.objects;
CREATE POLICY review_photos_authenticated_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'review-photos');

-- 🟠 ELEVE #33 — Bucket skin-scans : lecture path-knowing exploitable
DROP POLICY IF EXISTS "Anyone can upload skin scans" ON storage.objects;
DROP POLICY IF EXISTS skin_scans_anon_signed_read   ON storage.objects;
DROP POLICY IF EXISTS skin_scans_owner_read         ON storage.objects;
DROP POLICY IF EXISTS skin_scans_anon_insert        ON storage.objects;
CREATE POLICY skin_scans_owner_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'skin-scans'
    AND EXISTS (
      SELECT 1 FROM public.skin_scans s
       WHERE s.image_url LIKE '%' || storage.objects.name || '%'
         AND s.user_id = auth.uid()
    )
  );
CREATE POLICY skin_scans_anon_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'skin-scans');

-- delivery-proofs : signed URL only (les lecteurs sont admin/livreur via signed)
DROP POLICY IF EXISTS "Anyone can update delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS delivery_proofs_anon_select         ON storage.objects;
DROP POLICY IF EXISTS delivery_proofs_anon_signed_read    ON storage.objects;
DROP POLICY IF EXISTS delivery_proofs_anon_update         ON storage.objects;
DROP POLICY IF EXISTS delivery_proofs_anon_insert         ON storage.objects;
CREATE POLICY delivery_proofs_anon_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'delivery-proofs');

-- ============================================================================
-- SECTION 7 — INFOS
-- ============================================================================

-- 🟢 INFO — site_settings : lisible par anon. A audit le contenu (clefs API ?).
-- 🟢 INFO — promo_codes : SELECT actif autorise. Possibilite d'enumeration.
--   Mitigation possible : passer par RPC apply_promo_code(p_code).
-- 🟢 INFO — set_device_push_enabled existe en 2 signatures (overload). Verifier.

COMMIT;

-- ============================================================================
-- A FAIRE MANUELLEMENT APRES APPLICATION :
--   1. Rotation des PINs admin (ils etaient exposes)
--   2. Activer 2FA sur Supabase Studio
--   3. Rotater la cle service_role (Settings > API > Reset)
--   4. Rotater tous les delivery_token livreur actifs
--   5. TRUNCATE les sessions admin / pharma actives (force re-login)
--   6. Activer Postgres SSL strict
--   7. Relancer get_advisors apres et viser 0 ERROR/WARN
-- ============================================================================

-- ============================================================================
-- SECTION 8 — NOUVEAU : apply_referral_bonus
-- Remplace l'attribution client de 500/500 pts (bloquee par les fixes ci-dessus)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_referral_bonus(p_referrer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_my_referred_by uuid;
  v_referrer_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_referrer_id IS NULL OR p_referrer_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_referrer');
  END IF;

  -- Le referrer doit exister
  SELECT first_name INTO v_referrer_name FROM public.users_profile WHERE id = p_referrer_id;
  IF v_referrer_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'referrer_not_found');
  END IF;

  -- Le user actuel ne doit pas avoir deja de referred_by
  SELECT referred_by INTO v_my_referred_by FROM public.users_profile WHERE id = v_uid;
  IF v_my_referred_by IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_referred');
  END IF;

  -- Set referred_by via UPDATE (le trigger _block_user_loyalty_tampering laisse
  -- passer car ce RPC est SECURITY DEFINER et auth.uid() pointe encore sur le user ;
  -- on doit explicitement bypasser le check via SET LOCAL ROLE postgres si besoin)
  UPDATE public.users_profile SET referred_by = p_referrer_id WHERE id = v_uid AND referred_by IS NULL;

  -- +500 pts au referrer
  INSERT INTO public.loyalty_transactions (user_id, type, points, reason)
  VALUES (p_referrer_id, 'bonus', 500, 'Bonus parrainage');
  UPDATE public.users_profile
     SET loyalty_points = COALESCE(loyalty_points, 0) + 500,
         loyalty_total_earned = COALESCE(loyalty_total_earned, 0) + 500
   WHERE id = p_referrer_id;

  -- +500 pts au filleul (v_uid)
  INSERT INTO public.loyalty_transactions (user_id, type, points, reason)
  VALUES (v_uid, 'bonus', 500, 'Bonus inscription via ' || v_referrer_name);
  UPDATE public.users_profile
     SET loyalty_points = COALESCE(loyalty_points, 0) + 500,
         loyalty_total_earned = COALESCE(loyalty_total_earned, 0) + 500
   WHERE id = v_uid;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- NOTE : le trigger _block_user_loyalty_tampering ci-dessus utilise `auth.uid()`
-- pour detecter "appel client". Comme ce RPC est SECURITY DEFINER, auth.uid()
-- conserve la valeur du caller (le user). Le trigger bloquera donc le UPDATE
-- de loyalty_points venant de ce RPC.
--
-- Solution : on ajoute une exception explicite. On exclut les colonnes
-- loyalty_* du check si le caller est dans une RPC autorisee. La maniere la
-- plus propre est de scinder le trigger en :
--   - trigger normal : ne bloque que si auth.uid() = NEW.id (le user touche son propre profil)
-- Comme un user qui s'attaque ne peut updater QUE son propre profil
-- (RLS auth.uid() = id), un user lambda ne pourra jamais ecrire les
-- loyalty_* d'un AUTRE user via une session client : la RLS l'aurait deja
-- coupe. Ajustons le trigger pour autoriser les ecritures DEFINER :

CREATE OR REPLACE FUNCTION public._block_user_loyalty_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_role text;
BEGIN
  -- Si le caller est service_role / postgres → ok
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  -- Si on n'est PAS en train de modifier son propre profil → la RLS aurait deja
  -- du couper, on laisse Postgres lever l'erreur RLS.
  -- Si on EST en train de modifier son propre profil mais on tente de toucher
  -- loyalty_*, on bloque, SAUF si le SP est lui-meme un RPC autorise. Cas
  -- detecte via la presence d'un GUC custom positionne par apply_referral_bonus.
  v_role := current_setting('app.loyalty_writer_ok', true);
  IF v_role = 'yes' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() <> NEW.id THEN
    RETURN NEW;  -- la RLS gerera le rejet
  END IF;
  IF NEW.loyalty_points       IS DISTINCT FROM OLD.loyalty_points       THEN RAISE EXCEPTION 'forbidden:loyalty_points';       END IF;
  IF NEW.loyalty_total_earned IS DISTINCT FROM OLD.loyalty_total_earned THEN RAISE EXCEPTION 'forbidden:loyalty_total_earned'; END IF;
  IF NEW.loyalty_tier         IS DISTINCT FROM OLD.loyalty_tier         THEN RAISE EXCEPTION 'forbidden:loyalty_tier';         END IF;
  IF NEW.referred_by IS DISTINCT FROM OLD.referred_by AND OLD.referred_by IS NOT NULL THEN
    RAISE EXCEPTION 'forbidden:referred_by_already_set';
  END IF;
  IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'forbidden:referral_code';
  END IF;
  IF NEW.welcomed_at IS DISTINCT FROM OLD.welcomed_at AND OLD.welcomed_at IS NOT NULL THEN
    RAISE EXCEPTION 'forbidden:welcomed_at_already_set';
  END IF;
  RETURN NEW;
END
$fn$;

-- Et on modifie apply_referral_bonus pour set le GUC autour des updates :
CREATE OR REPLACE FUNCTION public.apply_referral_bonus(p_referrer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_my_referred_by uuid;
  v_referrer_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_referrer_id IS NULL OR p_referrer_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_referrer');
  END IF;
  SELECT first_name INTO v_referrer_name FROM public.users_profile WHERE id = p_referrer_id;
  IF v_referrer_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'referrer_not_found');
  END IF;
  SELECT referred_by INTO v_my_referred_by FROM public.users_profile WHERE id = v_uid;
  IF v_my_referred_by IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_referred');
  END IF;

  PERFORM set_config('app.loyalty_writer_ok', 'yes', true);
  UPDATE public.users_profile SET referred_by = p_referrer_id WHERE id = v_uid AND referred_by IS NULL;

  INSERT INTO public.loyalty_transactions (user_id, type, points, reason)
  VALUES (p_referrer_id, 'bonus', 500, 'Bonus parrainage');
  UPDATE public.users_profile
     SET loyalty_points = COALESCE(loyalty_points, 0) + 500,
         loyalty_total_earned = COALESCE(loyalty_total_earned, 0) + 500
   WHERE id = p_referrer_id;

  INSERT INTO public.loyalty_transactions (user_id, type, points, reason)
  VALUES (v_uid, 'bonus', 500, 'Bonus inscription via ' || v_referrer_name);
  UPDATE public.users_profile
     SET loyalty_points = COALESCE(loyalty_points, 0) + 500,
         loyalty_total_earned = COALESCE(loyalty_total_earned, 0) + 500
   WHERE id = v_uid;

  PERFORM set_config('app.loyalty_writer_ok', 'no', true);
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.loyalty_writer_ok', 'no', true);
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
