-- =====================================================================
-- MIGRATION P0 #1 — site_settings : fermeture de la policy permissive
-- =====================================================================
-- Date    : 2026-06-22
-- Auteur  : Yaram Top 5 P0 fixes
-- Audit   : voir AUDIT_COMPLET_YARAM.md ainsi que la session
--           local_84216a91-0d84-4884-bb24-dccb3fb84087
--
-- Objet :
--   1. Supprimer la policy permissive sur public.site_settings qui laisse
--      n'importe quel client anon UPDATE/INSERT/DELETE sur la table.
--      Cette policy a vécu sous plusieurs noms ("settings_write_temp",
--      "settings_write_anon_TEMP") — on drop les deux pour être tranquille.
--   2. Garder la lecture publique (SELECT) — l'app cliente lit les
--      paramètres pour afficher hero / numéro WA / commission, etc.
--   3. Créer / remplacer la RPC SECURITY DEFINER admin_update_site_settings
--      qui prend un p_token (session admin) et un p_settings (jsonb) puis
--      fait l'UPSERT clé-à-clé dans site_settings.
--   4. Tracer chaque update dans admin_logs (via admin_log_action côté
--      client → adminLogAction(...) dans SettingsSection.jsx).
--
-- Idempotent : OUI (DROP IF EXISTS + CREATE OR REPLACE).
-- Re-runnable : OUI.
--
-- Rollback (à exécuter MANUELLEMENT en cas de souci) :
--   DROP FUNCTION IF EXISTS public.admin_update_site_settings(text, jsonb);
--   CREATE POLICY "settings_write_temp" ON public.site_settings
--     FOR ALL USING (true) WITH CHECK (true);
--   ⚠️ Ne pas garder cette policy en prod : c'est précisément ce qu'on
--   referme dans cette migration.
-- =====================================================================

-- ─── 1. Vérification préalable : la table existe et RLS est activée ────
ALTER TABLE IF EXISTS public.site_settings ENABLE ROW LEVEL SECURITY;

-- ─── 2. DROP des policies permissives historiques ─────────────────────
DROP POLICY IF EXISTS "settings_write_anon_TEMP" ON public.site_settings;
DROP POLICY IF EXISTS "settings_write_temp"      ON public.site_settings;
DROP POLICY IF EXISTS "settings_write_all"       ON public.site_settings;
DROP POLICY IF EXISTS "settings_anon_write"      ON public.site_settings;

-- ─── 3. Re-crée la policy SELECT publique (idempotent) ────────────────
-- L'app cliente DOIT pouvoir lire les settings (HeroBanner, commission,
-- WhatsAppButton...). Aucune donnée sensible : la table contient des
-- couleurs, du texte marketing et le numéro WhatsApp public.
DROP POLICY IF EXISTS "settings_read_all" ON public.site_settings;
CREATE POLICY "settings_read_all"
  ON public.site_settings
  FOR SELECT
  USING (true);

-- ─── 4. Policy d'écriture EXPLICITEMENT vide pour anon/authenticated ──
-- Avec RLS ON et aucune policy d'écriture, tout UPDATE/INSERT/DELETE
-- direct depuis le client est bloqué. On ajoute service_role pour les
-- edge functions / scripts d'admin batch.
DROP POLICY IF EXISTS "settings_write_service" ON public.site_settings;
CREATE POLICY "settings_write_service"
  ON public.site_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── 5. RPC admin_update_site_settings ────────────────────────────────
-- SECURITY DEFINER : tourne avec les privilèges du owner (postgres),
-- bypasse la RLS de site_settings. Vérifie le token admin via
-- _check_admin_session (défini dans RLS_PHASE1_FOUNDATION.sql) puis
-- UPSERT chaque clé du jsonb dans site_settings.
--
-- Renvoie un jsonb { success: bool, error?: text, updated_keys: int }
-- pour rester compatible avec le wrapper updateSiteSettings() côté code.

CREATE OR REPLACE FUNCTION public.admin_update_site_settings(
  p_token    text,
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id    uuid;
  v_key         text;
  v_value       jsonb;
  v_count       int := 0;
BEGIN
  -- 1. Vérifie le token. Throw 'invalid_session' si KO.
  v_admin_id := public._check_admin_session(p_token);

  -- 2. Validations de base.
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_settings doit être un objet jsonb');
  END IF;

  -- 3. Itère sur chaque clé et UPSERT.
  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_settings)
  LOOP
    INSERT INTO public.site_settings (key, value, updated_at)
    VALUES (v_key, v_value, now())
    ON CONFLICT (key) DO UPDATE
      SET value      = EXCLUDED.value,
          updated_at = now();
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success',      true,
    'updated_keys', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_site_settings(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_update_site_settings(text, jsonb) TO anon, authenticated;

-- ─── 6. Vérification post-migration ───────────────────────────────────
-- Le check suivant doit retourner 1 ligne (settings_read_all + éventuel
-- settings_write_service). AUCUNE policy "anon TEMP" ne doit subsister.
--
--   SELECT policyname, cmd, roles
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'site_settings';
--
-- Test côté client :
--   1. Sans token admin :
--      supabase.from('site_settings').update({ value: '"x"' }).eq('key', 'siteName')
--      → doit échouer avec "new row violates row-level security policy"
--   2. Via la RPC :
--      supabase.rpc('admin_update_site_settings', { p_token: <token_admin>,
--                                                   p_settings: { siteName: '"YARAM"' } })
--      → doit retourner { success: true, updated_keys: 1 }
-- =====================================================================
-- END P0 #1
-- =====================================================================
