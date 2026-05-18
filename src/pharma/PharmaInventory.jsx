import { useState, useEffect } from 'react';
import { supabase, getPharmaToken } from '../lib/supabase';

export default function PharmaInventory({ pharmacyId }) {
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [showOnlyMine, setShowOnlyMine] = useState(false);

  useEffect(() => {
    refresh();
  }, [pharmacyId]);

  const refresh = async () => {
    setLoading(true);
    // Tous les produits validés du catalogue YARAM
    const { data: prods } = await supabase
      .from('products')
      .select('*')
      .or('status.eq.approved,status.is.null')
      .order('name', { ascending: true });
    
    // Inventaire actuel de cette pharmacie
    const { data: inv } = await supabase
      .from('inventory')
      .select('*')
      .eq('pharmacy_id', pharmacyId);
    
    const invMap = {};
    (inv || []).forEach(i => {
      invMap[i.product_id] = { stock: i.stock, available: i.available !== false };
    });
    
    setProducts(prods || []);
    setInventory(invMap);
    setLoading(false);
  };

  const toggleAvailable = async (productId) => {
    const current = inventory[productId] || { stock: 0, available: false };
    const newAvailable = !current.available;

    // Update local
    setInventory(prev => ({
      ...prev,
      [productId]: { ...current, available: newAvailable },
    }));

    // Vague 14 RLS : passe par pharma_upsert_inventory (token requis)
    const token = getPharmaToken();
    if (!token) return;
    await supabase.rpc('pharma_upsert_inventory', {
      p_token: token,
      p_product_id: productId,
      p_stock: current.stock,
      p_active: newAvailable,
    });
  };

  const updateStock = async (productId, stock) => {
    const current = inventory[productId] || { stock: 0, available: true };
    const newStock = Math.max(0, parseInt(stock) || 0);

    setInventory(prev => ({
      ...prev,
      [productId]: { ...current, stock: newStock, available: newStock > 0 },
    }));

    const token = getPharmaToken();
    if (!token) return;
    await supabase.rpc('pharma_upsert_inventory', {
      p_token: token,
      p_product_id: productId,
      p_stock: newStock,
      p_active: newStock > 0,
    });
  };

  const filtered = products.filter(p => {
    if (search && !p.name?.toLowerCase().includes(search.toLowerCase()) && 
        !p.brand_name?.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (category !== 'all' && p.category !== category) return false;
    if (showOnlyMine && !inventory[p.id]?.available) return false;
    return true;
  });

  const availableCount = Object.values(inventory).filter(i => i.available).length;
  const totalStock = Object.values(inventory).reduce((sum, i) => sum + (i.stock || 0), 0);

  const categories = ['all', ...new Set(products.map(p => p.category).filter(Boolean))];

  return (
    <div className="phar-section">
      <header className="phar-header">
        <div>
          <h1>📚 Inventaire</h1>
          <p>Coche les produits que tu as en stock</p>
        </div>
      </header>

      {/* KPI */}
      <div className="phar-kpi-grid">
        <div className="phar-kpi">
          <div className="phar-kpi-label">📦 Produits catalogue</div>
          <div className="phar-kpi-value">{products.length}</div>
        </div>
        <div className="phar-kpi">
          <div className="phar-kpi-label">✅ Disponibles chez moi</div>
          <div className="phar-kpi-value" style={{ color: '#1F8B4C' }}>{availableCount}</div>
        </div>
        <div className="phar-kpi">
          <div className="phar-kpi-label">📊 Stock total</div>
          <div className="phar-kpi-value">{totalStock}</div>
        </div>
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="🔍 Rechercher un produit..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 200,
            padding: '10px 14px',
            border: '1px solid #EEE',
            borderRadius: 10,
            fontSize: 13,
          }}
        />
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{
            padding: '10px 14px',
            border: '1px solid #EEE',
            borderRadius: 10,
            fontSize: 13,
            background: 'white',
          }}
        >
          {categories.map(c => (
            <option key={c} value={c}>{c === 'all' ? 'Toutes catégories' : c}</option>
          ))}
        </select>
        <label className="phar-filter" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showOnlyMine}
            onChange={e => setShowOnlyMine(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Seulement mes dispos
        </label>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', padding: 40 }}>Chargement…</p>
      ) : filtered.length === 0 ? (
        <div className="phar-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>📚</div>
          <p>Aucun produit trouvé</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(p => {
            const inv = inventory[p.id] || { stock: 0, available: false };
            return (
              <div
                key={p.id}
                style={{
                  background: 'white',
                  border: `1px solid ${inv.available ? '#E8F5EC' : '#EEE'}`,
                  borderLeft: `4px solid ${inv.available ? '#1F8B4C' : '#EEE'}`,
                  borderRadius: 12,
                  padding: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                {/* Photo */}
                <img
                  src={p.image_url || `https://placehold.co/60x60/F4F4F2/9B9B9B/png?text=?`}
                  alt={p.name}
                  style={{
                    width: 50, height: 50,
                    borderRadius: 8,
                    objectFit: 'cover',
                    background: '#F4F4F2',
                  }}
                  onError={(e) => e.target.src = `https://placehold.co/60x60/F4F4F2/9B9B9B/png?text=${encodeURIComponent(p.name?.charAt(0) || '?')}`}
                />
                
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13, display: 'block' }}>{p.name}</strong>
                  <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 2 }}>
                    {p.brand_name} · {p.category} · {p.price?.toLocaleString('fr-FR')} FCFA
                  </p>
                </div>
                
                {/* Stock input */}
                {inv.available && (
                  <input
                    type="number"
                    value={inv.stock}
                    onChange={e => updateStock(p.id, e.target.value)}
                    min="0"
                    style={{
                      width: 60,
                      padding: 6,
                      border: '1px solid #DDD',
                      borderRadius: 6,
                      textAlign: 'center',
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                    placeholder="0"
                  />
                )}
                
                {/* Toggle */}
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  gap: 8,
                  background: inv.available ? '#E8F5EC' : '#F4F4F2',
                  color: inv.available ? '#1F8B4C' : '#6B6B6B',
                  padding: '8px 14px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                }}>
                  <input
                    type="checkbox"
                    checked={inv.available}
                    onChange={() => toggleAvailable(p.id)}
                    style={{ margin: 0 }}
                  />
                  {inv.available ? '✓ Dispo' : 'Indispo'}
                </label>
              </div>
            );
          })}
        </div>
      )}

      <div className="phar-info-card" style={{ marginTop: 20, background: '#FEF6E5' }}>
        <h3>💡 Astuce</h3>
        <p>Coche les produits que tu as en stock. Quand le stock arrive à 0, le produit devient automatiquement indisponible pour les clientes.</p>
        <p>Met à jour ton stock régulièrement pour ne pas avoir à refuser de commandes.</p>
      </div>
    </div>
  );
}
