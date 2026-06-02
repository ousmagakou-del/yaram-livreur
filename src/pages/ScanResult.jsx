import { useState, useEffect } from 'react';
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
  low: 'Léger',
  moderate: 'Modéré',
  high: 'Important',
};

export default function ScanResult({ scanId }) {
  const { navigate } = useNav();
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [compatibles, setCompatibles] = useState([]);
  const [avoid, setAvoid] = useState([]);

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

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Chargement…</div>;
  if (!scan) return <div style={{ padding: 40, textAlign: 'center' }}>Scan introuvable</div>;

  const d = scan.diagnosis || {};
  const scoreColor = scan.skin_score >= 80 ? '#1F8B4C' : scan.skin_score >= 60 ? '#F4B53A' : '#D9342B';

  return (
    <div className="sr-screen page-anim">
      <header className="sr-header">
        <button className="icon-back-btn" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div>
          <h1>🤖 Ton diagnostic peau</h1>
          <p>{new Date(scan.created_at).toLocaleString('fr-FR')}</p>
        </div>
      </header>

      <div className="sr-scroll">
        {/* Hero — Skin Score */}
        <div className="sr-hero">
          <div className="sr-photos">
            {scan.photo_front_url && <SignedImage src={scan.photo_front_url} alt="front" />}
            {scan.photo_left_url && <SignedImage src={scan.photo_left_url} alt="left" />}
            {scan.photo_right_url && <SignedImage src={scan.photo_right_url} alt="right" />}
          </div>
          
          <div className="sr-score-row">
            <div className="sr-score-box">
              <div className="sr-score-circle" style={{ '--color': scoreColor }}>
                <svg viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" stroke="#EEE" strokeWidth="8" fill="none" />
                  <circle
                    cx="50" cy="50" r="42"
                    stroke={scoreColor}
                    strokeWidth="8"
                    fill="none"
                    strokeDasharray={`${2 * Math.PI * 42}`}
                    strokeDashoffset={`${2 * Math.PI * 42 * (1 - (scan.skin_score || 0) / 100)}`}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                  />
                </svg>
                <div className="sr-score-text">
                  <strong>{scan.skin_score || 0}</strong>
                  <span>/100</span>
                </div>
              </div>
              <p>Score peau</p>
            </div>
            
            <div className="sr-type-box">
              <div className="sr-type-emoji">
                {scan.skin_type === 'sèche' && '🌵'}
                {scan.skin_type === 'grasse' && '✨'}
                {scan.skin_type === 'mixte' && '💧'}
                {scan.skin_type === 'sensible' && '🌸'}
                {scan.skin_type === 'normale' && '💚'}
              </div>
              <strong>Peau {scan.skin_type}</strong>
              <p>Type détecté</p>
            </div>
          </div>

          <p className="sr-global">{d.global}</p>
        </div>

        {/* Concerns */}
        {d.concerns && d.concerns.length > 0 && (
          <div className="sr-card">
            <h2>🔍 Ce que l'IA a détecté</h2>
            <div className="sr-concerns">
              {d.concerns.map((c, i) => (
                <div key={i} className="sr-concern" style={{ '--c-color': SEVERITY_COLORS[c.severity] || '#6B6B6B' }}>
                  <div className="sr-concern-name">
                    <strong>{c.name}</strong>
                    <span>{c.zone && `· ${c.zone}`}</span>
                  </div>
                  <span className="sr-concern-badge">{SEVERITY_LABELS[c.severity] || c.severity}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Zones */}
        {d.zones && (
          <div className="sr-card">
            <h2>📍 Analyse par zone</h2>
            <div className="sr-zones">
              {d.zones.front && (
                <div className="sr-zone">
                  <strong>Front</strong>
                  <p>{d.zones.front}</p>
                </div>
              )}
              {d.zones.joue_gauche && (
                <div className="sr-zone">
                  <strong>Joue gauche</strong>
                  <p>{d.zones.joue_gauche}</p>
                </div>
              )}
              {d.zones.joue_droite && (
                <div className="sr-zone">
                  <strong>Joue droite</strong>
                  <p>{d.zones.joue_droite}</p>
                </div>
              )}
              {d.zones.menton && (
                <div className="sr-zone">
                  <strong>Menton</strong>
                  <p>{d.zones.menton}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Routine recommandée */}
        {d.routine_recommandee && d.routine_recommandee.length > 0 && (
          <div className="sr-card">
            <h2>✨ Ta routine personnalisée</h2>
            <div className="sr-routine">
              {d.routine_recommandee.map((step, i) => (
                <div key={i} className="sr-routine-step">
                  <div className="sr-routine-num">{step.step || (i + 1)}</div>
                  <div className="sr-routine-content">
                    <strong>{step.product_type}</strong>
                    <span className="sr-routine-time">{step.moment}</span>
                    <p>{step.why}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ingrédients recommandés */}
        {d.ingredients_recommandes && d.ingredients_recommandes.length > 0 && (
          <div className="sr-card sr-card-good">
            <h2>✅ Ingrédients à privilégier</h2>
            <div className="sr-tags">
              {d.ingredients_recommandes.map((ing, i) => (
                <span key={i} className="sr-tag sr-tag-good">{ing}</span>
              ))}
            </div>
          </div>
        )}

        {/* Ingrédients à éviter */}
        {d.ingredients_a_eviter && d.ingredients_a_eviter.length > 0 && (
          <div className="sr-card sr-card-bad">
            <h2>❌ Ingrédients à éviter</h2>
            <div className="sr-tags">
              {d.ingredients_a_eviter.map((ing, i) => (
                <span key={i} className="sr-tag sr-tag-bad">{ing}</span>
              ))}
            </div>
          </div>
        )}

        {/* Produits compatibles */}
        {compatibles.length > 0 && (
          <div className="sr-card">
            <h2>💚 Produits compatibles ({compatibles.length})</h2>
            <p className="sr-subtitle">Adaptés à ta peau selon l'IA</p>
            <div className="sr-products-grid">
              {compatibles.map(p => (
                <div
                  key={p.id}
                  className="sr-product"
                  onClick={() => navigate({ name: 'product', params: { id: p.id } })}
                >
                  <img src={p.img || p.image_url} alt={p.name} onError={(e) => e.target.style.display = 'none'} />
                  <strong>{p.name}</strong>
                  <span>{(p.price || 0).toLocaleString('fr-FR')} FCFA</span>
                </div>
              ))}
            </div>
            <button
              className="sr-btn-see-all"
              onClick={() => navigate('search')}
            >Voir tous les produits →</button>
          </div>
        )}

        {/* Produits à éviter */}
        {avoid.length > 0 && (
          <div className="sr-card sr-card-bad">
            <h2>⚠️ À éviter ({avoid.length})</h2>
            <p className="sr-subtitle">Contiennent des ingrédients déconseillés</p>
            <div className="sr-products-grid">
              {avoid.map(p => (
                <div key={p.id} className="sr-product sr-product-bad">
                  <img src={p.img || p.image_url} alt={p.name} onError={(e) => e.target.style.display = 'none'} />
                  <strong>{p.name}</strong>
                  <span style={{ color: '#D9342B' }}>Non recommandé</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conseil */}
        {d.advice && (
          <div className="sr-advice">
            <div style={{ fontSize: 32, marginBottom: 8 }}>💚</div>
            <h2>Conseil YARAM</h2>
            <p>{d.advice}</p>
          </div>
        )}

        {/* Actions */}
        <div className="sr-actions">
          <button
            className="sr-btn-primary"
            onClick={() => navigate('scan')}
          >🤖 Refaire un scan</button>
          
          <button
            className="sr-btn-secondary"
            onClick={() => navigate({ name: 'scan_history' })}
          >📊 Voir mon historique</button>
        </div>
      </div>
    </div>
  );
}
