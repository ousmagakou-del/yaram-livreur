import { useState, useEffect } from 'react';

/**
 * Composant qui affiche un prompt d'installation PWA
 * - Android : utilise beforeinstallprompt natif
 * - iOS : affiche instructions manuelles ("Ajouter à l'écran d'accueil")
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Détecter iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);
    
    // Vérifier si déjà installée
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (isStandalone) return;
    
    // Si déjà dismissed cette semaine, ne plus afficher
    const dismissed = localStorage.getItem('diaara-pwa-dismissed');
    if (dismissed) {
      const dismissedDate = new Date(dismissed);
      const daysSince = (Date.now() - dismissedDate) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) return;
    }
    
    // Android : écouter l'événement natif
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Attendre 30 secondes avant de proposer
      setTimeout(() => setShowPrompt(true), 30000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    
    // iOS : afficher prompt manuel après 45 secondes
    if (ios) {
      const t = setTimeout(() => setShowPrompt(true), 45000);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', handler);
      };
    }
    
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (isIOS) {
      setShowIOSInstructions(true);
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('[PWA] User accepted install');
    }
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('diaara-pwa-dismissed', new Date().toISOString());
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  if (showIOSInstructions) {
    return (
      <div style={overlayStyle} onClick={() => setShowIOSInstructions(false)}>
        <div style={modalStyle} onClick={e => e.stopPropagation()}>
          <button onClick={() => setShowIOSInstructions(false)} style={closeStyle}>✕</button>
          <div style={{ fontSize: 56, marginBottom: 10 }}>📱</div>
          <h2 style={{ margin: '0 0 10px', fontSize: 20, color: '#1A1A1A' }}>
            Installer Diaara
          </h2>
          <p style={{ fontSize: 14, color: '#6B6B6B', marginBottom: 24 }}>
            Sur iPhone, suis ces étapes :
          </p>
          
          <ol style={{ textAlign: 'left', paddingLeft: 0, listStyle: 'none' }}>
            {[
              ['1', 'Appuie sur le bouton', <strong key="s">Partager</strong>, ' ⬆️ en bas de Safari'],
              ['2', 'Fais défiler et choisis ', <strong key="a">Sur l\'écran d\'accueil</strong>],
              ['3', 'Appuie sur ', <strong key="add">Ajouter</strong>, ' en haut à droite'],
            ].map(([num, ...content], i) => (
              <li key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                marginBottom: 14, padding: 12, background: '#F9FAFB',
                borderRadius: 10,
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: '#1F8B4C', color: 'white', fontWeight: 800,
                  fontSize: 14, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0,
                }}>{num}</span>
                <span style={{ fontSize: 13, color: '#1A1A1A', lineHeight: 1.5 }}>
                  {content}
                </span>
              </li>
            ))}
          </ol>
          
          <button onClick={() => setShowIOSInstructions(false)} style={primaryBtn}>
            J'ai compris
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={bannerStyle}>
      <div style={{ width: 48, height: 48, borderRadius: 10,
                    background: 'white', color: '#1F8B4C',
                    fontWeight: 800, fontSize: 28,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0 }}>D</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 14, display: 'block', color: 'white' }}>
          Installe Diaara sur ton téléphone
        </strong>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', display: 'block', marginTop: 2 }}>
          Accès rapide depuis ton écran d'accueil
        </span>
      </div>
      <button onClick={handleInstall} style={installBtnStyle}>
        Installer
      </button>
      <button onClick={handleDismiss} style={dismissStyle} aria-label="Fermer">
        ✕
      </button>
    </div>
  );
}

// ─── STYLES ───
const bannerStyle = {
  position: 'fixed',
  bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
  left: 10, right: 10,
  background: 'linear-gradient(135deg, #1F8B4C 0%, #166635 100%)',
  borderRadius: 14,
  padding: 14,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
  zIndex: 9999,
  animation: 'slideUp 0.4s ease-out',
};

const installBtnStyle = {
  background: 'white',
  color: '#1F8B4C',
  border: 'none',
  borderRadius: 10,
  padding: '8px 16px',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  flexShrink: 0,
};

const dismissStyle = {
  background: 'transparent',
  color: 'rgba(255,255,255,0.6)',
  border: 'none',
  width: 30,
  height: 30,
  fontSize: 16,
  cursor: 'pointer',
  flexShrink: 0,
};

const overlayStyle = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 10000, padding: 20,
};

const modalStyle = {
  background: 'white',
  borderRadius: 16,
  padding: 28,
  maxWidth: 360,
  width: '100%',
  textAlign: 'center',
  position: 'relative',
};

const closeStyle = {
  position: 'absolute',
  top: 12, right: 12,
  background: '#F4F4F2',
  border: 'none',
  width: 32, height: 32,
  borderRadius: '50%',
  fontSize: 14,
  cursor: 'pointer',
};

const primaryBtn = {
  width: '100%',
  padding: 14,
  background: '#1F8B4C',
  color: 'white',
  border: 'none',
  borderRadius: 12,
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
};
