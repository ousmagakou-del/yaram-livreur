import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const TEMPLATES = [
  { id: 'welcome', label: '🎁 Bienvenue', text: 'Salut {name} 👋 Bienvenue chez YARAM ! Avec le code BIENVENUE tu as -10% sur ta 1ère commande. https://yaram.pages.dev' },
  { id: 'promo', label: '🔥 Promo flash', text: 'Hey {name} ✨ Flash promo : -15% sur tout avec le code YARAM15. Profite vite : https://yaram.pages.dev' },
  { id: 'abandoned', label: '🛒 Panier abandonné', text: 'Coucou {name} 💚 On a remarqué que tu as laissé des produits dans ton panier. Ils t\'attendent ! https://yaram.pages.dev' },
  { id: 'new_product', label: '🆕 Nouveau produit', text: 'Hey {name} ! On vient d\'ajouter de nouveaux produits validés pour ta peau {skinType}. Découvre-les : https://yaram.pages.dev' },
  { id: 'reactivation', label: '💌 Re-engagement', text: 'Salut {name}, ça fait un moment ! Profite de -20% avec le code COMEBACK20. https://yaram.pages.dev' },
];

export default function MarketingSection() {
  const [users, setUsers] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('welcome');
  const [customMessage, setCustomMessage] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [filterSkin, setFilterSkin] = useState('all');
  const [filterCity, setFilterCity] = useState('all');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('users_profile').select('*');
      setUsers(data || []);
    })();
  }, []);

  const template = TEMPLATES.find(t => t.id === selectedTemplate);
  const message = customMessage || template?.text || '';

  let filtered = users;
  if (filterSkin !== 'all') filtered = filtered.filter(u => u.skin_type === filterSkin);
  if (filterCity !== 'all') filtered = filtered.filter(u => u.city === filterCity);

  const cities = ['all', ...new Set(users.map(u => u.city).filter(Boolean))];
  const skinTypes = ['all', 'mixte', 'sèche', 'grasse', 'normale', 'sensible'];

  const toggleUser = (id) => {
    setSelectedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAll = () => {
    setSelectedUsers(filtered.map(u => u.id));
  };

  const sendWhatsApp = (u) => {
    const personalizedMsg = message
      .replace(/{name}/g, u.first_name || 'toi')
      .replace(/{skinType}/g, u.skin_type || '');
    const phone = (u.phone || '').replace(/\D/g, '');
    if (!phone) {
      alert('Pas de numéro pour ' + u.first_name);
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(personalizedMsg)}`, '_blank');
  };

  const sendAll = () => {
    const targets = filtered.filter(u => selectedUsers.includes(u.id));
    if (targets.length === 0) return alert('Sélectionne au moins une cliente');
    if (!confirm(`Envoyer ${targets.length} messages WhatsApp ?`)) return;
    targets.forEach((u, i) => setTimeout(() => sendWhatsApp(u), i * 500));
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Marketing</h1>
          <p>Campagnes WhatsApp ciblées</p>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="adm-recent-card">
          <h3>📝 Message</h3>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>Template</span>
            <select
              value={selectedTemplate}
              onChange={e => { setSelectedTemplate(e.target.value); setCustomMessage(''); }}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }}
            >
              {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>

          <label>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>Texte (personnalisable)</span>
            <textarea
              value={message}
              onChange={e => setCustomMessage(e.target.value)}
              rows={6}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', fontSize: 13, marginTop: 4 }}
            />
          </label>
          <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 6 }}>
            Variables : <code>{`{name}`}</code> = prénom · <code>{`{skinType}`}</code> = type peau
          </p>
        </div>

        <div className="adm-recent-card">
          <h3>🎯 Cible</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <label style={{ flex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>Type peau</span>
              <select value={filterSkin} onChange={e => setFilterSkin(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }}>
                {skinTypes.map(s => <option key={s} value={s}>{s === 'all' ? 'Tous' : s}</option>)}
              </select>
            </label>
            <label style={{ flex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>Ville</span>
              <select value={filterCity} onChange={e => setFilterCity(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }}>
                {cities.map(c => <option key={c} value={c}>{c === 'all' ? 'Toutes' : c}</option>)}
              </select>
            </label>
          </div>
          <p style={{ fontSize: 13, color: '#1F8B4C', fontWeight: 700 }}>
            {filtered.length} clientes correspondent · {selectedUsers.length} sélectionnées
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="adm-btn-sec" onClick={selectAll}>Tout sélectionner</button>
            <button className="adm-btn-sec" onClick={() => setSelectedUsers([])}>Désélectionner</button>
            <button className="adm-btn-pri" onClick={sendAll}>💬 Envoyer aux {selectedUsers.length}</button>
          </div>
        </div>
      </div>

      <div className="adm-recent-card" style={{ marginTop: 16 }}>
        <h3>👥 Liste des clientes</h3>
        <table className="adm-table">
          <thead>
            <tr>
              <th></th>
              <th>Cliente</th>
              <th>Téléphone</th>
              <th>Peau</th>
              <th>Ville</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id}>
                <td><input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={() => toggleUser(u.id)} /></td>
                <td><strong>{u.first_name} {u.last_name}</strong></td>
                <td>{u.phone || '—'}</td>
                <td>{u.skin_type ? <span className="adm-badge good">{u.skin_type}</span> : '—'}</td>
                <td>{u.city || '—'}</td>
                <td><button className="adm-btn-sec" onClick={() => sendWhatsApp(u)}>💬</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
