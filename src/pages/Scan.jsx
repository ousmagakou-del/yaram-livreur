import { useState, useRef, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { analyzeSkinPhotos, uploadScanPhoto, saveSkinScan } from '../lib/supabase';
import './Scan.css';

const STEPS = [
  { id: 'front', title: 'Regarde droit', icon: '⬆', instruction: 'Garde la tête droite, regarde l\'objectif', cue: 'Face' },
  { id: 'left', title: 'Tourne à gauche', icon: '←', instruction: 'Tourne doucement ta tête vers la gauche', cue: 'Profil gauche' },
  { id: 'right', title: 'Tourne à droite', icon: '→', instruction: 'Maintenant doucement vers la droite', cue: 'Profil droit' },
];

const ANALYZING_MESSAGES = [
  { label: 'Analyse de la texture…', icon: '✨' },
  { label: 'Détection des zones…', icon: '🔍' },
  { label: 'Mesure de l\'hydratation…', icon: '💧' },
  { label: 'Calcul des recommandations…', icon: '🧪' },
  { label: 'Personnalisation de ta routine…', icon: '💚' },
];

export default function Scan() {
  const { navigate } = useNav();
  const { user } = useUser();

  const [phase, setPhase] = useState('intro');
  const [stepIndex, setStepIndex] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [photos, setPhotos] = useState({ front: null, left: null, right: null });
  const [cameraError, setCameraError] = useState('');
  const [error, setError] = useState('');
  const [videoReady, setVideoReady] = useState(false);
  const [analyzingMsgIdx, setAnalyzingMsgIdx] = useState(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const photosRef = useRef({ front: null, left: null, right: null });
  const runningRef = useRef(false);
  const intervalRef = useRef(null);
  const timeoutRef = useRef(null);
  const cancelledRef = useRef(false);

  // Cycle messages d'analyse
  useEffect(() => {
    if (phase !== 'analyzing') return;
    const it = setInterval(() => {
      setAnalyzingMsgIdx(i => (i + 1) % ANALYZING_MESSAGES.length);
    }, 2200);
    return () => clearInterval(it);
  }, [phase]);

  const startCamera = async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError('Ton navigateur ne supporte pas la caméra. Essaie sur un iPhone récent ou un autre navigateur.');
      setPhase('error');
      return;
    }

    try {
      const cameraPromise = navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT_CAMERA_15S')), 15000)
      );

      const stream = await Promise.race([cameraPromise, timeoutPromise]);
      streamRef.current = stream;
      cancelledRef.current = false;
      setPhase('camera');
    } catch (e) {
      console.error('[Scan] Camera error:', e);
      let msg;
      if (e.message === 'TIMEOUT_CAMERA_15S') {
        msg = 'La caméra ne répond pas. Vérifie que tu as autorisé l\'accès dans Réglages → YARAM → Caméra, puis réessaie.';
      } else if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        msg = 'Autorise l\'accès à la caméra pour continuer (Réglages → YARAM → Caméra).';
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        msg = 'Aucune caméra détectée sur cet appareil.';
      } else {
        msg = 'Impossible d\'accéder à la caméra : ' + (e.message || e.name || 'erreur inconnue');
      }
      setCameraError(msg);
      setPhase('error');
    }
  };

  useEffect(() => {
    if (phase === 'camera' && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;

      const videoTimeout = setTimeout(() => {
        if (!videoReady && phase === 'camera') {
          console.error('[Scan] Video metadata timeout');
          setCameraError('La caméra démarre mais la vidéo ne s\'affiche pas. Réessaie en redémarrant l\'app.');
          setPhase('error');
        }
      }, 10000);
      timeoutRef.current = videoTimeout;

      videoRef.current.onloadedmetadata = () => {
        clearTimeout(videoTimeout);
        if (videoRef.current) {
          videoRef.current.play()
            .then(() => setVideoReady(true))
            .catch(e => {
              console.error('[Scan] Play error:', e);
              setCameraError('Impossible de lancer la vidéo : ' + e.message);
              setPhase('error');
            });
        }
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (videoReady && phase === 'camera' && !runningRef.current) {
      runningRef.current = true;
      timeoutRef.current = setTimeout(() => startScanning(), 2000);
    }
  }, [videoReady, phase]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      stopCamera();
    };
  }, []);

  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      console.error('[Scan] No video or canvas');
      return null;
    }
    if (video.videoWidth === 0) {
      console.error('[Scan] Video not ready, videoWidth=0');
      return null;
    }

    const maxDim = 512;
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
    return dataUrl;
  };

  const startScanning = () => {
    setPhase('scanning');
    setStepIndex(0);
    runStep(0);
  };

  const runStep = (idx) => {
    if (cancelledRef.current) return;
    setStepIndex(idx);
    let count = 3;
    setCountdown(count);

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (cancelledRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        return;
      }
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        setCountdown(null);

        const dataUrl = captureFrame();
        if (!dataUrl) {
          timeoutRef.current = setTimeout(() => runStep(idx), 1000);
          return;
        }

        const stepId = STEPS[idx].id;
        photosRef.current = { ...photosRef.current, [stepId]: dataUrl };
        setPhotos({ ...photosRef.current });

        if (idx < STEPS.length - 1) {
          timeoutRef.current = setTimeout(() => runStep(idx + 1), 900);
        } else {
          timeoutRef.current = setTimeout(() => {
            stopCamera();
            analyzeAll();
          }, 700);
        }
      }
    }, 1000);
  };

  const analyzeAll = async () => {
    setPhase('analyzing');
    setError('');
    setAnalyzingMsgIdx(0);

    const timeoutPromise = new Promise((_, reject) => {
      timeoutRef.current = setTimeout(
        () => reject(new Error('L\'analyse prend trop de temps. Vérifie ta connexion et réessaie.')),
        60000
      );
    });

    try {
      const result = await Promise.race([
        analyzeSkinPhotos({
          frontBase64: photosRef.current.front,
          leftBase64: photosRef.current.left,
          rightBase64: photosRef.current.right,
        }),
        timeoutPromise,
      ]);
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }

      if (!result.success) {
        setError(result.error || 'Erreur d\'analyse');
        if (result.detail) console.error('[Scan] Gemini detail:', result.detail);
        setPhase('error');
        return;
      }

      const tempScanId = 'scan_' + Date.now();
      const blobs = await Promise.all([
        fetch(photosRef.current.front).then(r => r.blob()),
        fetch(photosRef.current.left).then(r => r.blob()),
        fetch(photosRef.current.right).then(r => r.blob()),
      ]);
      const [frontUrl, leftUrl, rightUrl] = await Promise.all([
        uploadScanPhoto(blobs[0], tempScanId, 'front'),
        uploadScanPhoto(blobs[1], tempScanId, 'left'),
        uploadScanPhoto(blobs[2], tempScanId, 'right'),
      ]);

      const saved = await saveSkinScan({
        userId: user?.id,
        photoFrontUrl: frontUrl,
        photoLeftUrl: leftUrl,
        photoRightUrl: rightUrl,
        analysis: result.analysis,
      });

      if (saved) {
        navigate({ name: 'scan_result', params: { scanId: saved.id } });
      } else {
        setError('Impossible de sauvegarder le scan');
        setPhase('error');
      }
    } catch (e) {
      console.error('[Scan] Analysis error:', e);
      setError('Erreur : ' + e.message);
      setPhase('error');
    }
  };

  const restart = () => {
    photosRef.current = { front: null, left: null, right: null };
    setPhotos({ front: null, left: null, right: null });
    setStepIndex(0);
    setError('');
    setCameraError('');
    setVideoReady(false);
    runningRef.current = false;
    setPhase('intro');
  };

  // === INTRO ===
  if (phase === 'intro') {
    return (
      <div className="fs-screen fs-intro">
        <button className="fs-close" onClick={() => navigate('/')} aria-label="Fermer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="fs-intro-bg-orbs">
          <span className="fs-orb fs-orb-1" />
          <span className="fs-orb fs-orb-2" />
          <span className="fs-orb fs-orb-3" />
        </div>

        <div className="fs-intro-content">
          <div className="fs-face-animation">
            <svg viewBox="0 0 200 240" className="fs-face-svg">
              <defs>
                <linearGradient id="fs-scan-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgba(255,255,255,0)" />
                  <stop offset="50%" stopColor="rgba(255,255,255,0.9)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </linearGradient>
              </defs>
              <ellipse cx="100" cy="120" rx="70" ry="95" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" fill="rgba(255,255,255,0.04)" />
              <circle cx="78" cy="105" r="3.5" fill="rgba(255,255,255,0.85)" />
              <circle cx="122" cy="105" r="3.5" fill="rgba(255,255,255,0.85)" />
              <path d="M85 165 Q100 175 115 165" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              <rect x="0" y="0" width="200" height="3" fill="url(#fs-scan-grad)" className="fs-scan-beam" />
              <circle cx="40" cy="60" r="2" fill="rgba(255,255,255,0.5)" className="fs-dot-1" />
              <circle cx="160" cy="80" r="2" fill="rgba(255,255,255,0.5)" className="fs-dot-2" />
              <circle cx="50" cy="200" r="2" fill="rgba(255,255,255,0.5)" className="fs-dot-3" />
              <circle cx="155" cy="195" r="2" fill="rgba(255,255,255,0.5)" className="fs-dot-4" />
            </svg>
          </div>

          <div className="fs-intro-text">
            <span className="fs-pill">SCAN IA PREMIUM</span>
            <h1>Découvre ta routine perso</h1>
            <p className="fs-intro-subtitle">
              Tes photos restent privées. Analyse en 30 secondes pour une routine 100% adaptée à ta peau.
            </p>
          </div>

          <div className="fs-feature-row">
            <div className="fs-feature">
              <div className="fs-feature-ico">🔒</div>
              <span>Privé</span>
            </div>
            <div className="fs-feature">
              <div className="fs-feature-ico">⚡</div>
              <span>30 sec</span>
            </div>
            <div className="fs-feature">
              <div className="fs-feature-ico">💚</div>
              <span>Sur-mesure</span>
            </div>
          </div>

          <div className="fs-tips-card">
            <div className="fs-tips-title">Pour un résultat optimal</div>
            <div className="fs-tips-grid">
              <div className="fs-tip"><span>☀️</span><p>Lumière naturelle</p></div>
              <div className="fs-tip"><span>🧼</span><p>Sans maquillage</p></div>
              <div className="fs-tip"><span>💁</span><p>Cheveux dégagés</p></div>
            </div>
          </div>

          <button className="fs-btn-start" onClick={startCamera}>
            Commencer le scan
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <button className="fs-btn-ghost" onClick={() => navigate({ name: 'scan_history' })}>
            Voir mes anciens scans
          </button>
        </div>
      </div>
    );
  }

  // === ERROR ===
  if (phase === 'error') {
    const isCameraIssue = !!cameraError && (cameraError.includes('caméra') || cameraError.includes('Réglages'));
    return (
      <div className="fs-screen fs-error">
        <button className="fs-close" onClick={() => navigate('/')} aria-label="Fermer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div className="fs-error-content">
          <div className="fs-error-icon">!</div>
          <h2>Oups, on s'est arrêté</h2>
          <p>{cameraError || error}</p>
          <button className="fs-btn-start" onClick={restart}>Réessayer</button>
          {isCameraIssue && (
            <p className="fs-error-hint">
              Astuce : Réglages iOS → YARAM → Caméra → active l'accès.
            </p>
          )}
        </div>
      </div>
    );
  }

  // === ANALYZING ===
  if (phase === 'analyzing') {
    const currentMsg = ANALYZING_MESSAGES[analyzingMsgIdx];
    return (
      <div className="fs-screen fs-analyzing">
        <div className="fs-analyzing-bg-orbs">
          <span className="fs-orb fs-orb-1" />
          <span className="fs-orb fs-orb-2" />
        </div>

        <div className="fs-analyzing-content">
          <div className="fs-analyzing-stage">
            <div className="fs-analyzing-photos">
              {photosRef.current.front && <img src={photosRef.current.front} alt="" loading="lazy" decoding="async" />}
            </div>
            <div className="fs-scan-beam-overlay" />
            <div className="fs-analyzing-grid" />
            <div className="fs-analyzing-corners">
              <span /><span /><span /><span />
            </div>
          </div>

          <div className="fs-analyzing-status">
            <span className="fs-analyzing-emoji" key={analyzingMsgIdx}>{currentMsg.icon}</span>
            <h2 key={'h-' + analyzingMsgIdx}>{currentMsg.label}</h2>
          </div>

          <div className="fs-analyzing-bar">
            <div className="fs-analyzing-fill" />
          </div>

          <p className="fs-analyzing-hint">L'IA examine ta peau zone par zone</p>

          <button
            className="fs-btn-cancel"
            onClick={() => {
              cancelledRef.current = true;
              if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
              navigate('/');
            }}
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  // === CAMERA / SCANNING ===
  const currentStep = STEPS[stepIndex];
  const progress = phase === 'scanning' ? ((stepIndex) / STEPS.length) * 100 : 0;

  return (
    <div className="fs-screen fs-camera">
      <button className="fs-close" onClick={() => { stopCamera(); navigate('/'); }} aria-label="Fermer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      <div className="fs-progress-bar">
        <div className="fs-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <video
        ref={videoRef}
        className="fs-video"
        playsInline
        muted
        autoPlay
      />

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div className="fs-overlay">
        <div className={`fs-oval ${phase === 'scanning' ? 'active' : ''} ${countdown !== null ? 'capture' : ''}`}>
          <span className="fs-oval-corner fs-oval-corner-tl" />
          <span className="fs-oval-corner fs-oval-corner-tr" />
          <span className="fs-oval-corner fs-oval-corner-bl" />
          <span className="fs-oval-corner fs-oval-corner-br" />
        </div>
      </div>

      {/* Indicateurs qualité temps réel */}
      {phase === 'scanning' && (
        <div className="fs-quality-row">
          <div className="fs-q-chip fs-q-ok">
            <span className="fs-q-dot" />
            Lumière OK
          </div>
          <div className="fs-q-chip fs-q-ok">
            <span className="fs-q-dot" />
            Distance OK
          </div>
          <div className="fs-q-chip fs-q-ok">
            <span className="fs-q-dot" />
            Angle OK
          </div>
        </div>
      )}

      <div className="fs-instructions">
        {phase === 'camera' ? (
          <>
            <div className="fs-step-counter">PRÉPARATION</div>
            <h2>{videoReady ? 'Place ton visage dans l\'ovale' : 'Démarrage caméra…'}</h2>
            <p>{videoReady ? 'Le scan démarre dans un instant' : 'On configure tout pour toi'}</p>
            {!videoReady && (
              <div className="fs-mini-spinner" />
            )}
          </>
        ) : (
          <>
            <div className="fs-step-counter">
              Étape {stepIndex + 1} sur {STEPS.length} · {currentStep.cue}
            </div>
            <h2>
              <span className="fs-arrow">{currentStep.icon}</span>
              {currentStep.title}
            </h2>
            <p>{currentStep.instruction}</p>

            {countdown !== null && (
              <div className="fs-countdown-wrap">
                <div className="fs-countdown">
                  {countdown > 0 ? countdown : '📸'}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {phase === 'scanning' && (
        <div className="fs-thumbnails">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`fs-thumb ${photos[s.id] ? 'done' : ''} ${i === stepIndex && !photos[s.id] ? 'active' : ''}`}
            >
              {photos[s.id] ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <span>{i + 1}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
