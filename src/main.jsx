import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './lib/theme'
import './index.css'
import App from './App.jsx'
import { loadSiteSettings, subscribeSettings, supabase } from './lib/supabase'
import { initSentry } from './lib/sentry'
import { registerServiceWorker } from './lib/sw-register'
import { prefetchProbableRoutes } from './lib/prefetch'
import { initWebVitals } from './lib/webVitals'
import { isNativeApp } from './lib/platform'
// ─── TanStack Query : cache mémoire + persistance IndexedDB ───
// Permet de réafficher instantanément les données vues précédemment
// au cold start, puis revalider en arrière-plan.
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { focusManager, onlineManager } from '@tanstack/react-query'
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

// ════════════════════════════════════════════════════════════════
// ─── Refresh COMPLET quand l'app revient en foreground ───
// ════════════════════════════════════════════════════════════════
//
// Problème observé : sur iOS Capacitor ET sur web, quand l'utilisateur sort
// de l'app/onglet pendant quelques minutes et revient, les données restent
// stale jusqu'à ce qu'il pull-to-refresh manuellement.
//
// Causes :
//   1) Sur iOS Capacitor, window.focus n'est PAS déclenché de manière
//      fiable au retour du background → TanStack croit que rien n'a changé
//   2) Les channels Supabase Realtime se déconnectent en background
//      (iOS gèle les WebSockets) et ne reconnectent pas auto
//   3) Le service worker peut servir du cache stale sans revalider
//
// Fix : on intercepte 3 events (visibilitychange / focus / Capacitor resume)
// et on déclenche systématiquement :
//   - focusManager.setFocused(true)  → TanStack refait tous les refetch
//   - onlineManager.setOnline(true)  → idem côté reconnect
//   - queryClient.invalidateQueries() → force la revalidation immédiate
//   - supabase.realtime.connect()    → reconnecte les channels live
//   - loadSiteSettings()             → settings frais (couleurs, commission…)
// ════════════════════════════════════════════════════════════════

/**
 * Handler unique appelé à chaque retour foreground (peu importe la source).
 * Idempotent : safe à appeler plusieurs fois de suite sans effet de bord.
 */
function handleAppResume() {
  try {
    // 1) TanStack Query : marque comme focused + online → déclenche refetch
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    // 2) Invalide TOUT le cache mémoire (mais on garde la donnée affichée
    //    en stale tant que la revalidation n'est pas finie → pas de flash)
    queryClient.invalidateQueries();
    // 3) Reconnecte les channels Supabase Realtime (commandes live, etc.)
    try { supabase?.realtime?.connect?.(); } catch {}
    // 4) Refresh des site_settings (numéro WA, commission, couleurs…)
    loadSiteSettings().catch(() => {});
  } catch (e) {
    // Silent : on ne veut surtout pas casser le retour app
    if (typeof console !== 'undefined') console.warn('[YARAM] resume handler error:', e?.message);
  }
}

if (typeof document !== 'undefined') {
  // ── Web + PWA : visibilitychange est l'event LE PLUS fiable sur tous
  //    les navigateurs (Chrome desktop/Android, Safari mobile/desktop) ──
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      handleAppResume();
    } else {
      // App passe en background → on note la pause TanStack (économise des
      // refetch inutiles, évite les race conditions au retour)
      focusManager.setFocused(false);
    }
  });
  // ── Fallback web : focus window (cas où l'onglet reste visible mais
  //    perd le focus, ex. switch entre fenêtres sur desktop) ──
  window.addEventListener('focus', handleAppResume);
  // ── Reconnexion réseau (le plus utile à Dakar avec coupures LTE) ──
  window.addEventListener('online', () => {
    onlineManager.setOnline(true);
    handleAppResume();
  });
}

// ─── iOS / Android natif : event Capacitor App.resume ───
// Sur Capacitor, l'event JS `focus`/`visibilitychange` n'est pas toujours
// déclenché quand l'app revient du background (iOS suspend le WebView).
// On utilise donc l'event natif `appStateChange` qui est garanti.
if (isNativeApp()) {
  // Import dynamique pour ne pas charger Capacitor sur le web
  import('@capacitor/app').then(({ App: CapApp }) => {
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        handleAppResume();
      } else {
        focusManager.setFocused(false);
      }
    });
    // Event 'resume' (Android principalement, double safety net)
    CapApp.addListener('resume', handleAppResume);
  }).catch(() => { /* @capacitor/app pas dispo en dev web, normal */ });
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