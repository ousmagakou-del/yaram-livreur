// ════════════════════════════════════════════════════════════════════
// YARAM — BackHeader (header de sous-page réutilisable)
// ════════════════════════════════════════════════════════════════════
// Header sticky glass blanc 80% + blur, chevron retour à gauche,
// titre centré, slot droit optionnel. Tap zone 44x44 (a11y).
//
// Usage :
//   import BackHeader from '../components/BackHeader';
//   <BackHeader title="Mes adresses" />
//   <BackHeader title="Promos" onBack={customBack} rightSlot={<MyBtn/>} />
//
// Si onBack n'est pas fourni → fallback navigate(-1) (= App.goBack).
// goBack() côté App gère le cas "pas d'historique" → retour Home.
// ════════════════════════════════════════════════════════════════════

import { useNav } from '../App';
import './BackHeader.css';

function hapticTap() {
  try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* noop */ }
}

export default function BackHeader({ title, onBack, rightSlot, sticky = true, className = '' }) {
  const { navigate } = useNav();

  const handleBack = () => {
    hapticTap();
    if (typeof onBack === 'function') {
      onBack();
    } else {
      navigate(-1);
    }
  };

  return (
    <header
      className={`yh-back-header ${sticky ? 'yh-sticky' : ''} ${className}`.trim()}
      role="banner"
    >
      <button
        type="button"
        className="yh-back-btn"
        onClick={handleBack}
        aria-label="Retour"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>

      <h1 className="yh-back-title" title={title}>{title}</h1>

      <div className="yh-back-right">
        {rightSlot || <span className="yh-back-spacer" aria-hidden="true" />}
      </div>
    </header>
  );
}
