import { useState, useEffect, useRef } from 'react';
import { adminGetStats, adminUsersStats } from '../lib/adminApi';

// Cache 5 min en memoire (par period). Evite de re-tirer le gros agregat
// si l'admin switch 7j / 30j / 90j puis revient en arriere.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key = period string ; value = { at, payload }

export default function StatsSection() {
  const [period, setPeriod] = useState('30');
  const [stats, setStats] = useState(null);
  const [newUsers, setNewUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const myReq = ++reqIdRef.current;
    (async () => {
      setLoading(true);

      // 1) Cache hit ?
      const cached = cache.get(period);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        if (myReq !== reqIdRef.current) return;
        setStats(cached.payload.stats);
        setNewUsers(cached.payload.newUsers);
        setLoading(false);
        return;
      }

      // 2) Pull SQL agregat + stats users en parallele
      const since = new Date();
      since.setDate(since.getDate() - parseInt(period, 10));
      const sinceIso = since.toISOString();
      const nowIso   = new Date().toISOString();

      const [statsRes, usersRes] = await Promise.all([
        adminGetStats({ periodStart: sinceIso, periodEnd: nowIso }),
        adminUsersStats({ since: sinceIso }),
      ]);

      if (myReq !== reqIdRef.current) return; // requete superseded

      const payload = {
        stats:    statsRes.data || null,
        newUsers: usersRes.data?.new_this_period || 0,
      };
      cache.set(period, { at: Date.now(), payload });

      setStats(payload.stats);
      setNewUsers(payload.newUsers);
      setLoading(false);
    })();
  }, [period]);

  // Derive vues affichage à partir du payload agrégé SQL
  const totalOrders   = stats?.total_orders   || 0;
  const totalRev      = Number(stats?.total_revenue || 0);
  const avgBasket     = Math.round(Number(stats?.avg_basket || 0));
  const uniqueClients = stats?.unique_clients || 0;
  const byStatus      = Array.isArray(stats?.by_status)      ? stats.by_status      : [];
  const topProducts   = Array.isArray(stats?.top_products)   ? stats.top_products   : [];
  const topPharmacies = Array.isArray(stats?.top_pharmacies) ? stats.top_pharmacies : [];
  const daily         = Array.isArray(stats?.daily)          ? stats.daily          : [];

  const deliveredCount = byStatus.find(s => s.status === 'delivered')?.count || 0;
  const conversionRate = newUsers > 0 ? Math.round((totalOrders / newUsers) * 100) : 0;

  const maxDay = Math.max(...daily.map(d => Number(d.count) || 0), 1);

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Statistiques</h1>
          <p>
            Analyse de la performance · {totalOrders} commandes
            {loading && ' · chargement…'}
          </p>
        </div>
        <div className="adm-filters" style={{ margin: 0 }}>
          {['7', '30', '90'].map(d => (
            <button key={d} className={`adm-filter ${period === d ? 'active' : ''}`} onClick={() => setPeriod(d)}>
              {d} jours
            </button>
          ))}
        </div>
      </header>

      <div className="adm-kpi-grid">
        <div className="adm-kpi">
          <div className="adm-kpi-label">CHIFFRE D'AFFAIRES</div>
          <div className="adm-kpi-value" style={{ color: '#1F8B4C' }}>
            {totalRev.toLocaleString('fr-FR')}<small>FCFA</small>
          </div>
          <div className="adm-kpi-meta">sur {period}j (livrées)</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">COMMANDES</div>
          <div className="adm-kpi-value">{totalOrders}</div>
          <div className="adm-kpi-meta">{deliveredCount} livrées</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">PANIER MOYEN</div>
          <div className="adm-kpi-value">{avgBasket.toLocaleString('fr-FR')}<small>FCFA</small></div>
          <div className="adm-kpi-meta">{uniqueClients} clientes uniques</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">NOUVELLES CLIENTES</div>
          <div className="adm-kpi-value">{newUsers}</div>
          <div className="adm-kpi-meta">inscriptions</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">TAUX CONVERSION</div>
          <div className="adm-kpi-value" style={{ color: '#1F8B4C' }}>{conversionRate}<small>%</small></div>
          <div className="adm-kpi-meta">commandes / inscriptions</div>
        </div>
      </div>

      {daily.length > 0 && (
        <div className="adm-recent-card">
          <h3>Commandes par jour</h3>
          <div className="adm-sparkline">
            {daily.map(d => (
              <div key={d.day} className="adm-spark-bar-wrap" title={`${d.day}: ${d.count} commandes · ${Number(d.revenue || 0).toLocaleString('fr-FR')} FCFA`}>
                <div className="adm-spark-bar" style={{ height: `${(Number(d.count) / maxDay) * 100}%` }} />
                <span className="adm-spark-day">{d.day.slice(8, 10)}/{d.day.slice(5, 7)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {byStatus.length > 0 && (
        <div className="adm-recent-card" style={{ marginTop: 16 }}>
          <h3>Répartition par statut</h3>
          <table className="adm-table">
            <thead><tr><th>Statut</th><th>Nombre</th><th>CA</th></tr></thead>
            <tbody>
              {byStatus.map(s => (
                <tr key={s.status}>
                  <td><strong>{s.status}</strong></td>
                  <td>{s.count}</td>
                  <td>{Number(s.revenue || 0).toLocaleString('fr-FR')} FCFA</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="adm-recent-card">
          <h3>🏆 Top produits</h3>
          {topProducts.length === 0 ? (
            <div className="adm-empty" style={{ padding: 20 }}>Aucune vente</div>
          ) : (
            <table className="adm-table">
              <thead><tr><th>Produit</th><th>Qté</th><th>CA</th></tr></thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={p.product_id || i}>
                    <td><strong>{p.name || '—'}</strong></td>
                    <td>{p.qty}</td>
                    <td>{Number(p.revenue || 0).toLocaleString('fr-FR')} FCFA</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="adm-recent-card">
          <h3>🏥 Top pharmacies</h3>
          {topPharmacies.length === 0 ? (
            <div className="adm-empty" style={{ padding: 20 }}>Aucune vente</div>
          ) : (
            <table className="adm-table">
              <thead><tr><th>Pharmacie</th><th>Articles</th><th>CA</th></tr></thead>
              <tbody>
                {topPharmacies.map((p, i) => (
                  <tr key={p.pharmacy_id || i}>
                    <td><strong>{p.pharmacy_name || '—'}</strong></td>
                    <td>{p.qty}</td>
                    <td>{Number(p.revenue || 0).toLocaleString('fr-FR')} FCFA</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
