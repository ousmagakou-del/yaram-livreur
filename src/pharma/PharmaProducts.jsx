import { useState, useEffect, useRef } from 'react';
import { supabase, uploadProductImage, getAllBrands } from '../lib/supabase';
import './PharmaProducts.css';

const CATEGORIES = [
  { id: 'serum', label: '💧 Sérums' },
  { id: 'hydratant', label: '🌸 Hydratants' },
  { id: 'nettoyant', label: '🧼 Nettoyants' },
  { id: 'protection', label: '☀️ Solaires' },
  { id: 'exfoliant', label: '✨ Exfoliants' },
  { id: 'masque', label: '🎭 Masques' },
  { id: 'creme', label: '🧴 Crèmes' },
  { id: 'huile', label: '💛 Huiles' },
  { id: 'lèvres', label: '💋 Lèvres' },
  { id: 'autre', label: '📦 Autre' },
];

export default function PharmaProducts({ pharmacyId, pharmacyName }) {
  const [myProducts, setMyProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    refresh();
    (async () => {
      const b = await getAllBrands();
      setBrands(b);
    })();
  }, []);

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('submitted_by_pharmacy_id', pharmacyId)
      .order('created_at', { ascending: false });
    setMyProducts(data || []);
    setLoading(false);
  };

  const handleSave = async (product) => {
    const data = {
      ...product,
      submitted_by_pharmacy_id: pharmacyId,
      status: 'pending',
      active: false,
    };
    
    if (editing?.id) {
      await supabase.from('products').update(data).eq('id', editing.id);
    } else {
      await supabase.from('products').insert(data);
    }
    
    setShowForm(false);
    setEditing(null);
    refresh();
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette proposition ?')) return;
    await supabase.from('products').delete().eq('id', id);
    refresh();
  };

  const filtered = filter === 'all' ? myProducts : myProducts.filter(p => p.status === filter);

  return (
    <div className="ph-section">
      <header className="ph-header">
        <h1>📦 Mes produits</h1>
        <p>Propose des produits à ajouter au catalogue YARAM</p>
      </header>

      <div className="ph-filters">
        <button className={`ph-filter ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          Tous ({myProducts.length})
        </button>
        <button className={`ph-filter ${filter === 'pending' ? 'active' : ''}`} onClick={() => setFilter('pending')}>
          ⏳ En attente ({myProducts.filter(p => p.status === 'pending').length})
        </button>
        <button className={`ph-filter ${filter === 'approved' ? 'active' : ''}`} onClick={() => setFilter('approved')}>
          ✅ Validés ({myProducts.filter(p => p.status === 'approved').length})
        </button>
        <button className={`ph-filter ${filter === 'rejected' ? 'active' : ''}`} onClick={() => setFilter('rejected')}>
          ❌ Refusés ({myProducts.filter(p => p.status === 'rejected').length})
        </button>
      </div>

      <button className="ph-btn-add" onClick={() => { setEditing(null); setShowForm(true); }}>
        + Proposer un nouveau produit
      </button>

      {showForm && (
        <ProductForm
          product={editing || {}}
          brands={brands}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {loading ? (
        <p style={{ textAlign: 'center', padding: 40 }}>Chargement…</p>
      ) : filtered.length === 0 ? (
        <div className="ph-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>📦</div>
          <p>Aucun produit dans cette catégorie</p>
        </div>
      ) : (
        <div className="ph-products-grid">
          {filtered.map(p => (
            <div key={p.id} className="ph-product-card">
              <img
                src={p.image_url || `https://placehold.co/300x300/F4F4F2/9B9B9B/png?text=${encodeURIComponent(p.name?.substring(0, 20) || '?')}`}
                alt={p.name}
                onError={(e) => { e.target.src = `https://placehold.co/300x300/F4F4F2/9B9B9B/png?text=${encodeURIComponent(p.name?.substring(0, 15) || '?')}`; }}
              />
              <div className="ph-product-info">
                <div className="ph-product-head">
                  <strong>{p.name}</strong>
                  <span className={`ph-status ph-status-${p.status}`}>
                    {p.status === 'pending' && '⏳ En attente'}
                    {p.status === 'approved' && '✅ Validé'}
                    {p.status === 'rejected' && '❌ Refusé'}
                  </span>
                </div>
                <p className="ph-product-meta">{p.brand_name} · {p.category}</p>
                <p className="ph-product-price">{p.price?.toLocaleString('fr-FR')} FCFA</p>
                {p.status === 'rejected' && p.rejection_reason && (
                  <p className="ph-rejection">⚠️ {p.rejection_reason}</p>
                )}
                <div className="ph-product-actions">
                  {p.status === 'pending' && (
                    <button className="ph-mini-btn" onClick={() => { setEditing(p); setShowForm(true); }}>✏️ Modifier</button>
                  )}
                  {p.status !== 'approved' && (
                    <button className="ph-mini-btn ph-mini-btn-danger" onClick={() => handleDelete(p.id)}>🗑️ Supprimer</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductForm({ product, brands, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: product.name || '',
    brand_name: product.brand_name || '',
    category: product.category || 'serum',
    description: product.description || '',
    ingredients: product.ingredients || '',
    price: product.price || '',
    image_url: product.image_url || '',
    ...product,
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadProductImage(file);
      if (url) {
        setForm(f => ({ ...f, image_url: url }));
      } else {
        alert('Erreur upload. Réessaie.');
      }
    } catch (err) {
      console.error(err);
      alert('Erreur : ' + err.message);
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { alert('Nom du produit requis'); return; }
    if (!form.price || form.price <= 0) { alert('Prix requis'); return; }
    setSaving(true);
    const data = { ...form, price: parseInt(form.price) };
    delete data.created_at;
    delete data.updated_at;
    delete data.status;
    delete data.rejection_reason;
    await onSave(data);
    setSaving(false);
  };

  return (
    <div className="ph-modal-overlay" onClick={onCancel}>
      <div className="ph-modal" onClick={e => e.stopPropagation()}>
        <h3>{product.id ? '✏️ Modifier' : '📦 Nouveau produit'}</h3>
        <p style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 16 }}>
          Le produit sera vérifié par YARAM avant d'apparaître dans le catalogue
        </p>

        {/* PHOTO UPLOAD */}
        <div className="ph-photo-section">
          <h4>📷 Photo du produit</h4>
          {form.image_url ? (
            <div className="ph-photo-preview">
              <img src={form.image_url} alt="Produit" />
              <button className="ph-photo-remove" onClick={() => setForm({...form, image_url: ''})}>🗑️</button>
            </div>
          ) : (
            <div className="ph-photo-empty">
              <div style={{ fontSize: 36, opacity: 0.3 }}>📸</div>
              <p>Ajoute une photo claire du produit</p>
            </div>
          )}

          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
          <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />

          <div className="ph-photo-buttons">
            <button className="ph-photo-btn" onClick={() => cameraInputRef.current?.click()} disabled={uploading}>
              📷 Prendre photo
            </button>
            <button className="ph-photo-btn" onClick={() => galleryInputRef.current?.click()} disabled={uploading}>
              🖼️ Choisir
            </button>
          </div>
          {uploading && <p style={{ fontSize: 11, color: '#F4B53A', textAlign: 'center', marginTop: 6 }}>⏳ Upload en cours...</p>}
        </div>

        <label>Nom du produit *
          <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ex: Sérum Niacinamide 10%" />
        </label>

        <label>Marque
          <input value={form.brand_name} onChange={e => setForm({...form, brand_name: e.target.value})} placeholder="Ex: The Ordinary, La Roche-Posay" list="brands-list" />
          <datalist id="brands-list">
            {brands.map(b => <option key={b.id} value={b.name} />)}
          </datalist>
        </label>

        <label>Catégorie
          <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>

        <label>Prix (FCFA) *
          <input type="number" value={form.price} onChange={e => setForm({...form, price: e.target.value})} placeholder="8500" />
        </label>

        <label>Description courte
          <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2}
            placeholder="Action : éclaircit, hydrate, etc." />
        </label>

        <label>Ingrédients clés
          <textarea value={form.ingredients} onChange={e => setForm({...form, ingredients: e.target.value})} rows={3}
            placeholder="Niacinamide 10%, Zinc 1%, Acide Hyaluronique..." />
          <p style={{ fontSize: 10, color: '#6B6B6B', marginTop: 4 }}>
            💡 Important pour les recommandations IA
          </p>
        </label>

        <div className="ph-form-actions">
          <button className="ph-btn-sec" onClick={onCancel}>Annuler</button>
          <button className="ph-btn-pri" onClick={handleSubmit} disabled={saving || uploading}>
            {saving ? 'Envoi...' : '📤 Proposer le produit'}
          </button>
        </div>
      </div>
    </div>
  );
}
