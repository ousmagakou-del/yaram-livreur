import { useState, useEffect, useMemo } from 'react';
import { supabase, getCachedSetting } from '../lib/supabase';
import { exportCSV, openInvoicePrintWindow, fmtDate, fmtDateTime, fmtFCFA } from '../lib/exports';

// Taux lu dynamiquement depuis les site_settings (fallback 8%).
// Wrapped en fonction pour relire la valeur la plus recente sans re-render piege.
const getRate = () => getCachedSetting('commission', 8) / 100;
// CA "encaissé" = commandes effectivement livrees et confirmees par la cliente.
// CA "en cours" = commandes payees / en preparation / en route, pas encore livrees.
// On separe les deux pour ne pas afficher du revenu fantome (commandes pouvant etre annulees).
const FULFILLED_STATUSES = ['delivered', 'client_confirmed'];
const IN_PROGRESS_STATUSES = ['paid', 'preparing', 'ready', 'shipped', 'awaiting_confirm', 'awaiting_cash'];
// Statuts qu'on lit en DB (pour le detail) — on garde les deux familles
const REVENUE_STATUSES = [...FULFILLED_STATUSES, ...IN_PROGRESS_STATUSES];

export default function FinancesSection() {
  const [orders, setOrders] = useState([]);
  const [pharmacies, setPharmacies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');
  const [pharmacyFilter, setPharmacyFilter] = useState('all');
  const [exportMenu, setExportMenu] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [ordersRes, pharmaciesRes] = await Promise.all([
        supabase.from('orders')
          .select('id, total, items, status, created_at, accepted_at, prepared_at, assigned_pharmacy_id, pharmacy_splits, address')
          .in('status', REVENUE_STATUSES)
          .order('created_at', { ascending: false }),
        supabase.from('pharmacies').select('id, name, city, neighborhood, address, phone, whatsapp'),
      ]);
      setOrders(ordersRes.data || []);
      setPharmacies(pharmaciesRes.data || []);
      setLoading(false);
    })();
  }, []);

  // ─── Récupère le nom client depuis address (jsonb) ───
  const getCustomerName = (o) => {
    const a = o.address;
    if (typeof a === 'object' && a !== null) {
      return a.name || a.full_name || a.customer_name || '—';
    }
    return '—';
  };
  const getCustomerArea = (o) => {
    const a = o.address;
    if (typeof a === 'object' && a !== null) {
      return a.neighborhood || a.area || a.city || '';
    }
    return '';
  };

  // ─── Pharmacie de la commande (assigned_pharmacy_id en priorité) ───
  const getPharmacyId = (o) => {
    if (o.assigned_pharmacy_id) return o.assigned_pharmacy_id;
    // fallback : 1ère pharmacie du pharmacy_splits
    if (Array.isArray(o.pharmacy_splits) && o.pharmacy_splits[0]?.pharmacy_id) {
      return o.pharmacy_splits[0].pharmacy_id;
    }
    return null;
  };

  // ─── Filtrage période + pharmacie ───
  const filteredOrders = useMemo(() => {
    let list = orders;
    if (pharmacyFilter !== 'all') {
      list = list.filter(o => getPharmacyId(o) === pharmacyFilter);
    }
    if (period !== 'all') {
      const days = { '7d': 7, '30d': 30, '90d': 90, 'year': 365 }[period] || 30;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      list = list.filter(o => new Date(o.created_at).getTime() >= cutoff);
    }
    return list;
  }, [orders, period, pharmacyFilter]);

  const kpi = useMemo(() => {
    // Split clair entre CA encaisse et CA en cours
    const fulfilledOrders = filteredOrders.filter(o => FULFILLED_STATUSES.includes(o.status));
    const inProgressOrders = filteredOrders.filter(o => IN_PROGRESS_STATUSES.includes(o.status));

    const fulfilledRevenue = fulfilledOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const inProgressRevenue = inProgressOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const totalRevenue = fulfilledRevenue + inProgressRevenue;
    // Commission calculee SEULEMENT sur l'encaisse (on ne facture pas les commandes potentiellement annulees)
    const fulfilledCommission = Math.round(fulfilledRevenue * getRate());
    const netPharmacies = fulfilledRevenue - fulfilledCommission;
    const orderCount = filteredOrders.length;
    const avgBasket = fulfilledOrders.length > 0 ? Math.round(fulfilledRevenue / fulfilledOrders.length) : 0;

    const now = new Date();
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const endLastMonth = startThisMonth;
    // Comparaison mois N vs mois N-1 sur le CA encaisse (delivered) uniquement
    let revenueThisMonth = 0, revenueLastMonth = 0;
    for (const o of orders) {
      if (pharmacyFilter !== 'all' && getPharmacyId(o) !== pharmacyFilter) continue;
      if (!FULFILLED_STATUSES.includes(o.status)) continue;
      const t = new Date(o.created_at).getTime();
      const v = Number(o.total) || 0;
      if (t >= startThisMonth) revenueThisMonth += v;
      else if (t >= startLastMonth && t < endLastMonth) revenueLastMonth += v;
    }
    const monthDelta = revenueLastMonth > 0
      ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)
      : null;

    return {
      totalRevenue,
      fulfilledRevenue, inProgressRevenue,
      fulfilledOrdersCount: fulfilledOrders.length,
      inProgressOrdersCount: inProgressOrders.length,
      totalCommission: fulfilledCommission,
      netPharmacies, orderCount, avgBasket,
      revenueThisMonth, revenueLastMonth, monthDelta,
    };
  }, [filteredOrders, orders, pharmacyFilter]);

  const monthlyData = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      let revenue = 0;
      for (const o of orders) {
        if (pharmacyFilter !== 'all' && getPharmacyId(o) !== pharmacyFilter) continue;
        const t = new Date(o.created_at).getTime();
        if (t >= d.getTime() && t < next.getTime()) {
          revenue += Number(o.total) || 0;
        }
      }
      months.push({
        label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
        revenue,
      });
    }
    return months;
  }, [orders, pharmacyFilter]);

  const topPharmacies = useMemo(() => {
    const map = {};
    for (const o of filteredOrders) {
      const phId = getPharmacyId(o);
      if (!phId) continue;
      map[phId] = (map[phId] || 0) + (Number(o.total) || 0);
    }
    return Object.entries(map)
      .map(([id, revenue]) => {
        const ph = pharmacies.find(p => p.id === id);
        return { id, name: ph?.name || '—', revenue, commission: Math.round(revenue * getRate()) };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [filteredOrders, pharmacies]);

  const topProducts = useMemo(() => {
    const map = {};
    for (const o of filteredOrders) {
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        const key = it.productId || it.product_id || it.id || it.name || 'unknown';
        if (!map[key]) map[key] = { name: it.name || 'Produit', qty: 0, revenue: 0 };
        map[key].qty += Number(it.qty) || Number(it.quantity) || 1;
        map[key].revenue += (Number(it.price) || 0) * (Number(it.qty) || Number(it.quantity) || 1);
      }
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [filteredOrders]);

  const doExportOrders = (format) => {
    const rows = filteredOrders.map(o => {
      const ph = pharmacies.find(p => p.id === getPharmacyId(o));
      const total = Number(o.total) || 0;
      const commission = Math.round(total * getRate());
      const net = total - commission;
      const items = Array.isArray(o.items) ? o.items : [];
      return {
        id: String(o.id || '').slice(0, 8).toUpperCase(),
        date: fmtDate(o.created_at),
        pharmacie: ph?.name || '—',
        ville: ph?.city || '',
        cliente: getCustomerName(o),
        quartier: getCustomerArea(o),
        statut: o.status,
        nb_produits: items.length,
        total_fcfa: total,
        commission_8: commission,
        net_pharmacie: net,
      };
    });
    const headers = [
      { key: 'id', label: 'ID commande' },
      { key: 'date', label: 'Date' },
      { key: 'pharmacie', label: 'Pharmacie' },
      { key: 'ville', label: 'Ville' },
      { key: 'cliente', label: 'Cliente' },
      { key: 'quartier', label: 'Quartier' },
      { key: 'statut', label: 'Statut' },
      { key: 'nb_produits', label: 'Nb produits' },
      { key: 'total_fcfa', label: 'Total FCFA' },
      { key: 'commission_8', label: 'Commission 8%' },
      { key: 'net_pharmacie', label: 'Net pharmacie' },
    ];
    const today = new Date().toISOString().slice(0, 10);
    exportCSV(rows, headers, `yaram-commandes-${today}.csv`, { format });
    setExportMenu(null);
  };

  const doExportCommissions = (format) => {
    const rows = topPharmacies.map(p => ({
      pharmacie: p.name,
      ca_brut: p.revenue,
      commission_8: p.commission,
      net_a_verser: p.revenue - p.commission,
    }));
    const headers = [
      { key: 'pharmacie', label: 'Pharmacie' },
      { key: 'ca_brut', label: 'CA brut FCFA' },
      { key: 'commission_8', label: 'Commission YARAM 8%' },
      { key: 'net_a_verser', label: 'Net à verser FCFA' },
    ];
    const today = new Date().toISOString().slice(0, 10);
    exportCSV(rows, headers, `yaram-commissions-${today}.csv`, { format });
    setExportMenu(null);
  };

  const handleInvoice = (order) => {
    const ph = pharmacies.find(p => p.id === getPharmacyId(order));
    const enriched = {
      ...order,
      customer_name: getCustomerName(order),
    };
    openInvoicePrintWindow(enriched, ph);
  };

  const S = {
    section: { padding: 24 },
    h1: { fontSize: 24, fontWeight: 800, margin: 0 },
    sub: { color: '#6B6B6B', fontSize: 13, marginTop: 4 },
    filters: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, marginBottom: 20 },
    pill: { padding: '7px 14px', borderRadius: 999, border: '1px solid #DDD', background: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
    pillActive: { background: '#1F8B4C', color: 'white', borderColor: '#1F8B4C' },
    select: { padding: '7px 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 13, fontFamily: 'inherit' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 },
    kpiCard: { background: 'white', border: '1px solid #EEE', borderRadius: 14, padding: 18 },
    kpiLabel: { fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em' },
    kpiValue: { fontSize: 24, fontWeight: 800, marginTop: 6, color: '#1A1A1A' },
    kpiMeta: { fontSize: 11, color: '#9B9B9B', marginTop: 4 },
    section2: { background: 'white', borderRadius: 14, border: '1px solid #EEE', padding: 20, marginBottom: 16 },
    sectionTitle: { fontSize: 16, fontWeight: 800, marginBottom: 14 },
    rowExport: { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
    btnPrimary: { padding: '10px 16px', borderRadius: 10, background: '#1F8B4C', color: 'white', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
    btnOutline: { padding: '10px 16px', borderRadius: 10, background: 'white', color: '#1F8B4C', border: '1.5px solid #1F8B4C', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
    btnGhost: { padding: '6px 12px', borderRadius: 8, background: '#F4F4F2', color: '#1A1A1A', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { textAlign: 'left', padding: '10px 8px', background: '#F9FAFB', fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', borderBottom: '1px solid #EEE' },
    td: { padding: '10px 8px', borderBottom: '1px solid #F4F4F2' },
    chart: { display: 'flex', alignItems: 'flex-end', gap: 6, height: 180, padding: '0 4px' },
    bar: { flex: 1, background: 'linear-gradient(180deg, #1F8B4C 0%, #166635 100%)', borderRadius: '4px 4px 0 0', minHeight: 2 },
    barLabel: { fontSize: 9, color: '#6B6B6B', textAlign: 'center', marginTop: 4 },
    exportMenuWrap: { position: 'relative', display: 'inline-block' },
    exportMenu: { position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'white', border: '1px solid #DDD', borderRadius: 10, padding: 6, minWidth: 220, boxShadow: '0 6px 20px rgba(0,0,0,0.08)', zIndex: 10 },
    exportMenuItem: { display: 'block', width: '100%', padding: '8px 10px', textAlign: 'left', background: 'transparent', border: 'none', fontSize: 12, cursor: 'pointer', borderRadius: 6, fontFamily: 'inherit' },
  };

  const maxBar = Math.max(1, ...monthlyData.map(m => m.revenue));

  return (
    <div style={S.section} onClick={() => exportMenu && setExportMenu(null)}>
      <h1 style={S.h1}>💰 Finances</h1>
      <p style={S.sub}>CA, commissions, exports comptables · Commission YARAM fixée à 8%</p>

      <div style={S.filters}>
        {[['7d','7 jours'],['30d','30 jours'],['90d','90 jours'],['year','1 an'],['all','Tout']].map(([k, label]) => (
          <button key={k} style={{ ...S.pill, ...(period === k ? S.pillActive : {}) }} onClick={() => setPeriod(k)}>{label}</button>
        ))}
        <select style={S.select} value={pharmacyFilter} onChange={e => setPharmacyFilter(e.target.value)}>
          <option value="all">Toutes pharmacies</option>
          {pharmacies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading ? (
        <p style={{ color: '#9B9B9B' }}>Chargement…</p>
      ) : (
        <>
          <div style={S.grid}>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>✅ CA encaissé</div>
              <div style={{ ...S.kpiValue, color: '#1F8B4C' }}>{fmtFCFA(kpi.fulfilledRevenue)}</div>
              <div style={S.kpiMeta}>{kpi.fulfilledOrdersCount} commande{kpi.fulfilledOrdersCount > 1 ? 's' : ''} livrée{kpi.fulfilledOrdersCount > 1 ? 's' : ''}</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>⏳ CA en cours</div>
              <div style={{ ...S.kpiValue, color: '#F4B53A' }}>{fmtFCFA(kpi.inProgressRevenue)}</div>
              <div style={S.kpiMeta}>{kpi.inProgressOrdersCount} commande{kpi.inProgressOrdersCount > 1 ? 's' : ''} en préparation/route</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>💰 Commission YARAM</div>
              <div style={{ ...S.kpiValue, color: '#1F8B4C' }}>{fmtFCFA(kpi.totalCommission)}</div>
              <div style={S.kpiMeta}>8% sur CA encaissé</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>🏥 Net pharmacies (encaissé)</div>
              <div style={S.kpiValue}>{fmtFCFA(kpi.netPharmacies)}</div>
              <div style={S.kpiMeta}>92% du CA livré</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>🛒 Panier moyen</div>
              <div style={S.kpiValue}>{fmtFCFA(kpi.avgBasket)}</div>
              <div style={S.kpiMeta}>par commande livrée</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>📈 Mois N vs N-1 (encaissé)</div>
              <div style={{ ...S.kpiValue, color: kpi.monthDelta == null ? '#9B9B9B' : kpi.monthDelta >= 0 ? '#1F8B4C' : '#D9342B' }}>
                {kpi.monthDelta == null ? '—' : (kpi.monthDelta >= 0 ? '↑ +' : '↓ ') + kpi.monthDelta + '%'}
              </div>
              <div style={S.kpiMeta}>
                {fmtFCFA(kpi.revenueThisMonth)} vs {fmtFCFA(kpi.revenueLastMonth)}
              </div>
            </div>
          </div>

          <div style={S.section2}>
            <div style={S.sectionTitle}>📤 Exports comptables</div>
            <div style={S.rowExport}>
              <div style={S.exportMenuWrap}>
                <button style={S.btnPrimary} onClick={e => { e.stopPropagation(); setExportMenu(exportMenu === 'orders' ? null : 'orders'); }}>
                  ⬇️ Exporter les commandes ({filteredOrders.length})
                </button>
                {exportMenu === 'orders' && (
                  <div style={S.exportMenu} onClick={e => e.stopPropagation()}>
                    <button style={S.exportMenuItem} onClick={() => doExportOrders('excel-fr')}>📊 Excel français (recommandé)</button>
                    <button style={S.exportMenuItem} onClick={() => doExportOrders('standard')}>📄 CSV standard</button>
                  </div>
                )}
              </div>
              <div style={S.exportMenuWrap}>
                <button style={S.btnOutline} onClick={e => { e.stopPropagation(); setExportMenu(exportMenu === 'commissions' ? null : 'commissions'); }}>
                  💰 Exporter les commissions par pharmacie
                </button>
                {exportMenu === 'commissions' && (
                  <div style={S.exportMenu} onClick={e => e.stopPropagation()}>
                    <button style={S.exportMenuItem} onClick={() => doExportCommissions('excel-fr')}>📊 Excel français</button>
                    <button style={S.exportMenuItem} onClick={() => doExportCommissions('standard')}>📄 CSV standard</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={S.section2}>
            <div style={S.sectionTitle}>📈 Revenus des 12 derniers mois</div>
            <div style={S.chart}>
              {monthlyData.map((m, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div title={fmtFCFA(m.revenue)} style={{ ...S.bar, height: `${(m.revenue / maxBar) * 160}px`, width: '70%' }} />
                  <div style={S.barLabel}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={S.section2}>
            <div style={S.sectionTitle}>🏥 Top 10 pharmacies par CA</div>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>#</th><th style={S.th}>Pharmacie</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>CA brut</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Commission 8%</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Net à verser</th>
                </tr>
              </thead>
              <tbody>
                {topPharmacies.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#9B9B9B' }}>Aucune donnée</td></tr>
                ) : topPharmacies.map((p, i) => (
                  <tr key={p.id}>
                    <td style={S.td}>{i + 1}</td>
                    <td style={S.td}><strong>{p.name}</strong></td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{fmtFCFA(p.revenue)}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: '#1F8B4C', fontWeight: 700 }}>{fmtFCFA(p.commission)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{fmtFCFA(p.revenue - p.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={S.section2}>
            <div style={S.sectionTitle}>🏆 Top 10 produits vendus</div>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>#</th><th style={S.th}>Produit</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Quantité</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>CA généré</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.length === 0 ? (
                  <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center', color: '#9B9B9B' }}>Aucune donnée</td></tr>
                ) : topProducts.map((p, i) => (
                  <tr key={i}>
                    <td style={S.td}>{i + 1}</td>
                    <td style={S.td}><strong>{p.name}</strong></td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{p.qty}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{fmtFCFA(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={S.section2}>
            <div style={S.sectionTitle}>📋 Détail des commandes — {filteredOrders.length} résultat{filteredOrders.length > 1 ? 's' : ''}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Date</th><th style={S.th}>ID</th>
                    <th style={S.th}>Pharmacie</th><th style={S.th}>Cliente</th>
                    <th style={S.th}>Statut</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Total</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Commission</th>
                    <th style={S.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length === 0 ? (
                    <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#9B9B9B', padding: 30 }}>Aucune commande pour cette période</td></tr>
                  ) : filteredOrders.slice(0, 100).map(o => {
                    const ph = pharmacies.find(p => p.id === getPharmacyId(o));
                    const total = Number(o.total) || 0;
                    const commission = Math.round(total * getRate());
                    return (
                      <tr key={o.id}>
                        <td style={S.td}>{fmtDateTime(o.created_at)}</td>
                        <td style={S.td}><code style={{ background: '#F4F4F2', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>#{String(o.id).slice(0, 6).toUpperCase()}</code></td>
                        <td style={S.td}>{ph?.name || '—'}</td>
                        <td style={S.td}>{getCustomerName(o)}</td>
                        <td style={S.td}><span style={{ background: '#E8F5EC', color: '#1F8B4C', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{o.status}</span></td>
                        <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{fmtFCFA(total)}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#1F8B4C' }}>{fmtFCFA(commission)}</td>
                        <td style={S.td}><button style={S.btnGhost} onClick={() => handleInvoice(o)}>📄 Facture</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredOrders.length > 100 && (
                <p style={{ marginTop: 12, fontSize: 12, color: '#9B9B9B', textAlign: 'center' }}>
                  Affichage limité à 100 lignes — utilise l'export CSV pour le détail complet
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
