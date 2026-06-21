/* ═══════════════════════════════════════════════════════════════════
   InternationalShowcase — Hero card premium pour la boutique internationale
   • Background gradient bleu profond avec aurora animation subtile
   • Bandeau de marques connues (Sephora, Yves Rocher, La Roche-Posay, etc.)
   • Badges premium : "Importé en 15j" + "Acompte 50%"
   • Glow effect au tap
   • Shine effect qui passe une fois toutes les 6s
   ═══════════════════════════════════════════════════════════════════ */

import { useNav } from '../App';
import './InternationalShowcase.css';

const SHOWCASE_BRANDS = [
  { name: 'Sephora',         tag: '🇫🇷', color: '#000000' },
  { name: 'The Ordinary',    tag: '🇨🇦', color: '#1A1A1A' },
  { name: 'La Roche-Posay',  tag: '🇫🇷', color: '#0064B0' },
  { name: 'CeraVe',          tag: '🇺🇸', color: '#005EB8' },
  { name: 'Bioderma',        tag: '🇫🇷', color: '#E30613' },
  { name: 'Yves Rocher',     tag: '🇫🇷', color: '#2D6A2A' },
  { name: 'Vichy',           tag: '🇫🇷', color: '#E1141A' },
  { name: 'L\'Oréal',        tag: '🇫🇷', color: '#000000' },
];

export default function InternationalShowcase() {
  const { navigate } = useNav();

  const handleOpen = () => {
    if (navigator.vibrate) navigator.vibrate(30);
    navigate({ name: 'international', params: {} });
  };

  return (
    <section className="yhome-section">
      <button className="intl-card" onClick={handleOpen} aria-label="Boutique internationale">
        {/* Backdrop décoratif (aurora gradient + globe géant) */}
        <div className="intl-aurora" aria-hidden />
        <div className="intl-globe" aria-hidden>🌍</div>

        {/* Header pill : nouveau service */}
        <div className="intl-pill">
          <span className="intl-pill-dot" />
          <span>Nouveau service · disponible</span>
        </div>

        {/* Titre + sous-titre */}
        <h2 className="intl-title">
          Boutique<br/>internationale
        </h2>
        <p className="intl-sub">
          Tes marques préférées du monde entier, livrées à Dakar.
        </p>

        {/* Bandeau de marques scrollable */}
        <div className="intl-brands-row" aria-hidden>
          <div className="intl-brands-track">
            {/* dupliqué 2× pour l'effet marquee infini */}
            {[...SHOWCASE_BRANDS, ...SHOWCASE_BRANDS].map((b, i) => (
              <div className="intl-brand-chip" key={i}>
                <span className="intl-brand-flag">{b.tag}</span>
                <span className="intl-brand-name">{b.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Badges bénéfices */}
        <div className="intl-badges">
          <div className="intl-badge">
            <span className="intl-badge-emoji">✈️</span>
            <div className="intl-badge-text">
              <strong>15 jours</strong>
              <span>livraison max</span>
            </div>
          </div>
          <div className="intl-badge">
            <span className="intl-badge-emoji">💰</span>
            <div className="intl-badge-text">
              <strong>50% acompte</strong>
              <span>solde à la réception</span>
            </div>
          </div>
        </div>

        {/* CTA bas */}
        <div className="intl-cta">
          <span>Découvrir le catalogue</span>
          <span className="intl-cta-arrow" aria-hidden>→</span>
        </div>

        {/* Shine effect (lumière qui traverse) */}
        <div className="intl-shine" aria-hidden />
      </button>
    </section>
  );
}
