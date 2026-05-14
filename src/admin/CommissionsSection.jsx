import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function CommissionsSection() {
  const [orders, setOrders] = useState([]);
  const [pharmacies, setPharmacies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [oRes, pRes] = await Promise.all([
        supabase.from('orders').select('*').eq('status', 'delivered'),
        supabase.from('pharmacies').select('*'),
      ]);
      setOrders(oRes.data || []);
      setPharmacies(pRes.data || []);
      setLoading(false);
    })();
  }, []);

  // Calcul par pharmacie
  const byPharmacy = {};
  orders.forEach(o => {
    (o.items || []).forEach(it => {
      const phId = it.pharmacyId;
      if (!byPharmacy[phId]) byPharmacy[phId] = { name: it.pharmacyName, total: 0, articles: 0, orders: new Set() };
      const sub = it.qty * it.price;
      byPharmacy[phId].total += sub;
      byPharmacy[phId].articles += it.qty;
      byPharmacy[phId].orders.add(o.id);
    });
  });

  const rows = Object.entries(byPharmacy).map(([id, d]) => {
    const ph = pharmacies.find(p => p.id === id);
    const rate = (ph?.commission || 17.5) / 100;
    return {
      id, name: d.name, total: d.total, articles: d.articles,
      orders: d.orders.size,
      commission: Math.round(d.total * rate),
      payout: Math.round(d.total * (1 - rate)),
      rate: ph?.commission || 17.5,
    };
  }).sort((a, b) => b.total - a.total);

  const totals = rows.reduce((acc, r) => ({
    ca: acc.ca + r.total,
    commission: acc.commission + r.commission,
    payout: acc.payout + r.payout,
  }), { ca: 0, commission: 0, payout: 0 });

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Commissions</h1>
          <p>Suivi des paiements à reverser aux pharmacies</p>
        </div>
      </header>

      <div className="adm-kpi-grid">
        <div className="adm-kpi">
          <div className="adm-kpi-label">CA TOTAL MARKETPLACE</div>
          <div className="adm-kpi-value" style={{ color: '#1F8B4C' }}>
            {totals.ca.toLocaleString('fr-FR')}<small>FCFA</small>
          </div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">💰 COMMISSION YARAM</div>
          <div className="adm-kpi-value" style={{ color: '#166635' }}>
            {totals.commission.toLocaleString('fr-FR')}<small>FCFA</small>
          </div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">À REVERSER PHARMACIES</div>
          <div className="adm-kpi-value" style={{ color: '#F4B53A' }}>
            {totals.payout.toLocaleString('fr-FR')}<small>FCFA</small>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : rows.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>💰</div>
          <p>Aucune commande livrée pour l'instant</p>
        </div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Pharmacie</th>
              <th>Commandes</th>
              <th>Articles</th>
              <th>CA</th>
              <th>Commission</th>
              <th>À reverser</th>
              <th>Taux</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><strong>🏥 {r.name}</strong></td>
                <td>{r.orders}</td>
                <td>{r.articles}</td>
                <td>{r.total.toLocaleString('fr-FR')} FCFA</td>
                <td style={{ color: '#1F8B4C' }}><strong>{r.commission.toLocaleString('fr-FR')} FCFA</strong></td>
                <td style={{ color: '#F4B53A' }}><strong>{r.payout.toLocaleString('fr-FR')} FCFA</strong></td>
                <td>{r.rate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
