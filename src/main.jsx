import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './lib/theme'
import './index.css'
import App from './App.jsx'
import { loadSiteSettings, subscribeSettings } from './lib/supabase'
import { initSentry } from './lib/sentry'
import { registerServiceWorker } from './lib/sw-register'
import { prefetchProbableRoutes } from './lib/prefetch'
import { initWebVitals } from './lib/webVitals'
// ─── TanStack Query : cache mémoire + persistance IndexedDB ───
// Permet de réafficher instantanément les données vues précédemment
// au cold start, puis revalider en arrière-plan.
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { queryClient, queryPersister } from './lib/queryClient'

// ─── Init Sentry + SW DIFFÉRÉ à l'idle ───
// Sentry charge ~80kb gzip de @sentry/browser. Le faire au boot bloque le
// 1er paint sur LTE Sénégal. On le laisse partir quand le main thread est
// libre (requestIdleCallback) — fallback setTimeout pour Safari iOS.
// Idem SW register : pas la peine de courir, l'app fonctionne sans.
const _deferInit = () => {
  initSentry();
  registerServiceWorker();
  // PERF : precharge les chunks routes probables apres idle (-300ms a la navigation)
  prefetchProbableRoutes();
  // OBS : capture LCP / CLS / INP / FCP / TTFB et envoie a PostHog
  initWebVitals();
};
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  window.requestIdleCallback(_deferInit, { timeout: 3000 });
} else {
  setTimeout(_deferInit, 1500);
}

// ─── Splash inline : retire le bloc HTML pre-React avec un crossfade ───
// Le boot inline est defini dans index.html (#yaram-boot). On le marque .gone
// pour declencher le fade-out CSS (380ms), puis on le remove du DOM.
function hideBootSplash() {
  const el = document.getElementById('yaram-boot');
  if (!el) return;
  if (el.classList.contains('gone')) return;
  el.classList.add('gone');
  setTimeout(() => el.remove(), 400);
}
// Au cas où on veut le retirer manuellement plus tard
window.__yaramHideBoot = hideBootSplash;

// Load les site_settings en BG des le boot (commission, deliveryFee, couleurs…)
// Le rendu n'attend PAS : on a un fallback hardcode, donc l'app demarre instantanement
// et applique les vraies valeurs des qu'elles arrivent (via getCachedSetting).
loadSiteSettings().catch(() => { /* DB unavailable, keep fallback */ });

// ─── Refresh settings quand l'app revient en foreground ───
// Sans ça, l'app garde l'ancien numéro WhatsApp / commission / couleurs
// indéfiniment tant que l'user ne tue pas l'app. Critique pour iOS (l'app
// reste en mémoire après un swipe vers Home), critique aussi pour PWA.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadSiteSettings().catch(() => { /* silent */ });
    }
  });
  // Aussi sur focus window (cas où l'app perd focus sans cacher l'onglet)
  window.addEventListener('focus', () => {
    loadSiteSettings().catch(() => { /* silent */ });
  });
}

// Inject les couleurs en CSS variables des que les settings sont chargees.
// Cible les noms reels utilises dans src/index.css (--primary, --accent).
subscribeSettings((s) => {
  if (!s) return;
  const root = document.documentElement;
  if (s.primaryColor) root.style.setProperty('--primary', s.primaryColor);
  if (s.accentColor) root.style.setProperty('--accent', s.accentColor);
});

// Wrapper qui retire le splash inline une fois que l'app est montee.
// On attend 1 tick pour laisser React peindre le 1er frame puis on fade-out le boot.
function BootedApp() {
  useEffect(() => {
    // Si le splash React (SplashScreen) prend le relais, on retire l'inline tout de suite.
    // Si l'app affiche du contenu direct (user en cache, settings deja la), idem.
    const raf = requestAnimationFrame(() => {
      hideBootSplash();
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  return <App />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* PersistQueryClientProvider hydrate depuis IndexedDB AVANT le 1er render
        (asynchrone mais court-circuité par <PersistGate> implicite : si pas
        de cache persisté, l'app monte normalement). Ensuite il persiste
        toutes les mutations du queryClient en background, throttled 1s. */}
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 24 * 60 * 60 * 1000, // 24 h max d'âge pour le cache persisté
        buster: 'v1',
        // Ne persister que les queries qui ne sont pas user-sensitive
        // (pas d'auth token, pas de panier non commité).
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => {
            // Skip les queries qui ont explicitement opted-out via meta
            if (q.meta?.persist === false) return false;
            // Skip les erreurs
            if (q.state.status !== 'success') return false;
            return true;
          },
        },
      }}
    >
      <BootedApp />
    </PersistQueryClientProvider>
  </StrictMode>,
)

// Fallback : si pour une raison X le wrapper ne se monte pas en 3s, on retire
// quand meme le splash pour ne pas bloquer l'utilisatrice.
setTimeout(hideBootSplash, 3000)