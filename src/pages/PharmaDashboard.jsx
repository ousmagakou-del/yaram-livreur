import { useState, useEffect } from 'react';
import { getPharmacyStats } from '../lib/supabase';

export default function PharmaDashboard({ pharmacy, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pharmacy?.id) return;
    (async () => {
      const s = await getPharmacyStats(pharmacy.id);
      setStats(s);
      setLoading(false);
    })();
    const t = setInterval(async () => {
      const s = await getPharmacyStats(pharmacy.id);
      setStats(s);
    }, 30000);
    return () => clearInterval(t);
  }, [pharmacy]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#6B6B6B' }}>Chargement…</div>;

  const S = {
    page: { padding: 16, paddingBottom: 80, background: '#F5F6F8', minHeight: '100%' },
    greeting: { marginBottom: 16 },
    h1: { fontSize: 22, fontWeight: 800, color: '#1A1A1A', marginBottom: 4 },
    date: { color: '#6B6B6B', fontSize: 13, textTransform: 'capitalize' },
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 },
    statCard: { background: 'white', borderRadius: 14, padding: 14, border: '1px solid #EEE' },
    statPrimary: { background: 'linear-gradient(135deg, #1F8B4C 0%, #166635 100%)', color: 'white', border: 'none', cursor: 'pointer', borderRadius: 14, padding: 14 },
    statInfo: { background: '#E8F0FE', color: '#1A1A1A', borderRadius: 14, padding: 14, border: '1px solid #DCE7FB' },
    statSuccess: { background: '#E8F5EC', color: '#1A1A1A', borderRadius: 14, padding: 14, border: '1px solid #C8E6D2' },
    statGold: { background: '#FEF6E5', color: '#1A1A1A', borderRadius: 14, padding: 14, border: '1px solid #F4E5C5' },
    statIcon: { fontSize: 22, marginBottom: 6 },
    statNum: { fontSize: 30, fontWeight: 800, lineHeight: 1, display: 'block' },
    statLabel: { fontSize: 11, opacity: 0.85, marginTop: 6, display: 'block' },
    miniStat: { flex: 1, background: 'white', border: '1px solid #EEE', borderRadius: 12, padding: 12, textAlign: 'center', cursor: 'pointer' },
    miniNum: { fontSize: 22, fontWeight: 800, color: '#1F8B4C', display: 'block' },
    miniLabel: { fontSize: 11, color: '#6B6B6B' },
    section: { marginTop: 20 },
    sectionTitle: { fontSize: 14, fontWeight: 800, marginBottom: 10, color: '#1A1A1A' },
    actionBtn: { width: '100%', background: 'white', border: '1px solid #EEE', borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginBottom: 8, fontFamily: 'inherit', textAlign: 'left' },
    actionIcon: { fontSize: 24 },
    actionText: { flex: 1 },
    actionTitle: { display: 'block', fontSize: 14, fontWeight: 700, color: '#1A1A1A' },
    actionDesc: { fontSize: 11, color: '#6B6B6B' },
    actionArrow: { color: '#1F8B4C', fontWeight: 700, fontSize: 18 },
  };

  return (
    <div style={S.page}>
      <div style={S.greeting}>
        <h1 style={S.h1}>👋 Bonjour</h1>
        <p style={S.date}>{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {/* Stats principales */}
      <div style={S.grid}>
        <button style={S.statPrimary} onClick={() => onNavigate('orders')}>
          <div style={S.statIcon}>📦</div>
          <span style={S.statNum}>{stats.pendingCount}</span>
          <span style={S.statLabel}>En attente</span>
          {stats.pendingCount > 0 && (
            <div style={{ fontSize: 10, fontWeight: 700, marginTop: 6, opacity: 0.9 }}>→ Traiter</div>
          )}
        </button>

        <div style={S.statInfo}>
          <div style={S.statIcon}>⚡</div>
          <span style={S.statNum}>{stats.preparingCount}</span>
          <span style={S.statLabel}>En préparation</span>
        </div>

        <div style={S.statSuccess}>
          <div style={S.statIcon}>✅</div>
          <span style={S.statNum}>{stats.deliveredTodayCount}</span>
          <span style={S.statLabel}>Livrées aujourd'hui</span>
        </div>

        <div style={S.statGold}>
          <div style={S.statIcon}>💰</div>
          <span style={S.statNum}>{stats.todayRevenue.toLocaleString('fr-FR')}</span>
          <span style={S.statLabel}>FCFA encaissés</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={S.miniStat} onClick={() => onNavigate('inventory')}>
          <span style={S.miniNum}>{stats.activeProductsCount}</span>
          <span style={S.miniLabel}>Produits actifs</span>
        </div>
        <div style={S.miniStat} onClick={() => onNavigate('commissions')}>
          <span style={S.miniNum}>8%</span>
          <span style={S.miniLabel}>Commission Diaara</span>
        </div>
      </div>

      {/* Actions rapides */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Actions rapides</div>

        <button style={S.actionBtn} onClick={() => onNavigate('orders')}>
          <span style={S.actionIcon}>📦</span>
          <div style={S.actionText}>
            <strong style={S.actionTitle}>Voir les commandes</strong>
            <span style={S.actionDesc}>Accepter, refuser, marquer prêtes</span>
          </div>
          <span style={S.actionArrow}>→</span>
        </button>

        <button style={S.actionBtn} onClick={() => onNavigate('inventory')}>
          <span style={S.actionIcon}>📚</span>
          <div style={S.actionText}>
            <strong style={S.actionTitle}>Gérer mon stock</strong>
            <span style={S.actionDesc}>Mettre à jour les disponibilités</span>
          </div>
          <span style={S.actionArrow}>→</span>
        </button>

        <button style={S.actionBtn} onClick={() => onNavigate('commissions')}>
          <span style={S.actionIcon}>💰</span>
          <div style={S.actionText}>
            <strong style={S.actionTitle}>Mes commissions</strong>
            <span style={S.actionDesc}>Revenus et paiements 8%</span>
          </div>
          <span style={S.actionArrow}>→</span>
        </button>

        <button style={S.actionBtn} onClick={() => onNavigate('settings')}>
          <span style={S.actionIcon}>⚙️</span>
          <div style={S.actionText}>
            <strong style={S.actionTitle}>Paramètres</strong>
            <span style={S.actionDesc}>Horaires, contact, infos pharmacie</span>
          </div>
          <span style={S.actionArrow}>→</span>
        </button>
      </div>
    </div>
  );
}
