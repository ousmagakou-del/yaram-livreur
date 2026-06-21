// ════════════════════════════════════════════════════════════════════════════
// YARAM — Page "Boutique Internationale" (refonte ultra premium)
// ════════════════════════════════════════════════════════════════════════════
// Page d'atterrissage pour le service de commande de marques étrangères
// (Sephora, La Roche-Posay, The Ordinary, etc.) avec acompte 50% + 15j livraison.
//
// Sections :
//   A. Hero immersif (aurora animée + 3 badges flottants)
//   B. Comment ça marche (3 étapes scroll-snap)
//   C. Catalogue de marques disponibles
//   D. Formulaire de demande personnalisée (envoyé par email contact@yaram.app)
//   E. FAQ collapsible
//   F. Témoignages clients
//   G. Footer CTA WhatsApp
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useNav } from '../App';
import './International.css';

// ─── Catalogue marques internationales premium ──────────────────────────────
const BRANDS = [
  { name: 'Sephora',         flag: '🇫🇷', country: 'France',  status: 'live',    accent: '#000000' },
  { name: 'La Roche-Posay',  flag: '🇫🇷', country: 'France',  status: 'live',    accent: '#0064B0' },
  { name: 'The Ordinary',    flag: '🇨🇦', country: 'Canada',  status: 'live',    accent: '#1A1A1A' },
  { name: 'CeraVe',          flag: '🇺🇸', country: 'USA',     status: 'live',    accent: '#005EB8' },
  { name: 'Bioderma',        flag: '🇫🇷', country: 'France',  status: 'live',    accent: '#E30613' },
  { name: 'Yves Rocher',     flag: '🇫🇷', country: 'France',  status: 'live',    accent: '#2D6A2A' },
  { name: 'Vichy',           flag: '🇫🇷', country: 'France',  status: 'live',    accent: '#E1141A' },
  { name: "L'Oréal Paris",   flag: '🇫🇷', country: 'France',  status: 'live',    accent: '#000000' },
  { name: 'Garnier',         flag: '🇫🇷', country: 'France',  status: 'live',    accent: '#0A6B3B' },
  { name: 'Maybelline',      flag: '🇺🇸', country: 'USA',     status: 'live',    accent: '#1A1A1A' },
  { name: 'MAC Cosmetics',   flag: '🇺🇸', country: 'USA',     status: 'soon',    accent: '#000000' },
  { name: 'Estée Lauder',    flag: '🇺🇸', country: 'USA',     status: 'soon',    accent: '#0F2A4A' },
];

const STEPS = [
  {
    n: 1,
    emoji: '🛍️',
    title: 'Choisis ta marque',
    desc: 'Sephora, La Roche-Posay, The Ordinary... Dis-nous ce que tu veux, on s\'occupe de la sourcer.',
  },
  {
    n: 2,
    emoji: '💳',
    title: 'Acompte 50%',
    desc: 'Tu paies la moitié via Wave ou Orange Money pour sécuriser ta commande chez le fournisseur.',
  },
  {
    n: 3,
    emoji: '📦',
    title: 'Livraison 15 jours',
    desc: 'On expédie depuis la France ou les USA. À la réception, tu règles le solde.',
  },
];

const FAQ = [
  {
    q: 'Pourquoi un acompte de 50% ?',
    a: 'L\'acompte sert à acheter ton produit chez le fournisseur étranger et payer la logistique export. Le solde se règle uniquement à la livraison à Dakar — tu ne risques rien.',
  },
  {
    q: 'Que se passe-t-il si la marque est en rupture ?',
    a: 'On te contacte sous 48h avec une alternative équivalente ou on te rembourse intégralement ton acompte (Wave / OM, sans frais).',
  },
  {
    q: 'Puis-je suivre l\'expédition ?',
    a: 'Oui. Dès que ton colis quitte l\'Europe ou les USA, tu reçois un numéro de tracking et un point hebdomadaire sur WhatsApp.',
  },
  {
    q: 'Quels sont les frais de douane ?',
    a: 'Les frais de douane et le transport international sont déjà inclus dans le prix affiché. Aucune surprise à la livraison.',
  },
  {
    q: 'Comment payer le solde à la réception ?',
    a: 'Wave, Orange Money ou cash à la livraison. Le livreur ne te remet le colis qu\'une fois le solde réglé.',
  },
];

