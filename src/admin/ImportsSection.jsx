// ════════════════════════════════════════════════════════
// YARAM Admin — Section Imports (hub Boutique internationale)
// ════════════════════════════════════════════════════════
// Hub avec 2 onglets :
//   1. Commandes : gestion des commandes preorder (acompte → import → solde → livraison)
//   2. Produits : liste + ajout/édition des produits is_imported = true
// ════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast, confirmDialog } from '../lib/toast';
import { PREORDER_STATUS_LABELS, PREORDER_STATUS_ICONS, formatArrivalDate } from '../lib/preorder';
import { notifyPreorderStatusChange } from '../lib/preorderNotify';

const COUNTRIES = [
  { code: 'US', flag: '🇺🇸', name: 'États-Unis' },
  { code: 'FR', flag: '🇫🇷', name: 'France' },
  { code: 'UK', flag: '🇬🇧', name: 'Royaume-Uni' },
  { code: 'NG', flag: '🇳🇬', name: 'Nigeria' },
  { code: 'GH', flag: '🇬🇭', name: 'Ghana' },
  { code: 'ZA', flag: '🇿🇦', name: 'Afrique du Sud' },
  { code: 'CI', flag: '🇨🇮', name: 'Côte d\'Ivoire' },
  { code: 'KR', flag: '🇰🇷', name: 'Corée du Sud' },
  { code: 'JP', flag: '🇯🇵', name: 'Japon' },
];

