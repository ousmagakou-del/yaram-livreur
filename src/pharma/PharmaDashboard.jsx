import { useState, useEffect } from 'react';
import { getPharmacyStats } from '../lib/supabase';

export default function PharmaDashboard({ pharmacy, setSection, onPendingChange }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000); // refresh toutes les 30s
    return () => clearInterval(interval);
  }, [pharmacy.id]);

  const refresh = async () => {
    try {
      const data = await getPharmacyStats(pharmacy.id);
      setStats(data);
      onPendingChange?.(data.pendingCount || 0);
    } catch (e) {
      console.error('Stats error:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}>Chargement…</div>;
  }

  return (
    <div className="phar-section">
      <header className="phar-header">
        <div>
          <h1>Bonjour {pharmacy.name} 👋</h1>
          <p>{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </header>

      {/* Alerte commandes en attente */}
      {stats.pendingCount > 0 && (
        <button
          className="phar-alert phar-alert-urgent"
          onClick={() => setSection('orders')}
        >
          <span style={{ fontSize: 28 }}>🔔</span>
          <div>
            <strong>{stats.pendingCount} commande{stats.pendingCount > 1 ? 's' : ''} en attente d'acceptation</strong>
            <span>Clique pour les traiter</span>
          </div>
          <span className="phar-alert-arrow">→</span>
        </button>
      )}

      {/* KPI Grid */}
      <div className="phar-kpi-grid">
        <div className="phar-kpi">
          <div className="phar-kpi-label">📦 Commandes aujourd'hui</div>
          <div className="phar-kpi-value">{stats.todayOrdersCount}</div>
        </div>
        <div className="phar-kpi">
          <div className="phar-kpi-label">⏳ En attente</div>
          <div className="phar-kpi-value" style={{ color: stats.pendingCount > 0 ? '#F4B53A' : '#1A1A1A' }}>
            {stats.pendingCount}
          </div>
        </div>
        <div className="phar-kpi">
          <div className="phar-kpi-label">🛠️ En préparation</div>
          <div className="phar-kpi-value">{stats.preparingCount}</div>
        </div>
        <div className="phar-kpi">
          <div className="phar-kpi-label">🎉 Livrées</div>
          <div className="phar-kpi-value" style={{ color: '#1F8B4C' }}>{stats.deliveredTodayCount}</div>
        </div>
      </div>

      {/* Revenu du jour */}
      <div className="phar-revenue-card">
        <div className="phar-revenue-label">💰 Revenu du jour (livré)</div>
        <div className="phar-revenue-value">
          {stats.todayRevenue.toLocaleString('fr-FR')} <span>FCFA</span>
        </div>
        <div className="phar-revenue-meta">
          Commission Diaara (17.5%) : {Math.round(stats.todayRevenue * 0.175).toLocaleString('fr-FR')} FCFA
        </div>
        <div className="phar-revenue-net">
          Net : <strong>{(stats.todayRevenue - Math.round(stats.todayRevenue * 0.175)).toLocaleString('fr-FR')} FCFA</strong>
        </div>
      </div>

      {/* Actions rapides */}
      <div className="phar-actions-grid">
        <button className="phar-quick-action" onClick={() => setSection('orders')}>
          <span>📦</span>
          <strong>Voir mes commandes</strong>
          <p>Accepter / Refuser / Préparer</p>
        </button>
        <button className="phar-quick-action" onClick={() => setSection('products')}>
          <span>📷</span>
          <strong>Mes produits</strong>
          <p>{stats.activeProductsCount} actifs · Proposer</p>
        </button>
        <button className="phar-quick-action" onClick={() => setSection('inventory')}>
          <span>📚</span>
          <strong>Inventaire</strong>
          <p>Gérer le stock</p>
        </button>
        <button className="phar-quick-action" onClick={() => setSection('commission')}>
          <span>💰</span>
          <strong>Mes commissions</strong>
          <p>Suivi des paiements</p>
        </button>
      </div>

      {/* Info contact */}
      <div className="phar-info-card">
        <h3>📞 Besoin d'aide ?</h3>
        <p>Contact Diaara : <a href="https://wa.me/221777608983" target="_blank" rel="noopener noreferrer">+221 77 760 89 83</a></p>
        <p>WhatsApp prioritaire pour toute urgence livraison ou commande</p>
      </div>
    </div>
  );
}
