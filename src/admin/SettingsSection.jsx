import { useState, useEffect } from 'react';
import { getSiteSettings, updateSiteSettings } from '../lib/supabase';
import { toast, confirmDialog } from '../lib/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration generale du site — persistee en DB (table site_settings).
//
// MIGRATION SQL A LANCER UNE FOIS dans Supabase Studio :
//
//   CREATE TABLE IF NOT EXISTS public.site_settings (
//     key         text PRIMARY KEY,
//     value       jsonb NOT NULL,
//     updated_at  timestamptz DEFAULT now()
//   );
//   ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
//   -- Lecture publique (l'app cliente peut lire les settings publics)
//   CREATE POLICY "settings_read_all" ON public.site_settings
//     FOR SELECT USING (true);
//   -- Ecriture : service_role uniquement (l'admin passe par RPC ou edge function)
//   -- Pour le MVP on autorise l'ecriture cote anon mais a securiser en prod !
//   CREATE POLICY "settings_write_anon_TEMP" ON public.site_settings
//     FOR ALL USING (true) WITH CHECK (true);
//
// Note : les VRAIES sources d'info de l'app (commission 8% dans supabase.js,
// frais livraison par ville dans utils.js, etc.) ne sont PAS encore branchees
// sur cette table. Pour le moment cette page persiste les valeurs en DB mais
// le code ne les lit pas. Prochaine etape : remplacer les constantes par des
// lectures de getSiteSettings() dans les helpers concernes.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  siteName: 'YARAM',
  commission: 8,
  deliveryFee: 1500,
  freeDeliveryFrom: 50000,
  whatsapp: '+221 77 438 87 66',
  email: 'contact@yaram.sn',
  primaryColor: '#1F8B4C',
  accentColor: '#FFD700',
  // ─── Hero banner Home (3 lignes typo XXL + sous-titre + couleurs) ───
  heroEnabled: true,
  heroLine1: 'Zéro',
  heroLine2: 'frais de',
  heroLine3: 'service',
  heroSubtext: 'Livraison à 1 500 FCFA',
  heroBackground: '#1F8B4C',
  heroLine1Color: '#FFF8E5',
  heroLineColor: '#FFFFFF',
  heroSubBg: '#F4B53A',
  heroSubColor: '#4A1B0C',
  heroCtaLabel: 'Découvrir les promos',
  heroCtaRoute: 'promos',
};

