import { useState, useEffect, useMemo } from 'react';
import { useNav, useUser } from '../App';
import { getMySkinScans } from '../lib/supabase';
import { usePersistedData } from '../lib/usePersistedData';
import SignedImage from '../components/SignedImage';
import './ScanHistory.css';

function formatDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
function formatDateFull(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function ScanHistory() {
  const { navigate } = useNav();
  const { user } = useUser();
  const [chartReady, setChartReady] = useState(false);

  // FIX juin 2026 : usePersistedData → hydrate depuis cache au remount.
  const { data: scansData, loading } = usePersistedData(
    `scan-history-${user?.id || 'anon'}`,
    async () => {
      const data = await getMySkinScans();
      return data || [];
    },
    { ttl: 5 * 60 * 1000, enabled: !!user?.id }
  );
  const scans = scansData || [];

  // Lance l'animation du chart après hydratation
  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => setChartReady(true), 200);
      return () => clearTimeout(t);
    }
  }, [loading]);

  // Stats globales
  const stats = useMemo(() => {
    if (!scans.length) return null;
    const scores = scans.map(s => s.skin_score || 0);
    const latest = scores[0];
    const previous = scores[1];
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const best = Math.max(...scores);
    const trend = previous != null ? latest - previous : null;
    return { latest, previous, avg, best, trend };
  }, [scans]);

  // Chart data (oldest → newest for nice left→right reading)
  const chartData = useMemo(() => {
    if (scans.length < 2) return null;
    const items = [...scans].reverse(); // chrono ASC
    const W = 320;
    const H = 110;
    const PAD_X = 16;
    const PAD_Y = 14;
    const innerW = W - PAD_X * 2;
    const innerH = H - PAD_Y * 2;
    const points = items.map((s, i) => {
      const x = items.length === 1 ? W / 2 : PAD_X + (i / (items.length - 1)) * innerW;
      const score = s.skin_score || 0;
      const y = PAD_Y + (1 - score / 100) * innerH;
      return { x, y, score, date: s.created_at, id: s.id };
    });
    const path = points
      .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
      .join(' ');
    const areaPath = `${path} L ${points[points.length - 1].x} ${H - PAD_Y} L ${points[0].x} ${H - PAD_Y} Z`;
    return { W, H, points, path, areaPath };
  }, [scans]);

  if (loading) {
    return (
      <div className="sh-screen sh-loading">
        <div className="sh-loading-spinner" />
        <p>Chargement de ton historique…</p>
      </div>
    );
  }

  return (
    <div className="sh-screen page-anim">
      <header className="sh-header">
        <button className="sh-back" onClick={() => navigate('/')} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className="sh-header-title">
          <h1>Évolution de ma peau</h1>
          <p>{scans.length} scan{scans.length > 1 ? 's' : ''} · suivi dans le temps</p>
        </div>
      </header>

      <div className="sh-scroll">
        {scans.length === 0 ? (
          <div className="sh-empty">
            <div className="sh-empty-illustration">
              <svg viewBox="0 0 200 200" className="sh-empty-svg">
                <defs>
                  <linearGradient id="sh-empty-grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#4CD080" />
                    <stop offset="100%" stopColor="#1F8B4C" />
                  </linearGradient>
                </defs>
                <circle cx="100" cy="100" r="80" fill="rgba(31, 139, 76, 0.08)" />
                <circle cx="100" cy="100" r="58" fill="rgba(31, 139, 76, 0.12)" />
                <ellipse cx="100" cy="95" rx="38" ry="50" fill="url(#sh-empty-grad)" />
                <circle cx="88" cy="86" r="2.5" fill="white" />
                <circle cx="112" cy="86" r="2.5" fill="white" />
                <path d="M88 110 Q100 118 112 110" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
              </svg>
            </div>
            <h2>Pas encore de scan</h2>
            <p>Commence ton suivi peau IA pour voir tes progrès au fil du temps</p>
            <button className="sh-btn-primary" onClick={() => navigate('scan')}>
              Faire mon premier scan
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>
        ) : (
          <>
            {/* ===== STATS RECAP ===== */}
            {stats && (
              <section className="sh-stats">
                <div className="sh-stat-card sh-stat-main">
                  <span className="sh-stat-label">Score actuel</span>
                  <div className="sh-stat-value-row">
                    <span className="sh-stat-value">{stats.latest}</span>
                    <span className="sh-stat-unit">/100</span>
                    {stats.trend != null && stats.trend !== 0 && (
                      <span className={`sh-trend ${stats.trend > 0 ? 'sh-trend-up' : 'sh-trend-down'}`}>
                        {stats.trend > 0 ? '↑' : '↓'} {Math.abs(stats.trend)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="sh-stat-card">
                  <span className="sh-stat-label">Moyenne</span>
                  <span className="sh-stat-value-sm">{stats.avg}/100</span>
                </div>
                <div className="sh-stat-card">
                  <span className="sh-stat-label">Meilleur</span>
                  <span className="sh-stat-value-sm">{stats.best}/100</span>
                </div>
              </section>
            )}

            {/* ===== EVOLUTION CHART ===== */}
            {chartData && (
              <section className="sh-chart-card">
                <div className="sh-chart-head">
                  <div>
                    <h2>Évolution du score</h2>
                    <p>{scans.length} scans · {formatDate(scans[scans.length - 1].created_at)} → {formatDate(scans[0].created_at)}</p>
                  </div>
                </div>

                <div className="sh-chart-wrap">
                  <svg viewBox={`0 0 ${chartData.W} ${chartData.H}`} className="sh-chart-svg" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="sh-line-grad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#4CD080" />
                        <stop offset="100%" stopColor="#1F8B4C" />
                      </linearGradient>
                      <linearGradient id="sh-area-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4CD080" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#4CD080" stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {/* Gridlines */}
                    {[0, 25, 50, 75, 100].map((v) => {
                      const y = 14 + (1 - v / 100) * (chartData.H - 28);
                      return (
                        <line key={v} x1="0" x2={chartData.W} y1={y} y2={y} stroke="var(--line)" strokeWidth="0.5" strokeDasharray="2 3" />
                      );
                    })}

                    {/* Area */}
                    <path
                      d={chartData.areaPath}
                      fill="url(#sh-area-grad)"
                      className={chartReady ? 'sh-area-in' : ''}
                    />

                    {/* Line */}
                    <path
                      d={chartData.path}
                      fill="none"
                      stroke="url(#sh-line-grad)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`sh-line ${chartReady ? 'sh-line-draw' : ''}`}
                    />

                    {/* Points */}
                    {chartData.points.map((p, i) => (
                      <g key={p.id} className={chartReady ? 'sh-point-in' : ''} style={{ animationDelay: `${1.2 + i * 0.08}s` }}>
                        <circle cx={p.x} cy={p.y} r="6" fill="white" stroke="#1F8B4C" strokeWidth="2" />
                        <circle cx={p.x} cy={p.y} r="3" fill="#1F8B4C" />
                      </g>
                    ))}
                  </svg>

                  <div className="sh-chart-axis">
                    {chartData.points.map((p) => (
                      <span key={p.id} className="sh-axis-label">{formatDate(p.date)}</span>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* ===== TIMELINE OF SCANS ===== */}
            <section className="sh-timeline">
              <h2 className="sh-timeline-title">Tous mes scans</h2>
              <div className="sh-timeline-list">
                {scans.map((s, i) => {
                  const previousScore = scans[i + 1]?.skin_score;
                  const currentScore = s.skin_score || 0;
                  const delta = previousScore != null ? currentScore - previousScore : null;
                  const scoreColor = currentScore >= 80 ? '#1F8B4C' : currentScore >= 60 ? '#F4B53A' : '#D9342B';

                  return (
                    <article
                      key={s.id}
                      className="sh-item"
                      onClick={() => navigate({ name: 'scan_result', params: { scanId: s.id } })}
                      style={{ animationDelay: `${0.04 * i}s` }}
                    >
                      <div className="sh-item-thumb">
                        {s.photo_front_url ? (
                          <SignedImage src={s.photo_front_url} alt="" />
                        ) : (
                          <div className="sh-thumb-placeholder">📷</div>
                        )}
                        <div
                          className="sh-thumb-score"
                          style={{ background: scoreColor }}
                        >
                          {currentScore}
                        </div>
                      </div>

                      <div className="sh-item-body">
                        <div className="sh-item-head">
                          <strong>Scan #{scans.length - i}</strong>
                          {delta != null && delta !== 0 && (
                            <span className={`sh-delta ${delta > 0 ? 'sh-delta-up' : 'sh-delta-down'}`}>
                              {delta > 0 ? '↑' : '↓'} {Math.abs(delta)} pts
                            </span>
                          )}
                          {i === 0 && scans.length > 1 && (
                            <span className="sh-badge-latest">Dernier</span>
                          )}
                        </div>
                        <span className="sh-item-date">{formatDateFull(s.created_at)}</span>
                        <div className="sh-item-meta">
                          <span className="sh-meta-chip">
                            {s.skin_type === 'sèche' && '🌵'}
                            {s.skin_type === 'grasse' && '✨'}
                            {s.skin_type === 'mixte' && '💧'}
                            {s.skin_type === 'sensible' && '🌸'}
                            {s.skin_type === 'normale' && '💚'}
                            {' '}Peau {s.skin_type || '—'}
                          </span>
                          {s.diagnosis?.concerns?.length > 0 && (
                            <span className="sh-meta-chip sh-meta-soft">
                              {s.diagnosis.concerns.length} préoccupation{s.diagnosis.concerns.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        {s.diagnosis?.concerns && s.diagnosis.concerns.length > 0 && (
                          <p className="sh-item-concerns">
                            {s.diagnosis.concerns.slice(0, 2).map(c => c.name).join(' · ')}
                          </p>
                        )}
                      </div>

                      <div className="sh-item-arrow">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <button className="sh-btn-primary" onClick={() => navigate('scan')}>
              Faire un nouveau scan
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
