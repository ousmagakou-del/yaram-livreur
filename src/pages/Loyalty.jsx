import { useState, useEffect, useRef } from 'react';
import { useNav, useUser } from '../App';
import { supabase } from '../lib/supabase';
import { haptic } from '../lib/haptic';
import TabBar from '../components/TabBar';
import './Loyalty.css';

/* ─── Paliers (Bronze → Platine) ─── */
const TIERS = [
  {
    id: 'bronze',
    name: 'Bronze',
    icon: '🥉',
    min: 0,
    next: 500,
    bg: 'linear-gradient(135deg, #C8956A 0%, #8C5A2C 100%)',
    perks: ['Accès à la fidélité', 'Offres newsletter exclusives'],
  },
  {
    id: 'silver',
    name: 'Argent',
    icon: '🥈',
    min: 500,
    next: 2000,
    bg: 'linear-gradient(135deg, #BBC5CB 0%, #6B7780 100%)',
    perks: ['Livraison réduite (-50%)', '+5% de points sur tes commandes'],
  },
  {
    id: 'gold',
    name: 'Or',
    icon: '🏆',
    min: 2000,
    next: 5000,
    bg: 'linear-gradient(135deg, #F6D365 0%, #BF9B25 100%)',
    perks: ['Livraison gratuite', '10% sur les marques premium', 'Accès anticipé aux nouveautés'],
  },
  {
    id: 'platinum',
    name: 'Platine',
    icon: '💎',
    min: 5000,
    next: null,
    bg: 'linear-gradient(135deg, #B4E0E8 0%, #4A90A8 100%)',
    perks: ['Tout les avantages Or', 'Conseillère dédiée', 'Cadeaux d\'anniversaire'],
  },
];

/* Détermine palier courant depuis totalEarned */
function getTierFromTotal(total) {
  let current = TIERS[0];
  for (const t of TIERS) {
    if (total >= t.min) current = t;
  }
  return current;
}

/* Hook counter animé */
function useCounter(target, duration = 1100) {
  const [value, setValue] = useState(0);
  const raf = useRef(null);

  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const ease = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(from + (target - from) * ease(p)));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);

  return value;
}

