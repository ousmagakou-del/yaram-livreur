-- ════════════════════════════════════════════════════════
-- YARAM — Setup drip d'onboarding (J+2 / J+7 / J+30)
-- ════════════════════════════════════════════════════════
-- À EXÉCUTER UNE FOIS dans Supabase Dashboard → SQL Editor
-- (étape par étape — lire les commentaires avant le bloc cron).
--
-- 1. Colonnes de tracking sur users_profile (idempotent)
-- 2. Setting Postgres `app.cron_secret` (pour le cron pg_cron)
-- 3. Job pg_cron : appelle l'edge function tous les jours à 10h UTC
-- ════════════════════════════════════════════════════════

-- ─── 1. COLONNES DE TRACKING ────────────────────────────────
-- Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE public.users_profile
  ADD COLUMN IF NOT EXISTS onboarding_drip_d2_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_drip_d7_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_drip_d30_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_drip_disabled    boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users_profile.onboarding_drip_d2_sent_at  IS 'Drip onboarding J+2 envoyé à cette date (NULL = pas encore envoyé).';
COMMENT ON COLUMN public.users_profile.onboarding_drip_d7_sent_at  IS 'Drip onboarding J+7 envoyé à cette date (NULL = pas encore envoyé).';
COMMENT ON COLUMN public.users_profile.onboarding_drip_d30_sent_at IS 'Drip onboarding J+30 envoyé à cette date (NULL = pas encore envoyé). Bonus 500 points crédités quand cette colonne passe non-NULL.';
COMMENT ON COLUMN public.users_profile.onboarding_drip_disabled    IS 'Opt-out marketing : si true, aucun email de relance onboarding.';

-- Index pour filtrer rapidement les candidats (drip activé + au moins 1 étape NULL).
CREATE INDEX IF NOT EXISTS idx_users_profile_drip_pending
  ON public.users_profile (created_at)
  WHERE onboarding_drip_disabled = false
    AND (
      onboarding_drip_d2_sent_at  IS NULL
      OR onboarding_drip_d7_sent_at  IS NULL
      OR onboarding_drip_d30_sent_at IS NULL
    );

-- ─── 2. SECRET POUR LE CRON ─────────────────────────────────
-- Le cron pg_cron doit s'authentifier auprès de l'edge function avec un
-- Bearer token. On stocke ce token comme un setting Postgres custom.
--
-- ⚠️ AVANT DE LANCER LE BLOC ci-dessous, génère un token aléatoire et
-- remplace 'CHANGE_ME_SECRET_TOKEN' par sa valeur.
-- Le même token doit être set côté Supabase Edge Function comme
-- ONBOARDING_DRIP_TOKEN (Dashboard → Project → Edge Functions → Secrets).
--
-- Pour générer : openssl rand -hex 32

-- ALTER DATABASE postgres SET app.cron_secret TO 'CHANGE_ME_SECRET_TOKEN';
-- SELECT pg_reload_conf();

-- ─── 3. EXTENSIONS REQUISES ─────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── 4. JOB CRON QUOTIDIEN ──────────────────────────────────
-- 1×/jour à 10h UTC (= 10h Dakar UTC+0).
-- Idempotent : on tue l'ancien job s'il existe avant de re-planifier.

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'yaram-onboarding-drip';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END$$;

SELECT cron.schedule(
  'yaram-onboarding-drip',
  '0 10 * * *',
  $$
    SELECT net.http_post(
      url := 'https://qxhhnrnworwrnwmqekmb.supabase.co/functions/v1/onboarding-drip',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
      ),
      body := '{}'::jsonb
    );
  $$
);

-- ─── 5. VÉRIF (lecture seule) ───────────────────────────────
-- SELECT * FROM cron.job WHERE jobname = 'yaram-onboarding-drip';
-- SELECT jobid, runid, status, return_message, start_time, end_time
--   FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'yaram-onboarding-drip')
--   ORDER BY start_time DESC
--   LIMIT 5;

-- ─── 6. KILL SWITCH (si besoin de stopper) ──────────────────
-- SELECT cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'yaram-onboarding-drip'));
