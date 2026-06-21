import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// PINs trop evidents (6 chiffres) : suites, repetitions, dates de naissance type.
const BANNED_PINS = [
  '000000','111111','222222','333333','444444','555555','666666','777777','888888','999999',
  '123456','654321','012345','543210','111222','121212','123123','112233',
];

// Suggestions Unsplash : photos libres de droits, déjà optimisées
const UNSPLASH_SUGGESTIONS = [
  {
    label: 'Croix verte',
    cover: 'https://images.unsplash.com/photo-1622230208995-0f26eba75875?fm=jpg&q=80&w=1600&auto=format&fit=crop',
    logo:  'https://images.unsplash.com/photo-1622230208995-0f26eba75875?fm=jpg&q=80&w=400&h=400&auto=format&fit=crop',
  },
  {
    label: 'Comptoir blanc',
    cover: 'https://images.unsplash.com/photo-1583912267550-d6c2ac3196c0?fm=jpg&q=80&w=1600&auto=format&fit=crop',
    logo:  'https://images.unsplash.com/photo-1583912267550-d6c2ac3196c0?fm=jpg&q=80&w=400&h=400&auto=format&fit=crop',
  },
  {
    label: 'Médicaments',
    cover: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?fm=jpg&q=80&w=1600&auto=format&fit=crop',
    logo:  'https://images.unsplash.com/photo-1576091160550-2173dba999ef?fm=jpg&q=80&w=400&h=400&auto=format&fit=crop',
  },
  {
    label: 'Cosmétiques',
    cover: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?fm=jpg&q=80&w=1600&auto=format&fit=crop',
    logo:  'https://images.unsplash.com/photo-1556228720-195a672e8a03?fm=jpg&q=80&w=400&h=400&auto=format&fit=crop',
  },
];

