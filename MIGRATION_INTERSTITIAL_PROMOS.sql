-- ════════════════════════════════════════════════════════
-- YARAM — Interstitial Promos (splashs full-screen)
-- ════════════════════════════════════════════════════════
-- Système de promos plein écran affichées au boot de l'app
-- - Modes : image (visuel custom) OU template (structuré)
-- - Audience targeting (all, new_users, returning, with_orders, no_orders)
-- - Frequency (always, once, once_per_session, once_per_day, once_per_week)
-- - Tracking impressions + clicks pour mesurer CTR
-- ════════════════════════════════════════════════════════

-- ═══ TABLE 1 : app_promos ═══
CREATE TABLE IF NOT EXISTS app_promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Mode d'affichage
  mode TEXT NOT NULL CHECK (mode IN ('image', 'template')),

  -- Contenu commun
  title TEXT,
  subtitle TEXT,
  description TEXT,

  -- Mode IMAGE
  image_url TEXT,             -- URL Supabase Storage (bucket marketing-assets)

  -- Mode TEMPLATE (champs structurés)
  badge_text TEXT,            -- ex: "🏠 Lokas · Sénégal"
  bg_color TEXT DEFAULT '#0A0A1F',
  text_color TEXT DEFAULT '#FFFFFF',
  title_accent_color TEXT DEFAULT '#A78BFA',  -- pour le mot mis en avant
  features JSONB DEFAULT '[]'::jsonb,         -- [{icon, title, subtitle}]

  -- Call-to-action principal
  cta_text TEXT,
  cta_url TEXT,               -- URL externe OU route interne (ex: /international)

  -- Call-to-action secondaire (optionnel)
  cta_secondary_text TEXT,
  cta_secondary_url TEXT,

  -- Ciblage
  target_audience TEXT NOT NULL DEFAULT 'all'
    CHECK (target_audience IN ('all', 'new_users', 'returning_users', 'with_orders', 'no_orders')),
  placement TEXT NOT NULL DEFAULT 'home'
    CHECK (placement IN ('home', 'login', 'all')),

  -- Fréquence d'affichage par user
  frequency TEXT NOT NULL DEFAULT 'once_per_day'
    CHECK (frequency IN ('always', 'once', 'once_per_session', 'once_per_day', 'once_per_week')),

  -- Période d'activité
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,

  -- Gestion
  priority INT DEFAULT 0,     -- + haut = + prioritaire
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Contraintes : selon mode, certains champs requis
  CONSTRAINT promo_image_url_required CHECK (mode != 'image' OR image_url IS NOT NULL),
  CONSTRAINT promo_template_title_required CHECK (mode != 'template' OR title IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_app_promos_active ON app_promos(is_active, priority DESC) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_app_promos_placement ON app_promos(placement, is_active);

COMMENT ON TABLE app_promos IS 'Splashs interstitiels affichés dans YARAM (web + iOS + Android)';
COMMENT ON COLUMN app_promos.frequency IS 'once: 1 fois pour l_user. once_per_day: 1 fois/24h. once_per_session: à chaque app open';

-- ═══ TABLE 2 : promo_impressions (tracking) ═══
CREATE TABLE IF NOT EXISTS promo_impressions (
  id BIGSERIAL PRIMARY KEY,
  promo_id UUID NOT NULL REFERENCES app_promos(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,            -- random ID stocké localStorage (pour anon)
  shown_at TIMESTAMPTZ DEFAULT NOW(),
  clicked_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  cta_clicked TEXT            -- 'primary' | 'secondary' | null
);

CREATE INDEX IF NOT EXISTS idx_promo_impressions_user ON promo_impressions(user_id, promo_id);
CREATE INDEX IF NOT EXISTS idx_promo_impressions_session ON promo_impressions(session_id, promo_id);
CREATE INDEX IF NOT EXISTS idx_promo_impressions_shown ON promo_impressions(shown_at DESC);

COMMENT ON TABLE promo_impressions IS 'Tracking : qui a vu quelle promo + clic/dismiss';

-- ═══ RLS ═══
ALTER TABLE app_promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_impressions ENABLE ROW LEVEL SECURITY;

-- Tout le monde peut SELECT les promos actives (pour fetch)
DROP POLICY IF EXISTS "promos read active" ON app_promos;
CREATE POLICY "promos read active" ON app_promos
  FOR SELECT TO anon, authenticated
  USING (
    is_active = true
    AND (start_date IS NULL OR start_date <= NOW())
    AND (end_date IS NULL OR end_date >= NOW())
  );

-- Tout le monde peut INSERT impressions (anon + auth)
DROP POLICY IF EXISTS "impressions insert any" ON promo_impressions;
CREATE POLICY "impressions insert any" ON promo_impressions
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- User peut SELECT ses propres impressions (pour cache local)
DROP POLICY IF EXISTS "impressions read own" ON promo_impressions;
CREATE POLICY "impressions read own" ON promo_impressions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR session_id = COALESCE(current_setting('request.jwt.claims', true)::json->>'session_id', ''));

-- ═══ RPC : get_next_promo ═══
-- Retourne la prochaine promo à afficher pour un user/session sur un placement
CREATE OR REPLACE FUNCTION get_next_promo(
  p_placement TEXT DEFAULT 'home',
  p_session_id TEXT DEFAULT NULL,
  p_audience_hint TEXT DEFAULT 'all'  -- 'new_users' | 'returning_users' | 'with_orders' | 'no_orders' | 'all'
)
RETURNS app_promos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_promo app_promos;
BEGIN
  -- Itère sur les promos actives par priorité décroissante
  FOR v_promo IN
    SELECT * FROM app_promos
    WHERE is_active = true
      AND (placement = p_placement OR placement = 'all')
      AND (start_date IS NULL OR start_date <= NOW())
      AND (end_date IS NULL OR end_date >= NOW())
      AND (
        target_audience = 'all'
        OR target_audience = p_audience_hint
      )
    ORDER BY priority DESC, created_at DESC
  LOOP
    -- Vérifie la fréquence : a-t-on déjà montré cette promo récemment ?
    IF v_promo.frequency = 'always' THEN
      RETURN v_promo;
    END IF;

    IF v_promo.frequency = 'once' THEN
      IF NOT EXISTS (
        SELECT 1 FROM promo_impressions
        WHERE promo_id = v_promo.id
          AND (
            (v_user_id IS NOT NULL AND user_id = v_user_id)
            OR (v_user_id IS NULL AND session_id = p_session_id)
          )
      ) THEN
        RETURN v_promo;
      END IF;
    END IF;

    IF v_promo.frequency = 'once_per_day' THEN
      IF NOT EXISTS (
        SELECT 1 FROM promo_impressions
        WHERE promo_id = v_promo.id
          AND shown_at > NOW() - INTERVAL '24 hours'
          AND (
            (v_user_id IS NOT NULL AND user_id = v_user_id)
            OR (v_user_id IS NULL AND session_id = p_session_id)
          )
      ) THEN
        RETURN v_promo;
      END IF;
    END IF;

    IF v_promo.frequency = 'once_per_week' THEN
      IF NOT EXISTS (
        SELECT 1 FROM promo_impressions
        WHERE promo_id = v_promo.id
          AND shown_at > NOW() - INTERVAL '7 days'
          AND (
            (v_user_id IS NOT NULL AND user_id = v_user_id)
            OR (v_user_id IS NULL AND session_id = p_session_id)
          )
      ) THEN
        RETURN v_promo;
      END IF;
    END IF;

    -- 'once_per_session' : géré côté client via localStorage (ne re-affiche pas dans même tab)
    IF v_promo.frequency = 'once_per_session' THEN
      RETURN v_promo;
    END IF;
  END LOOP;

  -- Aucune promo disponible
  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION get_next_promo(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ═══ RPC : record_promo_event ═══
CREATE OR REPLACE FUNCTION record_promo_event(
  p_promo_id UUID,
  p_event_type TEXT,  -- 'shown' | 'click_primary' | 'click_secondary' | 'dismissed'
  p_session_id TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_impression_id BIGINT;
BEGIN
  IF p_event_type = 'shown' THEN
    INSERT INTO promo_impressions (promo_id, user_id, session_id, shown_at)
    VALUES (p_promo_id, v_user_id, p_session_id, NOW())
    RETURNING id INTO v_impression_id;
    RETURN v_impression_id;
  END IF;

  -- Pour click / dismissed, on update la dernière impression
  IF p_event_type IN ('click_primary', 'click_secondary') THEN
    UPDATE promo_impressions
    SET clicked_at = NOW(),
        cta_clicked = SUBSTRING(p_event_type FROM 7)
    WHERE id = (
      SELECT id FROM promo_impressions
      WHERE promo_id = p_promo_id
        AND ((v_user_id IS NOT NULL AND user_id = v_user_id) OR (v_user_id IS NULL AND session_id = p_session_id))
      ORDER BY shown_at DESC
      LIMIT 1
    )
    RETURNING id INTO v_impression_id;
    RETURN v_impression_id;
  END IF;

  IF p_event_type = 'dismissed' THEN
    UPDATE promo_impressions
    SET dismissed_at = NOW()
    WHERE id = (
      SELECT id FROM promo_impressions
      WHERE promo_id = p_promo_id
        AND ((v_user_id IS NOT NULL AND user_id = v_user_id) OR (v_user_id IS NULL AND session_id = p_session_id))
      ORDER BY shown_at DESC
      LIMIT 1
    )
    RETURNING id INTO v_impression_id;
    RETURN v_impression_id;
  END IF;

  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION record_promo_event(UUID, TEXT, TEXT) TO anon, authenticated;

-- ═══ Trigger : updated_at auto ═══
CREATE OR REPLACE FUNCTION app_promos_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_promos_updated_at_trigger ON app_promos;
CREATE TRIGGER app_promos_updated_at_trigger
  BEFORE UPDATE ON app_promos
  FOR EACH ROW
  EXECUTE FUNCTION app_promos_set_updated_at();

-- ═══ Exemple : ajoute une 1ère promo pour tester ═══
-- (à activer si tu veux un test après migration)

-- INSERT INTO app_promos (mode, title, subtitle, description, badge_text, bg_color, title_accent_color,
--   cta_text, cta_url, cta_secondary_text, cta_secondary_url, features,
--   target_audience, placement, frequency, priority, is_active)
-- VALUES (
--   'template',
--   'Boutique internationale',
--   'Tes marques préférées',
--   'Découvre les meilleures marques des USA, France, Nigeria importées directement à Dakar.',
--   '🌍 NOUVEAU sur YARAM',
--   '#0066CC',
--   '#FCD34D',
--   'Découvrir →',
--   '/international',
--   'Plus tard',
--   NULL,
--   '[
--     {"icon": "✈️", "title": "Livraison 15j", "subtitle": "Direct depuis USA/EU"},
--     {"icon": "💳", "title": "Acompte 50%", "subtitle": "Le reste à l_arrivée"},
--     {"icon": "📦", "title": "100% original", "subtitle": "Marques vérifiées"}
--   ]'::jsonb,
--   'all',
--   'home',
--   'once_per_day',
--   10,
--   true
-- );

-- ═══ Vérification ═══
SELECT 'Migration interstitial promos OK' AS status,
       (SELECT COUNT(*) FROM app_promos) AS promos_count,
       (SELECT COUNT(*) FROM promo_impressions) AS impressions_count;
