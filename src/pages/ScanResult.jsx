import { useState, useEffect, useRef } from 'react';
import { useNav } from '../App';
import { supabase, getProductsForSkinDiagnosis } from '../lib/supabase';
import SignedImage from '../components/SignedImage';
import './ScanResult.css';

const SEVERITY_COLORS = {
  low: '#1F8B4C',
  moderate: '#F4B53A',
  high: '#D9342B',
};

const SEVERITY_LABELS = {
  low: 'Faible',
  moderate: 'Modérée',
  high: 'Forte',
};

const CONCERN_EMOJIS = {
  default: '🔍',
  sécheresse: '🌵',
  taches: '🟤',
  rides: '〰️',
  acné: '🔴',
  pores: '⚫',
  rougeurs: '🟥',
  brillance: '✨',
  cernes: '🌙',
  sensibilité: '🌸',
  hyperpigmentation: '🟫',
  imperfections: '⚪',
};

const SKIN_TYPE_LABELS = {
  'sèche': { emoji: '🌵', label: 'Peau sèche', tone: 'Recherche d\'hydratation profonde' },
  'grasse': { emoji: '✨', label: 'Peau grasse', tone: 'Régulation du sébum' },
  'mixte': { emoji: '💧', label: 'Peau mixte', tone: 'Équilibre zones T et joues' },
  'sensible': { emoji: '🌸', label: 'Peau sensible', tone: 'Apaisement et protection' },
  'normale': { emoji: '💚', label: 'Peau normale', tone: 'Entretien et prévention' },
};

function findConcernEmoji(name = '') {
  const lower = name.toLowerCase();
  for (const key of Object.keys(CONCERN_EMOJIS)) {
    if (key !== 'default' && lower.includes(key)) return CONCERN_EMOJIS[key];
  }
  return CONCERN_EMOJIS.default;
}

// easeOutCubic
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

