import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function PharmaciesSection() {
  const [pharmacies, setPharmacies] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showInventory, setShowInventory] = useState(null);

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    const { data } = await supabase
      .from('pharmacies')
      .select('*')
      .order('created_at', { ascending: false });
    setPharmacies(data || []);
    setLoading(false);
  };

  const handleSave = async (p) => {
    if (p.id) {
      await supabase.from('pharmacies').update({
        name: p.name, owner: p.owner, address: p.address,
        city: p.city, neighborhood: p.neighborhood, phone: p.phone,
        whatsapp: p.whatsapp, lat: p.lat ? parseFloat(p.lat) : null,
        lng: p.lng ? parseFloat(p.lng) : null,
        hours: p.hours, pin: p.pin, commission: parseFloat(p.commission || 17.5),
        active: p.active, logo: p.logo, cover: p.cover, tagline: p.tagline,
      }).eq('id', p.id);
    } else {
      await supabase.from('pharmacies').insert({
        ...p,
        lat: p.lat ? parseFloat(p.lat) : null,
        lng: p.lng ? parseFloat(p.lng) : null,
        commission: parseFloat(p.commission || 17.5),
      });
    }
    setEditing(null);
    refresh();
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette pharmacie ?')) return;
    await supabase.from('pharmacies').delete().eq('id', id);
    refresh();
  };

  const handleNew = () => {
    setEditing({
      name: '', owner: '', address: '', city: 'Dakar', neighborhood: '',
      phone: '', whatsapp: '', lat: '', lng: '',
      hours: '8h-20h', pin: '0000', commission: 17.5, active: true,
      logo: '', cover: '', tagline: '',
    });
  };

  if (editing) {
    return <PharmacyEditor pharmacy={editing} onSave={handleSave} onCancel={() => setEditing(null)} />;
  }

  if (showInventory) {
    return <InventoryEditor pharmacy={showInventory} onClose={() => setShowInventory(null)} />;
  }

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Pharmacies partenaires</h1>
          <p>{pharmacies.length} pharmacies dont {pharmacies.filter(p => p.active).length} actives</p>
        </div>
        <button className="adm-btn-pri" onClick={handleNew}>+ Nouvelle pharmacie</button>
      </header>

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : (
        <div className="adm-ph-grid">
          {pharmacies.map(p => (
            <div key={p.id} className="adm-ph-card">
              {p.cover && <div className="adm-ph-cover" style={{ backgroundImage: `url(${p.cover})` }} />}
              <div className="adm-ph-body">
                <div className="adm-ph-head">
                  {p.logo && <img src={p.logo} alt="" className="adm-ph-logo" />}
                  <div style={{ flex: 1 }}>
                    <h3>{p.name}</h3>
                    <p className="adm-ph-meta">📍 {p.neighborhood ? `${p.neighborhood}, ` : ''}{p.city}</p>
                  </div>
                  <span className={`adm-badge ${p.active ? 'good' : 'bad'}`}>
                    {p.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {p.tagline && <p className="adm-ph-tagline">{p.tagline}</p>}
                <div className="adm-ph-info">
                  <div>👤 {p.owner || '—'}</div>
                  <div>📞 {p.phone || '—'}</div>
                  <div>💬 {p.whatsapp || '—'}</div>
                  <div>🕐 {p.hours || '—'}</div>
                  <div>💰 Commission {p.commission || 17.5}%</div>
                  <div>🔐 PIN {p.pin || '—'}</div>
                </div>
                <div className="adm-ph-actions">
                  <button className="adm-btn-sec" onClick={() => setShowInventory(p)}>📦 Stock</button>
                  <button className="adm-btn-sec" onClick={() => setEditing(p)}>✏️ Éditer</button>
                  <button className="adm-btn-danger" onClick={() => handleDelete(p.id)}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PharmacyEditor({ pharmacy, onSave, onCancel }) {
  const [p, setP] = useState(pharmacy);
  const [saving, setSaving] = useState(false);
  const upd = (k, v) => setP({ ...p, [k]: v });

  const handleSubmit = async () => {
    if (!p.name?.trim() || !p.city?.trim()) {
      alert('Nom et ville requis');
      return;
    }
    setSaving(true);
    await onSave(p);
    setSaving(false);
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <button className="adm-link" onClick={onCancel}>← Retour</button>
          <h1>{pharmacy.id ? 'Modifier' : 'Nouvelle'} pharmacie</h1>
        </div>
      </header>

      <div className="adm-form-grid">
        <div className="adm-form-section">
          <h3>Informations générales</h3>
          <label>Nom *<input value={p.name} onChange={e => upd('name', e.target.value)} placeholder="Pharmacie de l'Avenue" /></label>
          <label>Propriétaire<input value={p.owner} onChange={e => upd('owner', e.target.value)} placeholder="Dr. Aïssatou Diop" /></label>
          <label>Tagline<input value={p.tagline} onChange={e => upd('tagline', e.target.value)} placeholder="Votre santé, notre priorité" /></label>
          <label className="adm-form-checkbox">
            <input type="checkbox" checked={p.active} onChange={e => upd('active', e.target.checked)} />
            <span>Pharmacie active (visible dans l'app)</span>
          </label>
        </div>

        <div className="adm-form-section">
          <h3>Localisation</h3>
          <label>Adresse<input value={p.address} onChange={e => upd('address', e.target.value)} placeholder="Rue 12, immeuble..." /></label>
          <label>Ville *<input value={p.city} onChange={e => upd('city', e.target.value)} /></label>
          <label>Quartier<input value={p.neighborhood} onChange={e => upd('neighborhood', e.target.value)} placeholder="Almadies, Plateau..." /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ flex: 1 }}>Latitude<input value={p.lat} onChange={e => upd('lat', e.target.value)} placeholder="14.7..." /></label>
            <label style={{ flex: 1 }}>Longitude<input value={p.lng} onChange={e => upd('lng', e.target.value)} placeholder="-17.4..." /></label>
          </div>
        </div>

        <div className="adm-form-section">
          <h3>Contact</h3>
          <label>Téléphone<input value={p.phone} onChange={e => upd('phone', e.target.value)} placeholder="+221 33 XXX XX XX" /></label>
          <label>WhatsApp<input value={p.whatsapp} onChange={e => upd('whatsapp', e.target.value)} placeholder="+221 78 XXX XX XX" /></label>
          <label>Horaires<input value={p.hours} onChange={e => upd('hours', e.target.value)} placeholder="8h-20h" /></label>
        </div>

        <div className="adm-form-section">
          <h3>Visuel</h3>
          <label>URL Logo<input value={p.logo} onChange={e => upd('logo', e.target.value)} placeholder="https://..." /></label>
          <label>URL Couverture<input value={p.cover} onChange={e => upd('cover', e.target.value)} placeholder="https://..." /></label>
        </div>

        <div className="adm-form-section">
          <h3>Business</h3>
          <label>Commission YARAM (%)<input type="number" step="0.1" value={p.commission} onChange={e => upd('commission', e.target.value)} /></label>
          <label>PIN d'accès staff<input value={p.pin} onChange={e => upd('pin', e.target.value)} placeholder="4 chiffres" /></label>
        </div>
      </div>

      <div className="adm-form-actions">
        <button className="adm-btn-sec" onClick={onCancel}>Annuler</button>
        <button className="adm-btn-pri" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

function InventoryEditor({ pharmacy, onClose }) {
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const [prodRes, invRes] = await Promise.all([
        supabase.from('products').select('*').order('name'),
        supabase.from('inventory').select('*').eq('pharmacy_id', pharmacy.id),
      ]);
      setProducts(prodRes.data || []);
      const inv = {};
      (invRes.data || []).forEach(i => { inv[i.product_id] = { id: i.id, stock: i.stock, active: i.active }; });
      setInventory(inv);
      setLoading(false);
    })();
  }, [pharmacy.id]);

  const updateStock = (productId, stock) => {
    setInventory({
      ...inventory,
      [productId]: { ...(inventory[productId] || { active: true }), stock: parseInt(stock) || 0 },
    });
  };

  const toggleActive = (productId) => {
    const cur = inventory[productId] || { stock: 0, active: false };
    setInventory({
      ...inventory,
      [productId]: { ...cur, active: !cur.active },
    });
  };

  const handleSave = async () => {
    for (const productId of Object.keys(inventory)) {
      const inv = inventory[productId];
      if (inv.id) {
        await supabase.from('inventory').update({
          stock: inv.stock, active: inv.active,
        }).eq('id', inv.id);
      } else if (inv.stock > 0 || inv.active) {
        await supabase.from('inventory').insert({
          pharmacy_id: pharmacy.id,
          product_id: productId,
          stock: inv.stock,
          active: inv.active,
        });
      }
    }
    alert('Stock enregistré ✅');
    onClose();
  };

  const filtered = search.trim()
    ? products.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()) || p.brand?.toLowerCase().includes(search.toLowerCase()))
    : products;

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <button className="adm-link" onClick={onClose}>← Retour</button>
          <h1>📦 Stock · {pharmacy.name}</h1>
          <p>Coche les produits disponibles et définis le stock</p>
        </div>
        <button className="adm-btn-pri" onClick={handleSave}>💾 Enregistrer</button>
      </header>

      <input
        type="text"
        className="adm-search-input"
        placeholder="🔍 Filtrer produits..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th></th>
              <th>Produit</th>
              <th>Marque</th>
              <th>Catégorie</th>
              <th>Prix</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const inv = inventory[p.id] || { stock: 0, active: false };
              return (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={inv.active}
                      onChange={() => toggleActive(p.id)}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {p.img && <img src={p.img} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }} />}
                      <strong>{p.name}</strong>
                    </div>
                  </td>
                  <td>{p.brand}</td>
                  <td>{p.category}</td>
                  <td>{p.price?.toLocaleString('fr-FR')} FCFA</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      value={inv.stock}
                      onChange={e => updateStock(p.id, e.target.value)}
                      style={{ width: 70, padding: '4px 8px', border: '1px solid #DDD', borderRadius: 4 }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