export default function PharmaSettings({ pharmacy, onUpdate }) {
  const [form, setForm] = useState({
    name: '', description: '', manager_name: '',
    address: '', city: '', neighborhood: '',
    phone: '', whatsapp: '',
    hours: '', delivery_hours: '',
    logo: '', cover: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  // États d'erreur pour aperçu image
  const [logoBroken, setLogoBroken] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);

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
      logo: pharmacy.logo || '',
      cover: pharmacy.cover || '',
    });
    setLogoBroken(false);
    setCoverBroken(false);
  }, [pharmacy]);

  const handleChange = (key) => (e) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }));
    if (saved) setSaved(false);
    if (saveError) setSaveError('');
    if (key === 'logo') setLogoBroken(false);
    if (key === 'cover') setCoverBroken(false);
  };

  const applySuggestion = (s) => {
    setForm(prev => ({ ...prev, logo: s.logo, cover: s.cover }));
    setLogoBroken(false);
    setCoverBroken(false);
    if (saved) setSaved(false);
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
    // Validations cote client (le serveur revalide aussi)
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) return setPinError('Le nouveau PIN doit faire 6 chiffres');
    if (BANNED_PINS.includes(newPin)) return setPinError('PIN trop évident, choisis-en un autre');
    if (newPin === oldPin) return setPinError('Le nouveau PIN doit être différent de l\'ancien');
    if (newPin !== confirmPin) return setPinError('Les deux PIN ne correspondent pas');

    // RPC SECURITY DEFINER : valide ancien PIN cote serveur puis update
    // (le client n'a plus le droit d'UPDATE direct la colonne pin via REST)
    const { data, error } = await supabase.rpc('pharma_change_pin', {
      p_pharmacy_id: pharmacy.id,
      p_old_pin:     oldPin,
      p_new_pin:     newPin,
    });
    if (error) return setPinError('Erreur serveur : ' + error.message);
    if (!data?.success) return setPinError(data?.error || 'Echec changement PIN');

    setPinOk('✓ PIN modifié avec succès');
    const updated = { ...pharmacy, pin_set_at: new Date().toISOString() };
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
            <p>Choisis un nouveau code PIN à 6 chiffres</p>
          </div>
        </div>

        <div className="phar-settings-form">
          <div className="phar-card">
            <div className="phar-field">
              <label className="phar-label">Ancien PIN (6 chiffres)</label>
              <input
                className="phar-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={oldPin}
                onChange={e => { setOldPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                placeholder="••••••"
                autoFocus
              />
            </div>

            <div className="phar-field">
              <label className="phar-label">Nouveau PIN (6 chiffres)</label>
              <input
                className="phar-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={e => { setNewPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                placeholder="••••••"
              />
              <p className="phar-hint">💡 Évite 123456, 000000, 111111 et autres PIN évidents</p>
            </div>

            <div className="phar-field">
              <label className="phar-label">Confirme le nouveau PIN (6 chiffres)</label>
              <input
                className="phar-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                placeholder="••••••"
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

        {/* ── IMAGES ── */}
        <div className="phar-card">
          <div className="phar-card-title">🖼️ Images de ta pharmacie</div>

          {/* Logo */}
          <div className="phar-field">
            <label className="phar-label">Logo (carré 400×400 idéal)</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{
                width: 80, height: 80, borderRadius: 12, background: '#F4F4F2',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
                border: logoBroken ? '2px solid #D9342B' : '1px solid #EEE',
              }}>
                {form.logo && !logoBroken ? (
                  <img
                    src={form.logo}
                    alt="logo"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={() => setLogoBroken(true)}
                  />
                ) : (
                  <span style={{ fontSize: 28 }}>🏥</span>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <input
                  className="phar-input"
                  value={form.logo}
                  onChange={handleChange('logo')}
                  placeholder="https://exemple.com/logo.jpg"
                />
                {logoBroken && (
                  <p className="phar-hint" style={{ color: '#D9342B' }}>
                    ⚠️ Image introuvable — vérifie l'URL
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Cover */}
          <div className="phar-field">
            <label className="phar-label">Image de couverture (bandeau page détail)</label>
            <div style={{
              width: '100%', height: 140, borderRadius: 12,
              background: form.cover && !coverBroken ? 'transparent' : 'linear-gradient(135deg, #1F8B4C 0%, #166635 100%)',
              overflow: 'hidden',
              border: coverBroken ? '2px solid #D9342B' : '1px solid #EEE',
              marginBottom: 8,
            }}>
              {form.cover && !coverBroken ? (
                <img
                  src={form.cover}
                  alt="cover"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={() => setCoverBroken(true)}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 600 }}>
                  Aperçu de la couverture
                </div>
              )}
            </div>
            <input
              className="phar-input"
              value={form.cover}
              onChange={handleChange('cover')}
              placeholder="https://exemple.com/cover.jpg"
            />
            {coverBroken && (
              <p className="phar-hint" style={{ color: '#D9342B' }}>
                ⚠️ Image introuvable — vérifie l'URL
              </p>
            )}
          </div>

          {/* Suggestions Unsplash */}
          <div className="phar-field">
            <label className="phar-label">💡 Pas d'image ? Choisis une suggestion</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {UNSPLASH_SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => applySuggestion(s)}
                  style={{
                    border: '1px solid #DDD',
                    borderRadius: 10,
                    padding: 6,
                    background: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    width: 96,
                    fontFamily: 'inherit',
                  }}
                  title={`Appliquer "${s.label}"`}
                >
                  <img
                    src={s.logo}
                    alt={s.label}
                    style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6 }}
                    loading="lazy"
                  />
                  <span style={{ fontSize: 11, color: '#1A1A1A', fontWeight: 600 }}>{s.label}</span>
                </button>
              ))}
            </div>
            <p className="phar-hint">📷 Photos libres de droits Unsplash — remplaçables plus tard</p>
          </div>
        </div>

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
          YARAM · Dashboard Pharmacie
        </p>
      </div>
    </div>
  );
}
