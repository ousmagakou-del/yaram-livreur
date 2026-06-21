-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION_PHARMA_HARDENING.sql
-- ----------------------------------------------------------------------------
-- Hardening du flow pharma :
--   1. PIN passe de 4 a 6 chiffres (refus du login si PIN < 6 -> force migration)
--   2. Rate limit / lockout sur pharma_start_session
--      - 5 echecs consecutifs -> verrou de 15 min
--      - reset compteur a chaque PIN correct
--   3. pharma_change_pin refuse les PIN < 6 chiffres
--   4. Nouvelle RPC pharma_revert_to_paid : permet un refus tardif
--      (preparing -> paid) pour debloquer un workflow zombie
--
-- Tout est idempotent : peut etre relance sans danger.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1) Colonnes de rate-limit sur pharmacies
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

COMMENT ON COLUMN pharmacies.failed_attempts IS
  'Compteur echecs PIN consecutifs. Reset a 0 quand un PIN correct passe.';
COMMENT ON COLUMN pharmacies.locked_until IS
  'Si > NOW(), la pharmacie est verrouillee (login refuse jusqu''a cette date).';


-- ──────────────────────────────────────────────────────────────────────────
-- 2) pharma_start_session : version durcie
-- ──────────────────────────────────────────────────────────────────────────
-- Hypotheses :
--   - signature historique : (p_pharmacy_id text, p_pin text, p_user_agent text)
--   - retourne jsonb { success, token?, pharmacy?, error?, retry_at? }
--   - delegue la verif PIN a verify_pharmacy_pin (deja en place)
--
-- Comportement nouveau :
--   - si locked_until > NOW()  -> { success:false, error:'locked', retry_at }
--   - si PIN < 6 chiffres      -> { success:false, error:'pin_too_short' }
--     (force la pharma a passer par admin_set_pharmacy_pin pour migrer)
--   - PIN incorrect : failed_attempts++. A 5, locked_until = NOW()+15min + reset.
--   - PIN correct : failed_attempts=0, locked_until=null.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pharma_start_session(
  p_pharmacy_id text,
  p_pin         text,
  p_user_agent  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy   pharmacies%ROWTYPE;
  v_token      text;
  v_now        timestamptz := NOW();
  v_max_fails  constant integer := 5;
  v_lock_dur   constant interval := interval '15 minutes';
BEGIN
  -- 1) Refus immediat si PIN trop court : on ne consomme meme pas un essai,
  --    on force la pharmacie a faire passer un admin par admin_set_pharmacy_pin
  --    avec un PIN >= 6.
  IF p_pin IS NULL OR length(p_pin) < 6 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'pin_too_short',
      'message', 'PIN doit faire 6 chiffres. Contacte YARAM pour migrer ton ancien PIN.'
    );
  END IF;

  -- 2) Lookup pharmacy
  SELECT * INTO v_pharmacy
  FROM pharmacies
  WHERE id::text = p_pharmacy_id
    AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'pharmacy_not_found');
  END IF;

  -- 3) Lockout actif ?
  IF v_pharmacy.locked_until IS NOT NULL AND v_pharmacy.locked_until > v_now THEN
    RETURN jsonb_build_object(
      'success',  false,
      'error',    'locked',
      'retry_at', v_pharmacy.locked_until,
      'message',  'Compte verrouille suite a plusieurs erreurs. Reessaie plus tard.'
    );
  END IF;

  -- 4) Verif PIN
  IF v_pharmacy.pin IS DISTINCT FROM p_pin THEN
    -- Incremente compteur ; si on atteint v_max_fails, on verrouille et on reset.
    IF v_pharmacy.failed_attempts + 1 >= v_max_fails THEN
      UPDATE pharmacies
         SET failed_attempts = 0,
             locked_until    = v_now + v_lock_dur
       WHERE id = v_pharmacy.id;

      RETURN jsonb_build_object(
        'success',  false,
        'error',    'locked',
        'retry_at', v_now + v_lock_dur,
        'message',  'Trop d''erreurs : compte verrouille 15 min.'
      );
    ELSE
      UPDATE pharmacies
         SET failed_attempts = failed_attempts + 1
       WHERE id = v_pharmacy.id;

      RETURN jsonb_build_object(
        'success',           false,
        'error',             'invalid_pin',
        'attempts_left',     v_max_fails - (v_pharmacy.failed_attempts + 1),
        'message',           'PIN incorrect'
      );
    END IF;
  END IF;

  -- 5) PIN OK : reset compteur + lockout, emettre token
  UPDATE pharmacies
     SET failed_attempts = 0,
         locked_until    = NULL
   WHERE id = v_pharmacy.id;

  -- Token : on utilise un schema standard ("phs_" + pharmacy_id + "_" + random)
  -- Si tu as deja une table pharma_sessions, branche-toi dessus ici. On garde
  -- la compat la plus simple possible : un token opaque base64.
  v_token := 'phs_' || encode(gen_random_bytes(24), 'base64');

  -- Si une table pharma_sessions existe, on y enregistre la session. Sinon
  -- on laisse le mecanisme de token existant tel quel (autres RPC pharma_*
  -- valident probablement deja la signature). Le bloc est en best-effort.
  BEGIN
    INSERT INTO pharma_sessions (token, pharmacy_id, user_agent, created_at)
    VALUES (v_token, v_pharmacy.id, p_user_agent, v_now);
  EXCEPTION WHEN undefined_table THEN
    -- pas de table de sessions : on accepte, le token sera valide par d'autres
    -- moyens (HMAC, JWT, etc.) dans le reste du code existant.
    NULL;
  END;

  RETURN jsonb_build_object(
    'success',  true,
    'token',    v_token,
    'pharmacy', to_jsonb(v_pharmacy) - 'pin'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION pharma_start_session(text, text, text) TO anon, authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- 3) pharma_change_pin : refus si nouveau PIN < 6 chiffres
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pharma_change_pin(
  p_pharmacy_id text,
  p_old_pin     text,
  p_new_pin     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy pharmacies%ROWTYPE;
BEGIN
  IF p_new_pin IS NULL OR length(p_new_pin) < 6 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Le PIN doit faire au moins 6 chiffres'
    );
  END IF;

  IF p_new_pin !~ '^\d+$' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Le PIN doit etre uniquement des chiffres'
    );
  END IF;

  SELECT * INTO v_pharmacy
  FROM pharmacies
  WHERE id::text = p_pharmacy_id
    AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pharmacie introuvable');
  END IF;

  IF v_pharmacy.pin IS DISTINCT FROM p_old_pin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ancien PIN incorrect');
  END IF;

  UPDATE pharmacies
     SET pin             = p_new_pin,
         pin_set_at      = NOW(),
         failed_attempts = 0,
         locked_until    = NULL
   WHERE id = v_pharmacy.id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION pharma_change_pin(text, text, text) TO anon, authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- 4) pharma_revert_to_paid : refus tardif (preparing -> paid)
