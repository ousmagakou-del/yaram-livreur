import { useEffect, useState } from 'react';
import { useNav } from '../App';
import { getCachedSetting, subscribeSettings, getAllPharmacies } from '../lib/supabase';
import './HeroBanner.css';

// ─── Hero banner Home — éditable depuis Admin → Settings → Hero ───────
// Lit les 12 clés heroXxx dans site_settings (fallback ds SETTINGS_FALLBACK).
// Slogan 3 lignes en typo XXL, animation slide-in + sparkles flottantes.
// 4 cards pharmacies promos en bas, cliquables.
//
// Props :
//   - showPharmaCards (default true) : si false, hero solo sans pharma cards
//
// Modifier le texte = changer les valeurs dans Admin, refresh, c'est appliqué.
// Le composant subscribe aux settings : si l'admin save pendant que le user
// est sur Home, le hero se met à jour SANS reload (live update).
// ─────────────────────────────────────────────────────────────────────

const SPARKS = [
  { cls: 's1', top: 14,  left: 22,  icon: 'ti-sparkles', size: 22, color: '#F4B53A' },
  { cls: 's2', top: 70,  right: 26, icon: 'ti-star',     size: 16, color: '#FBBF24' },
  { cls: 's3', top: 130, left: 18,  icon: 'ti-sparkles', size: 14, color: '#FCD34D' },
  { cls: 's4', top: 40,  right: 80, icon: 'ti-circle-filled', size: 12, color: '#F4B53A' },
  { cls: 's5', top: 160, right: 50, icon: 'ti-sparkles', size: 18, color: '#FBBF24' },
];

export default function HeroBanner({ showPharmaCards = true }) {
  const { navigate } = useNav();
  const [tick, setTick] = useState(0); // force re-render quand settings change
  const [pharmas, setPharmas] = useState([]);

  // ─── Live update : si l'admin save le hero, on re-render ───
  useEffect(() => {
    return subscribeSettings(() => setTick(t => t + 1));
  }, []);

  // ─── Charger les 4 premières pharmacies actives pour les cards promo ───
  useEffect(() => {
    if (!showPharmaCards) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await getAllPharmacies();
        if (!cancelled) {
          setPharmas((all || []).filter(p => p.active !== false).slice(0, 4));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [showPharmaCards]);

  // ─── Lecture des settings (avec fallback hardcoded) ───
  const enabled  = getCachedSetting('heroEnabled');
  if (enabled === false) return null;

  const line1    = getCachedSetting('heroLine1');
  const line2    = getCachedSetting('heroLine2');
  const line3    = getCachedSetting('heroLine3');
  const sub      = getCachedSetting('heroSubtext');
  const bg       = getCachedSetting('heroBackground');
  const c1       = getCachedSetting('heroLine1Color');
  const c2       = getCachedSetting('heroLineColor');
  const subBg    = getCachedSetting('heroSubBg');
  const subColor = getCachedSetting('heroSubColor');
  const ctaRoute = getCachedSetting('heroCtaRoute');

  const handleCta = () => {
    if (ctaRoute) {
      // navigate accepte un string ('/path'), -1 (back), ou {name, params}.
      // On passe en format objet pour matcher le système de routes YARAM.
      navigate({ name: ctaRoute, params: {} });
    }
  };

  return (
    <div
      className="yhero"
      style={{ background: bg }}
      onClick={handleCta}
      role="button"
      aria-label={`${line1} ${line2} ${line3}`}
      data-tick={tick}
    >
      {/* Sparkles flottantes */}
      {SPARKS.map((s) => (
        <span
          key={s.cls}
          className={`yhero-spark ${s.cls}`}
          style={{
            top: s.top,
            ...(s.left !== undefined ? { left: s.left } : { right: s.right }),
            fontSize: s.size,
            color: s.color,
          }}
        >
          <i className={`ti ${s.icon}`} aria-hidden="true" />
        </span>
      ))}

      {/* Contenu */}
      <div className="yhero-content">
        {line1 && (
          <div className="yhero-line yhero-line-1" style={{ color: c1 }}>{line1}</div>
        )}
        {line2 && (
          <div className="yhero-line yhero-line-2" style={{ color: c2 }}>{line2}</div>
        )}
        {line3 && (
          <div className="yhero-line yhero-line-3" style={{ color: c2 }}>{line3}</div>
        )}
        {sub && (
          <div
            className="yhero-sub"
            style={{ background: subBg, color: subColor }}
          >
            {sub}
          </div>
        )}

        {/* Cards pharmacies promo (4 max) */}
        {showPharmaCards && pharmas.length > 0 && (
          <div className="yhero-pharma-row">
            {pharmas.map((p, i) => (
              <div
                key={p.id}
                className={`yhero-pharma-card lc${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate({ name: 'pharmacy_detail', params: { id: p.id } });
                }}
              >
                <span className="yhero-pharma-badge-corner">$</span>
                <span className="yhero-pharma-name">{p.name?.slice(0, 16) || 'Pharmacie'}</span>
                {p.promo_label && (
                  <span className="yhero-pharma-promo">{p.promo_label}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
