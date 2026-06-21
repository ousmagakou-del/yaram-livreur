import { useState, useEffect, useMemo, useRef } from 'react';
import { useNav, useUser } from '../App';
import { getMySkinScans } from '../lib/supabase';
import SignedImage from '../components/SignedImage';
import './Evolution.css';

// ─── Haptic léger (no-op safe) ───
function haptic(kind = 'light') {
  try { if (window?.navigator?.vibrate) window.navigator.vibrate(kind === 'light' ? 8 : 20); } catch (_) {}
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
function formatMonthShort(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('fr-FR', { month: 'short' });
}

// ─── Compteur animé : interpole de 0 → target sur durationMs ───
function useCountUp(target, durationMs = 900, deps = []) {
  const [val, setVal] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    if (target == null) { setVal(0); return; }
    const start = performance.now();
    const from = 0;
    const to = target;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutQuart
      const eased = 1 - Math.pow(1 - t, 4);
      setVal(Math.round(from + (to - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, ...deps]);
  return val;
}

export default function Evolution() {
  const { navigate } = useNav();
  const user = useUser();
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chartReady, setChartReady] = useState(false);
  // Slider position pour le avant/après (0 = 100% premier scan, 100 = 100% dernier)
  const [sliderPos, setSliderPos] = useState(50);
  // Photo crossfade key — change quand on swipe l'image
  const [photoView, setPhotoView] = useState('after'); // 'before' | 'after'

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMySkinScans();
        if (!cancelled) {
          setScans(data || []);
          setTimeout(() => setChartReady(true), 250);
        }
      } catch (e) {
        console.warn('[Evolution] fetch failed:', e?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ═══ Derived data ═══

  // Tri DESC : dernier en premier
  const sorted = useMemo(() => [...scans].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [scans]);
  const latest = sorted[0];
  const first  = sorted[sorted.length - 1];

  // Score trend vs il y a ~30 jours
  const trend30 = useMemo(() => {
    if (!latest) return null;
    const now = new Date(latest.created_at).getTime();
    const target30 = now - 30 * 24 * 60 * 60 * 1000;
    // Trouve le scan le plus proche d'il y a 30 jours
    let ref = null;
    let best = Infinity;
    for (const s of sorted) {
      const t = new Date(s.created_at).getTime();
      const d = Math.abs(t - target30);
      if (d < best && s.id !== latest.id) { best = d; ref = s; }
    }
    if (!ref) return null;
    const diff = (latest.skin_score || 0) - (ref.skin_score || 0);
    const pct = ref.skin_score ? Math.round((diff / ref.skin_score) * 100) : 0;
    return { diff, pct, refDate: ref.created_at };
  }, [sorted, latest]);

  const skinScore = latest?.skin_score || 0;
  const animatedScore = useCountUp(loading ? 0 : skinScore, 1000);

  // Chart : 6 derniers mois (scans groupés par mois, on prend la moyenne)
  const chartData = useMemo(() => {
    if (sorted.length < 1) return null;
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: formatMonthShort(d), date: d, scores: [] });
    }
    for (const s of sorted) {
      const d = new Date(s.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const m = months.find(x => x.key === key);
      if (m) m.scores.push(s.skin_score || 0);
    }
    const monthsWithVal = months.map(m => ({
      ...m,
      val: m.scores.length ? Math.round(m.scores.reduce((a, b) => a + b, 0) / m.scores.length) : null,
    }));

    // Si trop peu de data → on remplit avec interpolation simple (gérer "pas de scan ce mois-là")
    const hasAny = monthsWithVal.some(m => m.val != null);
    if (!hasAny) return null;

    // Forward-fill : si null → on prend le dernier non-null
    let lastVal = null;
    const filled = monthsWithVal.map(m => {
      if (m.val != null) { lastVal = m.val; return { ...m, val: m.val }; }
      return { ...m, val: lastVal };
    });
    // Et si toujours null en début → on backward-fill
    let nextVal = null;
    for (let i = filled.length - 1; i >= 0; i--) {
      if (filled[i].val != null) nextVal = filled[i].val;
      else filled[i].val = nextVal;
    }

    const W = 320;
    const H = 140;
    const PAD_X = 18;
    const PAD_Y = 18;
    const innerW = W - PAD_X * 2;
    const innerH = H - PAD_Y * 2;
    const pts = filled.map((m, i) => {
      const x = filled.length === 1 ? W / 2 : PAD_X + (i / (filled.length - 1)) * innerW;
      const v = m.val ?? 0;
      const y = PAD_Y + (1 - v / 100) * innerH;
      return { x, y, val: v, label: m.label };
    });
    const path = pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
    const area = `${path} L ${pts[pts.length - 1].x} ${H - PAD_Y} L ${pts[0].x} ${H - PAD_Y} Z`;
    return { W, H, points: pts, path, area };
  }, [sorted]);

  // Path length pour l'animation draw du line chart
  const pathRef = useRef(null);
  const [pathLen, setPathLen] = useState(600);
  useEffect(() => {
    if (pathRef.current && chartData) {
      try { setPathLen(pathRef.current.getTotalLength()); } catch (_) {}
    }
  }, [chartData, chartReady]);

  // Préoccupations résolues = concerns présentes dans le PREMIER scan ET absentes du DERNIER
  const resolvedConcerns = useMemo(() => {
    if (!first || !latest || first.id === latest.id) return [];
    const firstConcerns = (first.diagnosis?.concerns || []).map(c => c.name).filter(Boolean);
    const latestNames = new Set((latest.diagnosis?.concerns || []).map(c => c.name).filter(Boolean));
    return firstConcerns.filter(n => !latestNames.has(n));
  }, [first, latest]);

  // Insights : règles simples basées sur progression
  const insights = useMemo(() => {
    if (!latest) return [];
    const out = [];
    const score = latest.skin_score || 0;
    const trend = trend30?.diff || 0;

    if (trend > 5) {
      out.push({ icon: 'spark', tone: 'good', title: 'Ta routine fonctionne !', desc: 'Continue sur cette lancée, tes progrès se voient.' });
    } else if (trend < -5) {
      out.push({ icon: 'alert', tone: 'warn', title: 'Petite baisse à surveiller', desc: 'Vérifie l\'hydratation et le sommeil cette semaine.' });
    } else if (sorted.length >= 2) {
      out.push({ icon: 'steady', tone: 'info', title: 'Score stable', desc: 'Constance, c\'est déjà très bien. Pense au layering pour booster.' });
    }

    if (score < 60) {
      out.push({ icon: 'drop', tone: 'info', title: 'Ajoute un sérum vitamine C', desc: 'Idéal le matin pour éclat et tonus de la peau.' });
    } else if (score < 80) {
      out.push({ icon: 'sun', tone: 'info', title: 'N\'oublie pas la protection solaire', desc: 'SPF 50 même les jours nuageux, ta peau te remerciera.' });
    } else {
      out.push({ icon: 'crown', tone: 'good', title: 'Skin goals atteint', desc: 'Ta peau est en super forme. Maintien et hydratation.' });
    }

    if (resolvedConcerns.length > 0) {
      out.push({ icon: 'check', tone: 'good', title: `${resolvedConcerns.length} préoccupation${resolvedConcerns.length > 1 ? 's' : ''} résolue${resolvedConcerns.length > 1 ? 's' : ''}`, desc: 'Tes efforts paient, garde le rythme.' });
    }

    if (sorted.length === 1) {
      out.push({ icon: 'calendar', tone: 'info', title: 'Refais un scan dans 30 jours', desc: 'Pour mesurer ta progression et adapter ta routine.' });
    }

    return out.slice(0, 5);
  }, [latest, trend30, resolvedConcerns, sorted]);

  // ═══ Slider avant/après — drag handler ═══
  const sliderTrackRef = useRef(null);
  const draggingRef = useRef(false);

  const updateSliderFromEvent = (clientX) => {
    if (!sliderTrackRef.current) return;
    const rect = sliderTrackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(pct);
  };

  const onSliderDown = (e) => {
    draggingRef.current = true;
    haptic('light');
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    updateSliderFromEvent(clientX);
    const onMove = (ev) => {
      if (!draggingRef.current) return;
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      updateSliderFromEvent(cx);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
  };

  // ═══ LOADING ═══
  if (loading) {
    return (
      <div className="ev-screen ev-loading page-anim">
        <header className="ev-header">
          <button className="ev-back-btn" onClick={() => navigate(-1)} aria-label="Retour">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <h1>Évolution</h1>
          <div className="ev-back-btn" style={{ visibility: 'hidden' }} />
        </header>
        <div className="ev-loading-body">
          <div className="ev-spinner" />
          <p>Analyse de ton parcours peau…</p>
        </div>
      </div>
    );
  }

  // ═══ EMPTY STATE ═══
  if (!scans.length) {
    return (
      <div className="ev-screen page-anim">
        <header className="ev-header">
          <button className="ev-back-btn" onClick={() => navigate(-1)} aria-label="Retour">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <h1>Mon évolution peau</h1>
          <div className="ev-back-btn" style={{ visibility: 'hidden' }} />
        </header>
        <div className="ev-empty">
          <div className="ev-empty-illu">
            <svg viewBox="0 0 200 200">
              <defs>
                <linearGradient id="ev-empty-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#4CD080"/>
                  <stop offset="100%" stopColor="#1F8B4C"/>
                </linearGradient>
              </defs>
              <circle cx="100" cy="100" r="86" fill="rgba(31, 139, 76, 0.07)"/>
              <circle cx="100" cy="100" r="62" fill="rgba(31, 139, 76, 0.12)"/>
              <ellipse cx="100" cy="96" rx="40" ry="52" fill="url(#ev-empty-grad)"/>
              <circle cx="86" cy="86" r="3" fill="white"/>
              <circle cx="114" cy="86" r="3" fill="white"/>
              <path d="M86 112 Q100 122 114 112" stroke="white" strokeWidth="2.4" fill="none" strokeLinecap="round"/>
            </svg>
          </div>
          <h2>Pas encore de scans</h2>
          <p>Lance ton premier scan IA pour démarrer le suivi de ta peau. Tu verras tes progrès en un coup d'œil.</p>
          <button className="ev-cta-primary ripple" onClick={() => { haptic('light'); navigate({ name: 'scan', params: {} }); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/>
            </svg>
            Faire mon 1er scan
          </button>
        </div>
      </div>
    );
  }

  // ═══ MAIN VIEW ═══
  const trendUp   = (trend30?.diff ?? 0) > 0;
  const trendDown = (trend30?.diff ?? 0) < 0;
  const trendNeutral = !trend30 || trend30.diff === 0;

  return (
    <div className="ev-screen page-anim">
      <header className="ev-header ev-header-glass">
        <button className="ev-back-btn" onClick={() => navigate(-1)} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <h1>Mon évolution</h1>
        <button className="ev-share-btn" onClick={() => { haptic('light'); navigate('scan_history'); }} aria-label="Historique">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </button>
      </header>

      <div className="ev-scroll">
        {/* ═══ 1. HERO STATS ═══ */}
        <section className="ev-hero">
          <div className="ev-hero-bg" />
          <div className="ev-hero-inner">
            <span className="ev-hero-label">Score peau actuel</span>
            <div className="ev-hero-score">
              <span className="ev-hero-score-val">{animatedScore}</span>
              <span className="ev-hero-score-unit">/100</span>
            </div>

            <div className="ev-hero-trend-row">
              {trend30 ? (
                <span className={`ev-trend-pill ${trendUp ? 'up' : trendDown ? 'down' : 'flat'}`}>
                  {trendUp && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                    </svg>
                  )}
                  {trendDown && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>
                    </svg>
                  )}
                  {trendNeutral && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  )}
                  <span>
                    {trendUp ? '+' : ''}{trend30.diff} pts
                    {trend30.pct !== 0 && <span className="ev-trend-pct"> · {trendUp ? '+' : ''}{trend30.pct}%</span>}
                  </span>
                </span>
              ) : (
                <span className="ev-trend-pill flat">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  <span>Pas de comparaison</span>
                </span>
              )}
              <span className="ev-hero-sub">vs il y a 30 jours</span>
            </div>

            {/* Gauge circulaire animée */}
            <div className="ev-gauge">
              <svg viewBox="0 0 120 120">
                <defs>
                  <linearGradient id="ev-gauge-grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#FFD66B"/>
                    <stop offset="50%" stopColor="#6FFFA6"/>
                    <stop offset="100%" stopColor="white"/>
                  </linearGradient>
                </defs>
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="8"/>
                <circle
                  cx="60" cy="60" r="52"
                  fill="none"
                  stroke="url(#ev-gauge-grad)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(animatedScore / 100) * 326.7} 326.7`}
                  transform="rotate(-90 60 60)"
                  style={{ transition: 'stroke-dasharray 1s cubic-bezier(0.22, 1, 0.36, 1)' }}
                />
              </svg>
            </div>
          </div>
        </section>

        {/* ═══ 2. LINE CHART — évolution 6 mois ═══ */}
        {chartData && (
          <section className="ev-card ev-chart-card">
            <div className="ev-card-head">
              <div>
                <h2 className="ev-card-title">Évolution du score</h2>
                <p className="ev-card-sub">6 derniers mois · {sorted.length} scan{sorted.length > 1 ? 's' : ''}</p>
              </div>
            </div>

            <div className="ev-chart-wrap">
              <svg viewBox={`0 0 ${chartData.W} ${chartData.H}`} className="ev-chart-svg" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="ev-line-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#4CD080"/>
                    <stop offset="100%" stopColor="#1F8B4C"/>
                  </linearGradient>
                  <linearGradient id="ev-area-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4CD080" stopOpacity="0.4"/>
                    <stop offset="100%" stopColor="#4CD080" stopOpacity="0"/>
                  </linearGradient>
                </defs>

                {/* Gridlines */}
                {[0, 25, 50, 75, 100].map(v => {
                  const y = 18 + (1 - v / 100) * (chartData.H - 36);
                  return <line key={v} x1="10" x2={chartData.W - 10} y1={y} y2={y} stroke="var(--ob-line, #ECECE8)" strokeWidth="0.6" strokeDasharray="2 3"/>;
                })}
                {/* Y-axis labels */}
                {[100, 50, 0].map(v => {
                  const y = 18 + (1 - v / 100) * (chartData.H - 36);
                  return <text key={v} x="4" y={y + 3} fill="#9B9B96" fontSize="8" fontWeight="600">{v}</text>;
                })}

                {/* Area */}
                <path
                  d={chartData.area}
                  fill="url(#ev-area-grad)"
                  className={chartReady ? 'ev-area-in' : ''}
                />

                {/* Line */}
                <path
                  ref={pathRef}
                  d={chartData.path}
                  fill="none"
                  stroke="url(#ev-line-grad)"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    strokeDasharray: pathLen,
                    strokeDashoffset: chartReady ? 0 : pathLen,
                    transition: chartReady ? 'stroke-dashoffset 1.4s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                  }}
                />

                {/* Points */}
                {chartData.points.map((p, i) => (
                  <g key={i} className={chartReady ? 'ev-point-in' : 'ev-point-hidden'} style={{ animationDelay: `${0.8 + i * 0.1}s` }}>
                    <circle cx={p.x} cy={p.y} r="7" fill="white" stroke="#1F8B4C" strokeWidth="2.2"/>
                    <circle cx={p.x} cy={p.y} r="3" fill="#1F8B4C"/>
                  </g>
                ))}
              </svg>

              <div className="ev-chart-axis">
                {chartData.points.map((p, i) => <span key={i} className="ev-axis-label">{p.label}</span>)}
              </div>
            </div>
          </section>
        )}

        {/* ═══ 3. BEFORE / AFTER PHOTOS ═══ */}
        {first && latest && first.id !== latest.id && (first.photo_front_url || latest.photo_front_url) && (
          <section className="ev-card ev-ba-card">
            <div className="ev-card-head">
              <div>
                <h2 className="ev-card-title">Avant / Après</h2>
                <p className="ev-card-sub">Glisse pour comparer ton premier scan et le dernier</p>
              </div>
            </div>

            <div className="ev-ba-wrap">
              {/* Image "Après" (dernier) en fond */}
              <div className="ev-ba-layer ev-ba-after">
                {latest.photo_front_url ? (
                  <SignedImage src={latest.photo_front_url} alt="Dernier scan" />
                ) : (
                  <div className="ev-ba-placeholder">Pas de photo</div>
                )}
                <div className="ev-ba-tag ev-ba-tag-after">
                  <span>Après</span>
                  <strong>{latest.skin_score || 0}/100</strong>
                </div>
              </div>

              {/* Image "Avant" (premier), clippée */}
              <div className="ev-ba-layer ev-ba-before" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
                {first.photo_front_url ? (
                  <SignedImage src={first.photo_front_url} alt="Premier scan" />
                ) : (
                  <div className="ev-ba-placeholder">Pas de photo</div>
                )}
                <div className="ev-ba-tag ev-ba-tag-before">
                  <span>Avant</span>
                  <strong>{first.skin_score || 0}/100</strong>
                </div>
              </div>

              {/* Divider + handle */}
              <div
                ref={sliderTrackRef}
                className="ev-ba-track"
                onMouseDown={onSliderDown}
                onTouchStart={onSliderDown}
              >
                <div className="ev-ba-divider" style={{ left: `${sliderPos}%` }} />
                <button
                  className="ev-ba-handle"
                  style={{ left: `${sliderPos}%` }}
                  aria-label="Glisser pour comparer"
                  type="button"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                    <polyline points="9 18 3 12 9 6" opacity="0"/>
                  </svg>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              </div>
            </div>

            <div className="ev-ba-dates">
              <span>{formatDate(first.created_at)}</span>
              <span className="ev-ba-arrow">→</span>
              <span>{formatDate(latest.created_at)}</span>
            </div>
          </section>
        )}

        {/* ═══ 4. PRÉOCCUPATIONS RÉSOLUES ═══ */}
        {resolvedConcerns.length > 0 && (
          <section className="ev-card">
            <div className="ev-card-head">
              <div>
                <h2 className="ev-card-title">
                  <span className="ev-emoji">✨</span>
                  Préoccupations résolues
                </h2>
                <p className="ev-card-sub">Disparues entre ton 1er scan et le dernier</p>
              </div>
            </div>
            <div className="ev-resolved-list">
              {resolvedConcerns.map((name, i) => (
                <span key={name} className="ev-resolved-badge" style={{ animationDelay: `${i * 0.08}s` }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Résolu : {name}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ═══ 5. INSIGHTS ═══ */}
        {insights.length > 0 && (
          <section className="ev-insights">
            <h2 className="ev-section-title">Tes insights</h2>
            <div className="ev-insights-list">
              {insights.map((ins, i) => (
                <article key={i} className={`ev-insight ev-insight-${ins.tone}`} style={{ animationDelay: `${0.1 + i * 0.08}s` }}>
                  <div className="ev-insight-icon">
                    <InsightIcon name={ins.icon} />
                  </div>
                  <div className="ev-insight-body">
                    <h3>{ins.title}</h3>
                    <p>{ins.desc}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Spacer pour que le CTA fixed ne masque pas le dernier contenu */}
        <div style={{ height: 80 }} />
      </div>

      {/* ═══ 6. CTA bottom ═══ */}
      <div className="ev-cta-bar">
        <button className="ev-cta-primary ripple" onClick={() => { haptic('light'); navigate({ name: 'scan', params: {} }); }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/>
          </svg>
          Nouveau scan
        </button>
      </div>
    </div>
  );
}

// ─── Insight icons ───
function InsightIcon({ name }) {
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'spark')    return <svg {...p}><path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.8 5.7 21l2.3-7.2-6-4.4h7.6z"/></svg>;
  if (name === 'alert')    return <svg {...p}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
  if (name === 'steady')   return <svg {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="19 6 19 12 13 12"/></svg>;
  if (name === 'drop')     return <svg {...p}><path d="M12 2l5.5 8.5a7 7 0 11-11 0z"/></svg>;
  if (name === 'sun')      return <svg {...p}><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.05" y2="7.05"/><line x1="16.95" y1="16.95" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.05" y2="16.95"/><line x1="16.95" y1="7.05" x2="19.07" y2="4.93"/></svg>;
  if (name === 'crown')    return <svg {...p}><path d="M3 18l2-12 5 6 4-8 4 8 5-6 2 12"/><line x1="3" y1="22" x2="21" y2="22"/></svg>;
  if (name === 'check')    return <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>;
  if (name === 'calendar') return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
  return null;
}
