import { useState, useEffect, useRef } from 'react';
import { useNav, useUser } from '../App';
import { subscribeNewsletter, isSubscribed } from '../lib/supabase/newsletter';
import { toast } from '../lib/toast';
import { trackEvent } from '../lib/analytics';
import { getWhatsAppNumber, getWhatsAppDisplay } from '../lib/utils';
import './Newsletter.css';

// ═══════════════════════════════════════════════════════════════════
//  YARAM — Newsletter (opt-in client)
// ═══════════════════════════════════════════════════════════════════
//  Inspiration : Sephora newsletter / Maybelline beauty mag
//  Préfixe CSS : `nl-`
// ═══════════════════════════════════════════════════════════════════

// Hook count-up (réutilisable, easeOutExpo)
function useCountUp(target, durationMs = 1400) {
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
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setValue(Math.round(safeTarget * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);
  return value;
}

// Hook reveal au scroll (IntersectionObserver, stagger via délai inline)
function useRevealOnScroll(ref) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          setVisible(true);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}

const FAQ = [
  {
    q: 'À quelle fréquence vais-je recevoir des emails ?',
    a: '1 à 2 emails par semaine maximum. On respecte ta boîte mail, promis.',
  },
  {
    q: 'Mes données sont-elles partagées ?',
    a: "Jamais. Ton email reste chez YARAM. Conforme RGPD et CDP Sénégal.",
  },
  {
    q: 'Je peux me désabonner facilement ?',
    a: 'Oui, lien de désabonnement en bas de chaque email. 1 clic et c\'est fait.',
  },
];

const TESTIMONIALS = [
  {
    name: 'Aïcha D.',
    city: 'Dakar',
    grad: 'linear-gradient(135deg,#F4B53A,#E89A3D)',
    text: 'Les conseils peau sont validés par des dermatos sénégalaises. Enfin une newsletter qui parle de MA peau.',
  },
  {
    name: 'Fatou N.',
    city: 'Thiès',
    grad: 'linear-gradient(135deg,#1F8B4C,#2EB872)',
    text: "J'ai eu -20% sur ma routine grâce à un code abonnée. Largement remboursé le \"prix\" de mon inscription.",
  },
  {
    name: 'Mariama B.',
    city: 'Saint-Louis',
    grad: 'linear-gradient(135deg,#E8385C,#F4B53A)',
    text: "Les nouveautés arrivent ici avant Insta. J'ai pu chopper la dernière crème CeraVe avant rupture.",
  },
];

