-- ═══════════════════════════════════════════════════════════════════
--  YARAM — Newsletter subscribers
-- ═══════════════════════════════════════════════════════════════════
--  Table publique pour stocker les opt-ins newsletter (anon + loggés).
--  Préférences fines (promos, articles, conseils peau, nouveautés)
--  stockées en JSONB pour pouvoir évoluer sans migration.
--
--  Notes RLS :
--   - INSERT : autorisé à tout le monde (anon + auth). Un user pas loggué
--     doit pouvoir s'abonner depuis la landing → policy WITH CHECK true.
--   - SELECT : seul le owner (user_id match auth.uid()) ou l'email de
--     l'user connecté peut lire. Les anonymes ne voient rien.
--   - UPDATE / DELETE : owner uniquement (pour gérer ses préférences
--     ou se désabonner soft via unsubscribed_at).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  preferences jsonb DEFAULT '{"promos":true,"articles":true,"conseils_peau":true,"nouveaux_produits":true}'::jsonb,
  subscribed_at timestamptz DEFAULT now(),
  unsubscribed_at timestamptz,
  source text DEFAULT 'app',
  UNIQUE NULLS NOT DISTINCT (email, user_id)
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY newsletter_insert_anyone ON public.newsletter_subscribers
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY newsletter_select_own ON public.newsletter_subscribers
  FOR SELECT TO authenticated USING (
    auth.uid() = user_id
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY newsletter_update_own ON public.newsletter_subscribers
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY newsletter_delete_own ON public.newsletter_subscribers
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Index sur user_id pour les lookups "suis-je abonné ?" rapides
CREATE INDEX IF NOT EXISTS newsletter_subscribers_user_id_idx
  ON public.newsletter_subscribers(user_id)
  WHERE user_id IS NOT NULL;

-- Index sur email pour les exports / segments marketing
CREATE INDEX IF NOT EXISTS newsletter_subscribers_email_idx
  ON public.newsletter_subscribers(email);
