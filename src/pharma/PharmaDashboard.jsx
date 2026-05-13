import { useState, useEffect } from 'react';
import { getPharmacyStats } from '../lib/supabase';

export default function PharmaDashboard({ pharmacy, setSection, onPendingChange }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pharmacy?.id) return;

    const load = async () => {
      const s = await getPharmacyStats(pharmacy.id);
      setStats(s);
      setLoading(false);
      if (onPendingChange && s && typeof s.pendingCount === 'number') {
        onPendingChange(s.pendingCount);
      }
    };

    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [pharmacy, onPendingChange]);

  if (loading) {
    return (
      <div className="phar-section">
        <div className="phar-empty">Chargement…</div>
      </div>
    );
  }

  const s = stats || {};
  const pending = s.pendingCount || 0;
  const preparing = s.preparingCount || 0;
  const deliveredToday = s.deliveredTodayCount || 0;
  const todayRevenue = s.todayRevenue || 0;
  const activeProducts = s.activeProductsCount || 0;
  const monthRevenue = s.monthRevenue || 0;

  return (
    <div className="phar-section">
      <div className="phar-header">
        <div>
          <h1>👋 Bonjour</h1>
          <p style={{ textTransform: 'capitalize' }}>
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      {/* Alerte commandes en attente */}
      {pending > 0 && (
        <button
          className="phar-alert phar-alert-urgent"
          onClick={() => setSection && setSection('orders')}
        >
          <div>
            <strong>📦 {pending} commande{pending > 1 ? 's' : ''} en attente</strong>
            <span>Accepte ou refuse pour démarrer la préparation</span>
          </div>
          <span className="phar-alert-arrow">→</span>
        </button>
      )}

      {/* Revenu du mois */}
      <div className="phar-revenue-card">
        <div className="phar-revenue-label">Chiffre d'affaires du mois</div>
        <div className="phar-revenue-value">
          {monthRevenue.toLocaleString('fr-FR')}<span>FCFA</span>
        </div>
        <div className="phar-revenue-net">
          💰 Aujourd'hui : <strong>{todayRevenue.toLocaleString('fr-FR')} FCFA</strong>
          {' · '}
          ✅ {deliveredToday} commande{deliveredToday > 1 ? 's' : ''} livrée{deliveredToday > 1 ? 's' : ''}
        </div>
      </div>

      {/* KPI */}
      <div className="phar-kpi-grid">
        <div className="phar-kpi">
          <div className="phar-kpi-label">📦 En attente</div>
          <div className="phar-kpi-value">{pending}</div>
          <div className="phar-kpi-meta">À traiter</div>
        </div>
        <div className="phar-kpi">
          <div className="phar-kpi-label">⚡ En préparation</div>
          <div className="phar-kpi-value">{preparing}</div>
          <div className="phar-kpi-meta">En cours</div>
        </div>
        <div className="phar-kpi">
          <div className="phar-kpi-label">✅ Livrées aujourd'hui</div>
          <div className="phar-kpi-value">{deliveredToday}</div>
          <div className="phar-kpi-meta">Commandes finalisées</div>
        </div>
        <div className="phar-kpi">
          <div className="phar-kpi-label">📚 Produits actifs</div>
          <div className="phar-kpi-value">{activeProducts}</div>
          <div className="phar-kpi-meta">En vente</div>
        </div>
      </div>

      {/* Actions rapides */}
      <div style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 12, color: '#1A1A1A' }}>
          Actions rapides
        </h3>
        <div className="phar-actions-grid">
          <button className="phar-quick-action" onClick={() => setSection && setSection('orders')}>
            <span>📦</span>
            <strong>Gérer les commandes</strong>
            <p>Accepter, refuser, marquer prêtes</p>
          </button>
          <button className="phar-quick-action" onClick={() => setSection && setSection('inventory')}>
            <span>📚</span>
            <strong>Mettre à jour le stock</strong>
            <p>Disponibilités produits</p>
          </button>
          <button className="phar-quick-action" onClick={() => setSection && setSection('commission')}>
            <span>💰</span>
            <strong>Mes commissions</strong>
            <p>Revenus et paiements</p>
          </button>
          <button className="phar-quick-action" onClick={() => setSection && setSection('settings')}>
            <span>⚙️</span>
            <strong>Paramètres</strong>
            <p>Horaires, contact, infos</p>
          </button>
        </div>
      </div>
    </div>
  );
}
