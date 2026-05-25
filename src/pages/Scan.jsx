import { useState, useRef, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { analyzeSkinPhotos, uploadScanPhoto, saveSkinScan } from '../lib/supabase';
import './Scan.css';

const STEPS = [
  { id: 'front', title: 'Regarde droit', arrow: '⬆️', instruction: 'Garde la tête droite' },
  { id: 'left', title: 'Tourne à gauche', arrow: '👈', instruction: 'Tourne doucement ta tête vers la gauche' },
  { id: 'right', title: 'Tourne à droite', arrow: '👉', instruction: 'Maintenant doucement vers la droite' },
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
  
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const photosRef = useRef({ front: null, left: null, right: null }); // ⚡ ref pour éviter closure stale
  const runningRef = useRef(false); // ⚡ évite double lancement
  // ⚡ Cleanup : on garde refs sur les timers/intervals/aborts pour pouvoir
  // tout couper si l'utilisatrice quitte la page pendant le scan.
  const intervalRef = useRef(null);
  const timeoutRef = useRef(null);
  const cancelledRef = useRef(false);
  
  // Démarrer la caméra
  // FIX iPad/WebView : ajout d'un timeout global de 15s sur getUserMedia.
  // Sur certains iPad (notamment M3 sous iPadOS 26), le WebView Capacitor
  // peut rester bloqué silencieusement sans répondre. On force une erreur
  // visible pour ne pas laisser l'utilisateur sur un écran qui ne charge jamais.
  const startCamera = async () => {
    // Compatibilité : certains WebView (très anciens) n'ont pas mediaDevices
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError('Ton navigateur ne supporte pas la caméra. Essaie sur un iPhone récent ou un autre navigateur.');
      setPhase('error');
      return;
    }

    try {
      // Race entre getUserMedia et un timeout de 15s
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

  // Attacher le stream à <video> dès que dispo
  // FIX iPad : si onloadedmetadata ne se déclenche pas en 10s, on force erreur
  // au lieu de rester bloqué sur "Démarrage caméra...".
  useEffect(() => {
    if (phase === 'camera' && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;

      // Safety net : si video pas prête en 10s, on bascule sur erreur
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

  // Auto-démarrer le scanning quand vidéo prête (2 sec après)
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
      // Cleanup complet au demontage : camera + interval + timeout + flag cancel.
      cancelledRef.current = true;
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      stopCamera();
    };
  }, []);
  
  // Capturer une frame
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
    
    // ⚡ Compression agressive : max 512px, qualité 75% → ~30 KB
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
    // Pas de flip — Gemini doit voir le visage normal
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
    return dataUrl;
  };

  // Lancer la séquence
  const startScanning = () => {
    setPhase('scanning');
    setStepIndex(0);
    runStep(0);
  };
  
  // Compte à rebours puis capture
  const runStep = (idx) => {
    if (cancelledRef.current) return;
    setStepIndex(idx);
    let count = 3;
    setCountdown(count);

    // Stocke l'interval pour cleanup au demontage
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

        // ⚡ Capture
        const dataUrl = captureFrame();
        if (!dataUrl) {
          // Retry une seule fois apres 1s, puis abandon si toujours pas OK
          timeoutRef.current = setTimeout(() => runStep(idx), 1000);
          return;
        }

        const stepId = STEPS[idx].id;
        // Stocker dans ref + state
        photosRef.current = { ...photosRef.current, [stepId]: dataUrl };
        setPhotos({ ...photosRef.current });

        // Suite
        if (idx < STEPS.length - 1) {
          timeoutRef.current = setTimeout(() => runStep(idx + 1), 800);
        } else {
          timeoutRef.current = setTimeout(() => {
            stopCamera();
            analyzeAll();
          }, 600);
        }
      }
    }, 1000);
  };
  
  // Analyse Gemini (avec timeout pour eviter de rester bloque sur "analyse en cours")
  const analyzeAll = async () => {
    setPhase('analyzing');
    setError('');

    // Timeout 60s : si Gemini ne repond pas, on bascule sur l'ecran erreur
    // au lieu de laisser l'utilisatrice attendre indefiniment.
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
      
      // Upload photos
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
  
  // === RENDER ===
  
  if (phase === 'intro') {
    return (
      <div className="fs-screen fs-intro">
        <button className="fs-close" onClick={() => navigate('/')}>✕</button>
        <div className="fs-intro-content">
          <div className="fs-intro-icon">🤖</div>
          <h1>Scan IA YARAM</h1>
          <p className="fs-intro-subtitle">Diagnostic peau professionnel en 20 secondes</p>
          
          <div className="fs-intro-steps">
            <div className="fs-intro-step">
              <span>1</span>
              <p>Place ton visage dans l'ovale</p>
            </div>
            <div className="fs-intro-step">
              <span>2</span>
              <p>Tourne ta tête à gauche, puis à droite</p>
            </div>
            <div className="fs-intro-step">
              <span>3</span>
              <p>L'IA analyse et te recommande</p>
            </div>
          </div>
          
          <div className="fs-intro-tips">
            <p>💡 Pour un meilleur diagnostic :</p>
            <ul>
              <li>✓ Lumière naturelle</li>
              <li>✓ Pas de maquillage</li>
              <li>✓ Cheveux dégagés du visage</li>
            </ul>
          </div>
          
          <button className="fs-btn-start" onClick={startCamera}>
            🎥 Démarrer le scan
          </button>
          <p className="fs-privacy">🔒 Tes photos restent privées</p>
        </div>
      </div>
    );
  }
  
  if (phase === 'error') {
    return (
      <div className="fs-screen fs-error">
        <button className="fs-close" onClick={() => navigate('/')}>✕</button>
        <div className="fs-error-content">
          <div style={{ fontSize: 56 }}>⚠️</div>
          <h2>Oups !</h2>
          <p>{cameraError || error}</p>
          <button className="fs-btn-start" onClick={restart}>Réessayer</button>
        </div>
      </div>
    );
  }
  
  if (phase === 'analyzing') {
    return (
      <div className="fs-screen fs-analyzing">
        <div className="fs-analyzing-content">
          <div className="fs-analyzing-icon">🤖</div>
          <h2>L'IA analyse ta peau...</h2>
          <p>Jusqu'à 1 minute selon ta connexion</p>
          <div className="fs-analyzing-bar">
            <div className="fs-analyzing-fill" />
          </div>
          <ul className="fs-analyzing-steps">
            <li>✓ Photos capturées</li>
            <li>✓ Envoi sécurisé</li>
            <li className="active">⏳ Analyse Gemini Vision...</li>
            <li>○ Diagnostic personnalisé</li>
          </ul>
          {/* Bouton Annuler : avant l'utilisatrice pouvait rester bloquee
              sur cet ecran si Gemini timeout. Maintenant elle peut sortir. */}
          <button
            onClick={() => {
              cancelledRef.current = true;
              if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
              navigate('/');
            }}
            style={{
              marginTop: 24,
              padding: '10px 18px',
              background: 'rgba(255,255,255,0.15)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }
  
  // phase === 'camera' || 'scanning'
  const currentStep = STEPS[stepIndex];
  const progress = phase === 'scanning' ? ((stepIndex) / STEPS.length) * 100 : 0;
  
  return (
    <div className="fs-screen fs-camera">
      <button className="fs-close" onClick={() => { stopCamera(); navigate('/'); }}>✕</button>
      
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
        <div className={`fs-oval ${phase === 'scanning' ? 'active' : ''}`} />
      </div>
      
      <div className="fs-instructions">
        {phase === 'camera' ? (
          <>
            <h2>Préparation</h2>
            <p>{videoReady ? 'Place ton visage dans l\'ovale...' : 'Démarrage caméra...'}</p>
          </>
        ) : (
          <>
            <div className="fs-step-counter">
              {stepIndex + 1} / {STEPS.length}
            </div>
            <h2>
              <span className="fs-arrow">{currentStep.arrow}</span>
              {currentStep.title}
            </h2>
            <p>{currentStep.instruction}</p>
            
            {countdown !== null && (
              <div className="fs-countdown">
                {countdown > 0 ? countdown : '📸'}
              </div>
            )}
          </>
        )}
      </div>
      
      {phase === 'scanning' && (
        <div className="fs-thumbnails">
          {STEPS.map(s => (
            <div key={s.id} className={`fs-thumb ${photos[s.id] ? 'done' : ''}`}>
              {photos[s.id] ? '✓' : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
