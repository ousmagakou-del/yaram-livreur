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

// ════════════════════════════════════════════════════════════════
// FIX juin 2026 : Anti-page-blanche défensif au niveau window
// ════════════════════════════════════════════════════════════════
//
// 1) Si un chunk JS lazy fail à charger (deploy + SW cache poisoning),
//    Vite throw 'Failed to fetch dynamically imported module' → page blanche.
//    On intercepte cette erreur et on force un reload propre.
// 2) Si le SW envoie SW_UPDATED, on prépare un reload doux à la prochaine
//    navigation pour éviter le mismatch HTML/chunks.
if (typeof window !== 'undefined') {
  let _chunkErrorReloaded = false;
  const isChunkLoadError = (msg) => {
    if (!msg) return false;
    const s = String(msg).toLowerCase();
    return s.includes('failed to fetch dynamically imported module')
      || s.includes('importing a module script failed')
      || s.includes('error loading chunk')
      || s.includes('loading css chunk');
  };
  const handleChunkError = (msg) => {
    if (!isChunkLoadError(msg)) return;
    if (_chunkErrorReloaded) return;
    _chunkErrorReloaded = true;
    if (typeof console !== 'undefined') console.warn('[YARAM] chunk load error → reload propre');
    // Sentinel localStorage pour éviter une boucle infinie de reloads
    try {
      const last = parseInt(localStorage.getItem('yaram_last_chunk_reload') || '0', 10);
      if (Date.now() - last < 10000) {
        // Si on a déjà rechargé < 10s ago, c'est probablement vraiment cassé
        // → on affiche le fallback HTML au lieu de reload en boucle
        return;
      }
      localStorage.setItem('yaram_last_chunk_reload', String(Date.now()));
    } catch {}
    // Reload sans cache (force fetch frais)
    window.location.reload();
  };
  window.addEventListener('error', (e) => {
    handleChunkError(e?.message || e?.error?.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    handleChunkError(e?.reason?.message || e?.reason);
  });

  // Listener message du Service Worker (cf sw.js activate)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event?.data?.type === 'SW_UPDATED') {
        if (typeof console !== 'undefined') console.log('[YARAM] SW updated →', event.data.build);
        // Reload doux : on attend que le user soit idle puis reload
        // (évite de couper une action en cours type checkout)
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(() => window.location.reload(), { timeout: 5000 });
        } else {
          setTimeout(() => window.location.reload(), 1500);
        }
      }
    });
  }
}

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
    // ════════════════════════════════════════════════════════════════
    //  FIX juin 2026 #6 (CAUSE RACINE PAGE BLANCHE CONFIRMÉE PAR 4 AGENTS)
    //
    //  AVANT : on appelait queryClient.invalidateQueries() SANS filtre
    //  → marquait TOUTES les queries du cache comme stale → toutes les
    //  pages re-fetchaient → flash blanc PARTOUT à chaque retour.
    //
    //  MAINTENANT : on garde uniquement focusManager.setFocused(true).
    //  TanStack v5 réagit en refetchant UNIQUEMENT les queries déjà
    //  considérées stale (au-delà de staleTime, ex: 5min sur Home).
    //  Les queries fraîches restent affichées → AUCUN flash.
    //
    //  Effet bonus : moins de requêtes réseau (LTE Dakar) au resume.
    // ════════════════════════════════════════════════════════════════
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    // Reconnecte les channels Supabase Realtime (commandes live, etc.)
    try { supabase?.realtime?.connect?.(); } catch {}
    // Refresh des site_settings (numéro WA, commission, couleurs…)
    loadSiteSettings().catch(() => {});
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[YARAM] resume handler error:', e?.message);
  }
}

