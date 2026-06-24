// src/admin/InventorySection.jsx
// ─────────────────────────────────────────────────────────────────────────────
// YARAM — Admin · Inventaire global
// ─────────────────────────────────────────────────────────────────────────────
// Vue cross-pharmacies du stock :
//   • 5 KPI top  (pharmacies, en stock, faible, rupture, valeur totale)
//   • Table summary par pharmacie  (admin_pharmacy_inventory_summary)
//   • Détail inline éditable     (admin_list_all_inventory + admin_set_stock)
//   • Bulk restock +N             (admin_bulk_restock)
//
// Toutes les écritures passent par des RPC SECURITY DEFINER côté DB.
// Pas de touche directe sur la table `inventory`.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { toast, confirmDialog } from '../lib/toast';

const FILTERS = [
  { key: 'all',        label: 'Tout',     pillClass: '' },
  { key: 'in_stock',   label: 'En stock', pillClass: 'good' },
  { key: 'low',        label: 'Faible',   pillClass: 'warn' },
  { key: 'out',        label: 'Rupture',  pillClass: 'bad' },
];

const fmtFCFA = (n) => (Number(n) || 0).toLocaleString('fr-FR') + ' FCFA';

const ago = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1)    return 'à l’instant';
  if (diffMin < 60)   return `il y a ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24)         return `il y a ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 30)      return `il y a ${days} j`;
  return d.toLocaleDateString('fr-FR');
};

const statusPill = (it) => {
  const stock = Number(it.stock_quantity ?? it.stock ?? 0);
  const thr   = Number(it.threshold ?? 5);
  if (stock <= 0)      return { label: 'Rupture',   cls: 'bad'  };
  if (stock <= thr)    return { label: 'Faible',    cls: 'warn' };
  return                    { label: 'En stock',   cls: 'good' };
};

