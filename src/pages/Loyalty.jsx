import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { getMyLoyalty, getLoyaltyTransactions, pointsToFcfa, getTierInfo } from '../lib/supabase';
import './Loyalty.css';

export default function Loyalty() {
  const { navigate } = useNav();
  const { user } = useUser();
  const [data, setData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [d, t] = await Promise.all([
        getMyLoyalty(user.id),
        getLoyaltyTransactions(user.id),
      ]);
      setData(d);
      setTransactions(t);
      setLoading(false);
    })();
  }, [user]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Chargement…</div>;

  const tier = getTierInfo(data.loyalty_tier);
  const equivalentFcfa = pointsToFcfa(data.loyalty_points);
  
  // Progression vers prochain niveau
  let nextTierAt = 30000;
  let nextTierName = 'Argent';
  if (data.loyalty_tier === 'silver') { nextTierAt = 100000; nextTierName = 'Or'; }
  if (data.loyalty_tier === 'gold') { nextTierAt = null; }
  const progress = nextTierAt ? Math.min(100, (data.loyalty_total_earned / nextTierAt) * 100) : 100;
  const remaining = nextTierAt ? nextTierAt - data.loyalty_total_earned : 0;

  return (
    <div className="ly-screen">
      <header className="ly-header">
        <button className="ly-back" onClick={() => navigate(-1)}>←</button>
        <h1>Mes points</h1>
      </header>

      <div className="ly-scroll">
        {/* Big card avec points */}
        <div className="ly-points-card">
          <div className="ly-tier-badge">{tier.emoji} Niveau {tier.label.replace(/[🥇🥈🥉]/g, '').trim()}</div>
          <div className="ly-points-number">{data.loyalty_points.toLocaleString('fr-FR')}</div>
          <div className="ly-points-label">points</div>
          
          {equivalentFcfa > 0 && (
            <div className="ly-equiv">
              = {equivalentFcfa.toLocaleString('fr-FR')} FCFA de réduction
            </div>
          )}
        </div>

        {/* Progression vers prochain niveau */}
        {nextTierAt && (
          <div className="ly-progress-card">
            <div className="ly-progress-head">
              <span>Vers le niveau <strong>{nextTierName}</strong></span>
              <span>{remaining.toLocaleString('fr-FR')} pts restants</span>
            </div>
            <div className="ly-progress-bar">
              <div className="ly-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="ly-progress-meta">
              {data.loyalty_total_earned.toLocaleString('fr-FR')} / {nextTierAt.toLocaleString('fr-FR')} points cumulés
            </p>
          </div>
        )}

        {/* Comment ça marche */}
        <div className="ly-info-card">
          <h3>💚 Comment ça marche</h3>
          <ul>
            <li><strong>1 FCFA dépensé = 1 point gagné</strong></li>
            <li><strong>100 points = 500 FCFA</strong> de réduction</li>
            <li>Points utilisables sur ton prochain achat</li>
            <li>30 000 pts cumulés → niveau Argent 🥈</li>
            <li>100 000 pts cumulés → niveau Or 🥇</li>
          </ul>
        </div>

        {/* Avantages par niveau */}
        <div className="ly-tiers">
          <h3>Avantages par niveau</h3>
          <div className="ly-tier-row">
            <span>🥉 Bronze</span>
            <span>1 point / FCFA</span>
          </div>
          <div className="ly-tier-row">
            <span>🥈 Argent</span>
            <span>1.5 point / FCFA</span>
          </div>
          <div className="ly-tier-row">
            <span>🥇 Or</span>
            <span>2 points / FCFA + livraison gratuite</span>
          </div>
        </div>

        {/* Historique */}
        <div className="ly-history">
          <h3>Historique</h3>
          {transactions.length === 0 ? (
            <p className="ly-empty">Pas encore de transactions. Fais ton premier achat !</p>
          ) : (
            transactions.map(t => (
              <div key={t.id} className="ly-tx">
                <div className="ly-tx-info">
                  <strong>{t.reason || t.type}</strong>
                  <span>{new Date(t.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                </div>
                <div className={`ly-tx-points ${t.points > 0 ? 'positive' : 'negative'}`}>
                  {t.points > 0 ? '+' : ''}{t.points.toLocaleString('fr-FR')}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