// FIX juin 2026 : envelopper TOUS les listeners dans try/catch défensif.
// Un throw au mount (avant React) crashait la page en blanc sans fallback.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    try {
      if (document.visibilityState === 'visible') {
        handleAppResume();
      } else {
        focusManager?.setFocused?.(false);
      }
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[YARAM] visibilitychange listener error:', e?.message);
    }
  });
  window.addEventListener('focus', () => {
    try { handleAppResume(); } catch (e) {
      if (typeof console !== 'undefined') console.warn('[YARAM] focus listener error:', e?.message);
    }
  });
  window.addEventListener('online', () => {
    try {
      onlineManager?.setOnline?.(true);
      handleAppResume();
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[YARAM] online listener error:', e?.message);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // FIX juin 2026 #iOS — Events spécifiques Safari mobile + PWA iOS
  // ════════════════════════════════════════════════════════════════
  //
  // iOS Safari a des comportements différents des autres navigateurs :
  //   • visibilitychange peut NE PAS firer au retour de background si
  //     l'app était dans le bfcache (back/forward cache)
  //   • Au lieu, iOS fire un event 'pageshow' avec event.persisted=true
  //   • iOS suspend tout le JS quand l'app passe en background, donc
  //     les setInterval/setTimeout sont gelés → polling cassé
  //   • iOS Safari PWA (mode standalone, ajouté à l'écran d'accueil)
  //     a un cycle de vie encore plus restreint (kills + cold restart)
  //   • Page Lifecycle API : 'freeze' / 'resume' (Chrome iOS / Safari 14+)
  //
  // C'EST POUR ÇA QUE LE USER VOYAIT TOUJOURS DES BUGS SUR SAFARI iOS
  // mais pas en desktop : les events standards ne se déclenchaient pas.
  // ════════════════════════════════════════════════════════════════

  // ── pageshow : LE MOMENT CRITIQUE iOS Safari ──
  // Fire à chaque retour du bfcache + au cold load. event.persisted=true
  // signifie "page restaurée depuis le cache iOS" → c'est ÇA le moment
  // où il faut refresh les queries stale (sinon UI montre des données
  // vieilles de plusieurs heures).
  window.addEventListener('pageshow', (event) => {
    try {
      if (event.persisted) {
        // Restauration depuis bfcache iOS → comportement = retour foreground
        if (typeof console !== 'undefined') console.log('[YARAM-iOS] pageshow persisted=true (bfcache restore) → handleAppResume');
        handleAppResume();
      }
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[YARAM] pageshow listener error:', e?.message);
    }
  });

  // ── pagehide : iOS Safari peut tuer la page en background ──
  // On note l'état pour que au prochain pageshow on sache si c'était un cold
  // restart ou un simple bfcache restore.
  window.addEventListener('pagehide', () => {
    try {
      focusManager?.setFocused?.(false);
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[YARAM] pagehide listener error:', e?.message);
    }
  });

  // ── Page Lifecycle API : 'resume' (Safari 14+, plus fiable que visibilitychange) ──
  document.addEventListener('resume', () => {
    try { handleAppResume(); } catch (e) {
      if (typeof console !== 'undefined') console.warn('[YARAM] document resume error:', e?.message);
    }
  });

  // ── iOS PWA standalone détection (mode "app installée") ──
  // En PWA standalone, le cycle de vie est encore plus restrictif.
  // On force le focusManager à true au boot pour éviter qu'il reste
  // stuck à false après un cold restart de la PWA.
  try {
    const isStandaloneiOS = window.navigator.standalone === true;
    const isStandalonePWA = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandaloneiOS || isStandalonePWA) {
      if (typeof console !== 'undefined') console.log('[YARAM-iOS] PWA standalone detected — force focusManager=true au boot');
      focusManager?.setFocused?.(true);
      onlineManager?.setOnline?.(true);
    }
  } catch {}
}

// ════════════════════════════════════════════════════════════════
// FIX juin 2026 #iOS-Capacitor — Resume agressif sur app TestFlight
// ════════════════════════════════════════════════════════════════
//
// L'utilisateur a confirmé : 'le probleme vient de l'app testflight'.
// Sur Capacitor iOS, WKWebView a son propre cycle de vie :
//   • L'app passe en background → WKWebView suspendu (JS gelé)
//   • Au retour → WKWebView reprend, mais :
//     - WebSockets Supabase Realtime sont MORTS définitivement
//     - Les fetches en cours sont abandonnés silencieusement
//     - localStorage est encore là (différent de Safari private)
//     - Le focusManager TanStack peut être stuck à false
//
// Solution agressive iOS native :
//   1. Logger CHAQUE transition d'état (visible dans DebugOverlay)
//   2. Au resume :
//      - DISCONNECT + RECONNECT total des channels realtime
//      - Forcer un refetch des queries critiques (user-scoped)
//      - Reload site settings
//   3. Tracker la durée away pour adapter le comportement :
//      - <30s : juste setFocused(true) (refetch silencieux)
//      - >30s : refetch agressif des queries critiques
//      - >5min : full invalidate (UI restera peuplée via placeholderData)
// ════════════════════════════════════════════════════════════════

let _capLastHiddenAt = null;
let _capResumeStats = { resumes: 0, pauses: 0, lastResumeAt: null };
// Exposé pour debug : window.__yaramCapStats
if (typeof window !== 'undefined') window.__yaramCapStats = _capResumeStats;

function handleCapacitorResume(source = 'capacitor') {
  try {
    _capResumeStats.resumes++;
    _capResumeStats.lastResumeAt = Date.now();
    const awayMs = _capLastHiddenAt ? (Date.now() - _capLastHiddenAt) : 0;
    _capLastHiddenAt = null;

    if (typeof console !== 'undefined') {
      console.log(`[YARAM-Cap] RESUME from ${source}, away=${(awayMs / 1000).toFixed(1)}s`);
    }

    // 1) Standard resume (setFocused + setOnline + reconnect)
    handleAppResume();

    // 2) FIX iOS Capacitor : disconnect + reconnect AGRESSIF des channels.
    //    Sans disconnect explicite, le client Supabase pense que la
    //    websocket est encore vivante (état "joined") alors qu'elle est
    //    fermée côté iOS → les events n'arrivent jamais.
    if (awayMs > 5 * 1000) {
      try {
        if (supabase?.realtime) {
          supabase.realtime.disconnect();
          setTimeout(() => {
            try { supabase.realtime.connect(); } catch {}
          }, 100);
        }
      } catch {}
    }

    // 3) Si away > 30s : refetch les queries actives (en background grâce
    //    à placeholderData → UI reste peuplée). Sur iOS Capacitor c'est
    //    nécessaire car le focusManager seul ne suffit pas toujours.
    if (awayMs > 30 * 1000) {
      try {
        // Refetch toutes les queries ACTIVES (= observées par un composant)
        queryClient.refetchQueries({ type: 'active' });
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[YARAM-Cap] refetch error:', e?.message);
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[YARAM-Cap] resume handler error:', e?.message);
  }
}

function handleCapacitorPause() {
  try {
    _capResumeStats.pauses++;
    _capLastHiddenAt = Date.now();
    focusManager?.setFocused?.(false);
    if (typeof console !== 'undefined') console.log('[YARAM-Cap] PAUSE');
  } catch {}
}

if (isNativeApp()) {
  import('@capacitor/app').then(({ App: CapApp }) => {
    try {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) handleCapacitorResume('appStateChange');
        else handleCapacitorPause();
      });
      CapApp.addListener('resume', () => handleCapacitorResume('resume'));
      CapApp.addListener('pause', handleCapacitorPause);
      if (typeof console !== 'undefined') console.log('[YARAM-Cap] listeners attached (appStateChange + resume + pause)');
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[YARAM-Cap] CapApp.addListener error:', e?.message);
    }
  }).catch((e) => {
    if (typeof console !== 'undefined') console.warn('[YARAM-Cap] @capacitor/app import failed:', e?.message);
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

// FIX juin 2026 : wrap createRoot dans try/catch avec fallback HTML brut.
// Sans ça, si #root est introuvable OU si createRoot/PersistQueryClientProvider
// throw au mount → page blanche TOTALE car React n'a pas encore d'ErrorBoundary.
// Avec ce fallback : l'user voit au moins un message + bouton Recharger.
function mountReact() {
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('YARAM: #root element introuvable dans index.html');
  }
  createRoot(rootEl).render(
    <StrictMode>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: 24 * 60 * 60 * 1000,
          buster: 'v2',
          dehydrateOptions: {
            shouldDehydrateQuery: (q) => {
              if (q.meta?.persist === false) return false;
              if (q.state.status !== 'success') return false;
              return true;
            },
          },
        }}
      >
        <BootedApp />
      </PersistQueryClientProvider>
    </StrictMode>,
  );
}

