-- ════════════════════════════════════════════════════════
-- YARAM — Système de rappels client (4 types)
-- ════════════════════════════════════════════════════════
-- 1. REPLENISHMENT  : "Ton produit acheté il y a X jours va bientôt finir"
-- 2. REENGAGEMENT   : "Ça fait 60+ jours qu'on ne t'a pas vue"
-- 3. ANNIVERSARY    : "Joyeux 1 an chez YARAM, voici un cadeau"
-- 4. SCAN_REFRESH   : "Refais un scan, ta peau a peut-être évolué"
--
-- À exécuter UNE FOIS dans Supabase Dashboard → SQL Editor.
-- ════════════════════════════════════════════════════════

-- 1. Ajout durée d'utilisation moyenne par produit
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS usage_duration_days INT DEFAULT 60;

COMMENT ON COLUMN products.usage_duration_days IS
  'Durée moyenne d''utilisation du produit en jours. Sert au calcul des rappels d''épuisement (replenishment). Valeurs typiques : sérum 30ml = 60, crème 50ml = 90, parfum = 180, masque = 30.';

-- Valeurs par défaut intelligentes selon la catégorie
-- (pour bootstrap : tu pourras ensuite ajuster produit par produit dans l'admin)
UPDATE products SET usage_duration_days = CASE category
  WHEN 'serum'        THEN 60
  WHEN 'hydratant'    THEN 90
  WHEN 'nettoyant'    THEN 60
  WHEN 'masque'       THEN 45
  WHEN 'solaire'      THEN 60
  WHEN 'parfum'       THEN 180
  WHEN 'cheveux'      THEN 60
  WHEN 'corps'        THEN 90
  WHEN 'levres'       THEN 90
  WHEN 'maquillage'   THEN 180
  WHEN 'huile'        THEN 90
  WHEN 'hygiene'      THEN 60
  WHEN 'bebe'         THEN 90
  WHEN 'bouche'       THEN 60
  WHEN 'complement'   THEN 30
  WHEN 'pieds_mains'  THEN 90
  WHEN 'intime'       THEN 60
  WHEN 'deodorants'   THEN 60
  ELSE 60
END
WHERE usage_duration_days = 60; -- seulement les rows qui ont la valeur défaut

-- 2. Table de log des rappels envoyés (anti-doublon)
CREATE TABLE IF NOT EXISTS public.reminder_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  type           text NOT NULL
                 CHECK (type IN ('replenishment', 'reengagement', 'anniversary', 'scan_refresh')),
  product_id     uuid,                 -- nullable : seul replenishment a un product_id
  order_id       text,                 -- nullable : seul replenishment / anniversary a un order_id
  scan_id        uuid,                 -- nullable : seul scan_refresh a un scan_id
  channel        text NOT NULL DEFAULT 'whatsapp'
                 CHECK (channel IN ('whatsapp', 'email', 'push')),
  status         text NOT NULL DEFAULT 'sent'
                 CHECK (status IN ('sent', 'failed', 'skipped')),
  message_preview text,                -- 200 premiers caractères pour debug
  error_text     text,
  sent_at        timestamptz NOT NULL DEFAULT now()
);

-- Index pour vérifier rapidement si on a déjà envoyé un rappel
CREATE INDEX IF NOT EXISTS idx_reminder_logs_dedup
  ON reminder_logs (user_id, type, product_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_sent_at
  ON reminder_logs (sent_at DESC);

-- RLS : on lit/écrit uniquement depuis l'edge function (service_role).
-- Personne d'autre n'a besoin d'accéder à cette table directement.
ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;

-- ─── RPC pour l'admin : stats rappels ───────────────────
CREATE OR REPLACE FUNCTION public.admin_reminder_stats(p_token text, p_days int DEFAULT 30)
RETURNS TABLE (
  type text,
  channel text,
  status text,
  nb bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
BEGIN
  SELECT * INTO v_session FROM admin_sessions WHERE token = p_token;
  IF v_session IS NULL OR v_session.expires_at < now() THEN
    RAISE EXCEPTION 'invalid_or_expired_token';
  END IF;

  RETURN QUERY
    SELECT rl.type, rl.channel, rl.status, COUNT(*) AS nb
    FROM reminder_logs rl
    WHERE rl.sent_at > now() - (p_days || ' days')::interval
    GROUP BY rl.type, rl.channel, rl.status
    ORDER BY rl.type, rl.channel, rl.status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reminder_stats(text, int) TO anon, authenticated;