export default function ScanResult({ scanId }) {
  const { navigate } = useNav();
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [compatibles, setCompatibles] = useState([]);
  const [avoid, setAvoid] = useState([]);
  const [animScore, setAnimScore] = useState(0);
  const [shareToast, setShareToast] = useState(false);
  const animRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const { data, error } = await supabase
          .from('skin_scans')
          .select('*')
          .eq('id', scanId)
          .single();
        if (cancelled) return;
        if (error) {
          console.warn('[ScanResult] fetch error:', error.message);
        }
        if (data) {
          setScan(data);
          try {
            const { compatibles, avoid } = await getProductsForSkinDiagnosis(data.diagnosis || {});
            if (cancelled) return;
            setCompatibles(compatibles.slice(0, 10));
            setAvoid(avoid.slice(0, 5));
          } catch (innerErr) {
            console.warn('[ScanResult] products diagnosis failed:', innerErr?.message);
          }
        }
      } catch (e) {
        console.warn('[ScanResult] load failed:', e?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [scanId]);

  // Animation compteur score
  useEffect(() => {
    if (!scan) return;
    const target = scan.skin_score || 0;
    const duration = 1200;
    const start = performance.now();
    const tick = (now) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(t);
      setAnimScore(Math.round(target * eased));
      if (t < 1) animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [scan]);

  const handleShare = async () => {
    const txt = `Mon scan peau YARAM : ${scan?.skin_score || 0}/100, peau ${scan?.skin_type || ''}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Mon diagnostic peau', text: txt });
      } else {
        await navigator.clipboard?.writeText(txt);
        setShareToast(true);
        setTimeout(() => setShareToast(false), 1800);
      }
    } catch (e) {
      // user cancelled
    }
  };

  if (loading) {
    return (
      <div className="sr-screen sr-loading">
        <div className="sr-loading-spinner" />
        <p>On prépare ton diagnostic…</p>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="sr-screen sr-empty-screen">
        <div className="sr-empty-icon">🔍</div>
        <h2>Scan introuvable</h2>
        <p>Ce diagnostic a peut-être été supprimé.</p>
        <button className="sr-btn-primary" onClick={() => navigate('scan')}>Faire un nouveau scan</button>
      </div>
    );
  }

  const d = scan.diagnosis || {};
  const target = scan.skin_score || 0;
  const scoreColor = target >= 80 ? '#1F8B4C' : target >= 60 ? '#F4B53A' : '#D9342B';
  const scoreLabel = target >= 80 ? 'Excellent' : target >= 60 ? 'Bon' : target >= 40 ? 'À améliorer' : 'À surveiller';
  const typeInfo = SKIN_TYPE_LABELS[scan.skin_type] || { emoji: '✨', label: `Peau ${scan.skin_type || ''}`, tone: '' };
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - animScore / 100);

  return (
    <div className="sr-screen page-anim">
      {/* Header glass */}
      <header className="sr-header">
        <button className="sr-back" onClick={() => navigate('/')} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className="sr-header-title">
          <h1>Ton diagnostic peau</h1>
          <p>{new Date(scan.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button className="sr-share" onClick={handleShare} aria-label="Partager">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
      </header>

      <div className="sr-scroll">
        {/* ===== HERO RESULTS ===== */}
        <section className="sr-hero" style={{ '--score-color': scoreColor }}>
          <div className="sr-hero-orbs">
            <span className="sr-orb sr-orb-1" />
            <span className="sr-orb sr-orb-2" />
          </div>

          <div className="sr-hero-top">
            <div className="sr-type-bubble">
              <span className="sr-type-emoji">{typeInfo.emoji}</span>
            </div>
            <h2 className="sr-type-name">{typeInfo.label}</h2>
            {typeInfo.tone && <p className="sr-type-tone">{typeInfo.tone}</p>}
          </div>

          <div className="sr-score-ring-wrap">
            <svg viewBox="0 0 140 140" className="sr-score-ring">
              <defs>
                <linearGradient id="sr-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={scoreColor} stopOpacity="1" />
                  <stop offset="100%" stopColor={scoreColor} stopOpacity="0.6" />
                </linearGradient>
              </defs>
              <circle cx="70" cy="70" r={radius} stroke="rgba(255,255,255,0.18)" strokeWidth="10" fill="none" />
              <circle
                cx="70" cy="70" r={radius}
                stroke="url(#sr-grad)"
                strokeWidth="10"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform="rotate(-90 70 70)"
                style={{ filter: `drop-shadow(0 0 8px ${scoreColor}88)` }}
              />
            </svg>
            <div className="sr-score-center">
              <span className="sr-score-num">{animScore}</span>
              <span className="sr-score-max">/100</span>
              <span className="sr-score-label">{scoreLabel}</span>
            </div>
          </div>

          {scan.photo_front_url && (
            <div className="sr-photos">
              {scan.photo_front_url && <SignedImage src={scan.photo_front_url} alt="face" />}
              {scan.photo_left_url && <SignedImage src={scan.photo_left_url} alt="profil gauche" />}
              {scan.photo_right_url && <SignedImage src={scan.photo_right_url} alt="profil droit" />}
            </div>
          )}

          {d.global && <p className="sr-global">{d.global}</p>}
        </section>

        {/* ===== DIAGNOSTIC CARDS ===== */}
        {d.concerns && d.concerns.length > 0 && (
          <section className="sr-section sr-stagger">
            <div className="sr-section-head">
              <h2>Préoccupations détectées</h2>
              <p>{d.concerns.length} {d.concerns.length > 1 ? 'points' : 'point'} d'attention</p>
            </div>
            <div className="sr-concerns-grid">
              {d.concerns.map((c, i) => (
                <article
                  key={i}
                  className="sr-concern-card"
                  style={{
                    '--c-color': SEVERITY_COLORS[c.severity] || '#6B6B6B',
                    animationDelay: `${0.05 * i}s`,
                  }}
                >
                  <div className="sr-concern-head">
                    <span className="sr-concern-emoji">{findConcernEmoji(c.name)}</span>
                    <span className="sr-concern-badge">{SEVERITY_LABELS[c.severity] || c.severity}</span>
                  </div>
                  <strong className="sr-concern-title">{c.name}</strong>
                  {c.zone && <span className="sr-concern-zone">📍 {c.zone}</span>}
                  {c.advice && <p className="sr-concern-advice">{c.advice}</p>}
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ===== ZONES ===== */}
        {d.zones && Object.values(d.zones).some(Boolean) && (
          <section className="sr-section">
            <div className="sr-section-head">
              <h2>Analyse par zone</h2>
              <p>Lecture détaillée de ton visage</p>
            </div>
            <div className="sr-zones-grid">
              {d.zones.front && <div className="sr-zone-card"><strong>Front</strong><p>{d.zones.front}</p></div>}
              {d.zones.joue_gauche && <div className="sr-zone-card"><strong>Joue gauche</strong><p>{d.zones.joue_gauche}</p></div>}
              {d.zones.joue_droite && <div className="sr-zone-card"><strong>Joue droite</strong><p>{d.zones.joue_droite}</p></div>}
              {d.zones.menton && <div className="sr-zone-card"><strong>Menton</strong><p>{d.zones.menton}</p></div>}
            </div>
          </section>
        )}

        {/* ===== ROUTINE RECOMMANDÉE ===== */}
        {d.routine_recommandee && d.routine_recommandee.length > 0 && (
          <section className="sr-section sr-section-routine">
            <div className="sr-section-head">
              <h2>Ta routine personnalisée</h2>
              <p>Pensée par l'IA pour ta peau</p>
            </div>
            <div className="sr-routine-timeline">
              {d.routine_recommandee.map((step, i) => (
                <article key={i} className="sr-routine-step" style={{ animationDelay: `${0.06 * i}s` }}>
                  <div className="sr-routine-num">{step.step || (i + 1)}</div>
                  <div className="sr-routine-body">
                    <div className="sr-routine-head">
                      <strong>{step.product_type}</strong>
                      {step.moment && <span className="sr-routine-time">{step.moment}</span>}
                    </div>
                    {step.why && <p>{step.why}</p>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ===== PRODUITS RECOMMANDÉS (CARROUSEL) ===== */}
        {compatibles.length > 0 && (
          <section className="sr-section">
            <div className="sr-section-head sr-section-head-row">
              <div>
                <h2>Produits suggérés</h2>
                <p>{compatibles.length} produits sélectionnés pour toi</p>
              </div>
              <button
                className="sr-see-all"
                onClick={() => navigate('search')}
              >
                Tout voir
              </button>
            </div>

            <div className="sr-carousel">
              {compatibles.map((p, i) => (
                <article
                  key={p.id}
                  className="sr-product-card"
                  onClick={() => navigate({ name: 'product', params: { id: p.id } })}
                  style={{ animationDelay: `${0.04 * i}s` }}
                >
                  <div className="sr-product-img-wrap">
                    <img
                      src={p.img || p.image_url}
                      alt={p.name}
                      onError={(e) => e.target.style.display = 'none'}
                    />
                    <span className="sr-match-badge">Match</span>
                  </div>
                  <div className="sr-product-info">
                    <strong>{p.name}</strong>
                    <span className="sr-product-price">{(p.price || 0).toLocaleString('fr-FR')} FCFA</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ===== INGRÉDIENTS ===== */}
        {(d.ingredients_recommandes?.length > 0 || d.ingredients_a_eviter?.length > 0) && (
          <section className="sr-section">
            <div className="sr-section-head">
              <h2>Ingrédients clés</h2>
              <p>Ce qu'il faut chercher (et fuir)</p>
            </div>

            {d.ingredients_recommandes?.length > 0 && (
              <div className="sr-ing-block sr-ing-good">
                <div className="sr-ing-label">
                  <span className="sr-ing-ico">✅</span>
                  À privilégier
                </div>
                <div className="sr-tags">
                  {d.ingredients_recommandes.map((ing, i) => (
                    <span key={i} className="sr-tag sr-tag-good">{ing}</span>
                  ))}
                </div>
              </div>
            )}

            {d.ingredients_a_eviter?.length > 0 && (
              <div className="sr-ing-block sr-ing-bad">
                <div className="sr-ing-label">
                  <span className="sr-ing-ico">⚠️</span>
                  À éviter
                </div>
                <div className="sr-tags">
                  {d.ingredients_a_eviter.map((ing, i) => (
                    <span key={i} className="sr-tag sr-tag-bad">{ing}</span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ===== PRODUITS À ÉVITER ===== */}
        {avoid.length > 0 && (
          <section className="sr-section sr-section-warn">
            <div className="sr-section-head">
              <h2>À éviter</h2>
              <p>{avoid.length} produits contiennent des ingrédients déconseillés</p>
            </div>
            <div className="sr-carousel">
              {avoid.map(p => (
                <article key={p.id} className="sr-product-card sr-product-avoid">
                  <div className="sr-product-img-wrap">
                    <img src={p.img || p.image_url} alt={p.name} onError={(e) => e.target.style.display = 'none'} />
                    <span className="sr-match-badge sr-avoid-badge">Non recommandé</span>
                  </div>
                  <div className="sr-product-info">
                    <strong>{p.name}</strong>
                    <span className="sr-product-price sr-avoid-price">{(p.price || 0).toLocaleString('fr-FR')} FCFA</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ===== COMPRENDRE TES RÉSULTATS ===== */}
        <section className="sr-edu">
          <div className="sr-edu-icon">💡</div>
          <h3>Comprendre tes résultats</h3>
          <p>
            Ton <strong>score peau</strong> reflète l'état global évalué par l'IA selon
            l'hydratation, la texture et les imperfections détectées. Les <strong>préoccupations</strong> sont
            classées par sévérité — concentre tes efforts sur les <em>fortes</em> d'abord.
            Une <strong>routine régulière</strong> (matin + soir, 4 à 8 semaines) montre les premiers effets visibles.
          </p>
        </section>

        {/* ===== ADVICE FROM AI ===== */}
        {d.advice && (
          <section className="sr-advice">
            <div className="sr-advice-icon">💚</div>
            <h3>Le mot YARAM</h3>
            <p>{d.advice}</p>
          </section>
        )}

        {/* ===== ACTIONS BOTTOM ===== */}
        <div className="sr-actions">
          <button className="sr-btn-primary" onClick={() => navigate('scan')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            Refaire un scan
          </button>
          <div className="sr-actions-row">
            <button className="sr-btn-secondary" onClick={() => navigate({ name: 'scan_history' })}>
              Mon historique
            </button>
            <button className="sr-btn-secondary" onClick={handleShare}>
              Partager
            </button>
          </div>
        </div>
      </div>

      {shareToast && (
        <div className="sr-toast">Diagnostic copié ✓</div>
      )}
    </div>
  );
}
