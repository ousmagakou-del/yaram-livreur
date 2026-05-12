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
  
  const [phase, setPhase] = useState('intro'); // intro, camera, scanning, analyzing, error
  const [stepIndex, setStepIndex] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [photos, setPhotos] = useState({ front: null, left: null, right: null });
  const [cameraError, setCameraError] = useState('');
  const [error, setError] = useState('');
  
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  
  // Démarrer la caméra
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 720 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase('camera');
      // Attendre 2 secondes que l'utilisatrice se prépare
      setTimeout(() => startScanning(), 2000);
    } catch (e) {
      console.error('Camera error:', e);
      setCameraError(
        e.name === 'NotAllowedError'
          ? 'Autorise l\'accès à la caméra pour continuer'
          : 'Impossible d\'accéder à la caméra : ' + e.message
      );
      setPhase('error');
    }
  };
  
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };
  
  useEffect(() => {
    return () => stopCamera();
  }, []);
  
  // Capturer une frame depuis la vidéo
  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    
    // Compression : max 800px, qualité 80%
    const maxDim = 800;
    let { videoWidth: w, videoHeight: h } = video;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = (h * maxDim) / w;
        w = maxDim;
      } else {
        w = (w * maxDim) / h;
        h = maxDim;
      }
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.8);
  };
  
  // Lancer la séquence de scan
  const startScanning = () => {
    setPhase('scanning');
    setStepIndex(0);
    runStep(0);
  };
  
  // Exécuter une étape : compte à rebours 3s puis capture
  const runStep = (idx) => {
    let count = 3;
    setCountdown(count);
    
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        clearInterval(interval);
        setCountdown(null);
        
        // Capturer la frame
        const dataUrl = captureFrame();
        if (dataUrl) {
          const stepId = STEPS[idx].id;
          setPhotos(p => ({ ...p, [stepId]: dataUrl }));
          
          // Passer à l'étape suivante
          if (idx < STEPS.length - 1) {
            setTimeout(() => {
              setStepIndex(idx + 1);
              runStep(idx + 1);
            }, 800);
          } else {
            // Toutes les photos prises → analyser
            setTimeout(() => {
              stopCamera();
              analyzeAll();
            }, 600);
          }
        }
      }
    }, 1000);
  };
  
  // Analyse Gemini
  const analyzeAll = async () => {
    setPhase('analyzing');
    setError('');
    
    try {
      const result = await analyzeSkinPhotos({
        frontBase64: photos.front,
        leftBase64: photos.left,
        rightBase64: photos.right,
      });
      
      if (!result.success) {
        setError(result.error || 'Erreur d\'analyse');
        setPhase('error');
        return;
      }
      
      // Upload photos vers Storage
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
        setError('Impossible de sauvegarder');
        setPhase('error');
      }
    } catch (e) {
      console.error('Analysis error:', e);
      setError('Erreur : ' + e.message);
      setPhase('error');
    }
  };
  
  // Refaire le scan depuis le début
  const restart = () => {
    setPhotos({ front: null, left: null, right: null });
    setStepIndex(0);
    setError('');
    setCameraError('');
    setPhase('intro');
  };
  
  // === RENDER ===
  
  if (phase === 'intro') {
    return (
      <div className="fs-screen fs-intro">
        <button className="fs-close" onClick={() => navigate('/')}>✕</button>
        
        <div className="fs-intro-content">
          <div className="fs-intro-icon">🤖</div>
          <h1>Scan IA Diaara</h1>
          <p className="fs-intro-subtitle">Diagnostic peau professionnel en 15 secondes</p>
          
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
          <button className="fs-btn-start" onClick={restart}>
            Réessayer
          </button>
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
          <p>Quelques secondes seulement</p>
          <div className="fs-analyzing-bar">
            <div className="fs-analyzing-fill" />
          </div>
          <ul className="fs-analyzing-steps">
            <li>✓ Photos capturées</li>
            <li>✓ Envoi sécurisé</li>
            <li className="active">⏳ Analyse Gemini Vision...</li>
            <li>○ Diagnostic personnalisé</li>
          </ul>
        </div>
      </div>
    );
  }
  
  // phase === 'camera' || 'scanning'
  const currentStep = STEPS[stepIndex];
  const progress = (stepIndex / STEPS.length) * 100;
  
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
      
      {/* Overlay sombre avec ovale transparent */}
      <div className="fs-overlay">
        <div className={`fs-oval ${phase === 'scanning' ? 'active' : ''}`} />
      </div>
      
      {/* Instructions en bas */}
      <div className="fs-instructions">
        {phase === 'camera' ? (
          <>
            <h2>Préparation</h2>
            <p>Place ton visage dans l'ovale</p>
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
      
      {/* Thumbnails des photos prises */}
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
