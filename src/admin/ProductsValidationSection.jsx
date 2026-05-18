import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { promptDialog } from '../lib/toast';

export default function ProductsValidationSection() {
  const [products, setProducts] = useState([]);
  const [pharmacies, setPharmacies] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    const [pRes, phRes] = await Promise.all([
      supabase.from('products').select('*').not('submitted_by_pharmacy_id', 'is', null).order('submitted_at', { ascending: false }),
      supabase.from('pharmacies').select('id, name'),
    ]);
    setProducts(pRes.data || []);
    setPharmacies(phRes.data || []);
    setLoading(false);
  };

  const approve = async (product) => {
    await supabase.from('products').update({ status: 'approved' }).eq('id', product.id);
    refresh();
  };

  const reject = async (product) => {
    const reason = await promptDialog('Motif du rejet (sera envoyé à la pharmacie) :', {
      multiline: true,
      placeholder: 'Ex: photo floue, prix incorrect, INCI manquant...',
      confirmLabel: 'Rejeter',
      danger: true,
    });
    if (!reason) return;
    await supabase.from('products').update({ status: 'rejected', rejection_reason: reason }).eq('id', product.id);
    refresh();
  };

  const filtered = filter === 'all' ? products : products.filter(p => p.status === filter);

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>✨ Validation produits</h1>
          <p>Produits proposés par les pharmacies partenaires</p>
        </div>
      </header>

      <div className="adm-filters">
        {[
          { id: 'pending', label: '⏳ En attente' },
          { id: 'approved', label: '✅ Approuvés' },
          { id: 'rejected', label: '❌ Rejetés' },
          { id: 'all', label: 'Tous' },
        ].map(f => (
          <button key={f.id} className={`adm-filter ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label} <span className="adm-filter-count">
              {f.id === 'all' ? products.length : products.filter(p => p.status === f.id).length}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>✨</div>
          <p>Aucun produit en attente</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
          {filtered.map(p => {
            const ph = pharmacies.find(x => x.id === p.submitted_by_pharmacy_id);
            return (
              <div key={p.id} className="adm-recent-card" style={{ padding: 14 }}>
                {p.img && <img src={p.img} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <strong>{p.name}</strong>
                  <span className={`adm-badge ${p.status === 'approved' ? 'good' : p.status === 'rejected' ? 'bad' : 'medium'}`}>
                    {p.status}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: '#6B6B6B' }}>
                  {p.brand} · {p.category}
                </p>
                <p style={{ fontSize: 16, fontWeight: 700, color: '#1F8B4C', margin: '8px 0' }}>
                  {p.price?.toLocaleString('fr-FR')} FCFA
                </p>
                {p.short_desc && <p style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 6 }}>{p.short_desc}</p>}
                <p style={{ fontSize: 11, color: '#1F8B4C', fontWeight: 600 }}>
                  🏥 Proposé par {ph?.name || 'Pharmacie inconnue'}
                </p>
                <p style={{ fontSize: 10, color: '#6B6B6B' }}>
                  {new Date(p.submitted_at || p.created_at).toLocaleString('fr-FR')}
                </p>
                {p.rejection_reason && (
                  <div style={{ marginTop: 8, padding: 8, background: '#FCE9E7', color: '#D9342B', borderRadius: 6, fontSize: 11 }}>
                    ⚠️ {p.rejection_reason}
                  </div>
                )}
                {p.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                    <button className="adm-btn-pri" onClick={() => approve(p)} style={{ flex: 1 }}>✅ Approuver</button>
                    <button className="adm-btn-danger" onClick={() => reject(p)}>❌</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
