import { useState, useRef, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { analyzeSkinPhotos, uploadScanPhoto, saveSkinScan } from '../lib/supabase';
import './Scan.css';

const STEPS = [
  {
    id: 'front',
    title: '📸 Photo de face',
    instruction: 'Regarde droit vers la caméra, lumière naturelle',
    tips: ['Pas de maquillage', 'Cheveux dégagés', 'Lumière du jour idéale'],
    icon: '🙎🏿‍♀️',
  },
  {
    id: 'left',
    title: '👈 Joue gauche',
    instruction: 'Tourne ton visage de 90° vers la droite',
    tips: ['Profil complet visible', 'Même lumière qu\'avant'],
    icon: '👈🏿',
  },
  {
    id: 'right',
    title: '👉 Joue droite',
    instruction: 'Tourne ton visage de 90° vers la gauche',
    tips: ['Profil complet visible', 'Garde la pose stable'],
    icon: '👉🏿',
  },
];

export default function Scan() {
  const { navigate } = useNav();
  const { user } = useUser();
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState({ front: null, left: null, right: null });
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const currentStep = STEPS[step];
  const allTaken = photos.front && photos.left && photos.right;

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Compresse et convertit en base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1024;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = (height * maxDim) / width;
            width = maxDim;
          } else {
            width = (width * maxDim) / height;
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        
        setPhotos(p => ({ ...p, [currentStep.id]: dataUrl }));
        
        // Auto avance à l'étape suivante
        if (step < STEPS.length - 1) {
          setTimeout(() => setStep(s => s + 1), 600);
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const retakePhoto = (stepId) => {
    setPhotos(p => ({ ...p, [stepId]: null }));
    const idx = STEPS.findIndex(s => s.id === stepId);
    setStep(idx);
  };

  const startAnalysis = async () => {
    if (!allTaken) {
      alert('Prends les 3 photos avant de lancer l\'analyse');
      return;
    }
    
    setAnalyzing(true);
    setError('');
    
    try {
      // 1. Lancer l'analyse IA Gemini
      const result = await analyzeSkinPhotos({
        frontBase64: photos.front,
        leftBase64: photos.left,
        rightBase64: photos.right,
      });
      
      if (!result.success) {
        setError(result.error || 'Erreur d\'analyse');
        setAnalyzing(false);
        return;
      }
      
      // 2. Convertir les data URLs en blobs pour l'upload
      const tempScanId = 'scan_' + Date.now();
      
      const blobs = await Promise.all([
        fetch(photos.front).then(r => r.blob()),
        fetch(photos.left).then(r => r.blob()),
        fetch(photos.right).then(r => r.blob()),
      ]);
      
      const [frontUrl, leftUrl, rightUrl] = await Promise.all([
        uploadScanPhoto(blobs[0], tempScanId, 'front'),
        uploadScanPhoto(blobs[1], tempScanId, 'left'),
        uploadScanPhoto(blobs[2], tempScanId, 'right'),
      ]);
      
      // 3. Sauvegarder en base
      const saved = await saveSkinScan({
        userId: user.id,
        photoFrontUrl: frontUrl,
        photoLeftUrl: leftUrl,
        photoRightUrl: rightUrl,
        analysis: result.analysis,
      });
      
      if (saved) {
        navigate({ name: 'scan_result', params: { scanId: saved.id } });
      } else {
        setError('Impossible de sauvegarder le scan');
      }
    } catch (e) {
      console.error('Analysis error:', e);
      setError('Erreur technique : ' + e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  if (analyzing) {
    return (
      <div className="scan-screen">
        <div className="scan-loading">
          <div className="scan-loading-icon">🤖</div>
          <h2>L'IA analyse ta peau...</h2>
          <p>Diagnostic professionnel personnalisé</p>
          <div className="scan-loading-bar">
            <div className="scan-loading-fill" />
          </div>
          <ul className="scan-loading-steps">
            <li>✓ Photos uploadées</li>
            <li>✓ Analyse zones du visage</li>
            <li>⏳ Détection problèmes peau</li>
            <li>⏳ Recommandations personnalisées</li>
          </ul>
          <p style={{ fontSize: 11, color: '#9B9B9B', marginTop: 20 }}>
            Temps estimé : 5-10 secondes
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-screen page-anim">
      <header className="scan-header">
        <button className="icon-back-btn" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div>
          <h1>🤖 Scan IA Diaara</h1>
          <p>Diagnostic peau personnalisé</p>
        </div>
      </header>

      <div className="scan-scroll">
        {/* Progress dots */}
        <div className="scan-progress">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`scan-progress-dot ${photos[s.id] ? 'done' : ''} ${i === step ? 'active' : ''}`}
            >
              {photos[s.id] ? '✓' : i + 1}
            </div>
          ))}
        </div>

        {/* Photos déjà prises (thumbnails) */}
        <div className="scan-thumbnails">
          {STEPS.map(s => (
            <div key={s.id} className={`scan-thumb ${photos[s.id] ? 'filled' : 'empty'}`}>
              {photos[s.id] ? (
                <>
                  <img src={photos[s.id]} alt={s.id} />
                  <button className="scan-retake" onClick={() => retakePhoto(s.id)}>↻</button>
                </>
              ) : (
                <span>{s.icon}</span>
              )}
              <span className="scan-thumb-label">{s.title.split(' ').slice(1).join(' ')}</span>
            </div>
          ))}
        </div>

        {!allTaken ? (
          <>
            {/* Instructions étape courante */}
            <div className="scan-instruction-card">
              <div className="scan-instruction-icon">{currentStep.icon}</div>
              <h2>{currentStep.title}</h2>
              <p>{currentStep.instruction}</p>
              <ul>
                {currentStep.tips.map((tip, i) => (
                  <li key={i}>✓ {tip}</li>
                ))}
              </ul>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="user"
              onChange={handlePhoto}
              style={{ display: 'none' }}
            />

            <button
              className="scan-btn-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              📷 Prendre la photo
            </button>

            <p className="scan-privacy">
              🔒 Tes photos sont privées et utilisées uniquement pour ton diagnostic
            </p>
          </>
        ) : (
          <>
            <div className="scan-ready-card">
              <div className="scan-ready-icon">🎉</div>
              <h2>Tout est prêt !</h2>
              <p>3/3 photos prises. Lance ton diagnostic personnalisé.</p>
            </div>

            <button className="scan-btn-primary" onClick={startAnalysis}>
              🤖 Lancer l'analyse IA
            </button>

            <p className="scan-privacy">
              ⏱️ L'analyse prend 5-10 secondes
            </p>
          </>
        )}

        {error && <div className="scan-error">⚠️ {error}</div>}
      </div>
    </div>
  );
}
