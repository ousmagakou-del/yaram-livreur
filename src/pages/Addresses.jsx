import { useState } from 'react';
import { useNav, useUser } from '../App';
import { getMyAddresses, saveAddress, deleteAddress, setDefaultAddress } from '../lib/supabase';
import { usePersistedData } from '../lib/usePersistedData';
import { haptic } from '../lib/haptic';
import { toast, confirmDialog } from '../lib/toast';
import './Addresses.css';

const PRESET_ICONS = [
  { icon: '🏠', label: 'Domicile' },
  { icon: '🏢', label: 'Bureau' },
  { icon: '👨‍👩‍👧', label: 'Famille' },
  { icon: '💕', label: 'Conjoint·e' },
  { icon: '📍', label: 'Autre' },
];

export default function Addresses() {
  const { navigate } = useNav();
  const { user } = useUser();
  const [editing, setEditing] = useState(null); // null | {id, label, ...}

  // FIX juin 2026 : usePersistedData → hydrate depuis cache au remount.
  // Plus de skeleton 1-3s au retour de navigation.
  const { data: addressesData, loading, refresh: refreshAddresses } = usePersistedData(
    `addresses-${user?.id || 'anon'}`,
    async () => {
      const list = await getMyAddresses();
      return list || [];
    },
    { ttl: 5 * 60 * 1000, enabled: !!user?.id }
  );
  const addresses = addressesData || [];

  const refresh = async () => {
    await refreshAddresses();
  };

  const handleNew = () => {
    setEditing({
      id: null,
      label: 'Domicile',
      icon: '🏠',
      name: (user?.first_name || '') + ' ' + (user?.last_name || ''),
      phone: user?.phone || '',
      city: user?.city || 'Dakar',
      neighborhood: user?.neighborhood || '',
      line: '',
      is_default: addresses.length === 0,
    });
  };

  const handleSave = async (addr) => {
    if (!addr.label.trim() || !addr.city.trim() || !addr.line.trim()) {
      toast.error('Remplis les champs requis');
      return;
    }
    haptic('success');
    await saveAddress(addr);
    setEditing(null);
    await refresh();
  };

  const handleDelete = async (id) => {
    if (!(await confirmDialog('Supprimer cette adresse ?', { confirmLabel: 'Supprimer', danger: true }))) return;
    await deleteAddress(id);
    await refresh();
  };

  const handleSetDefault = async (id) => {
    haptic('light');
    await setDefaultAddress(id);
    await refresh();
  };

  if (editing) {
    return <AddressEditor address={editing} onSave={handleSave} onCancel={() => setEditing(null)} />;
  }

  return (
    <div className="addr-screen page-anim">
      <div className="addr-header">
        <button className="icon-back-btn" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div style={{flex: 1}}>
          <h1>Mes adresses</h1>
          <p>{addresses.length} adresse{addresses.length > 1 ? 's' : ''} enregistrée{addresses.length > 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="addr-scroll">
        {loading ? (
          /* PERF : skeleton rows pour addresses */
          <div style={{ padding: '12px 16px' }}>
            {[0, 1, 2].map((i) => (
              <div key={'sk-' + i} className="skeleton-card">
                <div className="skeleton-line" style={{ width: '70%' }} />
                <div className="skeleton-line" style={{ width: '50%' }} />
                <div className="skeleton-line" style={{ width: '35%', marginBottom: 0 }} />
              </div>
            ))}
          </div>
        ) : addresses.length === 0 ? (
          <div className="addr-empty">
            <div style={{fontSize: 64, opacity: 0.2}}>📍</div>
            <h3>Aucune adresse</h3>
            <p>Ajoute ta première adresse de livraison</p>
          </div>
        ) : (
          addresses.map(a => (
            <div key={a.id} className={`addr-card ${a.is_default ? 'default' : ''}`}>
              <div className="addr-card-head">
                <span className="addr-icon">{a.icon}</span>
                <div style={{flex: 1}}>
                  <strong>{a.label}</strong>
                  {a.is_default && <span className="addr-default-badge">Par défaut</span>}
                </div>
              </div>
              <p className="addr-line">{a.line}</p>
              <p className="addr-meta">
                {a.neighborhood ? `${a.neighborhood}, ` : ''}{a.city}
              </p>
              {a.phone && <p className="addr-meta">📞 {a.phone}</p>}

              <div className="addr-actions">
                {!a.is_default && (
                  <button className="addr-btn" onClick={() => handleSetDefault(a.id)}>
                    ⭐ Définir par défaut
                  </button>
                )}
                <button className="addr-btn" onClick={() => setEditing(a)}>
                  ✏️ Modifier
                </button>
                <button className="addr-btn danger" onClick={() => handleDelete(a.id)}>
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}

        <button className="addr-add-btn" onClick={handleNew}>
          <span style={{fontSize: 20}}>+</span>
          <span>Ajouter une adresse</span>
        </button>

        <div style={{height: 30}} />
      </div>
    </div>
  );
}

function AddressEditor({ address, onSave, onCancel }) {
  const [a, setA] = useState(address);
  const [saving, setSaving] = useState(false);

  const update = (k, v) => setA({ ...a, [k]: v });

  const detectLocation = async () => {
    if (!navigator.geolocation) {
      toast.error('Géolocalisation non disponible');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&zoom=18&addressdetails=1`);
          const data = await r.json();
          const addr = data.address || {};
          update('city', addr.city || addr.town || addr.village || 'Dakar');
          update('neighborhood', addr.suburb || addr.neighbourhood || '');
          update('line', data.display_name?.split(',').slice(0, 2).join(',') || '');
        } catch {
          toast.error('Impossible de détecter la position');
        }
      },
      () => toast.error('Permission de localisation refusée'),
    );
  };

  const handleSubmit = async () => {
    // ─── FIX SPINNER BLOQUE ───
    // Avant : si onSave rejette (réseau, RLS, validation côté parent), setSaving(false)
    // n'était jamais appelé → bouton "Enregistrer" coincé en "Enregistrement..."
    // pour toujours. Maintenant : try/finally garantit le reset, et un toast
    // explique l'erreur à la cliente.
    setSaving(true);
    try {
      await onSave(a);
    } catch (e) {
      console.warn('[Addresses] save failed:', e?.message);
      toast.error(e?.message || 'Impossible d\'enregistrer l\'adresse. Réessaie.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="addr-screen page-anim">
      <div className="addr-header">
        <button className="icon-back-btn" onClick={onCancel}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <h1>{address.id ? 'Modifier' : 'Nouvelle adresse'}</h1>
      </div>

      <div className="addr-scroll" style={{paddingBottom: 90}}>
        <div className="addr-icon-picker">
          {PRESET_ICONS.map(p => (
            <button
              key={p.label}
              className={`addr-icon-choice ${a.icon === p.icon ? 'active' : ''}`}
              onClick={() => { update('icon', p.icon); update('label', p.label); }}
            >
              <span style={{fontSize: 22}}>{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        <button className="addr-detect" onClick={detectLocation}>
          📍 Détecter ma position automatiquement
        </button>

        <div className="phone-input-wrap">
          <span className="phone-input-label">Nom de l'adresse *</span>
          <input className="phone-input" value={a.label} onChange={e => update('label', e.target.value)} placeholder="Domicile, Bureau, Maman..." />
        </div>
        <div className="phone-input-wrap">
          <span className="phone-input-label">Nom du destinataire</span>
          <input className="phone-input" value={a.name} onChange={e => update('name', e.target.value)} />
        </div>
        <div className="phone-input-wrap">
          <span className="phone-input-label">Téléphone</span>
          <input className="phone-input" value={a.phone} onChange={e => update('phone', e.target.value)} placeholder="+221..." />
        </div>
        <div className="phone-input-wrap">
          <span className="phone-input-label">Ville *</span>
          <input className="phone-input" value={a.city} onChange={e => update('city', e.target.value)} />
        </div>
        <div className="phone-input-wrap">
          <span className="phone-input-label">Quartier</span>
          <input className="phone-input" value={a.neighborhood} onChange={e => update('neighborhood', e.target.value)} placeholder="Almadies, Plateau..." />
        </div>
        <div className="phone-input-wrap">
          <span className="phone-input-label">Adresse exacte *</span>
          <input className="phone-input" value={a.line} onChange={e => update('line', e.target.value)} placeholder="Rue, n°, repères..." />
        </div>

        <label className="addr-default-toggle">
          <input
            type="checkbox"
            checked={a.is_default}
            onChange={e => update('is_default', e.target.checked)}
          />
          <span>⭐ Adresse par défaut pour la livraison</span>
        </label>
      </div>

      <div className="addr-cta">
        <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}