export default function Loyalty() {
  const { navigate } = useNav();
  const { user, refreshUser } = useUser();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [progressPct, setProgressPct] = useState(0);

  /* PRESERVE : fetch loyalty transactions */
  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Safety 12s : libère l'UI si la requête loyalty_transactions hang
    const safety = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 12000);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('loyalty_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(30);
        if (cancelled) return;
        if (!error) setTransactions(data || []);
      } catch (e) {
        console.warn('[Loyalty] fetch failed:', e?.message);
      } finally {
        if (!cancelled) setLoading(false);
        clearTimeout(safety);
      }
    })();
    return () => { cancelled = true; clearTimeout(safety); };
  }, [user?.id]);

  const balance = user?.loyalty_points || 0;
  const totalEarned = user?.loyalty_total_earned || balance || 0;
  const currentTier = getTierFromTotal(totalEarned);
  const animatedPoints = useCounter(balance);
  const equivFCFA = Math.floor(balance / 100) * 1000; // 100 pts = 1000 FCFA
  const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

  /* Progression palier */
  const tierProgressPct = currentTier.next
    ? Math.min(100, ((totalEarned - currentTier.min) / (currentTier.next - currentTier.min)) * 100)
    : 100;

  // animate progress fill on mount
  useEffect(() => {
    const t = setTimeout(() => setProgressPct(tierProgressPct), 250);
    return () => clearTimeout(t);
  }, [tierProgressPct]);

  /* Prochain palier */
  const nextTier = TIERS.find(t => t.min === currentTier.next);
  const pointsToNext = currentTier.next ? Math.max(0, currentTier.next - totalEarned) : 0;
  const fcfaToNextEquiv = pointsToNext * 10; // approximation 1 pt ≈ 10 FCFA d'avantage

  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 2500);
  };

  /* CTA : utiliser mes points → set credit + redirect */
  const useMyPoints = () => {
    if (balance < 100) {
      showToast('Il te faut au moins 100 points');
      return;
    }
    haptic('medium');
    const fcfa = Math.floor(balance / 100) * 1000;
    try {
      localStorage.setItem('yaram_loyalty_credit', String(fcfa));
      localStorage.setItem('yaram_loyalty_credit_pts', String(Math.floor(balance / 100) * 100));
    } catch {}
    showToast(`✓ ${fmt(fcfa)} FCFA prêts à l'usage`);
    setTimeout(() => navigate('/cart'), 700);
  };

  /* Icon mapping pour transactions */
  const txMeta = (type) => {
    switch (type) {
      case 'earn_order':    return { icon: '📦', defaultLabel: 'Commande livrée' };
      case 'earn_admin':    return { icon: '🎁', defaultLabel: 'Bonus offert' };
      case 'earn_review':   return { icon: '⭐', defaultLabel: 'Avis publié' };
      case 'earn_referral': return { icon: '👯', defaultLabel: 'Parrainage validé' };
      case 'redeem':        return { icon: '💸', defaultLabel: 'Points utilisés' };
      case 'adjust_admin':  return { icon: '⚙️', defaultLabel: 'Ajustement' };
      default:              return { icon: '✨', defaultLabel: type };
    }
  };

  return (
    <div className="yloy-screen page-anim">
      <div className="yloy-scroll">
        {/* HEADER */}
        <header className="yloy-header">
          <button className="yloy-back" onClick={() => navigate(-1)} aria-label="Retour">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <h1 className="yloy-header-title">Fidélité</h1>
        </header>

        {/* HERO GRADIENT */}
        <div className="yloy-hero">
          <div className="yloy-hero-inner">
            <div className="yloy-hero-tier">
              <span>{currentTier.icon}</span>
              <span>Palier {currentTier.name}</span>
            </div>
            <div className="yloy-hero-points">{fmt(animatedPoints)}</div>
            <div className="yloy-hero-label">points fidélité</div>
            <div className="yloy-hero-equiv">
              <span>≈</span>
              <strong>{fmt(equivFCFA)} FCFA</strong>
              <span>disponibles</span>
            </div>

            {nextTier && (
              <div className="yloy-hero-progress">
                <div className="yloy-hero-progress-label">
                  <span>Plus que <strong>{fmt(pointsToNext)} pts</strong> pour {nextTier.name}</span>
                  <span><strong>{Math.round(progressPct)}%</strong></span>
                </div>
                <div className="yloy-hero-progress-bar">
                  <div className="yloy-hero-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}
            {!nextTier && (
              <div className="yloy-hero-progress">
                <div className="yloy-hero-progress-label">
                  <span>🏆 Tu es au palier maximum, bravo !</span>
                </div>
                <div className="yloy-hero-progress-bar">
                  <div className="yloy-hero-progress-fill" style={{ width: '100%' }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* COMMENT ÇA MARCHE — 3 cards horizontales */}
        <section className="yloy-section">
          <h2 className="yloy-section-title">Comment ça marche</h2>
          <p className="yloy-section-sub">Gagne des points à chaque achat et débloque des avantages.</p>
        </section>
        <div className="yloy-how-scroll">
          <div className="yloy-how-card">
            <div className="yloy-how-num">1</div>
            <div className="yloy-how-icon">🛒</div>
            <h3 className="yloy-how-title">Tu commandes</h3>
            <p className="yloy-how-desc">1 FCFA dépensé = 1 point fidélité crédité dès la livraison.</p>
          </div>
          <div className="yloy-how-card">
            <div className="yloy-how-num">2</div>
            <div className="yloy-how-icon">💰</div>
            <h3 className="yloy-how-title">Tu accumules</h3>
            <p className="yloy-how-desc">1 000 points = 1 000 FCFA de crédit utilisable directement.</p>
          </div>
          <div className="yloy-how-card">
            <div className="yloy-how-num">3</div>
            <div className="yloy-how-icon">🎁</div>
            <h3 className="yloy-how-title">Tu profites</h3>
            <p className="yloy-how-desc">Utilise ton crédit au checkout ou attends de débloquer le palier suivant.</p>
          </div>
        </div>

        {/* PALIERS */}
        <section className="yloy-section">
          <h2 className="yloy-section-title">Mes paliers</h2>
          <p className="yloy-section-sub">Plus tu commandes, plus tu débloques d'avantages.</p>
          <div className="yloy-tier-grid">
            {TIERS.map(t => {
              const isCurrent = t.id === currentTier.id;
              return (
                <div key={t.id} className={`yloy-tier-card ${isCurrent ? 'current' : ''}`}>
                  <div className="yloy-tier-icon-wrap" style={{ background: t.bg }}>
                    <span>{t.icon}</span>
                  </div>
                  <div className="yloy-tier-info">
                    <div className="yloy-tier-name-row">
                      <h3 className="yloy-tier-name">{t.name}</h3>
                      {isCurrent && <span className="yloy-tier-badge">Actuel</span>}
                    </div>
                    <p className="yloy-tier-req">
                      {t.next
                        ? `${fmt(t.min)} → ${fmt(t.next)} pts cumulés`
                        : `${fmt(t.min)}+ pts cumulés`}
                    </p>
                    <ul className="yloy-tier-perks">
                      {t.perks.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* HISTORIQUE */}
        <section className="yloy-section">
          <h2 className="yloy-section-title">Historique</h2>
          <p className="yloy-section-sub">Tes 30 dernières transactions de points.</p>
          {loading ? (
            /* PERF : skeleton lignes transactions */
            <div>
              {[0, 1, 2, 3].map((i) => (
                <div key={'sk-' + i} className="skeleton-card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div className="skeleton-shimmer" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton-line" style={{ width: '60%' }} />
                    <div className="skeleton-line" style={{ width: '30%', marginBottom: 0 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="yloy-empty">
              <div style={{ fontSize: 36, opacity: 0.4 }}>📭</div>
              <p>Aucune transaction pour l'instant</p>
              <p style={{ fontSize: 11, color: '#9B9B9B' }}>Passe ta 1ère commande pour gagner tes premiers points.</p>
            </div>
          ) : (
            <div className="yloy-tx-list">
              {transactions.map((tx, i) => {
                const meta = txMeta(tx.type);
                return (
                  <div
                    key={tx.id}
                    className="yloy-tx-item"
                    style={{ animationDelay: `${Math.min(i * 30, 600)}ms` }}
                  >
                    <div className="yloy-tx-icon">{meta.icon}</div>
                    <div className="yloy-tx-text">
                      <strong>{tx.reason || meta.defaultLabel}</strong>
                      <span>{new Date(tx.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                    <div className={`yloy-tx-pts ${tx.points > 0 ? 'positive' : 'negative'}`}>
                      {tx.points > 0 ? '+' : ''}{fmt(tx.points)} pts
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* CTA BOTTOM */}
      <div className="yloy-cta-wrap">
        <button
          className="yloy-cta"
          onClick={useMyPoints}
          disabled={balance < 100}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <circle cx="9" cy="21" r="1.5"/><circle cx="20" cy="21" r="1.5"/><path d="M1 1h4l2.7 13.4a2 2 0 002 1.6h9.7a2 2 0 002-1.6L23 6H6"/>
          </svg>
          Utiliser mes points {balance >= 100 && `(${fmt(equivFCFA)} FCFA)`}
        </button>
      </div>

      {toast && <div className="yloy-toast">{toast}</div>}

      <TabBar active="profile" />
    </div>
  );
}
