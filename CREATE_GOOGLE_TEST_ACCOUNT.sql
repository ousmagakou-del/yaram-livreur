-- ════════════════════════════════════════════════════════
-- YARAM — Compte de test pour Google Play Console
-- ════════════════════════════════════════════════════════
-- À exécuter dans Supabase SQL Editor
-- Crée un user complet avec :
--   • Email/password fonctionnels
--   • users_profile rempli (nom, téléphone, ville)
--   • 1 adresse de livraison Dakar
--   • 1 commande de démo
--
-- Identifiants à donner à Google Play Console :
--   Email     : google-test@yaram.app
--   Password  : GoogleTest2026!
-- ════════════════════════════════════════════════════════

-- ─── 1. Créer le user dans auth.users (via Supabase Auth Admin) ───
-- ⚠️ Tu dois faire ÇA via le Dashboard Supabase :
--    Authentication → Users → Add user → Create new user
--    Email    : google-test@yaram.app
--    Password : GoogleTest2026!
--    Auto Confirm : ✅ (très important)
--
-- Ensuite récupère l'UUID du user créé et remplace TEST_USER_UUID ci-dessous.

-- ─── 2. Insérer le profile (remplace TEST_USER_UUID) ───
DO $$
DECLARE
  test_user_id UUID := (
    SELECT id FROM auth.users WHERE email = 'google-test@yaram.app' LIMIT 1
  );
BEGIN
  IF test_user_id IS NULL THEN
    RAISE NOTICE 'User google-test@yaram.app introuvable. Crée-le d''abord dans Supabase Auth Dashboard.';
    RETURN;
  END IF;

  -- Profil
  INSERT INTO users_profile (id, full_name, phone, city, country, created_at)
  VALUES (
    test_user_id,
    'Google Play Tester',
    '+221770000099',
    'Dakar',
    'Sénégal',
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone     = EXCLUDED.phone,
    city      = EXCLUDED.city;

  -- Adresse de livraison
  INSERT INTO addresses (user_id, label, recipient_name, phone, street, city, country, is_default, created_at)
  VALUES (
    test_user_id,
    'Domicile',
    'Google Play Tester',
    '+221770000099',
    'Sacré-Cœur 3, près du Marché HLM',
    'Dakar',
    'Sénégal',
    true,
    NOW()
  )
  ON CONFLICT DO NOTHING;

  RAISE NOTICE '✅ Compte google-test@yaram.app configuré';
  RAISE NOTICE '   Login : google-test@yaram.app';
  RAISE NOTICE '   Password : GoogleTest2026!';
END $$;
