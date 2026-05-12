import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { getMySkinScans } from '../lib/supabase';
import './ScanHistory.css';

export default function ScanHistory() {
  const { navigate } = useNav();
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await getMySkinScans();
      setScans(data);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Chargement…</div>;

  return (
    <div className="sh-screen page-anim">
      <header className="sh-header">
        <button className="icon-back-btn" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div>
          <h1>📊 Évolution de ma peau</h1>
          <p>{scans.length} scan{scans.length > 1 ? 's' : ''} réalisé{scans.length > 1 ? 's' : ''}</p>
        </div>
      </header>

      <div className="sh-scroll">
        {scans.length === 0 ? (
          <div className="sh-empty">
            <div style={{ fontSize: 56, marginBottom: 16 }}>🤖</div>
            <h2>Aucun scan pour l'instant</h2>
            <p>Fais ton premier scan IA pour découvrir ta peau</p>
            <button className="sh-btn-pri" onClick={() => navigate('scan')}>
              🤖 Faire mon premier scan
            </button>
          </div>
        ) : (
          <>
            {/* Évolution score */}
            {scans.length >= 2 && (
              <div className="sh-evolution-card">
                <h2>📈 Évolution du score peau</h2>
                <div className="sh-evolution-chart">
                  {[...scans].reverse().map((s, i) => (
                    <div key={s.id} className="sh-bar-col">
                      <div
                        className="sh-bar"
                        style={{
                          height: `${s.skin_score || 0}%`,
                          background: (s.skin_score || 0) >= 80 ? '#1F8B4C' : (s.skin_score || 0) >= 60 ? '#F4B53A' : '#D9342B'
                        }}
                      >
                        <span>{s.skin_score || 0}</span>
                      </div>
                      <span className="sh-bar-date">
                        {new Date(s.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="sh-list">
              {scans.map((s, i) => (
                <div
                  key={s.id}
                  className="sh-item"
                  onClick={() => navigate({ name: 'scan_result', params: { scanId: s.id } })}
                >
                  <div className="sh-item-photos">
                    {s.photo_front_url && <img src={s.photo_front_url} alt="" />}
                  </div>
                  <div className="sh-item-info">
                    <div className="sh-item-head">
                      <strong>Scan #{scans.length - i}</strong>
                      <span>{new Date(s.created_at).toLocaleDateString('fr-FR')}</span>
                    </div>
                    <div className="sh-item-stats">
                      <span className="sh-stat sh-stat-score">
                        🎯 {s.skin_score || 0}/100
                      </span>
                      <span className="sh-stat">
                        💧 Peau {s.skin_type}
                      </span>
                    </div>
                    {s.diagnosis?.concerns && s.diagnosis.concerns.length > 0 && (
                      <p className="sh-item-concerns">
                        {s.diagnosis.concerns.slice(0, 2).map(c => c.name).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="sh-item-arrow">→</div>
                </div>
              ))}
            </div>

            <button className="sh-btn-pri" onClick={() => navigate('scan')}>
              🤖 Faire un nouveau scan
            </button>
          </>
        )}
      </div>
    </div>
  );
}
