import { useState } from 'react';

// ⚠️ Cette section est en mode "lecture seule + bac a sable".
// Les valeurs ne sont PAS persistees en base de donnees pour l'instant :
// elles vivent uniquement dans le localStorage du navigateur de l'admin courant,
// donc tu peux y jouer, mais ca n'a aucun effet sur l'app cliente.
//
// Les valeurs effectivement utilisees par l'app sont actuellement EN DUR dans le code :
//   - Commission : 0.08 dans src/lib/supabase.js (getPharmacyCommissions) et plusieurs sections admin
//   - Frais livraison : src/lib/utils.js getShippingZone (par ville)
//   - WhatsApp ops : src/components/WhatsAppButton.jsx + src/pharma/Pharma.jsx ADMIN_WHATSAPP
//
// TODO : creer une table `settings` (key, value jsonb) cote DB et reecrire cette page.

const DEFAULTS = {
  siteName: 'YARAM',
  commission: 8,
  deliveryFee: 1500,
  freeDeliveryFrom: 50000,
  whatsapp: '+221 77 438 87 66',
  email: 'contact@yaram.sn',
  primaryColor: '#1F8B4C',
  accentColor: '#FFD700',
};

function loadFromLS() {
  try {
    const raw = localStorage.getItem('yaram_settings');
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export default function SettingsSection() {
  const [settings, setSettings] = useState(loadFromLS);
  const [savedMsg, setSavedMsg] = useState('');

  const handleSave = () => {
    try {
      localStorage.setItem('yaram_settings', JSON.stringify(settings));
      setSavedMsg('✓ Enregistré dans ton navigateur (pas en base de données)');
      setTimeout(() => setSavedMsg(''), 4000);
    } catch (e) {
      setSavedMsg('Erreur localStorage : ' + e.message);
    }
  };

  const handleReset = () => {
    if (!confirm('Réinitialiser aux valeurs par défaut ?')) return;
    setSettings(DEFAULTS);
    try { localStorage.removeItem('yaram_settings'); } catch {}
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Paramètres</h1>
          <p>Configuration générale YARAM</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="adm-btn-sec" onClick={handleReset}>↺ Réinitialiser</button>
          <button className="adm-btn-pri" onClick={handleSave}>💾 Enregistrer (local)</button>
        </div>
      </header>

      {/* ────────── WARNING ────────── */}
      <div style={{
        background: '#FEF6E5',
        border: '2px solid #F4B53A',
        borderRadius: 12,
        padding: 14,
        marginBottom: 20,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: 24, lineHeight: 1 }}>⚠️</span>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#7A5A0A' }}>
          <strong>Cette section est un bac à sable.</strong> Les valeurs sont sauvegardées
          uniquement dans <em>ton navigateur</em> et ne sont pas appliquées à l'app cliente.
          Les vraies valeurs utilisées par YARAM sont actuellement en dur dans le code
          (commission 8%, frais livraison par ville, etc.).
          <br/>
          Pour activer cette page, il faut créer une table <code>settings</code> en base et
          y câbler la lecture/écriture.
        </div>
      </div>

      {savedMsg && (
        <div style={{ background: '#E8F5EC', color: '#1F8B4C', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
          {savedMsg}
        </div>
      )}

      <div className="adm-form-grid">
        <div className="adm-form-section">
          <h3>🏢 Identité</h3>
          <label>Nom de la boutique<input value={settings.siteName} onChange={e => setSettings({ ...settings, siteName: e.target.value })} /></label>
          <label>Email contact<input value={settings.email} onChange={e => setSettings({ ...settings, email: e.target.value })} /></label>
          <label>WhatsApp<input value={settings.whatsapp} onChange={e => setSettings({ ...settings, whatsapp: e.target.value })} /></label>
        </div>

        <div className="adm-form-section">
          <h3>💰 Business <small style={{ color: '#9B9B9B', fontWeight: 500, fontSize: 11 }}>(non appliqué — voir warning)</small></h3>
          <label>Commission YARAM (%)<input type="number" step="0.1" value={settings.commission} onChange={e => setSettings({ ...settings, commission: parseFloat(e.target.value) || 0 })} /></label>
          <label>Frais livraison Dakar (FCFA)<input type="number" value={settings.deliveryFee} onChange={e => setSettings({ ...settings, deliveryFee: parseInt(e.target.value) || 0 })} /></label>
          <label>Livraison gratuite dès (FCFA)<input type="number" value={settings.freeDeliveryFrom} onChange={e => setSettings({ ...settings, freeDeliveryFrom: parseInt(e.target.value) || 0 })} /></label>
        </div>

        <div className="adm-form-section">
          <h3>🎨 Couleurs <small style={{ color: '#9B9B9B', fontWeight: 500, fontSize: 11 }}>(non appliqué)</small></h3>
          <label>Couleur principale<input type="color" value={settings.primaryColor} onChange={e => setSettings({ ...settings, primaryColor: e.target.value })} style={{ height: 44 }} /></label>
          <label>Couleur accent<input type="color" value={settings.accentColor} onChange={e => setSettings({ ...settings, accentColor: e.target.value })} style={{ height: 44 }} /></label>
        </div>

        <div className="adm-form-section">
          <h3>ℹ️ À propos</h3>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#6B6B6B' }}>
            <strong>YARAM v0.1</strong><br />
            Marketplace beauté Sénégal 🇸🇳<br />
            Commission marketplace : 8% (en dur dans le code)<br />
            Livraison YARAM mutualisée
          </p>
        </div>
      </div>
    </div>
  );
}
