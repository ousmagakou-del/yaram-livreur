import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { fmtFCFA } from '../lib/exports';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const STATUS = {
  pending:    ['paid', 'awaiting_confirm', 'awaiting_cash', 'pending'],
  accepted:   ['preparing', 'ready', 'shipped', 'delivered', 'client_confirmed'],
  fulfilled:  ['delivered', 'client_confirmed'],
  refused:    ['refused', 'cancelled'],
};

export default function PerformanceSection() {
  const [orders, setOrders] = useState([]);
  const [pharmacies, setPharmacies] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');
  const [sortBy, setSortBy] = useState('score');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [oRes, pRes] = await Promise.all([
        supabase.from('orders').select('id, assigned_pharmacy_id, pharmacy_splits, status, total, created_at, accepted_at, prepared_at, refused_at'),
        supabase.from('pharmacies').select('id, name, city, neighborhood, active, rating, review_count, phone, whatsapp'),
      ]);
      setOrders(oRes.data || []);
      setPharmacies(pRes.data || []);

      // Reviews : on essaie de lire, si erreur on continue avec []
      const rRes = { data: [] };  // reviews.pharmacy_id n'existe pas dans le schéma, on utilise pharmacies.rating
      setReviews(rRes.data || []);

      setLoading(false);
    })();
  }, []);

  const getPharmacyId = (o) => {
    if (o.assigned_pharmacy_id) return o.assigned_pharmacy_id;
    if (Array.isArray(o.pharmacy_splits) && o.pharmacy_splits[0]?.pharmacy_id) {
      return o.pharmacy_splits[0].pharmacy_id;
    }
    return null;
  };

  const cutoffMs = useMemo(() => {
    if (period === 'all') return 0;
    const days = { '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
    return Date.now() - days * DAY;
  }, [period]);

  const filteredOrders = useMemo(
    () => orders.filter(o => new Date(o.created_at).getTime() >= cutoffMs),
    [orders, cutoffMs]
  );

  const stats = useMemo(() => {
    return pharmacies.map(ph => {
      const ords = filteredOrders.filter(o => getPharmacyId(o) === ph.id);
      const total = ords.length;
      const accepted = ords.filter(o => STATUS.accepted.includes(o.status)).length;
      const fulfilled = ords.filter(o => STATUS.fulfilled.includes(o.status)).length;
      const refused = ords.filter(o => STATUS.refused.includes(o.status)).length;
      const pending = ords.filter(o => STATUS.pending.includes(o.status)).length;
      const revenue = ords.filter(o => STATUS.accepted.includes(o.status))
        .reduce((s, o) => s + (Number(o.total) || 0), 0);

      const responseTimes = [];
      const prepTimes = [];
      for (const o of ords) {
        const created = o.created_at ? new Date(o.created_at).getTime() : null;
        const accepted = o.accepted_at ? new Date(o.accepted_at).getTime() : null;
        const prepared = o.prepared_at ? new Date(o.prepared_at).getTime() : null;

        if (created && accepted && accepted > created) {
          responseTimes.push(accepted - created);
        }
        if (accepted && prepared && prepared > accepted) {
          prepTimes.push(prepared - accepted);
        }
      }
      const avgResponseMs = responseTimes.length ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null;
      const avgPrepMs = prepTimes.length ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length : null;

      const stalePending = ords.filter(o => {
        if (!STATUS.pending.includes(o.status)) return false;
        const age = Date.now() - new Date(o.created_at).getTime();
        return age > 24 * HOUR;
      }).length;

      const decided = accepted + refused;
      const acceptanceRate = decided > 0 ? Math.round((accepted / decided) * 100) : null;
      const fulfillmentRate = accepted > 0 ? Math.round((fulfilled / accepted) * 100) : null;

      const phReviews = reviews.filter(r => r.pharmacy_id === ph.id);
      const avgRating = phReviews.length
        ? phReviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / phReviews.length
        : (Number(ph.rating) || null);

      const criteria = [];
      if (acceptanceRate != null) criteria.push({ w: 25, v: acceptanceRate / 100 });
      if (fulfillmentRate != null) criteria.push({ w: 25, v: fulfillmentRate / 100 });
      if (avgResponseMs != null) {
        const hours = avgResponseMs / HOUR;
        const speedScore =
          hours < 1 ? 1 :
          hours < 3 ? 0.6 :
          hours < 12 ? 0.32 :
          hours < 24 ? 0.12 : 0;
        criteria.push({ w: 25, v: speedScore });
      }
      if (avgRating != null) criteria.push({ w: 15, v: avgRating / 5 });
      const activityScore = Math.min(1, total / 10);
      criteria.push({ w: 10, v: activityScore });

      const totalWeight = criteria.reduce((s, c) => s + c.w, 0);
      const weightedSum = criteria.reduce((s, c) => s + c.w * c.v, 0);
      const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : null;

      return {
        ...ph,
        total, accepted, fulfilled, refused, pending, stalePending, revenue,
        avgResponseMs, avgPrepMs, acceptanceRate, fulfillmentRate,
        avgRating, score,
      };
    });
  }, [pharmacies, filteredOrders, reviews]);

  const sorted = useMemo(() => {
    return [...stats].sort((a, b) => {
      switch (sortBy) {
        case 'revenue':    return b.revenue - a.revenue;
        case 'speed':      return (a.avgResponseMs ?? Infinity) - (b.avgResponseMs ?? Infinity);
        case 'acceptance': return (b.acceptanceRate ?? 0) - (a.acceptanceRate ?? 0);
        case 'score':
        default:           return (b.score ?? 0) - (a.score ?? 0);
      }
    });
  }, [stats, sortBy]);

  const alerts = sorted.filter(p => p.stalePending > 0);

  const globalKpi = useMemo(() => {
    const activeCount = pharmacies.filter(p => p.active).length;
    const allResponseTimes = stats.flatMap(s => s.avgResponseMs != null ? [s.avgResponseMs] : []);
    const avgResponseMs = allResponseTimes.length
      ? allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length
      : null;
    const accepted = filteredOrders.filter(o => STATUS.accepted.includes(o.status)).length;
    const refused = filteredOrders.filter(o => STATUS.refused.includes(o.status)).length;
    const fulfilled = filteredOrders.filter(o => STATUS.fulfilled.includes(o.status)).length;
    const decided = accepted + refused;
    const acceptanceGlobal = decided > 0 ? Math.round((accepted / decided) * 100) : null;
    const fulfillmentGlobal = accepted > 0 ? Math.round((fulfilled / accepted) * 100) : null;
    return { activeCount, avgResponseMs, acceptanceGlobal, fulfillmentGlobal };
  }, [pharmacies, stats, filteredOrders]);

  const S = {
    section: { padding: 24 },
    h1: { fontSize: 24, fontWeight: 800, margin: 0 },
    sub: { color: '#6B6B6B', fontSize: 13, marginTop: 4 },
    filters: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, marginBottom: 20, alignItems: 'center' },
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
    alertCard: { background: '#FCE9E7', border: '1px solid #F5C2BE', borderRadius: 12, padding: 14, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { textAlign: 'left', padding: '10px 8px', background: '#F9FAFB', fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', borderBottom: '1px solid #EEE' },
    td: { padding: '10px 8px', borderBottom: '1px solid #F4F4F2' },
    scorePill: (s) => ({
      display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800,
      color: s == null ? '#9B9B9B' : s >= 80 ? '#1F8B4C' : s >= 60 ? '#A07700' : '#D9342B',
      background: s == null ? '#F4F4F2' : s >= 80 ? '#E8F5EC' : s >= 60 ? '#FEF6E5' : '#FCE9E7',
    }),
  };

  return (
    <div style={S.section}>
      <h1 style={S.h1}>📊 Performance pharmacies</h1>
      <p style={S.sub}>Vitesse de réponse, taux d'acceptation, fiabilité de livraison · Score sur 100</p>

      <div style={S.filters}>
        {[['7d','7 jours'],['30d','30 jours'],['90d','90 jours'],['all','Tout']].map(([k, label]) => (
          <button key={k} style={{ ...S.pill, ...(period === k ? S.pillActive : {}) }} onClick={() => setPeriod(k)}>{label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6B6B6B' }}>Trier par :</span>
        <select style={S.select} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="score">Score (meilleur d'abord)</option>
          <option value="revenue">CA généré</option>
          <option value="speed">Rapidité</option>
          <option value="acceptance">Taux d'acceptation</option>
        </select>
      </div>

      {loading ? (
        <p style={{ color: '#9B9B9B' }}>Chargement…</p>
      ) : (
        <>
          <div style={S.grid}>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>🏥 Pharmacies actives</div>
              <div style={S.kpiValue}>{globalKpi.activeCount}</div>
              <div style={S.kpiMeta}>sur {pharmacies.length} au total</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>⚡ Temps réponse moyen</div>
              <div style={S.kpiValue}>{formatDuration(globalKpi.avgResponseMs) || '—'}</div>
              <div style={S.kpiMeta}>Création → acceptation</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>✅ Taux d'acceptation</div>
              <div style={{ ...S.kpiValue, color: '#1F8B4C' }}>
                {globalKpi.acceptanceGlobal != null ? globalKpi.acceptanceGlobal + '%' : '—'}
              </div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>🎯 Taux de livraison</div>
              <div style={{ ...S.kpiValue, color: '#1F8B4C' }}>
                {globalKpi.fulfillmentGlobal != null ? globalKpi.fulfillmentGlobal + '%' : '—'}
              </div>
            </div>
          </div>

          {alerts.length > 0 && (
            <div style={S.section2}>
              <div style={{ ...S.sectionTitle, color: '#D9342B' }}>
                🚨 {alerts.length} pharmacie{alerts.length > 1 ? 's' : ''} avec commandes non traitées (+24h)
              </div>
              {alerts.map(p => (
                <div key={p.id} style={S.alertCard}>
                  <div>
                    <strong>{p.name}</strong>
                    <div style={{ fontSize: 12, color: '#6B6B6B', marginTop: 2 }}>
                      {p.stalePending} commande{p.stalePending > 1 ? 's' : ''} en attente depuis plus de 24h
                    </div>
                  </div>
                  {p.whatsapp && (
                    <a href={`https://wa.me/${String(p.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(`Bonjour ${p.name}, ${p.stalePending} commande(s) YARAM sont en attente depuis +24h. Peux-tu y jeter un œil stp ? Merci 💚`)}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ padding: '8px 14px', background: '#25D366', color: 'white', borderRadius: 8, textDecoration: 'none', fontSize: 12, fontWeight: 700 }}>
                      💬 Relancer
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={S.section2}>
            <div style={S.sectionTitle}>🏆 Classement des pharmacies</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>#</th><th style={S.th}>Pharmacie</th>
                    <th style={S.th}>Score</th><th style={S.th}>Commandes</th>
                    <th style={S.th}>Acceptation</th><th style={S.th}>Livraison</th>
                    <th style={S.th}>Réponse</th><th style={S.th}>Prép.</th>
                    <th style={S.th}>Note</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>CA</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr><td colSpan={10} style={{ ...S.td, textAlign: 'center', color: '#9B9B9B', padding: 30 }}>Aucune donnée</td></tr>
                  ) : sorted.map((p, i) => (
                    <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                      <td style={S.td}>{i + 1}</td>
                      <td style={S.td}>
                        <strong>{p.name}</strong>
                        <div style={{ fontSize: 11, color: '#9B9B9B' }}>
                          {p.neighborhood ? p.neighborhood + ', ' : ''}{p.city}
                          {!p.active && <span style={{ color: '#D9342B', marginLeft: 6 }}>· Inactive</span>}
                        </div>
                      </td>
                      <td style={S.td}><span style={S.scorePill(p.score)}>{p.score != null ? p.score : '—'}</span></td>
                      <td style={S.td}>
                        <strong>{p.total}</strong>
                        {p.stalePending > 0 && (<span style={{ color: '#D9342B', fontSize: 11, marginLeft: 6 }}>⚠️ {p.stalePending}</span>)}
                      </td>
                      <td style={S.td}>{p.acceptanceRate != null ? p.acceptanceRate + '%' : '—'}</td>
                      <td style={S.td}>{p.fulfillmentRate != null ? p.fulfillmentRate + '%' : '—'}</td>
                      <td style={S.td}>{formatDuration(p.avgResponseMs) || '—'}</td>
                      <td style={S.td}>{formatDuration(p.avgPrepMs) || '—'}</td>
                      <td style={S.td}>{p.avgRating != null ? <span>★ {Number(p.avgRating).toFixed(1)}</span> : '—'}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{fmtFCFA(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: '#9B9B9B', marginTop: 12 }}>
              💡 <strong>Score sur 100</strong> = acceptation (25%) + livraison (25%) + vitesse (25%) + note clients (15%) + volume (10%).
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function formatDuration(ms) {
  if (ms == null) return null;
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return '< 1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}j ${h % 24}h`;
}