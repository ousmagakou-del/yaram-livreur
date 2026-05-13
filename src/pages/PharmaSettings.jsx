import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function PharmaSettings({ pharmacy, onUpdate }) {
  const [form, setForm] = useState({
    name: '', description: '', manager_name: '',
    address: '', city: '', neighborhood: '',
    phone: '', whatsapp: '',
    hours: '', delivery_hours: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [changingPin, setChangingPin] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');

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

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const { error } = await supabase
      .from('pharmacies')
      .update(form)
      .eq('id', pharmacy.id);
    setSaving(false);
    if (!error) {
      setSaved(true);
      // Met à jour la session
      const updated = { ...pharmacy, ...form };
      sessionStorage.setItem('diaara-pharma', JSON.stringify(updated));
      if (onUpdate) onUpdate(updated);
      setTimeout(() => setSaved(false), 3000);
    } else {
      alert('Erreur : ' + error.message);
    }
  };

  const handleChangePin = async () => {
    setPinError('');
    setPinSuccess('');
    if (oldPin !== pharmacy.pin) return setPinError('Ancien PIN incorrect');
    if (newPin.length !== 4) return setPinError('Le nouveau PIN doit faire 4 chiffres');
    if (!/^\d{4}$/.test(newPin)) return setPinError('Uniquement des chiffres');
    const banned = ['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123'];
    if (banned.includes(newPin)) return setPinError('Choisis un PIN moins évident');
    if (newPin !== confirmPin) return setPinError('Les PIN ne correspondent pas');

    const { error } = await supabase
      .from('pharmacies')
      .update({ pin: newPin, pin_set_at: new Date().toISOString() })
      .eq('id', pharmacy.id);
    if (error) return setPinError('Erreur : ' + error.message);

    const updated = { ...pharmacy, pin: newPin };
    sessionStorage.setItem('diaara-pharma', JSON.stringify(updated));
    if (onUpdate) onUpdate(updated);
    setPinSuccess('✓ PIN modifié avec succès');
    setOldPin('');
    setNewPin('');
    setConfirmPin('');
    setTimeout(() => { setChangingPin(false); setPinSuccess(''); }, 2000);
  };

  const S = {
    page: { padding: 16, paddingBottom: 80 },
    h1: { fontSize: 22, fontWeight: 800, marginBottom: 4 },
    meta: { color: '#6B6B6B', fontSize: 13, marginBottom: 20 },
    section: { background: 'white', borderRadius: 14, padding: 16, marginBottom: 12, border: '1px solid #EEE' },
    sectionTitle: { fontSize: 14, fontWeight: 800, marginBottom: 12 },
    label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 12, marginBottom: 6 },
    input: { width: '100%', padding: '10px 12px', border: '1px solid #DDD', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' },
    textarea: { width: '100%', padding: '10px 12px', border: '1px solid #DDD', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit', minHeight: 60, resize: 'vertical' },
    btn: { width: '100%', padding: 12, background: '#1F8B4C', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 14, fontFamily: 'inherit' },
    btnSec: { width: '100%', padding: 10, background: '#F4F4F2', color: '#1A1A1A', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 8, fontFamily: 'inherit' },
    btnDanger: { width: '100%', padding: 10, background: '#FCE9E7', color: '#D9342B', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 12, fontFamily: 'inherit' },
    saved: { background: '#E8F5EC', color: '#1F8B4C', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginTop: 12, fontWeight: 600, textAlign: 'center' },
    error: { background: '#FCE9E7', color: '#D9342B', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginTop: 12, fontWeight: 600 },
    row: { display: 'flex', gap: 8 },
    rowItem: { flex: 1 },
    hint: { fontSize: 11, color: '#6B6B6B', marginTop: 4, fontStyle: 'italic' },
  };

  if (changingPin) {
    return (
      <div style={S.page}>
        <h1 style={S.h1}>🔑 Modifier mon PIN</h1>
        <p style={S.meta}>Choisis un nouveau code PIN à 4 chiffres</p>

        <div style={S.section}>
          <label style={S.label}>Ancien PIN</label>
          <input
            style={S.input}
            type="password"
            inputMode="numeric"
            maxLength="4"
            value={oldPin}
            onChange={e => setOldPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
          />

          <label style={S.label}>Nouveau PIN</label>
          <input
            style={S.input}
            type="password"
            inputMode="numeric"
            maxLength="4"
            value={newPin}
            onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
          />
          <p style={S.hint}>💡 Évite 1234, 0000, etc.</p>

          <label style={S.label}>Confirme le nouveau PIN</label>
          <input
            style={S.input}
            type="password"
            inputMode="numeric"
            maxLength="4"
            value={confirmPin}
            onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
          />

          {pinError && <div style={S.error}>⚠️ {pinError}</div>}
          {pinSuccess && <div style={S.saved}>{pinSuccess}</div>}

          <button onClick={handleChangePin} style={S.btn}>Modifier mon PIN</button>
          <button onClick={() => { setChangingPin(false); setPinError(''); setOldPin(''); setNewPin(''); setConfirmPin(''); }} style={S.btnSec}>← Annuler</button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <h1 style={S.h1}>⚙️ Paramètres</h1>
      <p style={S.meta}>Gère les infos de ta pharmacie</p>

      {/* INFOS GÉNÉRALES */}
      <div style={S.section}>
        <div style={S.sectionTitle}>🏥 Infos de la pharmacie</div>

        <label style={S.label}>Nom de la pharmacie</label>
        <input style={S.input} value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ex: Pharmacie Centrale Plateau" />

        <label style={S.label}>Description courte</label>
        <textarea style={S.textarea} value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Ex: Au cœur du Plateau · spécialité dermato" />

        <label style={S.label}>Nom du gérant</label>
        <input style={S.input} value={form.manager_name} onChange={e => setForm({...form, manager_name: e.target.value})} placeholder="Ex: Dr. Mamadou Ndiaye" />
      </div>

      {/* ADRESSE */}
      <div style={S.section}>
        <div style={S.sectionTitle}>📍 Adresse</div>

        <label style={S.label}>Adresse complète</label>
        <input style={S.input} value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="Avenue Pompidou, face BICIS" />

        <div style={S.row}>
          <div style={S.rowItem}>
            <label style={S.label}>Ville</label>
            <input style={S.input} value={form.city} onChange={e => setForm({...form, city: e.target.value})} placeholder="Dakar" />
          </div>
          <div style={S.rowItem}>
            <label style={S.label}>Quartier</label>
            <input style={S.input} value={form.neighborhood} onChange={e => setForm({...form, neighborhood: e.target.value})} placeholder="Plateau" />
          </div>
        </div>
      </div>

      {/* CONTACT */}
      <div style={S.section}>
        <div style={S.sectionTitle}>📞 Contact</div>

        <label style={S.label}>Téléphone fixe</label>
        <input style={S.input} value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="+221 33 821 45 67" />

        <label style={S.label}>WhatsApp</label>
        <input style={S.input} value={form.whatsapp} onChange={e => setForm({...form, whatsapp: e.target.value})} placeholder="+221 78 612 45 67" />
        <p style={S.hint}>📲 Les clientes te contactent via ce numéro</p>
      </div>

      {/* HORAIRES */}
      <div style={S.section}>
        <div style={S.sectionTitle}>🕐 Horaires</div>

        <label style={S.label}>Horaires d'ouverture</label>
        <input style={S.input} value={form.hours} onChange={e => setForm({...form, hours: e.target.value})} placeholder="07h30 - 21h, lun-sam" />

        <label style={S.label}>Horaires de livraison</label>
        <input style={S.input} value={form.delivery_hours} onChange={e => setForm({...form, delivery_hours: e.target.value})} placeholder="09h - 18h, tous les jours" />
        <p style={S.hint}>🛵 Quand peuvent passer nos livreurs ?</p>
      </div>

      {/* BOUTON SAVE */}
      <button onClick={handleSave} disabled={saving} style={S.btn}>
        {saving ? '⏳ Sauvegarde…' : '💾 Sauvegarder les modifications'}
      </button>

      {saved && <div style={S.saved}>✓ Modifications sauvegardées</div>}

      {/* SÉCURITÉ */}
      <div style={S.section}>
        <div style={S.sectionTitle}>🔒 Sécurité</div>
        <button onClick={() => setChangingPin(true)} style={S.btnSec}>
          🔑 Modifier mon PIN
        </button>
      </div>

      <p style={{ textAlign: 'center', fontSize: 11, color: '#9B9B9B', marginTop: 20 }}>
        Diaara · Dashboard Pharmacie v1.0
      </p>
    </div>
  );
}
