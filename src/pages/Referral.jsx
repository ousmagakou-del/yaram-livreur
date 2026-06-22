import { useState, useEffect, useRef } from 'react';
import { useNav, useUser } from '../App';
import { supabase, getOrCreateReferralCode, getReferralStats } from '../lib/supabase';
import { usePersistedData } from '../lib/usePersistedData';
import './Referral.css';

// ─── Hook : compteur animé au mount ───
function useCountUp(target, durationMs = 900) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const safeTarget = Number(target) || 0;
    if (safeTarget === 0) { setValue(0); return; }
    const start = performance.now();
    const tick = (t) => {
      const elapsed = t - start;
      const p = Math.min(1, elapsed / durationMs);
      // easeOutExpo
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setValue(Math.round(safeTarget * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);

  return value;
}

const STATUS_LABEL = {
  pending:    { label: 'En attente',     color: '#9B9B9B', bg: '#F4F4F2' },
  registered: { label: 'Inscrite',       color: '#185FA5', bg: '#E6F1FB' },
  ordered:    { label: 'A commandé',     color: '#B86E1A', bg: '#FFF4E0' },
  paid:       { label: 'A payé',         color: '#1F8B4C', bg: '#E8F5EC' },
};

function statusFor(filleule) {
  if (filleule.has_paid || filleule.paid_at) return 'paid';
  if (filleule.has_ordered || filleule.order_count > 0) return 'ordered';
  if (filleule.registered_at || filleule.created_at) return 'registered';
  return 'pending';
}

export default function Referral() {
  const { navigate } = useNav();
  const { user } = useUser();

  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState('');

  const REWARD_PER_REFERRAL = 3000; // FCFA (affichage) — 500 pts × 6 FCFA dans ton modèle

  // Migré vers usePersistedData → cache module-level user-scoped.
  // Plus de skeleton au remount/back navigation.
  const { data: referralData, loading } = usePersistedData(
    'referral-' + (user?.id || 'anon'),
    async () => {
      // Préserve la logique : referral_code prioritaire, fallback helper
      let userCode = user.referral_code || null;
      if (!userCode) userCode = await getOrCreateReferralCode(user.id);

      const s = await getReferralStats(user.id);

      // Leaderboard (anonymisé). On essaie une RPC dédiée, fallback silencieux.
      let lb = [];
      try {
        const { data } = await supabase.rpc('referral_leaderboard', { p_limit: 10 });
        if (Array.isArray(data)) lb = data;
      } catch {}

      return {
        code: userCode || 'YARAM',
        stats: s || { count: 0, bonusEarned: 0, list: [] },
        leaderboard: lb,
      };
    },
    { ttl: 5 * 60 * 1000, enabled: !!user?.id }
  );

  const code = referralData?.code || '';
  const stats = referralData?.stats || { count: 0, bonusEarned: 0, list: [] };
  const leaderboard = referralData?.leaderboard || [];

  // ─── Compteurs animés ───
  const invitesSent = Math.max(stats.count, stats.list?.length || 0); // approx envois
  const registered  = stats.count || 0;
  const creditFcfa  = (stats.count || 0) * REWARD_PER_REFERRAL;

  const animSent     = useCountUp(invitesSent);
  const animReg      = useCountUp(registered);
  const animCredit   = useCountUp(creditFcfa);

  // ─── Logged-out fallback ───
  if (!user) {
    return (
      <div className="rf-screen">
        <header className="rf-header rf-header-glass">
          <button className="rf-back" onClick={() => navigate(-1)} aria-label="Retour">←</button>
          <h1>Parrainage</h1>
        </header>
        <div className="rf-locked">
          <div className="rf-locked-emoji">💝</div>
          <h2>Connecte-toi pour parrainer</h2>
          <p>Invite tes copines et gagnez chacune {REWARD_PER_REFERRAL.toLocaleString('fr-FR')} FCFA de crédit.</p>
          <button className="rf-locked-cta" onClick={() => navigate('/')}>
            Se connecter
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rf-screen">
        <header className="rf-header rf-header-glass">
          <button className="rf-back" onClick={() => navigate(-1)} aria-label="Retour">←</button>
          <h1>Parrainage</h1>
        </header>
        <div className="rf-scroll">
          <div className="rf-skel rf-skel-hero" />
          <div className="rf-skel rf-skel-stats" />
          <div className="rf-skel rf-skel-card" />
        </div>
      </div>
    );
  }

  const shareUrl = `https://yaram.app/?ref=${code}`;
  const shareText = `Hey ! Je t'invite sur YARAM, la marketplace beauté pour la peau africaine. Utilise mon code ${code} et reçois ${REWARD_PER_REFERRAL.toLocaleString('fr-FR')} FCFA de crédit dès ta 1ère commande ! ${shareUrl}`;

  const fireToast = (msg) => {
    setToast(msg);
    if (navigator.vibrate) navigator.vibrate(30);
    setTimeout(() => setToast(''), 2000);
  };

  const handleCopyCode = async () => {
    try { await navigator.clipboard.writeText(code); }
    catch {
      const t = document.createElement('textarea');
      t.value = code; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(t);
    }
    setCopied(true);
    fireToast(`Code ${code} copié !`);
    setTimeout(() => setCopied(false), 2200);
  };

  const handleCopyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); }
    catch {
      const t = document.createElement('textarea');
      t.value = shareUrl; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(t);
    }
    fireToast('Lien copié !');
  };

  const handleWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  };

  const handleSMS = () => {
    // iOS use `&`, Android use `?` — sms: link works on both via body=
    window.open(`sms:?&body=${encodeURIComponent(shareText)}`, '_self');
  };

  const handleShareNative = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'YARAM', text: shareText, url: shareUrl }); }
      catch {}
    } else {
      handleCopyLink();
    }
  };

  return (
    <div className="rf-screen">

      {/* ════════ HEADER GLASS STICKY ════════ */}
      <header className="rf-header rf-header-glass">
        <button className="rf-back" onClick={() => navigate(-1)} aria-label="Retour">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <h1>Parrainage</h1>
      </header>

      <div className="rf-scroll">

        {/* ════════ HERO GRADIENT ════════ */}
        <section className="rf-hero rf-stagger" style={{ '--i': 0 }}>
          <div className="rf-hero-glow" />
          <div className="rf-hero-glow rf-hero-glow-2" />

          <div className="rf-hero-badge">YARAM × Toi</div>
          <h2 className="rf-hero-title">
            Ramène tes amies,<br />gagne <span>ensemble</span>
          </h2>
          <p className="rf-hero-sub">
            Toi <strong>+{REWARD_PER_REFERRAL.toLocaleString('fr-FR')} FCFA</strong> · Elle <strong>+{REWARD_PER_REFERRAL.toLocaleString('fr-FR')} FCFA</strong> dès sa 1ère commande.
          </p>
        </section>

        {/* ════════ STATS PREMIUM ════════ */}
        <section className="rf-stats rf-stagger" style={{ '--i': 1 }}>
          <div className="rf-stat">
            <div className="rf-stat-icon" style={{ background: '#FFF1ED', color: '#C92043' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </div>
            <div className="rf-stat-num">{animSent}</div>
            <div className="rf-stat-label">Invitations</div>
          </div>
          <div className="rf-stat">
            <div className="rf-stat-icon" style={{ background: '#E6F1FB', color: '#185FA5' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 11l-3-3-3 3"/>
                <line x1="19" y1="8" x2="19" y2="16"/>
              </svg>
            </div>
            <div className="rf-stat-num">{animReg}</div>
            <div className="rf-stat-label">Inscrites</div>
          </div>
          <div className="rf-stat rf-stat-highlight">
            <div className="rf-stat-icon" style={{ background: '#E8F5EC', color: '#1F8B4C' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div className="rf-stat-num">{animCredit.toLocaleString('fr-FR')}</div>
            <div className="rf-stat-label">FCFA gagnés</div>
          </div>
        </section>

        {/* ════════ CODE PERSONNEL ════════ */}
        <section className="rf-code-card rf-stagger" style={{ '--i': 2 }}>
          <div className="rf-code-header">
            <span className="rf-code-eyebrow">TON CODE PERSONNEL</span>
            <span className="rf-code-tag">Unique</span>
          </div>

          <div className={`rf-code-box ${copied ? 'copied' : ''}`} onClick={handleCopyCode}>
            <div className="rf-code-text">{code}</div>
            <div className="rf-code-tap-hint">Tap pour copier</div>
          </div>

          <div className="rf-share-row">
            <button className={`rf-share-btn rf-share-wa ${'rf-shake'}`} onClick={handleWhatsApp}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.8-.7-1.4-1.6-1.6-1.9-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.2-.3-.2-.5-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.2-1.4c1.4.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z"/>
              </svg>
              WhatsApp
            </button>
            <button className="rf-share-btn rf-share-copy" onClick={handleCopyCode}>
              {copied ? (
                <>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Copié
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Copier
                </>
              )}
            </button>
          </div>
        </section>

        {/* ════════ COMMENT ÇA MARCHE ════════ */}
        <section className="rf-how rf-stagger" style={{ '--i': 3 }}>
          <h3 className="rf-section-title">Comment ça marche ?</h3>
          <div className="rf-steps">
            <div className="rf-step">
              <div className="rf-step-num">1</div>
              <div className="rf-step-illu">📤</div>
              <div className="rf-step-body">
                <strong>Partage ton code</strong>
                <p>Envoie-le par WhatsApp, SMS ou copie le lien.</p>
              </div>
            </div>
            <div className="rf-step">
              <div className="rf-step-num">2</div>
              <div className="rf-step-illu">📝</div>
              <div className="rf-step-body">
                <strong>Ta copine s'inscrit</strong>
                <p>Elle entre ton code et passe sa première commande.</p>
              </div>
            </div>
            <div className="rf-step">
              <div className="rf-step-num">3</div>
              <div className="rf-step-illu">💸</div>
              <div className="rf-step-body">
                <strong>Vous gagnez chacune {REWARD_PER_REFERRAL.toLocaleString('fr-FR')} FCFA</strong>
                <p>Crédit appliqué automatiquement sur ta prochaine commande.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ════════ TOP PARRAINEUSES ════════ */}
        {leaderboard.length > 0 && (
          <section className="rf-board rf-stagger" style={{ '--i': 4 }}>
            <div className="rf-board-head">
              <h3 className="rf-section-title">Les YARAMists qui cartonnent ce mois</h3>
              <span className="rf-board-period">Top {Math.min(10, leaderboard.length)}</span>
            </div>
            <div className="rf-board-list">
              {leaderboard.slice(0, 10).map((row, i) => {
                const rank = i + 1;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
                const name = row.display_name || row.first_name || `YARAMist ${rank}`;
                const initial = (name[0] || 'Y').toUpperCase();
                return (
                  <div key={row.user_id || row.display_name || i} className={`rf-board-row ${rank <= 3 ? 'top3' : ''}`}>
                    <div className="rf-board-rank">{medal}</div>
                    <div className="rf-board-avatar">{initial}</div>
                    <div className="rf-board-name">{name}</div>
                    <div className="rf-board-count">{row.count || 0} amies</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ════════ MES INVITATIONS ════════ */}
        <section className="rf-invites rf-stagger" style={{ '--i': 5 }}>
          <h3 className="rf-section-title">Mes invitations</h3>
          {stats.list.length === 0 ? (
            <div className="rf-invites-empty">
              <div className="rf-invites-empty-emoji">🤝</div>
              <p>Aucune invitation pour l'instant.<br/>Partage ton code et commence à gagner !</p>
            </div>
          ) : (
            <div className="rf-invites-list">
              {stats.list.map(f => {
                const st = statusFor(f);
                const meta = STATUS_LABEL[st];
                const name = f.first_name || f.name || 'Filleule';
                const initial = (name[0] || '?').toUpperCase();
                return (
                  <div key={f.id || f.user_id || name} className="rf-invite">
                    <div className="rf-invite-avatar">{initial}</div>
                    <div className="rf-invite-body">
                      <div className="rf-invite-name">{name}</div>
                      <div className="rf-invite-meta">
                        {f.created_at && new Date(f.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                    <span className="rf-invite-status" style={{ background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div style={{ height: 120 }} />
      </div>

      {/* ════════ CTA BOTTOM STICKY ════════ */}
      <div className="rf-cta-bar">
        <button className="rf-cta rf-cta-wa" onClick={handleWhatsApp} aria-label="Inviter par WhatsApp">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.8-.7-1.4-1.6-1.6-1.9-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.2-.3-.2-.5-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.2-1.4c1.4.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z"/>
          </svg>
          WhatsApp
        </button>
        <button className="rf-cta rf-cta-sms" onClick={handleSMS} aria-label="Inviter par SMS">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          SMS
        </button>
        <button className="rf-cta rf-cta-link" onClick={handleShareNative} aria-label="Partager le lien">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          Lien
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="rf-toast" role="status">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {toast}
        </div>
      )}
    </div>
  );
}