export default function InventorySection() {
  const [stats,      setStats]      = useState(null);
  const [perPharma,  setPerPharma]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [detail,     setDetail]     = useState(null);   // pharmacy row when viewing detail

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, perPharmaRes] = await Promise.all([
        supabase.rpc('admin_inventory_global_stats'),
        supabase.rpc('admin_pharmacy_inventory_summary'),
      ]);
      if (statsRes.error)     console.warn('[InventorySection] global_stats:', statsRes.error.message);
      if (perPharmaRes.error) console.warn('[InventorySection] per_pharma:',   perPharmaRes.error.message);
      setStats(statsRes.data || null);
      setPerPharma(Array.isArray(perPharmaRes.data) ? perPharmaRes.data : []);
    } catch (e) {
      console.warn('[InventorySection] refresh failed:', e?.message);
      toast.error('Erreur chargement inventaire');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (detail) {
    return (
      <InventoryDetail
        pharmacy={detail}
        onClose={() => { setDetail(null); refresh(); }}
      />
    );
  }

  // KPI extraction — la RPC peut renvoyer une row ou {row}, on gère les 2.
  const s = Array.isArray(stats) ? (stats[0] || {}) : (stats || {});
  const kpis = [
    { label: 'PHARMACIES',        value: s.pharmacies_count    ?? s.pharmacies    ?? 0, color: '#1F2937' },
    { label: 'PRODUITS EN STOCK', value: s.in_stock_count      ?? s.in_stock      ?? 0, color: '#1F8B4C' },
    { label: 'STOCK FAIBLE',      value: s.low_stock_count     ?? s.low           ?? 0, color: '#D97706' },
    { label: 'RUPTURE',           value: s.out_of_stock_count  ?? s.out_of_stock  ?? 0, color: '#B91C1C' },
    { label: 'VALEUR STOCK',      value: s.total_value         ?? s.value         ?? 0, color: '#1F2937', money: true },
  ];

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Inventaire global</h1>
          <p>
            {perPharma.length} pharmacie{perPharma.length > 1 ? 's' : ''}
            {loading && ' · chargement…'}
          </p>
        </div>
        <button className="adm-btn-sec" onClick={refresh} disabled={loading}>
          {loading ? '⏳' : '🔄'} Rafraîchir
        </button>
      </header>

      <div className="adm-kpi-grid">
        {kpis.map(k => (
          <div className="adm-kpi" key={k.label}>
            <div className="adm-kpi-label">{k.label}</div>
            <div className="adm-kpi-value" style={{ color: k.color }}>
              {k.money
                ? <>{Number(k.value).toLocaleString('fr-FR')}<small>FCFA</small></>
                : Number(k.value).toLocaleString('fr-FR')}
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 24, fontSize: 18 }}>Par pharmacie</h2>

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : perPharma.length === 0 ? (
        <div className="adm-empty">Aucune pharmacie avec inventaire pour l’instant.</div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Pharmacie</th>
              <th style={{ textAlign: 'right' }}>Produits</th>
              <th style={{ textAlign: 'right' }}>En stock</th>
              <th style={{ textAlign: 'right' }}>Faible</th>
              <th style={{ textAlign: 'right' }}>Rupture</th>
              <th style={{ textAlign: 'right' }}>Valeur</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {perPharma.map(row => {
              const id    = row.pharmacy_id   || row.id;
              const name  = row.pharmacy_name || row.name || '—';
              const total = row.total_products   ?? row.total       ?? 0;
              const inSt  = row.in_stock_count   ?? row.in_stock    ?? 0;
              const low   = row.low_stock_count  ?? row.low         ?? 0;
              const out   = row.out_of_stock_count ?? row.out_of_stock ?? 0;
              const value = row.total_value      ?? row.value       ?? 0;
              return (
                <tr key={id}>
                  <td><strong>{name}</strong></td>
                  <td style={{ textAlign: 'right' }}>{Number(total).toLocaleString('fr-FR')}</td>
                  <td style={{ textAlign: 'right', color: '#1F8B4C' }}>{Number(inSt).toLocaleString('fr-FR')}</td>
                  <td style={{ textAlign: 'right', color: '#D97706' }}>{Number(low).toLocaleString('fr-FR')}</td>
                  <td style={{ textAlign: 'right', color: '#B91C1C' }}>{Number(out).toLocaleString('fr-FR')}</td>
                  <td style={{ textAlign: 'right' }}>{fmtFCFA(value)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="adm-btn-sec"
                      onClick={() => setDetail({ id, name })}
                    >
                      Voir détail
                    </button>
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

// ─────────────────────────────────────────────────────────────────────────────
// Détail inventaire d'une pharmacie
// ─────────────────────────────────────────────────────────────────────────────
function InventoryDetail({ pharmacy, onClose }) {
  const [items,    setItems]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState('all');
  const [edits,    setEdits]    = useState({});         // product_id → new qty
  const [savingId, setSavingId] = useState(null);
  const [bulking,  setBulking]  = useState(false);
  const [search,   setSearch]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_all_inventory', {
        p_pharmacy_id: pharmacy.id,
        p_filter:      filter,
      });
      if (error) {
        console.warn('[InventoryDetail] list err:', error.message);
        toast.error('Erreur chargement stock');
        setItems([]);
      } else {
        setItems(Array.isArray(data) ? data : []);
        setEdits({});
      }
    } finally {
      setLoading(false);
    }
  }, [pharmacy.id, filter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(it =>
      (it.product_name || it.name || '').toLowerCase().includes(q) ||
      (it.brand || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const updateQty = (pid, v) => {
    const n = parseInt(v, 10);
    setEdits(e => ({ ...e, [pid]: Number.isFinite(n) && n >= 0 ? n : 0 }));
  };

  const saveOne = async (it) => {
    const pid = it.product_id || it.id;
    const newQty = edits[pid];
    if (newQty == null) return;
    setSavingId(pid);
    try {
      const { error } = await supabase.rpc('admin_set_stock', {
        p_pharmacy_id: pharmacy.id,
        p_product_id:  pid,
        p_quantity:    newQty,
      });
      if (error) {
        toast.error('Erreur sauvegarde : ' + error.message);
      } else {
        toast.success(`Stock mis à jour (${newQty})`);
        // refléter localement sans recharger toute la liste
        setItems(arr => arr.map(x => {
          const xpid = x.product_id || x.id;
          return xpid === pid
            ? { ...x, stock_quantity: newQty, stock: newQty, last_restocked_at: new Date().toISOString() }
            : x;
        }));
        setEdits(e => {
          const { [pid]: _, ...rest } = e;
          return rest;
        });
      }
    } finally {
      setSavingId(null);
    }
  };

  const bulkRestock = async () => {
    const amount = 50;
    if (!await confirmDialog(
      `Bulk restock : ajouter +${amount} à TOUS les produits de "${pharmacy.name}" ?\n\n` +
      `Cette action est irréversible et touche l’ensemble du catalogue de la pharmacie.`,
      { confirmLabel: 'Restock +50', danger: true }
    )) return;

    setBulking(true);
    try {
      const { data, error } = await supabase.rpc('admin_bulk_restock', {
        p_pharmacy_id: pharmacy.id,
        p_amount:      amount,
      });
      if (error) {
        toast.error('Erreur bulk restock : ' + error.message);
      } else {
        const n = Array.isArray(data) ? data.length : (data?.updated_count ?? data ?? '?');
        toast.success(`Bulk restock OK · ${n} produit${typeof n === 'number' && n > 1 ? 's' : ''} mis à jour`);
        await load();
      }
    } finally {
      setBulking(false);
    }
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <button className="adm-link" onClick={onClose}>← Retour</button>
          <h1>📦 Stock · {pharmacy.name}</h1>
          <p>
            {items.length} produit{items.length > 1 ? 's' : ''}
            {loading && ' · chargement…'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="adm-btn-sec" onClick={load} disabled={loading}>
            {loading ? '⏳' : '🔄'} Rafraîchir
          </button>
          <button className="adm-btn-pri" onClick={bulkRestock} disabled={bulking || loading}>
            {bulking ? '⏳ Restock…' : '⚡ Bulk restock +50'}
          </button>
        </div>
      </header>

      <div className="adm-filters" style={{ marginBottom: 12 }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`adm-filter ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        className="adm-search-input"
        placeholder="🔍 Filtrer par nom / marque…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="adm-empty">
          {items.length === 0
            ? 'Aucun produit dans l’inventaire de cette pharmacie.'
            : 'Aucun produit ne correspond au filtre.'}
        </div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th></th>
              <th>Produit</th>
              <th>Marque</th>
              <th style={{ textAlign: 'right' }}>Stock</th>
              <th style={{ textAlign: 'right' }}>Seuil</th>
              <th>Statut</th>
              <th>Dernier restock</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(it => {
              const pid     = it.product_id || it.id;
              const name    = it.product_name || it.name || '—';
              const brand   = it.brand || '—';
              const img     = it.image_url || it.img || '';
              const stock   = Number(it.stock_quantity ?? it.stock ?? 0);
              const thr     = Number(it.threshold ?? 5);
              const pending = edits[pid];
              const cur     = pending != null ? pending : stock;
              const dirty   = pending != null && pending !== stock;
              const pill    = statusPill({ stock_quantity: cur, threshold: thr });
              const last    = it.last_restocked_at || it.restocked_at || null;

              return (
                <tr key={pid}>
                  <td>
                    {img
                      ? <img src={img} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }} />
                      : <div style={{ width: 40, height: 40, borderRadius: 6, background: '#F1F1F1' }} />}
                  </td>
                  <td><strong>{name}</strong></td>
                  <td>{brand}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      type="number"
                      min="0"
                      value={cur}
                      onChange={e => updateQty(pid, e.target.value)}
                      style={{
                        width: 80,
                        padding: '4px 8px',
                        border: `1px solid ${dirty ? '#D97706' : '#DDD'}`,
                        borderRadius: 4,
                        textAlign: 'right',
                      }}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>{thr}</td>
                  <td><span className={`adm-badge ${pill.cls}`}>{pill.label}</span></td>
                  <td style={{ color: '#9B9B9B', fontSize: 12 }}>{ago(last)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className={dirty ? 'adm-btn-pri' : 'adm-btn-sec'}
                      onClick={() => saveOne(it)}
                      disabled={!dirty || savingId === pid}
                    >
                      {savingId === pid ? '⏳' : '💾'} Sauvegarder
                    </button>
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