export default function Newsletter() {
  const { navigate, goBack } = useNav();
  const { user } = useUser();

  const [email, setEmail] = useState(user?.email || '');
  const [prefs, setPrefs] = useState({
    promos: true,
    conseils_peau: true,
    articles: true,
    nouveaux_produits: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [alreadyIn, setAlreadyIn] = useState(false);
  const [openFaq, setOpenFaq] = useState(-1);

  // Pré-fill email + check si déjà abonné
  useEffect(() => {
    if (user?.email) setEmail(user.email);
    if (user?.id) {
      isSubscribed(user.id).then((sub) => {
        if (sub) setAlreadyIn(true);
      }).catch(() => {});
    }
  }, [user?.id, user?.email]);

  // Refs reveal scroll
  const recvRef = useRef(null);
  const recvVisible = useRevealOnScroll(recvRef);
  const statsRef = useRef(null);
  const statsVisible = useRevealOnScroll(statsRef);
  const formRef = useRef(null);
  const formVisible = useRevealOnScroll(formRef);
  const testiRef = useRef(null);
  const testiVisible = useRevealOnScroll(testiRef);

  // Count-up (déclenche quand stats visible)
  const subscribersCount = useCountUp(statsVisible ? 5200 : 0, 1600);
  const ratingCount = useCountUp(statsVisible ? 49 : 0, 1200); // affichera 4.9

  const togglePref = (k) => setPrefs((p) => ({ ...p, [k]: !p[k] }));

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    const cleaned = (email || '').trim().toLowerCase();
    if (!cleaned) {
      toast.error('Indique ton email');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      toast.error('Email invalide');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await subscribeNewsletter({
        email: cleaned,
        preferences: prefs,
      });
      if (error) {
        console.warn('[Newsletter] subscribe failed:', error.message);
        toast.error('Erreur : ' + (error.message || 'réessaye'));
        setSubmitting(false);
        return;
      }
      try { trackEvent('newsletter_subscribed', { source: 'page', has_user: !!user?.id }); } catch {}
      setSuccess(true);
      // Scroll vers le haut de la page pour montrer l'anim succès
      setTimeout(() => {
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
      }, 50);
    } catch (err) {
      toast.error('Erreur : ' + (err?.message || 'réessaye'));
    } finally {
      setSubmitting(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  //  ÉCRAN SUCCÈS — affiché après opt-in
  // ═══════════════════════════════════════════════════════════════
  if (success) {
    return (
      <div className="nl-screen nl-success-screen">
        <div className="nl-confetti" aria-hidden>
          {Array.from({ length: 24 }).map((_, i) => (
            <span key={i} className="nl-confetti-piece" style={{
              '--i': i,
              '--x': `${(i * 37) % 100}%`,
              '--d': `${(i % 5) * 0.15}s`,
              '--c': ['#1F8B4C', '#F4B53A', '#E8385C', '#FFFFFF', '#2EB872'][i % 5],
            }} />
          ))}
        </div>
        <div className="nl-success-card">
          <div className="nl-success-burst" aria-hidden>
            <span className="nl-burst-ring nl-burst-ring-1" />
            <span className="nl-burst-ring nl-burst-ring-2" />
            <span className="nl-burst-ring nl-burst-ring-3" />
            <span className="nl-success-emoji">🎉</span>
          </div>
          <h1 className="nl-success-title">C'est confirmé !</h1>
          <p className="nl-success-sub">
            Bienvenue dans le club <strong>YARAM</strong>.<br />
            Premier mail dans ta boîte sous 24h.
          </p>
          <div className="nl-success-tag">
            <span aria-hidden>📩</span>
            <span>{email}</span>
          </div>
          <button
            type="button"
            className="nl-btn nl-btn-primary nl-btn-shine"
            onClick={() => navigate('/')}
          >
            Retour au shopping
          </button>
          <button
            type="button"
            className="nl-btn-ghost"
            onClick={() => navigate({ name: 'profile', params: {} })}
          >
            Voir mon profil
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  ÉCRAN PRINCIPAL
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="nl-screen">
      {/* Bouton retour flottant glass */}
      <button
        type="button"
        className="nl-back"
        onClick={() => goBack()}
        aria-label="Retour"
      >
        ‹
      </button>

      {/* ─────────────────────────────────────
         A. HERO animé immersif
         ───────────────────────────────────── */}
      <section className="nl-hero">
        {/* Aurora background */}
        <div className="nl-aurora" aria-hidden>
          <span className="nl-aurora-blob nl-aurora-blob-1" />
          <span className="nl-aurora-blob nl-aurora-blob-2" />
          <span className="nl-aurora-blob nl-aurora-blob-3" />
        </div>
        {/* Sparkles flottantes */}
        <div className="nl-sparkles" aria-hidden>
          <span className="nl-sparkle nl-sparkle-1">✦</span>
          <span className="nl-sparkle nl-sparkle-2">✧</span>
          <span className="nl-sparkle nl-sparkle-3">✦</span>
          <span className="nl-sparkle nl-sparkle-4">✧</span>
          <span className="nl-sparkle nl-sparkle-5">✦</span>
        </div>

        <div className="nl-hero-inner">
          <div className="nl-hero-tag">
            <span className="nl-hero-tag-dot" />
            YARAM Mag · #001
          </div>

          <h1 className="nl-hero-title">
            La <em>Newsletter Beauté</em><br />
            qui te respecte
          </h1>
          <p className="nl-hero-sub">
            Promos exclusives, conseils peau africaine validés par dermato,
            et nouveautés en avant-première — directement dans ta boîte.
          </p>

          {/* Magazine mockup flottant */}
          <div className="nl-mag" aria-hidden>
            <div className="nl-mag-shadow" />
            <div className="nl-mag-cover">
              <div className="nl-mag-cover-tag">YARAM<br />MAG</div>
              <div className="nl-mag-cover-headline">
                <small>Édition Juin</small>
                <span>Glow.<br />Naturellement.</span>
              </div>
              <div className="nl-mag-cover-shimmer" />
              <div className="nl-mag-cover-stripe" />
              <div className="nl-mag-cover-foot">
                3 routines · 12 produits testés · -20% abonnées
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────
         B. 3 CARDS "Ce que tu vas recevoir"
         ───────────────────────────────────── */}
      <section ref={recvRef} className={`nl-section nl-recv ${recvVisible ? 'is-in' : ''}`}>
        <div className="nl-section-head">
          <span className="nl-eyebrow">Au menu</span>
          <h2>Ce que tu vas recevoir</h2>
        </div>
        <div className="nl-recv-grid">
          <article className="nl-card nl-recv-card" style={{ '--i': 0 }}>
            <div className="nl-recv-emoji" aria-hidden>🎁</div>
            <h3>Promos exclusives</h3>
            <p>Codes <strong>-20%</strong> réservés aux abonnées, en avance.</p>
          </article>
          <article className="nl-card nl-recv-card" style={{ '--i': 1 }}>
            <div className="nl-recv-emoji" aria-hidden>💄</div>
            <h3>Conseils experts</h3>
            <p>Routines peau africaine validées par dermato.</p>
          </article>
          <article className="nl-card nl-recv-card" style={{ '--i': 2 }}>
            <div className="nl-recv-emoji" aria-hidden>✨</div>
            <h3>Nouveautés first</h3>
            <p>Marques fraîches avant tout le monde.</p>
          </article>
        </div>
      </section>

      {/* ─────────────────────────────────────
         C. STATS sociales (count-up)
         ───────────────────────────────────── */}
      <section ref={statsRef} className={`nl-section nl-stats ${statsVisible ? 'is-in' : ''}`}>
        <div className="nl-stats-card">
          <div className="nl-stat">
            <div className="nl-stat-num">
              {subscribersCount.toLocaleString('fr-FR')}+
            </div>
            <div className="nl-stat-lbl">Sénégalaises abonnées</div>
          </div>
          <div className="nl-stat-sep" />
          <div className="nl-stat">
            <div className="nl-stat-num">
              {(ratingCount / 10).toFixed(1)}
              <span className="nl-stat-num-small">/5</span>
            </div>
            <div className="nl-stat-stars" aria-label="Note 4.9 sur 5">
              {[0,1,2,3,4].map((i) => (
                <span key={i} className="nl-star" style={{ '--i': i }}>★</span>
              ))}
            </div>
            <div className="nl-stat-lbl">par nos abonnées</div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────
         D. FORMULAIRE d'abonnement
         ───────────────────────────────────── */}
      <section ref={formRef} className={`nl-section nl-form-wrap ${formVisible ? 'is-in' : ''}`}>
        <div className="nl-form-card">
          <div className="nl-form-head">
            <span className="nl-eyebrow nl-eyebrow-gold">Gratuit · 30 secondes</span>
            <h2>{alreadyIn ? 'Mets à jour tes préférences' : 'Rejoins le club YARAM'}</h2>
            <p>Choisis ce qui t'intéresse, on s'occupe du reste.</p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <label className="nl-field">
              <span className="nl-field-lbl">Ton email</span>
              <div className="nl-field-wrap">
                <span className="nl-field-icon" aria-hidden>✉</span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="aicha@exemple.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
            </label>

            <div className="nl-prefs">
              <div className="nl-prefs-title">Mes préférences</div>
              {[
                { k: 'promos',           label: 'Promos exclusives',  emoji: '🏷️' },
                { k: 'conseils_peau',    label: 'Conseils peau',      emoji: '💧' },
                { k: 'articles',         label: 'Articles tendances', emoji: '📰' },
                { k: 'nouveaux_produits',label: 'Nouveaux produits',  emoji: '🆕' },
              ].map(({ k, label, emoji }) => (
                <button
                  key={k}
                  type="button"
                  className={`nl-pref ${prefs[k] ? 'is-on' : ''}`}
                  onClick={() => togglePref(k)}
                  aria-pressed={prefs[k]}
                >
                  <span className="nl-pref-emoji" aria-hidden>{emoji}</span>
                  <span className="nl-pref-label">{label}</span>
                  <span className="nl-pref-check" aria-hidden>
                    {prefs[k] ? '✓' : ''}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="submit"
              className="nl-btn nl-btn-primary nl-btn-shine"
              disabled={submitting}
            >
              {submitting ? 'Inscription…' : (alreadyIn ? 'Enregistrer mes choix' : "S'abonner gratuitement")}
            </button>

            <p className="nl-legal">
              Pas de spam. Tu peux te désabonner en 1 clic à tout moment.
            </p>
          </form>
        </div>
      </section>

      {/* ─────────────────────────────────────
         F. TÉMOIGNAGES
         ───────────────────────────────────── */}
      <section ref={testiRef} className={`nl-section nl-testi ${testiVisible ? 'is-in' : ''}`}>
        <div className="nl-section-head">
          <span className="nl-eyebrow">Elles en parlent</span>
          <h2>Aimé par nos abonnées</h2>
        </div>
        <div className="nl-testi-grid">
          {TESTIMONIALS.map((t, i) => (
            <article key={t.name} className="nl-card nl-testi-card" style={{ '--i': i }}>
              <div className="nl-testi-head">
                <span className="nl-testi-avatar" style={{ background: t.grad }}>
                  {t.name.charAt(0)}
                </span>
                <div className="nl-testi-meta">
                  <strong>{t.name}</strong>
                  <span>{t.city}</span>
                </div>
                <div className="nl-testi-stars" aria-label="5 étoiles">
                  {'★★★★★'}
                </div>
              </div>
              <p className="nl-testi-quote">« {t.text} »</p>
            </article>
          ))}
        </div>
      </section>

      {/* ─────────────────────────────────────
         G. FAQ collapse
         ───────────────────────────────────── */}
      <section className="nl-section nl-faq">
        <div className="nl-section-head">
          <span className="nl-eyebrow">Bonnes questions</span>
          <h2>Tout savoir</h2>
        </div>
        <div className="nl-faq-list">
          {FAQ.map((item, i) => {
            const open = openFaq === i;
            return (
              <div key={i} className={`nl-faq-item ${open ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className="nl-faq-q"
                  onClick={() => setOpenFaq(open ? -1 : i)}
                  aria-expanded={open}
                >
                  <span>{item.q}</span>
                  <span className="nl-faq-chev" aria-hidden>›</span>
                </button>
                <div className="nl-faq-a">
                  <p>{item.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─────────────────────────────────────
         H. FOOTER mini
         ───────────────────────────────────── */}
      <footer className="nl-footer">
        <div className="nl-footer-text">
          Une question ?
        </div>
        <a
          className="nl-footer-wa"
          href={`https://wa.me/${getWhatsAppNumber()}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span aria-hidden>💬</span>
          WhatsApp {getWhatsAppDisplay()}
        </a>
        <div className="nl-footer-brand">YARAM · Beauté Sénégal</div>
      </footer>

      <div style={{ height: 40 }} />
    </div>
  );
}
