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
  
  // Démarrer la caméra
  const startCamera = async () => {
    try {
      console.log('[Scan] Requesting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      console.log('[Scan] Camera granted');
      streamRef.current = stream;
      setPhase('camera');
      // setPhase change DOM → on attend que video soit dans le DOM avant d'attacher le stream
    } catch (e) {
      console.error('[Scan] Camera error:', e);
      setCameraError(
        e.name === 'NotAllowedError'
          ? 'Autorise l\'accès à la caméra pour continuer'
          : 'Impossible d\'accéder à la caméra : ' + e.message
      );
      setPhase('error');
    }
  };
  
  // Attacher le stream à <video> dès que dispo
  useEffect(() => {
    if (phase === 'camera' && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      console.log('[Scan] Attaching stream to video');
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.onloadedmetadata = () => {
        console.log('[Scan] Video loaded, playing...');
        videoRef.current.play()
          .then(() => {
            console.log('[Scan] Video playing!');
            setVideoReady(true);
          })
          .catch(e => console.error('[Scan] Play error:', e));
      };
    }
  }, [phase]);
  
  // Auto-démarrer le scanning quand vidéo prête (2 sec après)
  useEffect(() => {
    if (videoReady && phase === 'camera' && !runningRef.current) {
      console.log('[Scan] Video ready, starting scan in 2s...');
      runningRef.current = true;
      setTimeout(() => startScanning(), 2000);
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
    return () => stopCamera();
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
    console.log('[Scan] Captured frame, size:', Math.round(dataUrl.length / 1024), 'KB');
    return dataUrl;
  };
  
  // Lancer la séquence
  const startScanning = () => {
    console.log('[Scan] Start scanning');
    setPhase('scanning');
    setStepIndex(0);
    runStep(0);
  };
  
  // Compte à rebours puis capture
  const runStep = (idx) => {
    console.log('[Scan] runStep', idx, STEPS[idx].id);
    setStepIndex(idx);
    let count = 3;
    setCountdown(count);
    
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        clearInterval(interval);
        setCountdown(null);
        
        // ⚡ Capture
        const dataUrl = captureFrame();
        if (!dataUrl) {
          console.error('[Scan] Capture failed, retry in 1s');
          setTimeout(() => runStep(idx), 1000);
          return;
        }
        
        const stepId = STEPS[idx].id;
        // Stocker dans ref + state
        photosRef.current = { ...photosRef.current, [stepId]: dataUrl };
        setPhotos({ ...photosRef.current });
        
        // Suite
        if (idx < STEPS.length - 1) {
          setTimeout(() => runStep(idx + 1), 800);
        } else {
          console.log('[Scan] All photos captured', Object.keys(photosRef.current));
          setTimeout(() => {
            stopCamera();
            analyzeAll();
          }, 600);
        }
      }
    }, 1000);
  };
  
  // Analyse Gemini
  const analyzeAll = async () => {
    console.log('[Scan] analyzeAll, photos:', {
      front: !!photosRef.current.front,
      left: !!photosRef.current.left,
      right: !!photosRef.current.right,
    });
    setPhase('analyzing');
    setError('');
    
    try {
      const result = await analyzeSkinPhotos({
        frontBase64: photosRef.current.front,
        leftBase64: photosRef.current.left,
        rightBase64: photosRef.current.right,
      });
      
      console.log('[Scan] Gemini result:', result);
      
      if (!result.success) {
        setError(result.error || 'Erreur d\'analyse');
        if (result.detail) {
          console.error('[Scan] Gemini detail:', result.detail);
        }
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
