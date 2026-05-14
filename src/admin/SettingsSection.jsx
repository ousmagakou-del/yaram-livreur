import { useState } from 'react';

export default function SettingsSection() {
  const [settings, setSettings] = useState({
    siteName: 'YARAM',
    commission: 17.5,
    deliveryFee: 1500,
    freeDeliveryFrom: 50000,
    whatsapp: '+221 78 521 12 34',
    email: 'contact@yaram.sn',
    primaryColor: '#1F8B4C',
    accentColor: '#FFD700',
  });

  const handleSave = () => {
    localStorage.setItem('yaram_settings', JSON.stringify(settings));
    alert('Paramètres enregistrés ✅');
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Paramètres</h1>
          <p>Configuration générale YARAM</p>
        </div>
        <button className="adm-btn-pri" onClick={handleSave}>💾 Enregistrer</button>
      </header>

      <div className="adm-form-grid">
        <div className="adm-form-section">
          <h3>🏢 Identité</h3>
          <label>Nom de la boutique<input value={settings.siteName} onChange={e => setSettings({ ...settings, siteName: e.target.value })} /></label>
          <label>Email contact<input value={settings.email} onChange={e => setSettings({ ...settings, email: e.target.value })} /></label>
          <label>WhatsApp<input value={settings.whatsapp} onChange={e => setSettings({ ...settings, whatsapp: e.target.value })} /></label>
        </div>

        <div className="adm-form-section">
          <h3>💰 Business</h3>
          <label>Commission YARAM (%)<input type="number" step="0.1" value={settings.commission} onChange={e => setSettings({ ...settings, commission: parseFloat(e.target.value) })} /></label>
          <label>Frais livraison Dakar (FCFA)<input type="number" value={settings.deliveryFee} onChange={e => setSettings({ ...settings, deliveryFee: parseInt(e.target.value) })} /></label>
          <label>Livraison gratuite dès (FCFA)<input type="number" value={settings.freeDeliveryFrom} onChange={e => setSettings({ ...settings, freeDeliveryFrom: parseInt(e.target.value) })} /></label>
        </div>

        <div className="adm-form-section">
          <h3>🎨 Couleurs</h3>
          <label>Couleur principale<input type="color" value={settings.primaryColor} onChange={e => setSettings({ ...settings, primaryColor: e.target.value })} style={{ height: 44 }} /></label>
          <label>Couleur accent<input type="color" value={settings.accentColor} onChange={e => setSettings({ ...settings, accentColor: e.target.value })} style={{ height: 44 }} /></label>
        </div>

        <div className="adm-form-section">
          <h3>ℹ️ À propos</h3>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#6B6B6B' }}>
            <strong>YARAM v0.1</strong><br />
            Marketplace beauté Sénégal 🇸🇳<br />
            10 pharmacies partenaires<br />
            Commission marketplace : 17.5%<br />
            Livraison YARAM mutualisée
          </p>
        </div>
      </div>
    </div>
  );
}
