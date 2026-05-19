-- ════════════════════════════════════════════════════════
-- YARAM — Marketing campaigns log (WaSender)
-- ════════════════════════════════════════════════════════
-- Historique des envois WhatsApp en bulk.
-- Alimenté par l'edge function `send-whatsapp-bulk`.
--
-- À exécuter UNE FOIS dans Supabase Dashboard → SQL Editor.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL DEFAULT 'Campagne sans nom',
  sent_by      text,                       -- email admin qui a envoyé
  target_count int NOT NULL DEFAULT 0,     -- cibles initiales
  sent_count   int NOT NULL DEFAULT 0,     -- succès
  failed_count int NOT NULL DEFAULT 0,     -- échecs
  status       text NOT NULL DEFAULT 'in_progress'
               CHECK (status IN ('in_progress', 'completed', 'failed')),
  details      jsonb DEFAULT '[]'::jsonb,  -- [{ phone, status, message_id?, error? }]
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_created_at
  ON public.marketing_campaigns (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status
  ON public.marketing_campaigns (status);

-- RLS : personne ne peut lire/écrire en direct.
-- Seule l'edge function (service_role) peut écrire.
-- Seule la RPC admin_list_campaigns (à créer plus tard) peut lire pour l'admin.
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;

-- Pas de policy = personne (à part service_role) ne peut accéder.
-- C'est volontaire : on lit via une future RPC `admin_list_campaigns`.

-- ─── (Optionnel mais utile) RPC pour lire l'historique côté admin ───
CREATE OR REPLACE FUNCTION public.admin_list_campaigns(
  p_token text,
  p_limit int DEFAULT 20
)
RETURNS SETOF public.marketing_campaigns
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
BEGIN
  -- Vérifie le token admin
  SELECT * INTO v_session FROM admin_sessions WHERE token = p_token;
  IF v_session IS NULL OR v_session.expires_at < now() THEN
    RAISE EXCEPTION 'invalid_or_expired_token';
  END IF;

  RETURN QUERY
    SELECT * FROM marketing_campaigns
    ORDER BY created_at DESC
    LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_campaigns(text, int) TO anon, authenticated;