const TESTIMONIALS = [
  {
    name: 'Fatou D.',
    city: 'Dakar, Plateau',
    avatarBg: 'linear-gradient(135deg, #F4B53A, #E89B1A)',
    initials: 'FD',
    text: 'Commandé sérum The Ordinary et crème La Roche-Posay. Reçu en 12 jours, exactement comme promis. Bravo YARAM.',
    brand: 'The Ordinary',
  },
  {
    name: 'Aminata S.',
    city: 'Mermoz',
    avatarBg: 'linear-gradient(135deg, #1F8B4C, #166635)',
    initials: 'AS',
    text: 'Ma fondation Sephora introuvable au Sénégal. Reçue authentique en 14 jours, prix imbattable. Je recommande à 100%.',
    brand: 'Sephora',
  },
  {
    name: 'Khady N.',
    city: 'Almadies',
    avatarBg: 'linear-gradient(135deg, #002F66, #00498A)',
    initials: 'KN',
    text: 'Service client au top sur WhatsApp. Acompte Wave, livraison à domicile, tout s\'est passé sans stress.',
    brand: 'CeraVe',
  },
];

export default function International() {
  const { navigate } = useNav();

  // ─── State formulaire ───
  const [formBrand, setFormBrand] = useState('');
  const [formProduct, setFormProduct] = useState('');
  const [formBudget, setFormBudget] = useState(50000);
  const [formPhone, setFormPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState(null); // 'ok' | 'err' | null

  // ─── State FAQ collapsible ───
  const [openFaq, setOpenFaq] = useState(null);

  // ─── Refs pour scroll into view (IntersectionObserver) ───
  const sectionsRef = useRef([]);

  useEffect(() => {
    document.title = 'Boutique Internationale | YARAM';

    // Pré-remplissage marque si l'utilisateur clique sur une tile marque
    const handler = (e) => {
      const brandName = e?.detail?.brand;
      if (brandName) {
        setFormBrand(brandName);
        const form = document.getElementById('intl-form');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    window.addEventListener('yaram-intl-prefill', handler);
    return () => window.removeEventListener('yaram-intl-prefill', handler);
  }, []);

  // ─── IntersectionObserver pour reveal-on-scroll ───
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const prefersReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReduce) {
      sectionsRef.current.forEach((el) => el && el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    sectionsRef.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const setSectionRef = (idx) => (el) => {
    sectionsRef.current[idx] = el;
  };

  // ─── Submit formulaire ───
  const submitForm = async (e) => {
    e?.preventDefault?.();
    if (!formBrand.trim() || !formProduct.trim()) {
      setSendStatus('err');
      return;
    }
    setSending(true);
    setSendStatus(null);

    const html = buildRequestEmailHtml({
      brand: formBrand.trim(),
      product: formProduct.trim(),
      budget: formBudget,
      phone: formPhone.trim(),
    });

    try {
      // Récupère email user (si connecté) pour reply-to
      let userEmail = null;
      try {
        const { data } = await supabase.auth.getUser();
        userEmail = data?.user?.email || null;
      } catch (_) { /* anonymous OK */ }

      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to: 'contact@yaram.app',
          subject: `Nouvelle demande International — ${formBrand.trim()}`,
          html,
          replyTo: userEmail || undefined,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'send_failed');

      console.log('[intl-request] sent OK', { brand: formBrand, product: formProduct, budget: formBudget });
      setSendStatus('ok');
      setFormBrand('');
      setFormProduct('');
      setFormBudget(50000);
      setFormPhone('');
      if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    } catch (err) {
      console.warn('[intl-request] failed:', err?.message);
      setSendStatus('err');
    } finally {
      setSending(false);
    }
  };

  const handleBrandClick = (brand) => {
    if (brand.status !== 'live') return;
    if (navigator.vibrate) navigator.vibrate(20);
    setFormBrand(brand.name);
    const form = document.getElementById('intl-form');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const budgetLabel = useMemo(() => {
    return new Intl.NumberFormat('fr-FR').format(formBudget) + ' FCFA';
  }, [formBudget]);

  return (
    <div className="intl-premium-page">

      {/* ═══════════ A. HERO IMMERSIF ═══════════ */}
      <section className="intlp-hero">
        <div className="intlp-hero-aurora" aria-hidden />
        <div className="intlp-hero-globe" aria-hidden>🌍</div>

        <button
          className="intlp-back"
          onClick={() => navigate('/')}
          aria-label="Retour"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>

        <div className="intlp-hero-content">
          <div className="intlp-hero-pill">
            <span className="intlp-hero-pill-dot" aria-hidden />
            <span>Service Premium</span>
          </div>
          <h1 className="intlp-hero-title">
            Boutique<br />Internationale
          </h1>
          <p className="intlp-hero-sub">
            Tes marques préférées du monde entier, livrées à ta porte à Dakar.
          </p>

          <div className="intlp-hero-badges">
            <div className="intlp-hero-badge">
              <span className="intlp-hero-badge-icon">🌍</span>
              <strong>15+ pays</strong>
            </div>
            <div className="intlp-hero-badge">
              <span className="intlp-hero-badge-icon">✈️</span>
              <strong>15 jours max</strong>
            </div>
            <div className="intlp-hero-badge">
              <span className="intlp-hero-badge-icon">💰</span>
              <strong>50% acompte</strong>
            </div>
          </div>
        </div>

        <div className="intlp-hero-shine" aria-hidden />
      </section>

      {/* ═══════════ B. COMMENT ÇA MARCHE ═══════════ */}
      <section
        className="intlp-section intlp-reveal"
        ref={setSectionRef(0)}
      >
        <div className="intlp-section-head">
          <span className="intlp-eyebrow">Étape par étape</span>
          <h2 className="intlp-section-title">Comment ça marche</h2>
        </div>

        <div className="intlp-steps-scroll">
          {STEPS.map((step, idx) => (
            <article
              key={step.n}
              className="intlp-step-card"
              style={{ animationDelay: `${idx * 80}ms` }}
            >
              <div className="intlp-step-bigno" aria-hidden>{step.n}</div>
              <div className="intlp-step-emoji">{step.emoji}</div>
              <h3 className="intlp-step-title">{step.title}</h3>
              <p className="intlp-step-desc">{step.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ═══════════ C. CATALOGUE MARQUES ═══════════ */}
      <section
        className="intlp-section intlp-reveal"
        ref={setSectionRef(1)}
      >
        <div className="intlp-section-head">
          <span className="intlp-eyebrow">Catalogue</span>
          <h2 className="intlp-section-title">Marques disponibles</h2>
          <p className="intlp-section-sub">
            Clique sur une marque pour pré-remplir ta demande.
          </p>
        </div>

        <div className="intlp-brands-grid">
          {BRANDS.map((b) => (
            <button
              key={b.name}
              type="button"
              className={`intlp-brand-tile ${b.status === 'soon' ? 'is-soon' : ''}`}
              onClick={() => handleBrandClick(b)}
              disabled={b.status !== 'live'}
              aria-label={`Demander ${b.name}`}
            >
              <div
                className="intlp-brand-logo"
                style={{ background: `linear-gradient(135deg, ${b.accent}ee, ${b.accent}aa)` }}
                aria-hidden
              >
                {b.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </div>
              <div className="intlp-brand-info">
                <div className="intlp-brand-name">{b.name}</div>
                <div className="intlp-brand-country">
                  <span className="intlp-brand-flag">{b.flag}</span>
                  {b.country}
                </div>
              </div>
              <span className={`intlp-brand-status ${b.status === 'live' ? 'is-live' : 'is-soon'}`}>
                {b.status === 'live' ? 'Disponible' : 'Bientôt'}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ═══════════ D. FORMULAIRE DEMANDE ═══════════ */}
      <section
        id="intl-form"
        className="intlp-section intlp-reveal"
        ref={setSectionRef(2)}
      >
        <div className="intlp-section-head">
          <span className="intlp-eyebrow">Sur-mesure</span>
          <h2 className="intlp-section-title">Demande personnalisée</h2>
          <p className="intlp-section-sub">
            Une marque qui n'est pas dans la liste ? Dis-nous ce que tu cherches.
          </p>
        </div>

        <form className="intlp-form" onSubmit={submitForm}>
          <label className="intlp-field">
            <span className="intlp-field-label">Marque souhaitée *</span>
            <input
              type="text"
              className="intlp-input"
              placeholder="Ex : Drunk Elephant, Glossier..."
              value={formBrand}
              onChange={(e) => setFormBrand(e.target.value)}
              required
              maxLength={80}
            />
          </label>

          <label className="intlp-field">
            <span className="intlp-field-label">Produit(s) précis *</span>
            <textarea
              className="intlp-input intlp-textarea"
              placeholder="Ex : Sérum vitamine C 30ml + crème hydratante peau sèche"
              value={formProduct}
              onChange={(e) => setFormProduct(e.target.value)}
              rows={3}
              required
              maxLength={400}
            />
          </label>

          <label className="intlp-field">
            <span className="intlp-field-label">
              Budget approximatif
              <span className="intlp-budget-value">{budgetLabel}</span>
            </span>
            <input
              type="range"
              className="intlp-slider"
              min={10000}
              max={300000}
              step={5000}
              value={formBudget}
              onChange={(e) => setFormBudget(Number(e.target.value))}
            />
            <div className="intlp-slider-marks">
              <span>10k</span>
              <span>150k</span>
              <span>300k</span>
            </div>
          </label>

          <label className="intlp-field">
            <span className="intlp-field-label">WhatsApp (optionnel)</span>
            <input
              type="tel"
              className="intlp-input"
              placeholder="+221 77 ..."
              value={formPhone}
              onChange={(e) => setFormPhone(e.target.value)}
              maxLength={20}
            />
          </label>

          <button
            type="submit"
            className="intlp-submit"
            disabled={sending || !formBrand.trim() || !formProduct.trim()}
          >
            <span className="intlp-submit-text">
              {sending ? 'Envoi en cours…' : 'Envoyer ma demande'}
            </span>
            <span className="intlp-submit-arrow" aria-hidden>→</span>
            <span className="intlp-submit-shine" aria-hidden />
          </button>

          {sendStatus === 'ok' && (
            <div className="intlp-form-msg is-ok">
              ✓ Demande envoyée. On revient vers toi sous 48h sur WhatsApp.
            </div>
          )}
          {sendStatus === 'err' && (
            <div className="intlp-form-msg is-err">
              ✗ Impossible d'envoyer. Réessaie ou écris-nous sur WhatsApp.
            </div>
          )}
        </form>
      </section>

      {/* ═══════════ E. FAQ ═══════════ */}
      <section
        className="intlp-section intlp-reveal"
        ref={setSectionRef(3)}
      >
        <div className="intlp-section-head">
          <span className="intlp-eyebrow">Tout savoir</span>
          <h2 className="intlp-section-title">Questions fréquentes</h2>
        </div>

        <div className="intlp-faq">
          {FAQ.map((item, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={idx}
                className={`intlp-faq-item ${isOpen ? 'is-open' : ''}`}
              >
                <button
                  type="button"
                  className="intlp-faq-q"
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  aria-expanded={isOpen}
                >
                  <span>{item.q}</span>
                  <span className="intlp-faq-chev" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </button>
                {isOpen && (
                  <div className="intlp-faq-a">{item.a}</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ═══════════ F. TÉMOIGNAGES ═══════════ */}
      <section
        className="intlp-section intlp-reveal"
        ref={setSectionRef(4)}
      >
        <div className="intlp-section-head">
          <span className="intlp-eyebrow">Elles ont testé</span>
          <h2 className="intlp-section-title">Témoignages</h2>
        </div>

        <div className="intlp-testi-scroll">
          {TESTIMONIALS.map((t, idx) => (
            <article key={idx} className="intlp-testi-card">
              <div className="intlp-testi-head">
                <div
                  className="intlp-testi-avatar"
                  style={{ background: t.avatarBg }}
                  aria-hidden
                >
                  {t.initials}
                </div>
                <div className="intlp-testi-id">
                  <strong>{t.name}</strong>
                  <span>{t.city}</span>
                </div>
              </div>
              <div className="intlp-testi-stars" aria-label="5 étoiles sur 5">
                {[0, 1, 2, 3, 4].map((s) => (
                  <span
                    key={s}
                    className="intlp-testi-star"
                    style={{ animationDelay: `${idx * 200 + s * 80}ms` }}
                  >★</span>
                ))}
              </div>
              <p className="intlp-testi-text">"{t.text}"</p>
              <div className="intlp-testi-brand">via {t.brand}</div>
            </article>
          ))}
        </div>
      </section>

      {/* ═══════════ G. FOOTER CTA WHATSAPP ═══════════ */}
      <section
        className="intlp-section intlp-reveal intlp-footer-cta"
        ref={setSectionRef(5)}
      >
        <div className="intlp-footercta-inner">
          <div className="intlp-footercta-emoji" aria-hidden>💬</div>
          <h3 className="intlp-footercta-title">Une question ?</h3>
          <p className="intlp-footercta-sub">
            On répond en moins de 30 min sur WhatsApp.
          </p>
          <a
            href="https://wa.me/221774388766?text=Bonjour%20YARAM%2C%20j%27ai%20une%20question%20sur%20la%20boutique%20internationale"
            className="intlp-wa-btn"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="intlp-wa-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.6.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.6-1.5-.9-2.1-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.4 0 1.4 1 2.8 1.2 3 .1.2 2 3 4.8 4.2.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.7 1.5 5.3L2 22l4.8-1.5c1.5.8 3.3 1.3 5.2 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2z" />
              </svg>
            </span>
            <span>Écris-nous WhatsApp</span>
          </a>
        </div>
      </section>

      <div className="intlp-bottom-spacer" />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Template HTML pour l'email envoyé à contact@yaram.app
// ════════════════════════════════════════════════════════════════════════════
function buildRequestEmailHtml({ brand, product, budget, phone }) {
  const escape = (s) => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const fmtBudget = new Intl.NumberFormat('fr-FR').format(budget) + ' FCFA';

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1A1A1A;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <tr><td style="background:linear-gradient(135deg,#002F66 0%,#00498A 100%);padding:28px 24px;text-align:center;color:white;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;opacity:0.85;">YARAM · International</div>
        <div style="font-size:22px;font-weight:800;margin-top:8px;">Nouvelle demande client</div>
      </td></tr>
      <tr><td style="padding:32px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr><td style="padding:12px 0;border-bottom:1px solid #EFEFEF;">
            <div style="font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Marque</div>
            <div style="font-size:18px;font-weight:700;margin-top:4px;">${escape(brand)}</div>
          </td></tr>
          <tr><td style="padding:12px 0;border-bottom:1px solid #EFEFEF;">
            <div style="font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Produit(s) demandé(s)</div>
            <div style="font-size:14px;margin-top:6px;line-height:1.5;white-space:pre-wrap;">${escape(product)}</div>
          </td></tr>
          <tr><td style="padding:12px 0;border-bottom:1px solid #EFEFEF;">
            <div style="font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Budget approximatif</div>
            <div style="font-size:16px;font-weight:700;margin-top:4px;color:#1F8B4C;">${escape(fmtBudget)}</div>
          </td></tr>
          ${phone ? `<tr><td style="padding:12px 0;border-bottom:1px solid #EFEFEF;">
            <div style="font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">WhatsApp</div>
            <div style="font-size:14px;margin-top:4px;"><a href="https://wa.me/${escape(phone.replace(/[^0-9]/g, ''))}" style="color:#1F8B4C;text-decoration:none;font-weight:600;">${escape(phone)}</a></div>
          </td></tr>` : ''}
          <tr><td style="padding-top:24px;">
            <div style="background:#FFF7E6;border:1px solid #F4B53A;border-radius:10px;padding:14px;font-size:13px;color:#664C0A;">
              <strong>À faire :</strong> sourcer le produit, envoyer un devis ferme au client sous 48h sur WhatsApp.
            </div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid #EFEFEF;font-size:12px;color:#888;text-align:center;">
        Reçu via le formulaire Boutique Internationale · <a href="https://yaram.app/international" style="color:#1F8B4C;text-decoration:none;">yaram.app/international</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