try {
  mountReact();
} catch (e) {
  // Crash fatal AVANT React → on tue le splash + on affiche un message texte
  // récupérable avec un bouton "Recharger" qui nuke tous les caches.
  if (typeof console !== 'undefined') console.error('[YARAM FATAL]', e);
  try { hideBootSplash(); } catch {}
  const fb = document.createElement('div');
  fb.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;color:#0D4D27;font-family:-apple-system,Segoe UI,sans-serif;padding:24px;text-align:center;z-index:99999';
  fb.innerHTML = `
    <div style="font-size:48px;margin-bottom:16px">🌿</div>
    <div style="font-size:18px;font-weight:700;margin-bottom:8px">YARAM</div>
    <div style="font-size:14px;color:#6b7280;max-width:300px;margin-bottom:24px;line-height:1.5">
      Petit souci au démarrage. On recharge l'application proprement ?
    </div>
    <button id="yaram-nuke-btn" style="background:#1F8B4C;color:#fff;border:none;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer">
      Recharger
    </button>
    <div style="font-size:11px;color:#9ca3af;margin-top:20px;max-width:280px;line-height:1.4">${(e?.message || 'erreur inconnue').slice(0, 200)}</div>
  `;
  document.body.appendChild(fb);
  document.getElementById('yaram-nuke-btn')?.addEventListener('click', async () => {
    // Nuke caches + SW + IndexedDB pour reset complet
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
    } catch {}
    window.location.reload();
  });
}

// Fallback : si pour une raison X le wrapper ne se monte pas en 3s, on retire
// quand meme le splash pour ne pas bloquer l'utilisatrice.
setTimeout(hideBootSplash, 3000)