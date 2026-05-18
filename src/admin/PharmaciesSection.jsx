import { useState, useEffect } from 'react';
import { supabase, adminSetPharmacyPin } from '../lib/supabase';
import { getAdminSession } from '../lib/adminAuth';
import { toast, confirmDialog } from '../lib/toast';

export default function PharmaciesSection() {
  const [pharmacies, setPharmacies] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showInventory, setShowInventory] = useState(null);

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    // ⚠️ Select EXPLICITE (pas de *) : la colonne `pin` n'est pas SELECTable
    // pour le role anon (cf migration GRANT SELECT). Si on faisait *, Postgres
    // refuse toute la query car * demande la permission sur toutes les colonnes.
    const { data, error } = await supabase
      .from('pharmacies')
      .select('id, name, tagline, owner_name, manager_name, city, neighborhood, address, lat, lng, phone, whatsapp, hours, delivery_hours, logo, cover, description, commission, active, rating, review_count, pin_set_at, created_at, updated_at, notification_email, notification_phone')
      .order('created_at', { ascending: false });
    if (error) console.warn('[PharmaciesSection] fetch error:', error.message);
    setPharmacies(data || []);
    setLoading(false);
  };

  const handleSave = async (p) => {
    if (p.id) {
      // Update : champs non-PIN via UPDATE direct (OK car write n'est pas restreinte
      // par notre GRANT — qui ne touche que SELECT).
      const payload = {
        name: p.name, owner_name: p.owner_name, address: p.address,
        city: p.city, neighborhood: p.neighborhood, phone: p.phone,
        whatsapp: p.whatsapp, lat: p.lat ? parseFloat(p.lat) : null,
        lng: p.lng ? parseFloat(p.lng) : null,
        hours: p.hours, commission: parseFloat(p.commission || 8),
        active: p.active, logo: p.logo, cover: p.cover, tagline: p.tagline,
      };
      const { error } = await supabase.from('pharmacies').update(payload).eq('id', p.id);
      if (error) { toast.error('Erreur update : ' + error.message); return; }

      // Si l'admin a tape un nouveau PIN, on passe par la RPC securisee qui
      // verifie le role caller (admin ou super_admin uniquement).
      if (p._resetPin && p._resetPin.trim()) {
        const session = getAdminSession();
        const result = await adminSetPharmacyPin(session?.id, p.id, p._resetPin.trim());
        if (!result.success) {
          toast.error('Erreur reset PIN : ' + (result.error || 'inconnue'));
          return;
        }
        toast.success(`PIN réinitialisé pour ${p.name}`);
      }
    } else {
      // Insert : on garde le pin (0000 par defaut) pour la 1ere connexion staff.
      // pin_set_at reste null tant que la pharmacie n'a pas choisi son propre PIN.
      // eslint-disable-next-line no-unused-vars
      const { _resetPin, ...rest } = p;
      const { error } = await supabase.from('pharmacies').insert({
        ...rest,
        lat: p.lat ? parseFloat(p.lat) : null,
        lng: p.lng ? parseFloat(p.lng) : null,
        commission: parseFloat(p.commission || 8),
      });
      if (error) { toast.error('Erreur création : ' + error.message); return; }
    }
    setEditing(null);
    refresh();
  };

  const handleDelete = async (id) => {
    if (!await confirmDialog('Supprimer cette pharmacie ?')) return;
    await supabase.from('pharmacies').delete().eq('id', id);
    refresh();
  };

  const handleNew = () => {
    setEditing({
      name: '', owner_name: '', address: '', city: 'Dakar', neighborhood: '',
      phone: '', whatsapp: '', lat: '', lng: '',
      hours: '8h-20h', pin: '0000', commission: 8, active: true,
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
                  <div>👤 {p.owner_name || '—'}</div>
                  <div>📞 {p.phone || '—'}</div>
                  <div>💬 {p.whatsapp || '—'}</div>
                  <div>🕐 {p.hours || '—'}</div>
                  <div>💰 Commission {p.commission || 8}%</div>
                  <div>🔐 {p.pin_set_at ? 'PIN défini' : 'PIN par défaut (0000)'}</div>
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
      toast.error('Nom et ville requis');
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
          <label>Propriétaire<input value={p.owner_name || ''} onChange={e => upd('owner_name', e.target.value)} placeholder="Dr. Aïssatou Diop" /></label>
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
          {!p.id ? (
            <label>PIN d'accès staff initial<input value={p.pin || ''} onChange={e => upd('pin', e.target.value)} placeholder="0000" maxLength={6} /></label>
          ) : (
            <label>
              Réinitialiser le PIN (laisse vide pour ne pas changer)
              <input
                value={p._resetPin || ''}
                onChange={e => upd('_resetPin', e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Tape un nouveau PIN…"
                maxLength={6}
                type="password"
                inputMode="numeric"
              />
              <small style={{ display: 'block', marginTop: 4, color: '#9B9B9B', fontSize: 11 }}>
                {p.pin_set_at ? `PIN actuel défini le ${new Date(p.pin_set_at).toLocaleDateString('fr-FR')}` : 'PIN jamais personnalisé (0000)'}
              </small>
            </label>
          )}
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
    toast.success('Stock enregistré ✅');
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
