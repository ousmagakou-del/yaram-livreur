import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { supabase } from '../lib/supabase';
import TabBar from '../components/TabBar';
import './Promos.css';

const FILTER_TABS = [
  { id: 'all',      label: 'Toutes',       icon: '🎁' },
  { id: 'percent',  label: 'Réductions',   icon: '💸' },
  { id: 'amount',   label: 'Montant fixe', icon: '💰' },
  { id: 'shipping', label: 'Livraison',    icon: '🛵' },
];

export default function Promos() {
  const { navigate } = useNav();
  const { user } = useUser();

  const [promos, setPromos] = useState([]);
  const [userUses, setUserUses] = useState({}); // { promo_code: count }
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [copiedCode, setCopiedCode] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const now = new Date().toISOString();

        // Promos actives + non-référral (les codes parrainage sont privés)
        const { data: promosData } = await supabase
          .from('promo_codes')
          .select('*')
          .eq('active', true)
          .neq('is_referral', true)
          .or(`expires_at.is.null,expires_at.gt.${now}`)
          .or(`starts_at.is.null,starts_at.lte.${now}`)
          .order('created_at', { ascending: false });

        // Filtre côté JS aussi : max_uses non atteint
        const filtered = (promosData || []).filter(p => {
          if (p.max_uses && p.uses_count >= p.max_uses) return false;
          return true;
        });

        setPromos(filtered);

        // Si user connecté, regarde combien de fois il a utilisé chaque promo
        if (user?.id) {
          const { data: uses } = await supabase
            .from('promo_uses')
            .select('promo_code')
            .eq('user_id', user.id);
          const counts = {};
          (uses || []).forEach(u => {
            counts[u.promo_code] = (counts[u.promo_code] || 0) + 1;
          });
          setUserUses(counts);
        }
      } catch (e) {
        console.error('Promos load error:', e);
      }
      setLoading(false);
    })();
  }, [user?.id]);

  const handleCopy = async (code) => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopiedCode(code);
      if (navigator.vibrate) navigator.vibrate(40);
      // Stocker pour application auto au checkout
      try { localStorage.setItem('yaram_pending_promo', code); } catch {}
      setTimeout(() => setCopiedCode(''), 2000);
    } catch {
      // Fallback : créer un textarea temporaire
      const t = document.createElement('textarea');
      t.value = code;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(t);
      setCopiedCode(code);
      try { localStorage.setItem('yaram_pending_promo', code); } catch {}
      setTimeout(() => setCopiedCode(''), 2000);
    }
  };

  // ─── Filtre par tab ───
  const filteredPromos = promos.filter(p => {
    if (filter === 'all')      return true;
    if (filter === 'percent')  return p.type === 'percent' || p.type === 'percentage';
    if (filter === 'amount')   return p.type === 'amount' || p.type === 'fixed' || p.type === 'flat';
    if (filter === 'shipping') return p.type === 'shipping' || p.type === 'free_shipping';
    return true;
  });

  // ─── Hero : promo avec la plus grosse valeur ───
  const heroPromo = (() => {
    if (promos.length === 0) return null;
    // Trier par "attractivité" : % d'abord, puis montant
    const sorted = [...promos].sort((a, b) => {
      if (a.type === 'percent' && b.type !== 'percent') return -1;
      if (b.type === 'percent' && a.type !== 'percent') return 1;
      return (b.value || 0) - (a.value || 0);
    });
    return sorted[0];
  })();

  // ─── Helpers ───
  const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

  const promoValueLabel = (p) => {
    if (p.type === 'percent' || p.type === 'percentage') return `-${p.value}%`;
    if (p.type === 'amount' || p.type === 'fixed' || p.type === 'flat') return `-${fmt(p.value)} FCFA`;
    if (p.type === 'shipping' || p.type === 'free_shipping') return 'Livraison offerte';
    return p.value ? `-${p.value}` : 'Promo';
  };

  const promoTypeChip = (p) => {
    if (p.type === 'percent' || p.type === 'percentage') return { label: 'Réduction', bg: '#FFE4D6', color: '#993C1D' };
    if (p.type === 'amount' || p.type === 'fixed' || p.type === 'flat') return { label: 'Montant fixe', bg: '#E8F5EC', color: '#1F8B4C' };
    if (p.type === 'shipping' || p.type === 'free_shipping') return { label: 'Livraison', bg: '#E6F1FB', color: '#185FA5' };
    return { label: 'Promo', bg: '#F4F4F2', color: '#6B6B6B' };
  };

  const daysLeft = (p) => {
    if (!p.expires_at) return null;
    const expDate = new Date(p.expires_at);
    if (isNaN(expDate.getTime())) return null;
    const diff = expDate - new Date();
    if (diff < 0) return null;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "Expire aujourd'hui";
    if (days === 1) return 'Expire demain';
    if (days <= 7) return `${days} jours restants`;
    return null;
  };

  const isExhausted = (p) => {
    if (!p.per_user_limit) return false;
    return (userUses[p.code] || 0) >= p.per_user_limit;
  };

  return (
    <div className="ypromos-screen page-anim">
      <div className="ypromos-scroll">

        {/* ════════ HEADER VERT ════════ */}
        <header className="ypromos-header">
          <button className="ypromos-back" onClick={() => navigate(-1)} aria-label="Retour">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div>
            <h1>🎁 Bons plans</h1>
            <p>{promos.length} promo{promos.length > 1 ? 's' : ''} active{promos.length > 1 ? 's' : ''}</p>
          </div>
        </header>

        {/* ════════ HERO PROMO ════════ */}
        {heroPromo && (
          <div className="ypromos-hero" onClick={() => handleCopy(heroPromo.code)}>
            <div className="ypromos-hero-badge">⚡ MEILLEURE OFFRE</div>
            <div className="ypromos-hero-value">{promoValueLabel(heroPromo)}</div>
            {heroPromo.description && (
              <div className="ypromos-hero-desc">{heroPromo.description}</div>
            )}
            <div className="ypromos-hero-code-wrap">
              <span className="ypromos-hero-code-label">Code</span>
              <div className="ypromos-hero-code">
                {heroPromo.code}
                <span className="ypromos-hero-copy">
                  {copiedCode === heroPromo.code ? '✓ Copié' : '📋 Copier'}
                </span>
              </div>
            </div>
            {heroPromo.min_order > 0 && (
              <div className="ypromos-hero-min">
                Dès {fmt(heroPromo.min_order)} FCFA d'achat
              </div>
            )}
          </div>
        )}

        {/* ════════ TABS FILTRES ════════ */}
        {promos.length > 1 && (
          <div className="ypromos-tabs">
            {FILTER_TABS.map(tab => (
              <button
                key={tab.id}
                className={`ypromos-tab ${filter === tab.id ? 'active' : ''}`}
                onClick={() => setFilter(tab.id)}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* ════════ LISTE DES PROMOS ════════ */}
        <section className="ypromos-section">
          {loading ? (
            <div className="ypromos-loading">Chargement…</div>
          ) : filteredPromos.length === 0 ? (
            <div className="ypromos-empty">
              <div style={{ fontSize: 56, opacity: 0.3 }}>🎁</div>
              <h3>Aucune promo pour l'instant</h3>
              <p>Reviens bientôt, on prépare de bonnes surprises !</p>
              <button className="ypromos-empty-cta" onClick={() => navigate('/')}>
                Continuer à explorer →
              </button>
            </div>
          ) : (
            <div className="ypromos-grid">
              {filteredPromos.map(p => {
                const chip = promoTypeChip(p);
                const left = daysLeft(p);
                const exhausted = isExhausted(p);
                return (
                  <div key={p.id} className={`ypromos-card ${exhausted ? 'exhausted' : ''}`}>
                    <div className="ypromos-card-left">
                      <div className="ypromos-card-value">{promoValueLabel(p)}</div>
                      <span className="ypromos-card-chip" style={{ background: chip.bg, color: chip.color }}>
                        {chip.label}
                      </span>
                    </div>

                    <div className="ypromos-card-body">
                      {p.description && (
                        <div className="ypromos-card-desc">{p.description}</div>
                      )}

                      <div className="ypromos-card-meta">
                        {p.min_order > 0 && (
                          <span>📦 Dès {fmt(p.min_order)} FCFA</span>
                        )}
                        {left && (
                          <span className="ypromos-card-urgent">⏰ {left}</span>
                        )}
                        {p.per_user_limit > 0 && (
                          <span>👤 {p.per_user_limit} fois max{userUses[p.code] ? ` (${userUses[p.code]} déjà utilisée${userUses[p.code] > 1 ? 's' : ''})` : ''}</span>
                        )}
                      </div>

                      <div className="ypromos-card-code-row">
                        <button
                          className="ypromos-card-code"
                          onClick={() => handleCopy(p.code)}
                          disabled={exhausted}
                        >
                          {copiedCode === p.code ? '✓ Code copié' : `📋 ${p.code}`}
                        </button>
                        <button
                          className="ypromos-card-cta"
                          onClick={() => {
                            try { localStorage.setItem('yaram_pending_promo', p.code); } catch {}
                            navigate('/cart');
                          }}
                          disabled={exhausted}
                        >
                          {exhausted ? 'Épuisée' : 'J\'achète →'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ════════ INFO COMMENT UTILISER ════════ */}
        <section className="ypromos-help">
          <h3>💡 Comment utiliser un code ?</h3>
          <ol>
            <li>Touche le bouton du code pour le copier</li>
            <li>Ajoute des produits au panier</li>
            <li>Au moment de payer, colle le code dans le champ "Code promo"</li>
            <li>La réduction s'applique automatiquement 🎉</li>
          </ol>
        </section>

        <div style={{ height: 40 }} />
      </div>

      <TabBar active="home" />
    </div>
  );
}
