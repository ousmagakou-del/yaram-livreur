import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const BANNED_PINS = ['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','9876'];

export default function PharmaSettings({ pharmacy, onUpdate }) {
  const [form, setForm] = useState({
    name: '', description: '', manager_name: '',
    address: '', city: '', neighborhood: '',
    phone: '', whatsapp: '',
    hours: '', delivery_hours: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Sous-vue : changement PIN
  const [pinView, setPinView] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinOk, setPinOk] = useState('');

  useEffect(() => {
    if (!pharmacy) return;
    setForm({
      name: pharmacy.name || '',
      description: pharmacy.description || '',
      manager_name: pharmacy.manager_name || '',
      address: pharmacy.address || '',
      city: pharmacy.city || '',
      neighborhood: pharmacy.neighborhood || '',
      phone: pharmacy.phone || '',
      whatsapp: pharmacy.whatsapp || '',
      hours: pharmacy.hours || '',
      delivery_hours: pharmacy.delivery_hours || '',
    });
  }, [pharmacy]);

  const handleChange = (key) => (e) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }));
    if (saved) setSaved(false);
    if (saveError) setSaveError('');
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError('');
    const { error } = await supabase
      .from('pharmacies')
      .update(form)
      .eq('id', pharmacy.id);
    setSaving(false);
    if (error) {
      setSaveError('Erreur : ' + error.message);
      return;
    }
    setSaved(true);
    const updated = { ...pharmacy, ...form };
    if (onUpdate) onUpdate(updated);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleChangePin = async () => {
    setPinError('');
    setPinOk('');
    if (oldPin !== pharmacy.pin) return setPinError('Ancien PIN incorrect');
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) return setPinError('Le nouveau PIN doit faire 4 chiffres');
    if (BANNED_PINS.includes(newPin)) return setPinError('PIN trop évident, choisis-en un autre');
    if (newPin === oldPin) return setPinError('Le nouveau PIN doit être différent de l\'ancien');
    if (newPin !== confirmPin) return setPinError('Les deux PIN ne correspondent pas');

    const { error } = await supabase
      .from('pharmacies')
      .update({ pin: newPin, pin_set_at: new Date().toISOString() })
      .eq('id', pharmacy.id);
    if (error) return setPinError('Erreur : ' + error.message);

    setPinOk('✓ PIN modifié avec succès');
    const updated = { ...pharmacy, pin: newPin };
    if (onUpdate) onUpdate(updated);
    setOldPin('');
    setNewPin('');
    setConfirmPin('');
    setTimeout(() => { setPinView(false); setPinOk(''); }, 2000);
  };

  // ─── VUE CHANGEMENT PIN ───
  if (pinView) {
    return (
      <div className="phar-section">
        <div className="phar-header">
          <div>
            <h1>🔑 Modifier mon PIN</h1>
            <p>Choisis un nouveau code PIN à 4 chiffres</p>
          </div>
        </div>

        <div className="phar-settings-form">
          <div className="phar-card">
            <div className="phar-field">
              <label className="phar-label">Ancien PIN</label>
              <input
                className="phar-input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={oldPin}
                onChange={e => { setOldPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                placeholder="••••"
                autoFocus
              />
            </div>

            <div className="phar-field">
              <label className="phar-label">Nouveau PIN</label>
              <input
                className="phar-input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={newPin}
                onChange={e => { setNewPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                placeholder="••••"
              />
              <p className="phar-hint">💡 Évite 1234, 0000, 1111 et autres PIN évidents</p>
            </div>

            <div className="phar-field">
              <label className="phar-label">Confirme le nouveau PIN</label>
              <input
                className="phar-input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={confirmPin}
                onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                placeholder="••••"
                onKeyDown={e => e.key === 'Enter' && handleChangePin()}
              />
            </div>

            {pinError && <div className="phar-save-error">⚠️ {pinError}</div>}
            {pinOk && <div className="phar-save-ok">{pinOk}</div>}

            <button onClick={handleChangePin} className="phar-btn-primary" style={{ marginTop: 14 }}>
              Modifier mon PIN
            </button>
            <button
              onClick={() => { setPinView(false); setPinError(''); setOldPin(''); setNewPin(''); setConfirmPin(''); }}
              className="phar-btn-outline"
              style={{ marginTop: 8 }}
            >
              ← Annuler
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── VUE PRINCIPALE PARAMÈTRES ───
  return (
    <div className="phar-section">
      <div className="phar-header">
        <div>
          <h1>⚙️ Paramètres</h1>
          <p>Gère les infos de ta pharmacie</p>
        </div>
      </div>

      <div className="phar-settings-form">
        {/* Infos générales */}
        <div className="phar-card">
          <div className="phar-card-title">🏥 Infos de la pharmacie</div>

          <div className="phar-field">
            <label className="phar-label">Nom de la pharmacie</label>
            <input
              className="phar-input"
              value={form.name}
              onChange={handleChange('name')}
              placeholder="Pharmacie Centrale Plateau"
            />
          </div>

          <div className="phar-field">
            <label className="phar-label">Description courte</label>
            <textarea
              className="phar-textarea"
              value={form.description}
              onChange={handleChange('description')}
              placeholder="Au cœur du Plateau · spécialité dermato"
            />
          </div>

          <div className="phar-field">
            <label className="phar-label">Nom du gérant</label>
            <input
              className="phar-input"
              value={form.manager_name}
              onChange={handleChange('manager_name')}
              placeholder="Dr. Mamadou Ndiaye"
            />
          </div>
        </div>

        {/* Adresse */}
        <div className="phar-card">
          <div className="phar-card-title">📍 Adresse</div>

          <div className="phar-field">
            <label className="phar-label">Adresse complète</label>
            <input
              className="phar-input"
              value={form.address}
              onChange={handleChange('address')}
              placeholder="Avenue Pompidou, face BICIS"
            />
          </div>

          <div className="phar-row">
            <div className="phar-field">
              <label className="phar-label">Ville</label>
              <input
                className="phar-input"
                value={form.city}
                onChange={handleChange('city')}
                placeholder="Dakar"
              />
            </div>
            <div className="phar-field">
              <label className="phar-label">Quartier</label>
              <input
                className="phar-input"
                value={form.neighborhood}
                onChange={handleChange('neighborhood')}
                placeholder="Plateau"
              />
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="phar-card">
          <div className="phar-card-title">📞 Contact</div>

          <div className="phar-field">
            <label className="phar-label">Téléphone fixe</label>
            <input
              className="phar-input"
              value={form.phone}
              onChange={handleChange('phone')}
              placeholder="+221 33 821 45 67"
            />
          </div>

          <div className="phar-field">
            <label className="phar-label">WhatsApp</label>
            <input
              className="phar-input"
              value={form.whatsapp}
              onChange={handleChange('whatsapp')}
              placeholder="+221 78 612 45 67"
            />
            <p className="phar-hint">📲 Les clientes te contactent via ce numéro</p>
          </div>
        </div>

        {/* Horaires */}
        <div className="phar-card">
          <div className="phar-card-title">🕐 Horaires</div>

          <div className="phar-field">
            <label className="phar-label">Horaires d'ouverture</label>
            <input
              className="phar-input"
              value={form.hours}
              onChange={handleChange('hours')}
              placeholder="07h30 - 21h, lun-sam"
            />
          </div>

          <div className="phar-field">
            <label className="phar-label">Horaires de livraison</label>
            <input
              className="phar-input"
              value={form.delivery_hours}
              onChange={handleChange('delivery_hours')}
              placeholder="09h - 18h, tous les jours"
            />
            <p className="phar-hint">🛵 Quand peuvent passer nos livreurs ?</p>
          </div>
        </div>

        {/* Boutons sauvegarde */}
        <div>
          <button onClick={handleSave} disabled={saving} className="phar-btn-primary">
            {saving ? '⏳ Sauvegarde…' : '💾 Sauvegarder les modifications'}
          </button>
          {saved && <div className="phar-save-ok">✓ Modifications sauvegardées</div>}
          {saveError && <div className="phar-save-error">⚠️ {saveError}</div>}
        </div>

        {/* Sécurité */}
        <div className="phar-card">
          <div className="phar-card-title">🔒 Sécurité</div>
          <button onClick={() => setPinView(true)} className="phar-btn-outline">
            🔑 Modifier mon PIN
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: '#9B9B9B', marginTop: 4 }}>
          Diaara · Dashboard Pharmacie
        </p>
      </div>
    </div>
  );
}
