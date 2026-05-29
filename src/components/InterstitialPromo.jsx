// ════════════════════════════════════════════════════════
// YARAM — Composant Interstitial Promo (splash full-screen)
// ════════════════════════════════════════════════════════
// Affiche une promo plein écran avec 2 modes :
//   - mode='image' : image custom Canva en background, CTA en bas
//   - mode='template' : badge + title + subtitle + features + 2 CTAs
//
// Récupération via getNextPromo(), tracking via recordPromoEvent().
// ════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { recordPromoEvent } from '../lib/promos';
import { useNav } from '../App';
import './InterstitialPromo.css';

export default function InterstitialPromo({ promo, onClose }) {
  const { navigate } = useNav();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!promo?.id) return;
    // Fade-in après 50ms
    const t = setTimeout(() => setVisible(true), 50);
    // Enregistre l'impression
    recordPromoEvent(promo.id, 'shown');
    return () => clearTimeout(t);
  }, [promo?.id]);

  if (!promo) return null;

  const handleDismiss = async () => {
    setVisible(false);
    await recordPromoEvent(promo.id, 'dismissed');
    setTimeout(() => onClose?.(), 300);
  };

  const handleCTA = async (which) => {
    await recordPromoEvent(promo.id, which === 'primary' ? 'click_primary' : 'click_secondary');
    setVisible(false);
    const url = which === 'primary' ? promo.cta_url : promo.cta_secondary_url;
    setTimeout(() => {
      onClose?.();
      if (url) {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          // Route interne, ex : '/international'
          const path = url.startsWith('/') ? url.slice(1) : url;
          const [name, ...rest] = path.split('/');
          navigate({ name: name || 'home', params: rest.length ? { id: rest[0] } : {} });
        }
      }
    }, 300);
  };

  const bgStyle = promo.mode === 'image'
    ? {
        backgroundImage: `url("${promo.image_url}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : {
        background: promo.bg_color || '#0A0A1F',
        color: promo.text_color || '#FFFFFF',
      };

  // Pour le template, render des features structurées
  const features = Array.isArray(promo.features) ? promo.features : [];

  return (
    <div
      className={`yip-overlay ${visible ? 'visible' : ''}`}
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`yip-content yip-mode-${promo.mode}`}
        onClick={e => e.stopPropagation()}
        style={bgStyle}
      >
        {/* Bouton X dismiss */}
        <button
          className="yip-close"
          onClick={handleDismiss}
          aria-label="Fermer"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {promo.mode === 'image' && (
          <div className="yip-image-overlay">
            {promo.title && <h1 className="yip-image-title">{promo.title}</h1>}
            {promo.subtitle && <p className="yip-image-subtitle">{promo.subtitle}</p>}
            {promo.cta_text && (
              <button className="yip-cta-primary" onClick={() => handleCTA('primary')}>
                {promo.cta_text}
              </button>
            )}
            {promo.cta_secondary_text && (
              <button className="yip-cta-secondary" onClick={() => handleCTA('secondary')}>
                {promo.cta_secondary_text}
              </button>
            )}
          </div>
        )}

        {promo.mode === 'template' && (
          <div className="yip-template">
            {promo.badge_text && (
              <div
                className="yip-badge"
                style={{ borderColor: `${promo.title_accent_color}44` }}
              >
                {promo.badge_text}
              </div>
            )}

            <h1 className="yip-title">
              {/* Si title contient des _mots_ entourés d'underscore → couleur accent */}
              {renderTitleWithAccent(promo.title, promo.title_accent_color)}
            </h1>

            {promo.subtitle && (
              <p className="yip-subtitle">{promo.subtitle}</p>
            )}

            {features.length > 0 && (
              <div className="yip-features">
                {features.map((f, i) => (
                  <div key={i} className="yip-feature">
                    {f.icon && <div className="yip-feature-icon">{f.icon}</div>}
                    <div>
                      <strong>{f.title}</strong>
                      {f.subtitle && <span>{f.subtitle}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {promo.cta_text && (
              <button
                className="yip-cta-primary"
                onClick={() => handleCTA('primary')}
                style={{
                  background: promo.title_accent_color || '#A78BFA',
                  color: '#FFFFFF',
                }}
              >
                {promo.cta_text}
              </button>
            )}

            {promo.cta_secondary_text && (
              <button
                className="yip-cta-secondary"
                onClick={() => handleCTA('secondary')}
                style={{ color: promo.text_color || '#FFFFFF' }}
              >
                {promo.cta_secondary_text}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper : transforme "tu _mérites_" en <span style={color:accent}>mérites</span>
function renderTitleWithAccent(text, accentColor) {
  if (!text) return null;
  const parts = text.split(/(_[^_]+_)/g);
  return parts.map((p, i) => {
    if (p.startsWith('_') && p.endsWith('_')) {
      return (
        <span key={i} style={{ color: accentColor || '#A78BFA' }}>
          {p.slice(1, -1)}
        </span>
      );
    }
    return p;
  });
}
