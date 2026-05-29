// ════════════════════════════════════════════════════════
// YARAM Admin — Section Imports (commandes preorder)
// ════════════════════════════════════════════════════════
// Permet à l'admin de gérer le cycle de vie des commandes import :
//   1. Acompte reçu (50%)
//   2. Commande chez le fournisseur USA/EU
//   3. Marqué "en transit"
//   4. Arrivé à Dakar
//   5. Demande de solde
//   6. Solde reçu + livraison
// ════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { PREORDER_STATUS_LABELS, PREORDER_STATUS_ICONS, formatArrivalDate } from '../lib/preorder';

export default function ImportsSection() {
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

  // Stats
  const stats = orders.reduce((acc, o) => {
    acc.total++;
    if (o.deposit_paid_at) acc.depositsReceived += Number(o.deposit_amount) || 0;
    if (!o.balance_paid_at && o.status !== 'cancelled') acc.balancesAwaiting += Number(o.balance_amount) || 0;
    if (o.status === 'awaiting_supplier') acc.toOrderCount++;
    if (o.status === 'in_transit_intl') acc.inTransitCount++;
    if (o.status === 'arrived_local') acc.arrivedCount++;
    return acc;
  }, { total: 0, depositsReceived: 0, balancesAwaiting: 0, toOrderCount: 0, inTransitCount: 0, arrivedCount: 0 });

  const advance = async (orderId, newStatus, extraFields = {}) => {
    try {
      const update = { status: newStatus, ...extraFields };
      const { error } = await supabase
        .from('orders')
        .update(update)
        .eq('id', orderId);
      if (error) throw error;
      toast.success(`Commande ${orderId} → ${PREORDER_STATUS_LABELS[newStatus] || newStatus}`);
      await load();
    } catch (e) {
      toast.error('Erreur : ' + e.message);
    }
  };

  const getNextAction = (order) => {
    switch (order.status) {
      case 'pending_payment':
        return {
          label: '✅ Acompte reçu',
          handler: () => advance(order.id, 'paid', { deposit_paid_at: new Date().toISOString() }),
        };
      case 'paid':
        return {
          label: '🛍️ Commander chez fournisseur',
          handler: () => advance(order.id, 'awaiting_supplier', { supplier_order_date: new Date().toISOString() }),
        };
      case 'awaiting_supplier':
        return {
          label: '✈️ Marquer en transit',
          handler: () => advance(order.id, 'in_transit_intl'),
        };
      case 'in_transit_intl':
        return {
          label: '🇸🇳 Arrivé à Dakar',
          handler: () => advance(order.id, 'arrived_local', { arrived_dakar_at: new Date().toISOString() }),
        };
      case 'arrived_local':
        return {
          label: '💰 Demander solde au client',
          handler: () => advance(order.id, 'awaiting_balance'),
        };
      case 'awaiting_balance':
        return {
          label: '✅ Solde reçu, livrer',
          handler: () => advance(order.id, 'shipped', { balance_paid_at: new Date().toISOString() }),
        };
      case 'shipped':
        return {
          label: '🎉 Marquer livré',
          handler: () => advance(order.id, 'delivered'),
        };
      default:
        return null;
    }
  };

  if (loading) return <div style={{ padding: 40 }}>Chargement…</div>;

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>✈️ Imports</h1>
          <p style={{ margin: 0, color: '#6B6B6B', fontSize: 13 }}>
            Gestion du cycle de vie des commandes preorder (Boutique internationale)
          </p>
        </div>
      </header>

      {/* STATS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, padding: '0 16px 14px' }}>
        <StatCard label="Total imports" value={stats.total} color="#0066CC" />
        <StatCard label="Acomptes encaissés" value={stats.depositsReceived.toLocaleString('fr-FR') + ' FCFA'} color="#1F8B4C" />
        <StatCard label="Soldes en attente" value={stats.balancesAwaiting.toLocaleString('fr-FR') + ' FCFA'} color="#E0A52D" />
        <StatCard label="À commander" value={stats.toOrderCount} color="#D9342B" highlight={stats.toOrderCount > 0} />
        <StatCard label="En transit" value={stats.inTransitCount} color="#9C27B0" />
        <StatCard label="Arrivés à Dakar" value={stats.arrivedCount} color="#1F8B4C" highlight={stats.arrivedCount > 0} />
      </div>

      {/* FILTRES */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 14px', overflowX: 'auto' }}>
        {[
          { id: 'all',     label: 'Tous',       count: orders.length },
          { id: 'pending', label: 'En attente', count: orders.filter(o => ['pending_payment','paid','awaiting_supplier'].includes(o.status)).length },
          { id: 'transit', label: 'En transit', count: orders.filter(o => o.status === 'in_transit_intl').length },
          { id: 'arrived', label: 'Arrivés',    count: orders.filter(o => ['arrived_local','awaiting_balance'].includes(o.status)).length },
          { id: 'done',    label: 'Terminés',   count: orders.filter(o => ['delivered','cancelled'].includes(o.status)).length },
        ].map(f => (
          <button
            key={f.id}
            className={`adm-filter ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* LISTE */}
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
            <div key={o.id} style={{
              background: '#fff',
              border: '1px solid #E5E5E2',
              borderRadius: 12,
              padding: 14,
              marginBottom: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <code style={{ fontSize: 12, color: '#6B6B6B' }}>{o.id}</code>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>
                    {o.address?.name || 'Client inconnu'} · {Number(o.total).toLocaleString('fr-FR')} FCFA
                  </div>
                </div>
                <div style={{
                  background: 'linear-gradient(135deg, #0066CC, #004999)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 8,
                }}>
                  {PREORDER_STATUS_ICONS[o.status] || ''} {PREORDER_STATUS_LABELS[o.status] || o.status}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, fontSize: 12, color: '#6B6B6B', marginBottom: 10 }}>
                <div>
                  <strong style={{ color: '#1A1A1A' }}>Acompte (50%)</strong><br/>
                  {Number(o.deposit_amount || 0).toLocaleString('fr-FR')} FCFA
                  {o.deposit_paid_at && <span style={{ color: '#1F8B4C' }}> ✓</span>}
                </div>
                <div>
                  <strong style={{ color: '#1A1A1A' }}>Solde (50%)</strong><br/>
                  {Number(o.balance_amount || 0).toLocaleString('fr-FR')} FCFA
                  {o.balance_paid_at && <span style={{ color: '#1F8B4C' }}> ✓</span>}
                </div>
                {o.expected_arrival_date && (
                  <div>
                    <strong style={{ color: '#1A1A1A' }}>Arrivée prévue</strong><br/>
                    {formatArrivalDate(o.expected_arrival_date)}
                  </div>
                )}
                <div>
                  <strong style={{ color: '#1A1A1A' }}>Items</strong><br/>
                  {(o.items || []).length} produit(s)
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {next && (
                  <button className="adm-btn-pri" onClick={next.handler}>
                    {next.label}
                  </button>
                )}
                {phone && (
                  <a
                    href={`https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Bonjour, c'est YARAM concernant votre commande ${o.id}.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="adm-btn-sec"
                    style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    💬 WhatsApp client
                  </a>
                )}
                {o.status !== 'cancelled' && o.status !== 'delivered' && (
                  <button
                    className="adm-btn-sec"
                    style={{ color: '#D9342B' }}
                    onClick={() => {
                      if (confirm(`Annuler la commande ${o.id} ?`)) {
                        advance(o.id, 'cancelled');
                      }
                    }}
                  >
                    ❌ Annuler
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
