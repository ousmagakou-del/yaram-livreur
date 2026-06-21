// ════════════════════════════════════════════════
// YARAM — Service Worker registration
// ════════════════════════════════════════════════
// Garde-fous :
//   - Pas de SW en dev (vite serve sur localhost)
//   - Pas de SW dans Capacitor iOS/Android (cache natif WKWebView)
//   - Pas de SW si l'API n'existe pas (vieux Safari)
//   - Update auto si nouveau SW dispo : skipWaiting() puis reload
// ════════════════════════════════════════════════

function isLocalhost() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.local');
}

function isCapacitorNative() {
  try {
    // Capacitor v3+ : isNativePlatform() ; v2 fallback : platform !== 'web'
    const cap = window.Capacitor;
    if (!cap) return false;
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
    if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web';
    return Boolean(cap.isNative);
  } catch {
    return false;
  }
}

function pingVersion(reg) {
  // Demande la version au SW actif pour log
  const sw = reg.active || reg.waiting || reg.installing;
  if (!sw) return;
  try {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      if (e.data?.type === 'VERSION') {
        console.log('[SW] active version =', e.data.version);
      }
    };
    sw.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  } catch { /* noop */ }
}

function watchForUpdates(reg) {
  // Quand un nouveau SW est trouvé, on le surveille
  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        // Nouvelle version prête : on la promeut tout de suite
        console.log('[SW] new version installed → skipWaiting');
        installing.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  });

  // Quand le controller change, on recharge pour servir la nouvelle version
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    console.log('[SW] controllerchange → reload');
    window.location.reload();
  });
}

export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) {
    console.log('[SW] unsupported, skip');
    return;
  }
  if (isLocalhost()) {
    console.log('[SW] localhost dev, skip register');
    return;
  }
  if (isCapacitorNative()) {
    console.log('[SW] Capacitor native, skip register (cache natif WKWebView)');
    // Si jamais un ancien SW est resté actif dans une WebView Capacitor, on le purge
    navigator.serviceWorker.getRegistrations?.().then(regs => {
      regs.forEach(r => r.unregister().catch(() => {}));
    }).catch(() => {});
    return;
  }

  // Register après load pour ne pas concurrencer le 1er rendu
  const doRegister = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[SW] registered, scope =', reg.scope);
        watchForUpdates(reg);
        pingVersion(reg);
        // Vérifie périodiquement (1×/h) si un nouveau SW est dispo
        setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);
      })
      .catch((err) => {
        console.warn('[SW] register failed', err);
      });
  };

  if (document.readyState === 'complete') {
    doRegister();
  } else {
    window.addEventListener('load', doRegister, { once: true });
  }
}

export default registerServiceWorker;