export default function SettingsSection() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const remote = await getSiteSettings();
      // Merge DB sur defaults pour gerer le cas d'une table vide ou partielle
      setSettings({ ...DEFAULTS, ...remote });
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const result = await updateSiteSettings(settings);
    setSaving(false);
    if (result.success) {
      toast.success('Paramètres enregistrés en base de données');
    } else {
      toast.error('Échec sauvegarde : ' + (result.error || 'erreur inconnue'));
    }
  };

  const handleReset = async () => {
    if (!(await confirmDialog('Réinitialiser aux valeurs par défaut ?', { confirmLabel: 'Réinitialiser', danger: true }))) return;
    setSettings(DEFAULTS);
    setSaving(true);
    const result = await updateSiteSettings(DEFAULTS);
    setSaving(false);
    if (result.success) toast.success('Paramètres réinitialisés');
    else toast.error('Échec : ' + (result.error || 'erreur inconnue'));
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Paramètres</h1>
          <p>Configuration générale YARAM (persistée en DB)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="adm-btn-sec" onClick={handleReset} disabled={saving || loading}>↺ Réinitialiser</button>
          <button className="adm-btn-pri" onClick={handleSave} disabled={saving || loading}>
            {saving ? '💾 Sauvegarde…' : '💾 Enregistrer'}
          </button>
        </div>
      </header>

      {/* ────────── INFO sur quoi est branche / pas encore ────────── */}
      <div style={{
        background: '#E6F1FB',
        border: '1.5px solid #4285F4',
        borderRadius: 12,
        padding: 14,
        marginBottom: 20,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>ℹ️</span>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#185FA5' }}>
          <strong>Les valeurs sont sauvegardées en base</strong> (table <code>site_settings</code>).
          Toutefois certains modules de l'app (calcul de la commission dans <code>supabase.js</code>,
          frais de livraison par ville dans <code>utils.js</code>) utilisent encore des valeurs
          en dur dans le code. Modifier ici ne les affecte pas <em>encore</em> — la prochaine
          étape sera de les brancher sur <code>getSiteSettings()</code>.
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#9B9B9B' }}>Chargement…</p>
      ) : (
        <div className="adm-form-grid">
          <div className="adm-form-section">
            <h3>🏢 Identité</h3>
            <label>Nom de la boutique<input value={settings.siteName} onChange={e => setSettings({ ...settings, siteName: e.target.value })} /></label>
            <label>Email contact<input value={settings.email} onChange={e => setSettings({ ...settings, email: e.target.value })} /></label>
            <label>WhatsApp<input value={settings.whatsapp} onChange={e => setSettings({ ...settings, whatsapp: e.target.value })} /></label>
          </div>

          <div className="adm-form-section">
            <h3>💰 Business <small style={{ color: '#9B9B9B', fontWeight: 500, fontSize: 11 }}>(à câbler côté code)</small></h3>
            <label>Commission YARAM (%)<input type="number" step="0.1" value={settings.commission} onChange={e => setSettings({ ...settings, commission: parseFloat(e.target.value) || 0 })} /></label>
            <label>Frais livraison Dakar (FCFA)<input type="number" value={settings.deliveryFee} onChange={e => setSettings({ ...settings, deliveryFee: parseInt(e.target.value) || 0 })} /></label>
            <label>Livraison gratuite dès (FCFA)<input type="number" value={settings.freeDeliveryFrom} onChange={e => setSettings({ ...settings, freeDeliveryFrom: parseInt(e.target.value) || 0 })} /></label>
          </div>

          <div className="adm-form-section">
            <h3>🎨 Couleurs <small style={{ color: '#9B9B9B', fontWeight: 500, fontSize: 11 }}>(à câbler côté CSS)</small></h3>
            <label>Couleur principale<input type="color" value={settings.primaryColor} onChange={e => setSettings({ ...settings, primaryColor: e.target.value })} style={{ height: 44 }} /></label>
            <label>Couleur accent<input type="color" value={settings.accentColor} onChange={e => setSettings({ ...settings, accentColor: e.target.value })} style={{ height: 44 }} /></label>
          </div>

          {/* ════════ HERO BANNER (page Home) ════════ */}
          <div className="adm-form-section" style={{ gridColumn: '1 / -1' }}>
            <h3>🎨 Hero banner (page Home)</h3>
            <p style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 12 }}>
              Slogan typo XXL animé en haut de la home cliente. 3 lignes de texte
              en très gros, sous-titre en pill, couleurs personnalisables. Les
              utilisatrices voient ce nouveau texte au prochain refresh de l'app.
            </p>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={settings.heroEnabled !== false}
                onChange={e => setSettings({ ...settings, heroEnabled: e.target.checked })}
              />
              <span>Afficher le hero banner</span>
            </label>

            {/* ── Aperçu live ── */}
            <div style={{
              background: settings.heroBackground || '#1F8B4C',
              borderRadius: 16,
              padding: 16,
              marginBottom: 16,
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                fontSize: 38, fontWeight: 900, color: settings.heroLine1Color,
                lineHeight: 0.92, letterSpacing: -1.5, textTransform: 'uppercase',
              }}>{settings.heroLine1 || 'Ligne 1'}</div>
              <div style={{
                fontSize: 30, fontWeight: 900, color: settings.heroLineColor,
                lineHeight: 0.92, letterSpacing: -1.2, textTransform: 'uppercase', marginTop: 2,
              }}>{settings.heroLine2 || 'Ligne 2'}</div>
              <div style={{
                fontSize: 30, fontWeight: 900, color: settings.heroLineColor,
                lineHeight: 0.92, letterSpacing: -1.2, textTransform: 'uppercase', marginTop: 2,
              }}>{settings.heroLine3 || 'Ligne 3'}</div>
              {settings.heroSubtext && (
                <div style={{
                  display: 'inline-block', marginTop: 10,
                  background: settings.heroSubBg, color: settings.heroSubColor,
                  fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999,
                  fontStyle: 'italic',
                }}>{settings.heroSubtext}</div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label>Ligne 1<input value={settings.heroLine1} onChange={e => setSettings({ ...settings, heroLine1: e.target.value })} maxLength={20} /></label>
              <label>Ligne 2<input value={settings.heroLine2} onChange={e => setSettings({ ...settings, heroLine2: e.target.value })} maxLength={20} /></label>
              <label>Ligne 3<input value={settings.heroLine3} onChange={e => setSettings({ ...settings, heroLine3: e.target.value })} maxLength={20} /></label>
              <label>Sous-titre (pill)<input value={settings.heroSubtext} onChange={e => setSettings({ ...settings, heroSubtext: e.target.value })} maxLength={40} /></label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: 12 }}>
              <label>Fond hero<input type="color" value={settings.heroBackground} onChange={e => setSettings({ ...settings, heroBackground: e.target.value })} style={{ height: 40 }} /></label>
              <label>Couleur L1<input type="color" value={settings.heroLine1Color} onChange={e => setSettings({ ...settings, heroLine1Color: e.target.value })} style={{ height: 40 }} /></label>
              <label>Couleur L2/L3<input type="color" value={settings.heroLineColor} onChange={e => setSettings({ ...settings, heroLineColor: e.target.value })} style={{ height: 40 }} /></label>
              <label>Pill fond<input type="color" value={settings.heroSubBg} onChange={e => setSettings({ ...settings, heroSubBg: e.target.value })} style={{ height: 40 }} /></label>
              <label>Pill texte<input type="color" value={settings.heroSubColor} onChange={e => setSettings({ ...settings, heroSubColor: e.target.value })} style={{ height: 40 }} /></label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <label>CTA label (optionnel)<input value={settings.heroCtaLabel} onChange={e => setSettings({ ...settings, heroCtaLabel: e.target.value })} placeholder="Découvrir les promos" /></label>
              <label>CTA route (au clic)
                <select value={settings.heroCtaRoute} onChange={e => setSettings({ ...settings, heroCtaRoute: e.target.value })} style={{ height: 40 }}>
                  <option value="promos">Promos</option>
                  <option value="pharmacies">Pharmacies</option>
                  <option value="categories">Catégories</option>
                  <option value="international">International</option>
                  <option value="cart">Panier</option>
                  <option value="">Aucune (juste affichage)</option>
                </select>
              </label>
            </div>
          </div>

          <div className="adm-form-section">
            <h3>ℹ️ À propos</h3>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#6B6B6B' }}>
              <strong>YARAM v0.1</strong><br />
              Marketplace beauté Sénégal 🇸🇳<br />
              Commission marketplace : {settings.commission}%<br />
              Livraison YARAM mutualisée
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
