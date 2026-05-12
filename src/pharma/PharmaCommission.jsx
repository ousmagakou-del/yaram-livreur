import { useState, useEffect } from 'react';
import { getPharmacyCommissions } from '../lib/supabase';

export default function PharmaCommission({ pharmacyId, pharmacyName }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const result = await getPharmacyCommissions(pharmacyId);
      setData(result);
      setLoading(false);
    })();
  }, [pharmacyId]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Chargement…</div>;
  if (!data) return null;

  // Prochain paiement = fin du mois en cours
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysUntilPayment = Math.ceil((lastDay - now) / (1000 * 60 * 60 * 24));

  return (
    <div className="phar-section">
      <header className="phar-header">
        <div>
          <h1>Mes commissions</h1>
          <p>Suivi des revenus et paiements mensuels</p>
        </div>
      </header>

      {/* Montant à recevoir ce mois */}
      <div className="phar-revenue-card phar-revenue-big">
        <div className="phar-revenue-label">💰 Net à recevoir ce mois</div>
        <div className="phar-revenue-value">
          {data.monthNet.toLocaleString('fr-FR')} <span>FCFA</span>
        </div>
        <div className="phar-revenue-meta">
          {data.monthOrders.length} commande{data.monthOrders.length > 1 ? 's' : ''} livrée{data.monthOrders.length > 1 ? 's' : ''} ce mois
        </div>
        <div className="phar-revenue-net">
          💸 Paiement dans <strong>{daysUntilPayment} jour{daysUntilPayment > 1 ? 's' : ''}</strong> (le {lastDay.toLocaleDateString('fr-FR')})
        </div>
      </div>

      {/* Décomposition mois */}
      <div className="phar-kpi-grid">
        <div className="phar-kpi">
          <div className="phar-kpi-label">💰 Chiffre d'affaires</div>
          <div className="phar-kpi-value">{data.monthRevenue.toLocaleString('fr-FR')}</div>
          <div className="phar-kpi-meta">FCFA brut</div>
        </div>
        <div className="phar-kpi">
          <div className="phar-kpi-label">📊 Commission Diaara</div>
          <div className="phar-kpi-value" style={{ color: '#F4B53A' }}>
            -{data.monthCommission.toLocaleString('fr-FR')}
          </div>
          <div className="phar-kpi-meta">17.5%</div>
        </div>
        <div className="phar-kpi">
          <div className="phar-kpi-label">✅ Net à recevoir</div>
          <div className="phar-kpi-value" style={{ color: '#1F8B4C' }}>
            {data.monthNet.toLocaleString('fr-FR')}
          </div>
          <div className="phar-kpi-meta">FCFA</div>
        </div>
      </div>

      {/* Historique total */}
      <div className="phar-info-card" style={{ marginTop: 20 }}>
        <h3>📊 Total historique</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
          <div>
            <p style={{ fontSize: 11, color: '#6B6B6B' }}>Chiffre d'affaires total</p>
            <strong style={{ fontSize: 18 }}>{data.totalRevenue.toLocaleString('fr-FR')} FCFA</strong>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#6B6B6B' }}>Commission totale</p>
            <strong style={{ fontSize: 18, color: '#F4B53A' }}>{data.totalCommission.toLocaleString('fr-FR')} FCFA</strong>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#6B6B6B' }}>Net total</p>
            <strong style={{ fontSize: 18, color: '#1F8B4C' }}>{data.totalNet.toLocaleString('fr-FR')} FCFA</strong>
          </div>
        </div>
      </div>

      {/* Historique des paiements */}
      {data.payments && data.payments.length > 0 && (
        <div className="phar-info-card" style={{ marginTop: 20 }}>
          <h3>💸 Historique des paiements</h3>
          <table className="phar-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Période</th>
                <th>Montant</th>
                <th>Méthode</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map(p => (
                <tr key={p.id}>
                  <td>{new Date(p.period_start).toLocaleDateString('fr-FR')} → {new Date(p.period_end).toLocaleDateString('fr-FR')}</td>
                  <td><strong>{p.amount_due?.toLocaleString('fr-FR')} FCFA</strong></td>
                  <td>{p.paid_method || '—'}</td>
                  <td>
                    {p.status === 'paid' ? (
                      <span className="phar-badge phar-badge-delivered">✅ Payé</span>
                    ) : (
                      <span className="phar-badge phar-badge-paid">⏳ En attente</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Détail commandes du mois */}
      <div className="phar-info-card" style={{ marginTop: 20 }}>
        <h3>📦 Commandes livrées ce mois ({data.monthOrders.length})</h3>
        {data.monthOrders.length === 0 ? (
          <p style={{ color: '#9B9B9B', textAlign: 'center', padding: 20 }}>
            Aucune commande livrée ce mois
          </p>
        ) : (
          <table className="phar-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Commande</th>
                <th>Date</th>
                <th>Revenu</th>
                <th>Commission</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {data.monthOrders.map(o => (
                <tr key={o.id}>
                  <td><code>{o.id}</code></td>
                  <td>{new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
                  <td>{o.pharmacy_revenue?.toLocaleString('fr-FR')} FCFA</td>
                  <td style={{ color: '#F4B53A' }}>-{o.pharmacy_commission?.toLocaleString('fr-FR')}</td>
                  <td><strong style={{ color: '#1F8B4C' }}>{o.pharmacy_net?.toLocaleString('fr-FR')}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Info paiement */}
      <div className="phar-info-card" style={{ marginTop: 20, background: '#FEF6E5' }}>
        <h3>💡 Comment fonctionne le paiement</h3>
        <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Paiement <strong>mensuel</strong>, le dernier jour de chaque mois</li>
          <li>Commission Diaara : <strong>17.5%</strong> sur chaque commande livrée</li>
          <li>Méthodes de paiement : Wave, Orange Money, virement bancaire</li>
          <li>Contact pour question : <a href="https://wa.me/221777608983">+221 77 760 89 83</a></li>
        </ul>
      </div>
    </div>
  );
}
