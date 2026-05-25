import { useState, useEffect } from 'react';
import { isNativeApp } from '../lib/platform';

/**
 * Composant qui propose à l'utilisateur d'installer YARAM sur son téléphone.
 *
 * Comportement par plateforme :
 * - Capacitor (app native iOS/Android) : ne s'affiche JAMAIS (l'user est déjà dans l'app)
 * - iOS Safari/Chrome web : propose de télécharger sur l'App Store (vraie app native)
 * - Android Chrome : PWA install natif (Android n'a pas encore d'app native YARAM)
 * - Déjà installé en PWA (standalone) : ne s'affiche pas
 * - Dismissed dans les 7 derniers jours : ne s'affiche pas
 */
const APP_STORE_URL = 'https://apps.apple.com/sn/app/yaram/id6771017009';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // 1. Si on est dans l'app Capacitor native → ne JAMAIS afficher le prompt.
    //    L'user est déjà dans la vraie app, pas besoin de lui dire de l'installer.
    if (isNativeApp()) return;

    // 2. Détecter iOS (web, pas Capacitor) — inclut Safari, Chrome iOS, Firefox iOS,
    //    Edge iOS (tous utilisent le moteur WebKit sur iOS).
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);

    // 3. Vérifier si déjà installée en PWA (standalone)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (isStandalone) return;

    // 4. Si déjà dismissed cette semaine, ne plus afficher
    const dismissed = localStorage.getItem('yaram-pwa-dismissed');
    if (dismissed) {
      const dismissedDate = new Date(dismissed);
      const daysSince = (Date.now() - dismissedDate) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) return;
    }

    // 5. iOS : afficher le banner après 5 secondes (pour pas être agressif au boot)
    //    On veut que les users iOS voient vite qu'il y a une vraie app native dispo.
    if (ios) {
      const t = setTimeout(() => setShowPrompt(true), 5000);
      return () => clearTimeout(t);
    }

    // 6. Android : écouter l'événement natif beforeinstallprompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Attendre 30 secondes avant de proposer (laisser le temps à l'user de découvrir)
      setTimeout(() => setShowPrompt(true), 30000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    // iOS : redirige direct vers l'App Store (vraie app native)
    if (isIOS) {
      window.open(APP_STORE_URL, '_blank');
      // Mémorise qu'on a redirigé pour ne pas réafficher tout de suite
      localStorage.setItem('yaram-pwa-dismissed', new Date().toISOString());
      setShowPrompt(false);
      return;
    }

    // Android : utilise le prompt natif PWA
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
    localStorage.setItem('yaram-pwa-dismissed', new Date().toISOString());
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  // Texte différent selon la plateforme
  const title = isIOS
    ? 'YARAM est sur l\'App Store !'
    : 'Installe YARAM sur ton téléphone';
  const subtitle = isIOS
    ? 'Télécharge la vraie app iOS pour une expérience optimale'
    : 'Accès rapide depuis ton écran d\'accueil';
  const buttonLabel = isIOS ? 'Télécharger' : 'Installer';

  return (
    <div style={bannerStyle}>
      <div style={iconStyle}>
        {isIOS ? (
          // Logo Apple stylisé pour iOS
          <svg viewBox="0 0 24 24" width="28" height="28" fill="#1F8B4C">
            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
          </svg>
        ) : (
          // Logo YARAM "Y" pour Android
          <span style={{
            fontWeight: 800,
            fontSize: 28,
            color: '#1F8B4C',
            fontFamily: 'inherit',
          }}>Y</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 14, display: 'block', color: 'white' }}>
          {title}
        </strong>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', display: 'block', marginTop: 2 }}>
          {subtitle}
        </span>
      </div>
      <button onClick={handleInstall} style={installBtnStyle}>
        {buttonLabel}
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

const iconStyle = {
  width: 48, height: 48, borderRadius: 10,
  background: 'white',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
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
