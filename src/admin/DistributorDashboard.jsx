// ════════════════════════════════════════════════════════════════════
// YARAM — Dashboard Distributeur (admin + vue publique)
// ════════════════════════════════════════════════════════════════════
// Affiche les KPI, tableau par marque, opportunités de prospection,
// top pharmas partenaires, et insights métier pour un distributeur.
//
// Accepte :
//   - distributor   : objet distributor (depuis distributors table ou RPC token)
//   - onBack        : optional, callback retour vers la liste (mode admin)
//   - readOnly      : optional bool, masque les boutons d'édition (vue publique)
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import {
  getBrandAnalytics,
  getProspectionOpportunities,
  getTopPartnerPharmacies,
  getBrandsByIds,
  formatFcfa,
} from '../lib/distributorsApi';

const PERIODS = [
  { value: 7,   label: '7 jours' },
  { value: 30,  label: '30 jours' },
  { value: 90,  label: '90 jours' },
  { value: 365, label: '12 mois' },
];

export default function DistributorDashboard({ distributor, onBack, readOnly = false }) {
  const [days, setDays] = useState(30);
  const [analytics, setAnalytics] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [topPartners, setTopPartners] = useState([]);
  const [brandsMap, setBrandsMap] = useState({});
  const [loading, setLoading] = useState(true);

  const brandIds = useMemo(() => Array.isArray(distributor?.brands) ? distributor.brands : [], [distributor]);

  useEffect(() => {
    if (!distributor) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [a, p, tp, brs] = await Promise.all([
          getBrandAnalytics(brandIds, days),
          getProspectionOpportunities(brandIds, days),
          getTopPartnerPharmacies(brandIds, days),
          getBrandsByIds(brandIds),
        ]);
        if (cancelled) return;
        setAnalytics(a);
        setProspects(p);
        setTopPartners(tp);
        const map = {};
        (brs || []).forEach(b => { map[b.id] = b; });
        setBrandsMap(map);
      } catch (e) {
        console.error('[DistributorDashboard] load failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [distributor?.id, brandIds, days]);

  // ─── KPIs agrégés ─────────────────────────────────────────────
  const totals = useMemo(() => {
    const t = { orders: 0, units: 0, revenue: 0, customers: 0, partnerPharmas: 0, nonPartnerScans: 0 };
    analytics.forEach(a => {
      t.orders          += Number(a.total_orders) || 0;
      t.units           += Number(a.total_units_sold) || 0;
      t.revenue         += Number(a.total_revenue_fcfa) || 0;
      t.customers       += Number(a.unique_customers) || 0;
      t.partnerPharmas  += Number(a.partner_pharmacies_with_sales) || 0;
      t.nonPartnerScans += Number(a.non_partner_scans) || 0;
    });
    return t;
  }, [analytics]);

  const totalRevenuePharmas = useMemo(
    () => topPartners.reduce((s, p) => s + (p.totalRevenue || 0), 0),
    [topPartners]
  );

  // ─── Insights (règles métier) ─────────────────────────────────
  const insights = useMemo(() => {
    const out = [];
    // 1) Demande externe forte
    const externalProspects = prospects.reduce((s, p) => s + p.scans, 0);
    if (externalProspects > 0) {
      out.push({
        icon: '🔥',
        text: `Demande externe : ${externalProspects} scan${externalProspects > 1 ? 's' : ''} de vos produits dans ${prospects.length} pharmacie${prospects.length > 1 ? 's' : ''} non-partenaire${prospects.length > 1 ? 's' : ''} sur ${days} jours. Autant d'opportunités directes de prospection pour votre force de vente.`,
      });
    }
    // 2) Top brand
    const topBrand = [...analytics].sort((a, b) => (b.total_revenue_fcfa || 0) - (a.total_revenue_fcfa || 0))[0];
    if (topBrand && Number(topBrand.total_revenue_fcfa) > 0) {
      out.push({
        icon: '🏆',
        text: `Marque championne : ${topBrand.brand_name} génère ${formatFcfa(topBrand.total_revenue_fcfa)} sur ${days} jours (${topBrand.total_units_sold} unités). Doublez la mise marketing dessus.`,
      });
    }
    // 3) Top pharma partenaire
    const topPharma = topPartners[0];
    if (topPharma && totalRevenuePharmas > 0) {
      const pct = Math.round((topPharma.totalRevenue / totalRevenuePharmas) * 100);
      if (pct >= 25) {
        out.push({
          icon: '📈',
          text: `${topPharma.name} représente ${pct}% de votre chiffre partenaire. Pharmacie idéale pour un partenariat exclusif ou des animations terrain.`,
        });
      }
    }
    // 4) Marque sous-vendue avec forte demande externe
    analytics.forEach(a => {
      const sold = Number(a.partner_pharmacies_with_sales) || 0;
      const ext = Number(a.non_partner_scans) || 0;
      if (ext > 5 && sold <= 2) {
        out.push({
          icon: '⚠️',
          text: `${a.brand_name} est demandée ${ext} fois en pharmas non-partenaires mais seules ${sold} pharma${sold > 1 ? 's' : ''} partenaire${sold > 1 ? 's' : ''} la vendent. Opportunité claire d'élargir le réseau.`,
        });
      }
    });
    // 5) Aucune commande mais des scans
    if (totals.orders === 0 && externalProspects > 0) {
      out.push({
        icon: '🎯',
        text: `Aucune commande encore enregistrée sur cette période, mais ${externalProspects} scans externes : la demande est là, il manque l'offre. Distribuons ensemble !`,
      });
    }
    return out.slice(0, 5);
  }, [analytics, prospects, topPartners, totalRevenuePharmas, totals, days]);

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  if (!distributor) return <div className="adm-empty">Distributeur introuvable.</div>;

  return (
    <div className="adm-section dist-dashboard" style={{ paddingBottom: 60 }}>
      {/* Style scoped print + carte */}
      <style>{`
        @media print {
          .adm-side, .dist-no-print { display: none !important; }
          .adm-main, .adm-section { padding: 0 !important; }
          .dist-card { break-inside: avoid; box-shadow: none !important; border: 1px solid #DDD !important; }
        }
        .dist-card {
          background: white;
          border: 1px solid #EEE;
          border-radius: 14px;
          padding: 18px;
          margin-bottom: 16px;
        }
        .dist-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }
        .dist-kpi {
          background: linear-gradient(135deg, #FFFFFF 0%, #F8FAF7 100%);
          border: 1px solid #E5EFE8;
          border-radius: 14px;
          padding: 16px;
        }
        .dist-kpi-icon { font-size: 22px; }
        .dist-kpi-label { font-size: 11px; color: #6B6B6B; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
        .dist-kpi-value { font-size: 26px; font-weight: 800; color: #1A1A1A; margin-top: 4px; }
        .dist-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .dist-table th, .dist-table td { padding: 10px 8px; text-align: left; border-bottom: 1px solid #F0F0F0; }
        .dist-table th { font-size: 11px; text-transform: uppercase; color: #6B6B6B; font-weight: 700; letter-spacing: 0.4px; background: #FAFAF9; }
        .dist-table tr:last-child td { border-bottom: none; }
        .dist-table tr:hover td { background: #FAFAF9; }
        .dist-chip {
          display: inline-block;
          padding: 3px 9px;
          background: #EAF5EE;
          color: #166635;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
          margin: 2px 4px 2px 0;
        }
        .dist-pulse {
          background: linear-gradient(135deg, #FFF8E1 0%, #FFE8C8 100%);
          border: 1px solid #F4B53A;
        }
        .dist-bar-bg { background: #F4F4F2; height: 8px; border-radius: 4px; overflow: hidden; }
        .dist-bar-fill { background: linear-gradient(90deg, #1F8B4C 0%, #166635 100%); height: 100%; transition: width 0.3s; }
      `}</style>

      {/* ─── HEADER ─── */}
      <header className="adm-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
          {onBack && !readOnly && (
            <button
              className="adm-btn-sec dist-no-print"
              onClick={onBack}
              style={{ padding: '6px 10px' }}
            >← Retour</button>
          )}
          {distributor.logo_url ? (
            <img
              src={distributor.logo_url}
              alt={distributor.name}
              style={{ width: 58, height: 58, borderRadius: 12, objectFit: 'cover', border: '1px solid #EEE' }}
            />
          ) : (
            <div style={{
              width: 58, height: 58, borderRadius: 12, background: 'linear-gradient(135deg, #1F8B4C, #166635)',
              color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 800,
            }}>{(distributor.name || '?')[0]}</div>
          )}
          <div>
            <h1 style={{ marginBottom: 2 }}>{distributor.name}</h1>
            <p style={{ fontSize: 13, color: '#6B6B6B' }}>
              {distributor.contact_person ? `${distributor.contact_person} · ` : ''}
              Dashboard {readOnly ? 'partenaire' : 'distributeur'}
            </p>
          </div>
        </div>
        <div className="dist-no-print" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={days}
            onChange={e => setDays(parseInt(e.target.value, 10))}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 13 }}
          >
            {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <button className="adm-btn-sec" onClick={handlePrint}>🖨 Exporter PDF</button>
        </div>
      </header>

      {/* ─── KPI CARDS ─── */}
      <div className="dist-kpi-grid">
        <div className="dist-kpi">
          <div className="dist-kpi-icon">💰</div>
          <div className="dist-kpi-label">Revenu total</div>
          <div className="dist-kpi-value">{formatFcfa(totals.revenue)}</div>
        </div>
        <div className="dist-kpi">
          <div className="dist-kpi-icon">🛒</div>
          <div className="dist-kpi-label">Commandes</div>
          <div className="dist-kpi-value">{totals.orders.toLocaleString('fr-FR')}</div>
        </div>
        <div className="dist-kpi">
          <div className="dist-kpi-icon">👥</div>
          <div className="dist-kpi-label">Clients uniques</div>
          <div className="dist-kpi-value">{totals.customers.toLocaleString('fr-FR')}</div>
        </div>
        <div className="dist-kpi">
          <div className="dist-kpi-icon">📦</div>
          <div className="dist-kpi-label">Unités vendues</div>
          <div className="dist-kpi-value">{totals.units.toLocaleString('fr-FR')}</div>
        </div>
      </div>

      {/* ─── BRANDS COVERED ─── */}
      <div className="dist-card">
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Marques distribuées · {brandIds.length}
        </h3>
        {brandIds.length === 0 ? (
          <p style={{ fontSize: 13, color: '#999' }}>Aucune marque associée. Édite le distributeur pour en ajouter.</p>
        ) : (
          <div>
            {brandIds.map(bid => (
              <span key={bid} className="dist-chip">{brandsMap[bid]?.name || '…'}</span>
            ))}
          </div>
        )}
      </div>

      {/* ─── TABLEAU PAR MARQUE ─── */}
      <div className="dist-card">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>📊 Performance par marque</h3>
        {loading ? (
          <p style={{ color: '#999', fontSize: 13 }}>Chargement…</p>
        ) : analytics.length === 0 ? (
          <p style={{ color: '#999', fontSize: 13 }}>Aucune donnée sur la période.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="dist-table">
              <thead>
                <tr>
                  <th>Marque</th>
                  <th style={{ textAlign: 'right' }}>Commandes</th>
                  <th style={{ textAlign: 'right' }}>Unités</th>
                  <th style={{ textAlign: 'right' }}>Revenu</th>
                  <th style={{ textAlign: 'right' }}>Clients</th>
                  <th style={{ textAlign: 'right' }}>Pharmas</th>
                  <th style={{ textAlign: 'right' }}>Demande ext.</th>
                </tr>
              </thead>
              <tbody>
                {analytics
                  .slice()
                  .sort((a, b) => (b.total_revenue_fcfa || 0) - (a.total_revenue_fcfa || 0))
                  .map(a => (
                    <tr key={a.brand_id}>
                      <td><strong>{a.brand_name}</strong></td>
                      <td style={{ textAlign: 'right' }}>{Number(a.total_orders) || 0}</td>
                      <td style={{ textAlign: 'right' }}>{Number(a.total_units_sold) || 0}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatFcfa(a.total_revenue_fcfa)}</td>
                      <td style={{ textAlign: 'right' }}>{Number(a.unique_customers) || 0}</td>
                      <td style={{ textAlign: 'right' }}>{Number(a.partner_pharmacies_with_sales) || 0}</td>
                      <td style={{ textAlign: 'right', color: Number(a.non_partner_scans) > 0 ? '#E8385C' : '#6B6B6B', fontWeight: Number(a.non_partner_scans) > 0 ? 700 : 400 }}>
                        {Number(a.non_partner_scans) || 0}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── PROSPECTION ─── */}
      <div className="dist-card dist-pulse">
        <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>
          🎯 Opportunités de prospection — Pharmacies non-partenaires où vos produits sont demandés
        </h3>
        <p style={{ fontSize: 12, color: '#7A5A1A', marginBottom: 12 }}>
          Ces pharmacies ne sont pas dans notre réseau partenaire MAIS nos livreurs y ont scanné vos produits
          pour des clients YARAM. C'est là que vous devriez pousser votre force de vente.
        </p>
        {loading ? (
          <p style={{ fontSize: 13, color: '#7A5A1A' }}>Chargement…</p>
        ) : prospects.length === 0 ? (
          <p style={{ fontSize: 13, color: '#7A5A1A' }}>
            Aucun scan externe pour le moment. Plus on collecte de scans livreur, plus cette section devient riche.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="dist-table" style={{ background: 'transparent' }}>
              <thead>
                <tr>
                  <th>Pharmacie</th>
                  <th style={{ textAlign: 'right' }}>Scans</th>
                  <th>Produits demandés</th>
                  <th>Position GPS</th>
                  <th style={{ textAlign: 'right' }}>Dernier scan</th>
                </tr>
              </thead>
              <tbody>
                {prospects.slice(0, 30).map((p, i) => (
                  <tr key={i}>
                    <td><strong>{p.name}</strong></td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#E8385C' }}>{p.scans}</td>
                    <td style={{ fontSize: 12 }}>
                      {(p.products || []).slice(0, 4).map((pr, idx) => (
                        <span key={idx} className="dist-chip" style={{ background: '#FFE8C8', color: '#7A5A1A' }}>{pr}</span>
                      ))}
                      {(p.products || []).length > 4 && (
                        <span style={{ fontSize: 11, color: '#7A5A1A' }}>+{p.products.length - 4}</span>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: '#6B6B6B' }}>
                      {p.lat && p.lng
                        ? <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}>📍 Carte</a>
                        : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 11, color: '#6B6B6B' }}>
                      {p.lastScanAt ? new Date(p.lastScanAt).toLocaleDateString('fr-FR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {prospects.length > 30 && (
              <p style={{ fontSize: 11, color: '#7A5A1A', marginTop: 8 }}>+ {prospects.length - 30} autres pharmacies…</p>
            )}
          </div>
        )}
      </div>

      {/* ─── TOP PARTENAIRES ─── */}
      <div className="dist-card">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>🏥 Top pharmacies partenaires</h3>
        {loading ? (
          <p style={{ color: '#999', fontSize: 13 }}>Chargement…</p>
        ) : topPartners.length === 0 ? (
          <p style={{ color: '#999', fontSize: 13 }}>Aucune vente partenaire sur la période.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="dist-table">
              <thead>
                <tr>
                  <th>Pharmacie</th>
                  <th>Quartier</th>
                  <th>Tier</th>
                  <th style={{ textAlign: 'right' }}>Commandes</th>
                  <th style={{ textAlign: 'right' }}>Revenu</th>
                  <th style={{ textAlign: 'right' }}>% du total</th>
                  <th style={{ width: 120 }}>Tendance</th>
                </tr>
              </thead>
              <tbody>
                {topPartners.slice(0, 15).map(p => {
                  const pct = totalRevenuePharmas > 0 ? (p.totalRevenue / totalRevenuePharmas) * 100 : 0;
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong></td>
                      <td style={{ fontSize: 12, color: '#6B6B6B' }}>{p.neighborhood || '—'}</td>
                      <td>
                        {p.partnershipTier ? (
                          <span className="dist-chip">{p.partnershipTier}</span>
                        ) : <span style={{ fontSize: 11, color: '#999' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{p.totalOrders}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatFcfa(p.totalRevenue)}</td>
                      <td style={{ textAlign: 'right' }}>{pct.toFixed(1)}%</td>
                      <td>
                        <div className="dist-bar-bg">
                          <div className="dist-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── INSIGHTS ─── */}
      <div className="dist-card">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>💡 Insights & recommandations</h3>
        {loading ? (
          <p style={{ color: '#999', fontSize: 13 }}>Chargement…</p>
        ) : insights.length === 0 ? (
          <p style={{ color: '#999', fontSize: 13 }}>
            Pas encore assez de données pour générer des recommandations sur cette période.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {insights.map((it, i) => (
              <li key={i} style={{
                padding: '10px 12px',
                background: '#F8FAF7',
                borderLeft: '3px solid #1F8B4C',
                borderRadius: 6,
                marginBottom: 8,
                fontSize: 13,
                lineHeight: 1.5,
              }}>
                <span style={{ fontSize: 16, marginRight: 8 }}>{it.icon}</span>
                {it.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ─── FOOTER ─── */}
      <div style={{ marginTop: 24, padding: 14, textAlign: 'center', fontSize: 11, color: '#999' }}>
        Dashboard généré le {new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
        {' · '}Période : {days} jours
        {' · '}YARAM × {distributor.name}
      </div>
    </div>
  );
}
