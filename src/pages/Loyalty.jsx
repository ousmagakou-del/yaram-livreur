import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { supabase } from '../lib/supabase';
import TabBar from '../components/TabBar';
import './Loyalty.css';

const TIER_INFO = {
  bronze: {
    name: 'Bronze',
    color: '#CD7F32',
    bg: 'linear-gradient(135deg, #C8956A 0%, #8C5A2C 100%)',
    icon: '🥉',
    next: 500,
    nextName: 'Silver',
  },
  silver: {
    name: 'Silver',
    color: '#7F8C95',
    bg: 'linear-gradient(135deg, #BBC5CB 0%, #6B7780 100%)',
    icon: '🥈',
    next: 2000,
    nextName: 'Gold',
  },
  gold: {
    name: 'Gold',
    color: '#D4AF37',
    bg: 'linear-gradient(135deg, #F6D365 0%, #BF9B25 100%)',
    icon: '🏆',
    next: null,
    nextName: null,
  },
};

const REDEEM_OPTIONS = [
  { points: 100, fcfa: 1000 },
  { points: 200, fcfa: 2000 },
  { points: 500, fcfa: 5000 },
  { points: 1000, fcfa: 10000 },
];

export default function Loyalty() {
  const { navigate } = useNav();
  const { user, refreshUser } = useUser();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    refreshTransactions();
  }, [user?.id]);

  const refreshTransactions = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('loyalty_transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (!error) setTransactions(data || []);
    setLoading(false);
  };

  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 2500);
  };

  const handleRedeem = async (points) => {
    if (!confirm(`Échanger ${points} points contre ${(points / 100) * 1000} FCFA de réduction ?`)) return;
    setRedeeming(points);
    const { data, error } = await supabase.rpc('redeem_loyalty_points', {
      p_user_id: user.id,
      p_points: points,
    });
    setRedeeming(null);

    if (error) {
      showToast('Erreur : ' + error.message);
      return;
    }

    if (!data?.success) {
      showToast(data?.error || 'Échec');
      return;
    }

    // Stocke le crédit dans localStorage pour utilisation au checkout
    try {
      const existing = JSON.parse(localStorage.getItem('yaram_loyalty_credit') || '0');
      const newCredit = parseInt(existing) + parseInt(data.fcfa_credit);
      localStorage.setItem('yaram_loyalty_credit', String(newCredit));
    } catch {}

    showToast(`✓ ${data.fcfa_credit} FCFA crédités sur ta prochaine cmd`);
    refreshUser?.();
    refreshTransactions();
  };

  const balance = user?.loyalty_points || 0;
  const totalEarned = user?.loyalty_total_earned || 0;
  const tier = user?.loyalty_tier || 'bronze';
  const tierData = TIER_INFO[tier];
  const progressPct = tierData.next
    ? Math.min(100, (totalEarned / tierData.next) * 100)
    : 100;

  const fmt = (n) => Number(n).toLocaleString('fr-FR');

  return (
    <div className="yloy-screen page-anim">
      <div className="yloy-scroll">
        <header className="yloy-header">
          <button className="yloy-back" onClick={() => navigate(-1)} aria-label="Retour">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div>
            <h1>Fidélité</h1>
            <p>Gagne des points à chaque commande</p>
          </div>
        </header>

        {/* Carte solde + tier */}
        <div className="yloy-card" style={{ background: tierData.bg }}>
          <div className="yloy-tier-badge">
            <span className="yloy-tier-icon">{tierData.icon}</span>
            <span className="yloy-tier-name">{tierData.name}</span>
          </div>
          <div className="yloy-balance-label">Mes points</div>
          <div className="yloy-balance-value">{fmt(balance)}</div>
          <div className="yloy-balance-equiv">
            ≈ {fmt(Math.floor(balance / 100) * 1000)} FCFA disponibles
          </div>

          {tierData.next && (
            <>
              <div className="yloy-progress-info">
                <span>{fmt(totalEarned)} / {fmt(tierData.next)} pour {tierData.nextName}</span>
              </div>
              <div className="yloy-progress-bar">
                <div className="yloy-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            </>
          )}
        </div>

        {/* Options d'échange */}
        <section className="yloy-section">
          <h2 className="yloy-section-title">💰 Échanger mes points</h2>
          <div className="yloy-section-sub">100 points = 1 000 FCFA de réduction</div>

          <div className="yloy-redeem-grid">
            {REDEEM_OPTIONS.map(opt => {
              const canRedeem = balance >= opt.points;
              return (
                <button
                  key={opt.points}
                  className={`yloy-redeem-btn ${canRedeem ? '' : 'disabled'} ${redeeming === opt.points ? 'loading' : ''}`}
                  onClick={() => canRedeem && handleRedeem(opt.points)}
                  disabled={!canRedeem || redeeming != null}
                >
                  <div className="yloy-redeem-pts">{fmt(opt.points)} pts</div>
                  <div className="yloy-redeem-arrow">↓</div>
                  <div className="yloy-redeem-fcfa">{fmt(opt.fcfa)} FCFA</div>
                  {!canRedeem && <div className="yloy-redeem-miss">Manque {opt.points - balance}</div>}
                </button>
              );
            })}
          </div>
        </section>

        {/* Comment gagner */}
        <section className="yloy-section">
          <h2 className="yloy-section-title">✨ Comment gagner des points</h2>
          <div className="yloy-earn-list">
            <div className="yloy-earn-item">
              <div className="yloy-earn-icon">🛍️</div>
              <div className="yloy-earn-text">
                <strong>Commande livrée</strong>
                <span>+10 points par commande</span>
              </div>
              <button className="yloy-earn-cta" onClick={() => navigate('/')}>Voir →</button>
            </div>
            <div className="yloy-earn-item">
              <div className="yloy-earn-icon">⭐</div>
              <div className="yloy-earn-text">
                <strong>Laisser un avis</strong>
                <span>+50 points avec photo</span>
              </div>
              <button className="yloy-earn-cta" onClick={() => navigate({ name: 'orders', params: {} })}>Mes cmds →</button>
            </div>
            <div className="yloy-earn-item">
              <div className="yloy-earn-icon">👯</div>
              <div className="yloy-earn-text">
                <strong>Parrainer une amie</strong>
                <span>+500 points si elle commande</span>
              </div>
              <button className="yloy-earn-cta" onClick={() => navigate({ name: 'referral', params: {} })}>Inviter →</button>
            </div>
            <div className="yloy-earn-item">
              <div className="yloy-earn-icon">🧴</div>
              <div className="yloy-earn-text">
                <strong>Scan IA peau</strong>
                <span>+25 points (1 fois/mois)</span>
              </div>
              <button className="yloy-earn-cta" onClick={() => navigate({ name: 'scan', params: {} })}>Scanner →</button>
            </div>
          </div>
        </section>

        {/* Historique */}
        <section className="yloy-section">
          <h2 className="yloy-section-title">📜 Historique</h2>
          {loading ? (
            <div className="yloy-loading">Chargement…</div>
          ) : transactions.length === 0 ? (
            <div className="yloy-empty">
              <div style={{ fontSize: 36, opacity: 0.4 }}>📭</div>
              <p>Aucune transaction pour l'instant</p>
              <p style={{ fontSize: 11, color: '#9B9B9B' }}>Passe ta 1ère commande pour gagner +10 points !</p>
            </div>
          ) : (
            <div className="yloy-tx-list">
              {transactions.map(tx => (
                <div key={tx.id} className="yloy-tx-item">
                  <div className="yloy-tx-icon">
                    {tx.type === 'earn_order'   && '🛍️'}
                    {tx.type === 'earn_admin'   && '🎁'}
                    {tx.type === 'adjust_admin' && '⚙️'}
                    {tx.type === 'redeem'       && '💰'}
                    {tx.type === 'earn_review'  && '⭐'}
                    {tx.type === 'earn_referral'&& '👯'}
                    {!['earn_order','earn_admin','adjust_admin','redeem','earn_review','earn_referral'].includes(tx.type) && '•'}
                  </div>
                  <div className="yloy-tx-text">
                    <strong>{tx.reason || tx.type}</strong>
                    <span>{new Date(tx.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>
                  <div className={`yloy-tx-pts ${tx.points > 0 ? 'positive' : 'negative'}`}>
                    {tx.points > 0 ? '+' : ''}{tx.points} pts
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div style={{ height: 40 }} />
      </div>

      {toast && <div className="yloy-toast">{toast}</div>}

      <TabBar active="profile" />
    </div>
  );
}
