import { useState, useEffect } from 'react';
import { supabase, getCachedSetting } from '../lib/supabase';

export default function DashboardSection({ setSection }) {
  const [stats, setStats] = useState({
    orders: 0, revenue: 0, commission: 0, users: 0, pharmacies: 0, products: 0,
    pending: 0, toShip: 0, delivered: 0, avgBasket: 0,
    pendingRevenue: 0,
    lowStock: 0, outOfStock: 0,
  });
  const [recentOrders, setRecentOrders] = useState([]);

  useEffect(() => {
    const fetchAll = async () => {
      const [ordersRes, usersRes, pharmaciesRes, productsRes, inventoryRes] = await Promise.all([
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('users_profile').select('id', { count: 'exact', head: true }),
        supabase.from('pharmacies').select('id', { count: 'exact', head: true }),
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('inventory').select('stock'),
      ]);
      const orders = ordersRes.data || [];
      const delivered = orders.filter(o => o.status === 'delivered');
      const revenue = delivered.reduce((s, o) => s + (o.total || 0), 0);
      const pending = orders.filter(o => o.status === 'pending_payment').length;
      const toShip = orders.filter(o => ['paid', 'preparing', 'ready', 'shipped'].includes(o.status)).length;
      // Vraie somme des commandes en cours (payees, en prepa, en route, attente confirm)
      // — separe du revenu deja livre.
      const pendingRevenue = orders
        .filter(o => ['paid', 'preparing', 'ready', 'shipped', 'awaiting_confirm', 'awaiting_cash'].includes(o.status))
        .reduce((s, o) => s + (Number(o.total) || 0), 0);
      const inv = inventoryRes.data || [];

      setStats({
        orders: orders.length,
        revenue,
        commission: Math.round(revenue * (getCachedSetting('commission', 8) / 100)),
        users: usersRes.count || 0,
        pharmacies: pharmaciesRes.count || 0,
        products: productsRes.count || 0,
        pending,
        toShip,
        delivered: delivered.length,
        avgBasket: delivered.length > 0 ? Math.round(revenue / delivered.length) : 0,
        pendingRevenue,
        lowStock: inv.filter(i => i.stock > 0 && i.stock < 10).length,
        outOfStock: inv.filter(i => i.stock === 0).length,
      });
      setRecentOrders(orders.slice(0, 5));
    };
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Vue d'ensemble</h1>
          <p>Tableau de bord temps réel · refresh toutes les 15s</p>
        </div>
        <div className="adm-header-meta">
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </header>

      <div className="adm-kpi-grid">
        <div className="adm-kpi">
          <div className="adm-kpi-label">REVENU ENCAISSÉ</div>
          <div className="adm-kpi-value" style={{ color: '#1F8B4C' }}>
            {stats.revenue.toLocaleString('fr-FR')}<small>FCFA</small>
          </div>
          <div className="adm-kpi-meta">{stats.delivered} commandes livrées</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">EN ATTENTE</div>
          <div className="adm-kpi-value" style={{ color: '#F4B53A' }}>
            {stats.pendingRevenue.toLocaleString('fr-FR')}<small>FCFA</small>
          </div>
          <div className="adm-kpi-meta">{stats.pending + stats.toShip} commandes en cours</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">PANIER MOYEN</div>
          <div className="adm-kpi-value">
            {stats.avgBasket.toLocaleString('fr-FR')}<small>FCFA</small>
          </div>
          <div className="adm-kpi-meta">par commande livrée</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">CLIENTES</div>
          <div className="adm-kpi-value">{stats.users}</div>
          <div className="adm-kpi-meta">inscrites au total</div>
        </div>
      </div>

      <div className="adm-alerts">
        {stats.outOfStock > 0 && (
          <button className="adm-alert urgent" onClick={() => setSection('products')}>
            <span>⚠️</span>
            <div>
              <strong>{stats.outOfStock} produits en rupture</strong>
              <span>Réapprovisionne pour éviter de perdre des ventes</span>
            </div>
            <span>→</span>
          </button>
        )}
        {stats.lowStock > 0 && (
          <button className="adm-alert" onClick={() => setSection('products')}>
            <span>📦</span>
            <div>
              <strong>{stats.lowStock} produits stock faible (&lt; 10)</strong>
              <span>Prévoir un réapprovisionnement</span>
            </div>
            <span>→</span>
          </button>
        )}
        {stats.pending > 0 && (
          <button className="adm-alert" onClick={() => setSection('orders')}>
            <span>⏳</span>
            <div>
              <strong>{stats.pending} commandes en attente de paiement</strong>
              <span>Relancer les clientes</span>
            </div>
            <span>→</span>
          </button>
        )}
      </div>

      <div className="adm-recent-card">
        <div className="adm-recent-head">
          <h3>Dernières commandes</h3>
          <button className="adm-link" onClick={() => setSection('orders')}>Toutes →</button>
        </div>
        {recentOrders.length === 0 ? (
          <div className="adm-empty" style={{ padding: 20 }}>Aucune commande pour l'instant.</div>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Commande</th>
                <th>Cliente</th>
                <th>Articles</th>
                <th>Total</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map(o => (
                <tr key={o.id}>
                  <td><code>{o.id}</code></td>
                  <td>{o.address?.name || '—'}</td>
                  <td>{o.items?.length || 0} art.</td>
                  <td>{o.total?.toLocaleString('fr-FR')} FCFA</td>
                  <td><span className="adm-badge good">{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