export default function ImportsSection() {
  const [tab, setTab] = useState('orders'); // 'orders' | 'products'

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>✈️ Boutique internationale</h1>
          <p style={{ margin: 0, color: '#6B6B6B', fontSize: 13 }}>
            Gestion complète : commandes preorder et catalogue produits import
          </p>
        </div>
      </header>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 16px', borderBottom: '1px solid #E5E5E2', marginBottom: 14 }}>
        <button
          className={`adm-filter ${tab === 'orders' ? 'active' : ''}`}
          onClick={() => setTab('orders')}
          style={{ fontSize: 14, padding: '8px 16px' }}
        >
          🛒 Commandes
        </button>
        <button
          className={`adm-filter ${tab === 'products' ? 'active' : ''}`}
          onClick={() => setTab('products')}
          style={{ fontSize: 14, padding: '8px 16px' }}
        >
          📦 Produits Import
        </button>
      </div>

      {tab === 'orders' && <OrdersTab />}
      {tab === 'products' && <ProductsTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════
// TAB 1 — COMMANDES PREORDER (existant)
// ═══════════════════════════════════════════════
function OrdersTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('is_preorder', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setOrders(data || []);
    } catch (e) {
      console.warn('[ImportsSection] load failed:', e?.message);
      toast.error('Erreur de chargement : ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = orders.filter(o => {
    if (filter === 'all') return true;
    if (filter === 'pending') return ['pending_payment', 'paid', 'awaiting_supplier'].includes(o.status);
    if (filter === 'transit') return o.status === 'in_transit_intl';
    if (filter === 'arrived') return ['arrived_local', 'awaiting_balance'].includes(o.status);
    if (filter === 'done') return ['delivered', 'cancelled'].includes(o.status);
    return true;
  });

  const stats = orders.reduce((acc, o) => {
    acc.total++;
    if (o.deposit_paid_at) acc.depositsReceived += Number(o.deposit_amount) || 0;
    if (!o.balance_paid_at && o.status !== 'cancelled') acc.balancesAwaiting += Number(o.balance_amount) || 0;
    if (o.status === 'awaiting_supplier') acc.toOrderCount++;
    if (o.status === 'in_transit_intl') acc.inTransitCount++;
    if (o.status === 'arrived_local') acc.arrivedCount++;
    return acc;
  }, { total: 0, depositsReceived: 0, balancesAwaiting: 0, toOrderCount: 0, inTransitCount: 0, arrivedCount: 0 });

  const advance = async (orderId, newStatus, extraFields = {}, opts = {}) => {
    try {
      const update = { status: newStatus, ...extraFields };
      const { error } = await supabase
        .from('orders')
        .update(update)
        .eq('id', orderId);
      if (error) throw error;
      toast.success(`Commande ${orderId} → ${PREORDER_STATUS_LABELS[newStatus] || newStatus}`);

      if (newStatus !== 'cancelled' && !opts.skipNotify) {
        const order = orders.find(o => o.id === orderId);
        if (order) {
          const updated = { ...order, ...update };
          const res = await notifyPreorderStatusChange(updated, newStatus);
          if (res.push?.ok) toast.success('🔔 Push envoyé au client');
          if (res.whatsapp?.ok) toast.success('💬 WhatsApp envoyé au client');
        }
      }

      await load();
    } catch (e) {
      toast.error('Erreur : ' + e.message);
    }
  };

  const getNextAction = (order) => {
    switch (order.status) {
      case 'pending_payment':
        return { label: '✅ Acompte reçu', handler: () => advance(order.id, 'paid', { deposit_paid_at: new Date().toISOString() }) };
      case 'paid':
        return { label: '🛍️ Commander chez fournisseur', handler: () => advance(order.id, 'awaiting_supplier', { supplier_order_date: new Date().toISOString() }) };
      case 'awaiting_supplier':
        return { label: '✈️ Marquer en transit', handler: () => advance(order.id, 'in_transit_intl') };
      case 'in_transit_intl':
        return { label: '🇸🇳 Arrivé à Dakar', handler: () => advance(order.id, 'arrived_local', { arrived_dakar_at: new Date().toISOString() }) };
      case 'arrived_local':
        return { label: '💰 Demander solde au client', handler: () => advance(order.id, 'awaiting_balance') };
      case 'awaiting_balance':
        return { label: '✅ Solde reçu, livrer', handler: () => advance(order.id, 'shipped', { balance_paid_at: new Date().toISOString() }) };
      case 'shipped':
        return { label: '🎉 Marquer livré', handler: () => advance(order.id, 'delivered') };
      default:
        return null;
    }
  };

  if (loading) return <div style={{ padding: 40 }}>Chargement…</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, padding: '0 16px 14px' }}>
        <StatCard label="Total imports" value={stats.total} color="#0066CC" />
        <StatCard label="Acomptes encaissés" value={stats.depositsReceived.toLocaleString('fr-FR') + ' FCFA'} color="#1F8B4C" />
        <StatCard label="Soldes en attente" value={stats.balancesAwaiting.toLocaleString('fr-FR') + ' FCFA'} color="#E0A52D" />
        <StatCard label="À commander" value={stats.toOrderCount} color="#D9342B" highlight={stats.toOrderCount > 0} />
        <StatCard label="En transit" value={stats.inTransitCount} color="#9C27B0" />
        <StatCard label="Arrivés à Dakar" value={stats.arrivedCount} color="#1F8B4C" highlight={stats.arrivedCount > 0} />
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 16px 14px', overflowX: 'auto' }}>
        {[
          { id: 'all',     label: 'Tous',       count: orders.length },
          { id: 'pending', label: 'En attente', count: orders.filter(o => ['pending_payment','paid','awaiting_supplier'].includes(o.status)).length },
          { id: 'transit', label: 'En transit', count: orders.filter(o => o.status === 'in_transit_intl').length },
          { id: 'arrived', label: 'Arrivés',    count: orders.filter(o => ['arrived_local','awaiting_balance'].includes(o.status)).length },
          { id: 'done',    label: 'Terminés',   count: orders.filter(o => ['delivered','cancelled'].includes(o.status)).length },
        ].map(f => (
          <button key={f.id} className={`adm-filter ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      <div style={{ padding: '0 16px' }}>
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#6B6B6B' }}>
            Aucune commande import {filter !== 'all' && 'dans cette catégorie'}.
          </div>
        )}
        {filtered.map(o => {
          const next = getNextAction(o);
          const phone = o.address?.phone;
          return (
            <div key={o.id} style={{ background: '#fff', border: '1px solid #E5E5E2', borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <code style={{ fontSize: 12, color: '#6B6B6B' }}>{o.id}</code>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>
                    {o.address?.name || 'Client inconnu'} · {Number(o.total).toLocaleString('fr-FR')} FCFA
                  </div>
                </div>
                <div style={{ background: 'linear-gradient(135deg, #0066CC, #004999)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8 }}>
                  {PREORDER_STATUS_ICONS[o.status] || ''} {PREORDER_STATUS_LABELS[o.status] || o.status}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, fontSize: 12, color: '#6B6B6B', marginBottom: 10 }}>
                <div><strong style={{ color: '#1A1A1A' }}>Acompte (50%)</strong><br/>{Number(o.deposit_amount || 0).toLocaleString('fr-FR')} FCFA{o.deposit_paid_at && <span style={{ color: '#1F8B4C' }}> ✓</span>}</div>
                <div><strong style={{ color: '#1A1A1A' }}>Solde (50%)</strong><br/>{Number(o.balance_amount || 0).toLocaleString('fr-FR')} FCFA{o.balance_paid_at && <span style={{ color: '#1F8B4C' }}> ✓</span>}</div>
                {o.expected_arrival_date && <div><strong style={{ color: '#1A1A1A' }}>Arrivée prévue</strong><br/>{formatArrivalDate(o.expected_arrival_date)}</div>}
                <div><strong style={{ color: '#1A1A1A' }}>Items</strong><br/>{(o.items || []).length} produit(s)</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {next && <button className="adm-btn-pri" onClick={next.handler}>{next.label}</button>}
                {phone && (
                  <a href={`https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Bonjour, c'est YARAM concernant votre commande ${o.id}.`)}`} target="_blank" rel="noopener noreferrer" className="adm-btn-sec" style={{ textDecoration: 'none' }}>
                    💬 WhatsApp client
                  </a>
                )}
                {o.status !== 'cancelled' && o.status !== 'delivered' && (
                  <button className="adm-btn-sec" style={{ color: '#D9342B' }} onClick={async () => {
                    const ok = await confirmDialog({ title: 'Annuler ?', message: `Annuler la commande ${o.id} ?` });
                    if (ok) advance(o.id, 'cancelled');
                  }}>❌ Annuler</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// TAB 2 — PRODUITS IMPORT (nouveau)
// ═══════════════════════════════════════════════
function ProductsTab() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | productId
  const [filterCountry, setFilterCountry] = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      const [pRes, cRes] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, brand, category, price, img, score, rating, active, is_imported, lead_time_days, origin_country, supplier_url, supplier_cost, created_at')
          .eq('is_imported', true)
          .order('created_at', { ascending: false }),
        supabase.from('categories').select('id, slug, name').eq('active', true).order('display_order'),
      ]);
      if (pRes.error) throw pRes.error;
      setProducts(pRes.data || []);
      setCategories(cRes.data || []);
    } catch (e) {
      toast.error('Erreur chargement : ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = filterCountry === 'all'
    ? products
    : products.filter(p => p.origin_country === filterCountry);

  const availableCountries = [...new Set(products.map(p => p.origin_country).filter(Boolean))];

  // Stats
  const totalValue = products.reduce((s, p) => s + Number(p.price || 0), 0);
  const totalCost  = products.reduce((s, p) => s + Number(p.supplier_cost || 0), 0);
  const avgMargin  = totalCost > 0 ? Math.round(((totalValue - totalCost) / totalValue) * 100) : 0;

  if (editing !== null) {
    return (
      <ProductImportEditor
        product={editing === 'new' ? null : products.find(p => p.id === editing)}
        categories={categories}
        onSave={async () => { setEditing(null); await load(); }}
        onCancel={() => setEditing(null)}
        onDelete={editing !== 'new' ? async () => {
          const ok = await confirmDialog({ title: 'Supprimer ?', message: 'Cette action est irréversible.' });
          if (!ok) return;
          await supabase.from('products').delete().eq('id', editing);
          toast.success('Produit supprimé');
          setEditing(null);
          await load();
        } : null}
      />
    );
  }

  if (loading) return <div style={{ padding: 40 }}>Chargement…</div>;

  return (
    <div>
      {/* STATS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, padding: '0 16px 14px' }}>
        <StatCard label="Produits import" value={products.length} color="#0066CC" />
        <StatCard label="Valeur catalogue" value={totalValue.toLocaleString('fr-FR') + ' FCFA'} color="#1F8B4C" />
        <StatCard label="Coût fournisseur" value={totalCost.toLocaleString('fr-FR') + ' FCFA'} color="#E0A52D" />
        <StatCard label="Marge moyenne" value={avgMargin + '%'} color="#9C27B0" highlight={avgMargin >= 30} />
      </div>

      {/* TOOLBAR */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 14px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="adm-btn-pri" onClick={() => setEditing('new')}>
          + Nouveau produit import
        </button>

        <select
          value={filterCountry}
          onChange={e => setFilterCountry(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #E5E5E2', borderRadius: 8, fontSize: 13 }}
        >
          <option value="all">🌍 Tous les pays ({products.length})</option>
          {availableCountries.map(code => {
            const c = COUNTRIES.find(x => x.code === code) || { flag: '🌐', name: code };
            const cnt = products.filter(p => p.origin_country === code).length;
            return <option key={code} value={code}>{c.flag} {c.name} ({cnt})</option>;
          })}
        </select>
      </div>

      {/* LISTE PRODUITS */}
      <div style={{ padding: '0 16px' }}>
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#6B6B6B' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📦</div>
            <p>Aucun produit import {filterCountry !== 'all' && 'dans cette région'}.</p>
            <button className="adm-btn-pri" onClick={() => setEditing('new')} style={{ marginTop: 12 }}>
              + Ajouter le premier produit
            </button>
          </div>
        )}

        {filtered.map(p => {
          const country = COUNTRIES.find(c => c.code === p.origin_country);
          const margin = p.supplier_cost && p.price
            ? Math.round(((Number(p.price) - Number(p.supplier_cost)) / Number(p.price)) * 100)
            : null;
          return (
            <div key={p.id} style={{
              display: 'flex',
              gap: 12,
              background: '#fff',
              border: '1px solid #E5E5E2',
              borderRadius: 12,
              padding: 12,
              marginBottom: 10,
              alignItems: 'center',
            }}>
              {p.img ? (
                <img src={p.img} alt={p.name} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
              ) : (
                <div style={{ width: 56, height: 56, background: '#F4F4F2', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>📦</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {p.brand} {country && <span>· {country.flag} {country.name}</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, margin: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                </div>
                <div style={{ display: 'flex', gap: 10, fontSize: 12, color: '#6B6B6B', flexWrap: 'wrap' }}>
                  <span><strong style={{ color: '#1A1A1A' }}>{Number(p.price).toLocaleString('fr-FR')} FCFA</strong></span>
                  {margin !== null && <span>Marge : <strong style={{ color: margin >= 30 ? '#1F8B4C' : '#E0A52D' }}>{margin}%</strong></span>}
                  <span>⏱️ {p.lead_time_days || 15}j</span>
                  {!p.active && <span style={{ color: '#D9342B' }}>● Inactif</span>}
                </div>
              </div>
              <button
                className="adm-btn-sec"
                onClick={() => setEditing(p.id)}
                style={{ flexShrink: 0 }}
              >
                Modifier
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Éditeur compact pour produit import
// ═══════════════════════════════════════════════
function ProductImportEditor({ product, categories, onSave, onCancel, onDelete }) {
  const isNew = !product;
  const [p, setP] = useState(product || {
    name: '',
    brand: '',
    category: categories[0]?.slug || '',
    price: '',
    img: '',
    score: 70,
    rating: 4.5,
    active: true,
    is_imported: true,
    lead_time_days: 15,
    origin_country: 'US',
    supplier_url: '',
    supplier_cost: '',
  });
  const [saving, setSaving] = useState(false);
  const upd = (k, v) => setP({ ...p, [k]: v });

  const handleSave = async () => {
    if (!p.name?.trim() || !p.brand?.trim()) {
      toast.error('Nom et marque requis');
      return;
    }
    if (!p.price || Number(p.price) <= 0) {
      toast.error('Prix requis');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...p,
        price: Number(p.price) || 0,
        score: Number(p.score) || 70,
        rating: Number(p.rating) || 4.5,
        lead_time_days: Number(p.lead_time_days) || 15,
        supplier_cost: p.supplier_cost ? Number(p.supplier_cost) : null,
        is_imported: true,
      };
      // Cleanup avant insert
      delete payload.created_at;
      if (isNew) delete payload.id;

      const { error } = isNew
        ? await supabase.from('products').insert(payload)
        : await supabase.from('products').update(payload).eq('id', p.id);
      if (error) throw error;
      toast.success(isNew ? 'Produit créé ✅' : 'Produit modifié ✅');
      onSave();
    } catch (e) {
      toast.error('Erreur : ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const margin = p.supplier_cost && p.price
    ? Math.round(((Number(p.price) - Number(p.supplier_cost)) / Number(p.price)) * 100)
    : null;

  return (
    <div style={{ padding: '0 16px' }}>
      <header className="adm-header">
        <div>
          <button className="adm-link" onClick={onCancel}>← Retour à la liste</button>
          <h1>{isNew ? '+ Nouveau produit import' : 'Modifier produit import'}</h1>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* IDENTITÉ */}
        <div className="adm-form-section">
          <h3>Identité</h3>
          <label>Nom du produit *<input value={p.name} onChange={e => upd('name', e.target.value)} placeholder="Fenty Beauty Pro Filt'r Foundation" /></label>
          <label>Marque *<input value={p.brand} onChange={e => upd('brand', e.target.value)} placeholder="Fenty Beauty" /></label>
          <label>Catégorie<select value={p.category} onChange={e => upd('category', e.target.value)}>
            {categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select></label>
          <label>URL image<input value={p.img} onChange={e => upd('img', e.target.value)} placeholder="https://..." /></label>
          <label className="adm-form-checkbox">
            <input type="checkbox" checked={p.active} onChange={e => upd('active', e.target.checked)} />
            <span>Produit actif (visible dans Boutique internationale)</span>
          </label>
        </div>

        {/* PRIX & MARGE */}
        <div className="adm-form-section">
          <h3>Prix & Marge</h3>
          <PriceCalculator
            onApply={(supplierCost, suggestedPrice) => {
              upd('supplier_cost', supplierCost);
              upd('price', suggestedPrice);
            }}
          />
          <label>Prix de vente (FCFA) *<input type="number" value={p.price} onChange={e => upd('price', e.target.value)} placeholder="15000" /></label>
          <label>Prix coûtant fournisseur (FCFA)<input type="number" value={p.supplier_cost} onChange={e => upd('supplier_cost', e.target.value)} placeholder="8000" /></label>

          {margin !== null && (
            <div style={{
              background: margin >= 30 ? 'rgba(31,139,76,0.08)' : 'rgba(224,165,45,0.08)',
              border: `1px solid ${margin >= 30 ? '#1F8B4C' : '#E0A52D'}`,
              borderRadius: 8,
              padding: 10,
              marginTop: 8,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 2 }}>Marge nette estimée</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: margin >= 30 ? '#1F8B4C' : '#E0A52D' }}>{margin}%</div>
              <div style={{ fontSize: 11, color: '#6B6B6B' }}>
                {(Number(p.price) - Number(p.supplier_cost)).toLocaleString('fr-FR')} FCFA / unité
              </div>
            </div>
          )}

          <label>Score YARAM<input type="number" min="0" max="100" value={p.score} onChange={e => upd('score', e.target.value)} /></label>
          <label>Note moyenne<input type="number" step="0.1" min="0" max="5" value={p.rating} onChange={e => upd('rating', e.target.value)} /></label>
        </div>

        {/* IMPORT */}
        <div className="adm-form-section" style={{ gridColumn: '1 / -1', background: 'rgba(0,102,204,0.04)', borderRadius: 12, padding: 14 }}>
          <h3 style={{ color: '#0066CC' }}>✈️ Configuration import</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>Pays d'origine
              <select value={p.origin_country} onChange={e => upd('origin_country', e.target.value)}>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
              </select>
            </label>
            <label>Délai de livraison (jours) *
              <input type="number" min="1" max="60" value={p.lead_time_days} onChange={e => upd('lead_time_days', e.target.value)} />
              <small style={{ display: 'block', fontSize: 11, color: '#6B6B6B', marginTop: 4 }}>
                15j USA · 10j Europe · 7j Maghreb
              </small>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>URL fournisseur (admin only)
              <input value={p.supplier_url} onChange={e => upd('supplier_url', e.target.value)} placeholder="https://www.amazon.com/dp/..." />
              <small style={{ display: 'block', fontSize: 11, color: '#6B6B6B', marginTop: 4 }}>
                Lien direct vers le produit chez ton fournisseur. Pas visible côté client.
              </small>
            </label>
          </div>
        </div>
      </div>

      {/* ACTIONS */}
      <div style={{ display: 'flex', gap: 10, marginTop: 20, padding: '12px 0', borderTop: '1px solid #E5E5E2', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="adm-btn-sec" onClick={onCancel}>Annuler</button>
          <button className="adm-btn-pri" onClick={handleSave} disabled={saving}>
            {saving ? 'Enregistrement...' : (isNew ? 'Créer' : 'Enregistrer')}
          </button>
        </div>
        {onDelete && !isNew && (
          <button className="adm-btn-sec" style={{ color: '#D9342B' }} onClick={onDelete}>
            🗑 Supprimer
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Mini-calculateur prix : USD → FCFA + frais import + marge
// ═══════════════════════════════════════════════
function PriceCalculator({ onApply }) {
  // Valeurs persistées dans localStorage pour ne pas re-taper chaque fois
  const [priceUSD, setPriceUSD] = useState('');
  const [rate, setRate] = useState(() => {
    try { return localStorage.getItem('yaram_import_rate') || '620'; } catch { return '620'; }
  });
  const [importFees, setImportFees] = useState(() => {
    try { return localStorage.getItem('yaram_import_fees') || '20'; } catch { return '20'; }
  });
  const [targetMargin, setTargetMargin] = useState(() => {
    try { return localStorage.getItem('yaram_import_margin') || '35'; } catch { return '35'; }
  });
  const [expanded, setExpanded] = useState(false);

  // Persiste les réglages
  useEffect(() => {
    try { localStorage.setItem('yaram_import_rate', rate); } catch {}
  }, [rate]);
  useEffect(() => {
    try { localStorage.setItem('yaram_import_fees', importFees); } catch {}
  }, [importFees]);
  useEffect(() => {
    try { localStorage.setItem('yaram_import_margin', targetMargin); } catch {}
  }, [targetMargin]);

  const usd = Number(priceUSD) || 0;
  const fx = Number(rate) || 620;
  const fees = Number(importFees) || 0;
  const margin = Number(targetMargin) || 0;

  // supplier_cost = prix USD × taux + frais import (douane, transport, etc.)
  const supplierCost = Math.round(usd * fx * (1 + fees / 100));
  // prix de vente cible = supplier_cost / (1 - margin/100)
  const suggestedPrice = margin < 100 ? Math.round(supplierCost / (1 - margin / 100)) : supplierCost;
  // arrondir à la centaine supérieure pour faire plus propre (12 750 → 12 800)
  const suggestedPriceRounded = Math.ceil(suggestedPrice / 100) * 100;

  return (
    <div style={{
      background: 'rgba(0,102,204,0.05)',
      border: '1px dashed rgba(0,102,204,0.3)',
      borderRadius: 10,
      padding: 12,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded ? 10 : 0 }}>
        <strong style={{ fontSize: 13, color: '#0066CC' }}>🧮 Calculateur USD → FCFA</strong>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{ background: 'none', border: 'none', color: '#0066CC', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          {expanded ? 'Réduire ▲' : 'Ouvrir ▼'}
        </button>
      </div>

      {expanded && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <label style={{ fontSize: 11 }}>
              Prix USD ($)
              <input
                type="number"
                step="0.01"
                value={priceUSD}
                onChange={e => setPriceUSD(e.target.value)}
                placeholder="29.99"
                style={{ width: '100%', padding: 6, fontSize: 13 }}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              Taux change (FCFA/$)
              <input
                type="number"
                value={rate}
                onChange={e => setRate(e.target.value)}
                style={{ width: '100%', padding: 6, fontSize: 13 }}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              Frais import (%)
              <input
                type="number"
                value={importFees}
                onChange={e => setImportFees(e.target.value)}
                style={{ width: '100%', padding: 6, fontSize: 13 }}
              />
              <small style={{ fontSize: 10, color: '#6B6B6B' }}>Douane + transport + emballage</small>
            </label>
            <label style={{ fontSize: 11 }}>
              Marge cible (%)
              <input
                type="number"
                value={targetMargin}
                onChange={e => setTargetMargin(e.target.value)}
                style={{ width: '100%', padding: 6, fontSize: 13 }}
              />
              <small style={{ fontSize: 10, color: '#6B6B6B' }}>30-40% recommandé</small>
            </label>
          </div>

          {usd > 0 && (
            <div style={{
              background: '#fff',
              border: '1px solid #E5E5E2',
              borderRadius: 8,
              padding: 10,
              fontSize: 12,
              marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>Prix achat Sam's :</span>
                <strong>${usd.toFixed(2)} = {(usd * fx).toLocaleString('fr-FR')} FCFA</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>+ Frais import ({fees}%) :</span>
                <strong>{Math.round(usd * fx * fees / 100).toLocaleString('fr-FR')} FCFA</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid #E5E5E2' }}>
                <span><strong>Coût total YARAM :</strong></span>
                <strong style={{ color: '#E0A52D' }}>{supplierCost.toLocaleString('fr-FR')} FCFA</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span><strong>💰 Prix de vente suggéré :</strong></span>
                <strong style={{ color: '#1F8B4C', fontSize: 14 }}>{suggestedPriceRounded.toLocaleString('fr-FR')} FCFA</strong>
              </div>
            </div>
          )}

          <button
            type="button"
            className="adm-btn-pri"
            disabled={usd <= 0}
            onClick={() => onApply(supplierCost, suggestedPriceRounded)}
            style={{ width: '100%', fontSize: 13 }}
          >
            ⬇ Appliquer aux champs ci-dessous
          </button>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Composant StatCard partagé
// ═══════════════════════════════════════════════
function StatCard({ label, value, color, highlight }) {
  return (
    <div style={{
      background: highlight ? `${color}15` : '#fff',
      border: `1px solid ${highlight ? color : '#E5E5E2'}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 10,
      padding: '10px 14px',
    }}>
      <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