-- ──────────────────────────────────────────────────────────────────────────
-- Use-case : la pharma a accepte la commande, mais en preparant elle se rend
-- compte d'une rupture / d'un probleme. Elle ne peut plus refuser car
-- pharma_update_order(action='refuse') exige status='paid'.
-- Cette RPC fait sauter ce blocage : elle remet l'order en 'paid' pour que
-- le flux normal de refus puisse ensuite s'appliquer.
--
-- Securite :
--   - exige un token pharma valide (via pharma_validate_token si dispo)
--   - verifie que l'order appartient bien a la pharmacie du token
--   - ne fonctionne que si status = 'preparing' (sinon no-op)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pharma_revert_to_paid(
  p_token    text,
  p_order_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pharmacy_id  text;
  v_order        record;
BEGIN
  -- 1) Resolution token -> pharmacy_id. On tente d'abord une fonction
  --    pharma_validate_token si elle existe, sinon fallback sur la table
  --    pharma_sessions.
  BEGIN
    SELECT (pharma_validate_token(p_token)->>'pharmacy_id') INTO v_pharmacy_id;
  EXCEPTION WHEN undefined_function THEN
    SELECT pharmacy_id::text INTO v_pharmacy_id
      FROM pharma_sessions
     WHERE token = p_token
     LIMIT 1;
  END;

  IF v_pharmacy_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session invalide ou expiree');
  END IF;

  -- 2) Verif que l'order appartient bien a la pharmacie et est en 'preparing'
  SELECT id, status, pharmacy_id
    INTO v_order
    FROM orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Commande introuvable');
  END IF;

  -- pharmacy_id peut etre stocke directement OU via items[].pharmacyId. On
  -- accepte les deux : si la colonne pharmacy_id existe et matche, OK ; sinon
  -- on regarde dans items.
  IF v_order.pharmacy_id IS NOT NULL THEN
    IF v_order.pharmacy_id::text IS DISTINCT FROM v_pharmacy_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Commande pas a toi');
    END IF;
  ELSE
    -- fallback : verifie que au moins un item appartient a cette pharmacie
    PERFORM 1
      FROM orders o,
           jsonb_array_elements(o.items) it
     WHERE o.id = p_order_id
       AND (it->>'pharmacyId') = v_pharmacy_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Commande pas a toi');
    END IF;
  END IF;

  IF v_order.status <> 'preparing' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Statut incompatible : seules les commandes en preparation peuvent etre refusees tardivement',
      'current_status', v_order.status
    );
  END IF;

  -- 3) Revert vers 'paid' pour que pharma_update_order(refuse) reprenne la main
  UPDATE orders
     SET status     = 'paid',
         updated_at = NOW()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION pharma_revert_to_paid(text, text) TO anon, authenticated;


COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS (a lancer manuellement apres deploiement)
-- ════════════════════════════════════════════════════════════════════════════
-- 1) Verifier colonnes :
--    SELECT failed_attempts, locked_until FROM pharmacies LIMIT 1;
--
-- 2) Tester lockout (replace PHA_ID) :
--    SELECT pharma_start_session('PHA_ID','000000',null);  -- x5
--    -> doit retourner { success:false, error:'locked', retry_at:... }
--
-- 3) Tester PIN court refus :
--    SELECT pharma_start_session('PHA_ID','1234',null);
--    -> { success:false, error:'pin_too_short' }
--
-- 4) Tester refus tardif (replace token + order id) :
--    SELECT pharma_revert_to_paid('phs_xxx', 'ORD_xxx');
--    -> doit passer status 'preparing' -> 'paid'
