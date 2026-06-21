// ═══════════════════════════════════════════════════════════════════
//  YARAM · Analytics (PostHog)
// ═══════════════════════════════════════════════════════════════════
// Wrapper safe autour de posthog-js. Tous les helpers sont no-op si :
//   - VITE_POSTHOG_KEY non défini (build dev / preview)
//   - MODE !== 'production' (on ne pollue pas les analytics en dev)
//   - le user n'a pas consenti (DNT respect_dnt)
//
// Aucune exception ne remonte au reste de l'app : si PostHog plante,
// l'app continue de tourner normalement.
// ═══════════════════════════════════════════════════════════════════

// PERF : posthog-js fait ~32kb gzip. Import dynamique → exclu du bundle initial.
// L'app boot sans, et PostHog charge en background à initAnalytics().
// Tous les helpers sont safe-stub tant que le module n'est pas résolu.

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || '';
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com';

let initialized = false;
let posthog = null; // résolu après le dynamic import
let initPromise = null;

export function initAnalytics() {
  if (initialized || initPromise) return initPromise;
  if (!POSTHOG_KEY || import.meta.env.MODE !== 'production') return;
  initPromise = (async () => {
    try {
      const mod = await import('posthog-js');
      posthog = mod.default || mod;
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        persistence: 'localStorage',
        autocapture: false,
        capture_pageview: false, // on track manuellement
        session_recording: { maskAllInputs: true },
        respect_dnt: true,
      });
      initialized = true;
    } catch (e) {
      console.warn('[Analytics] init failed:', e?.message);
    }
  })();
  return initPromise;
}

export function identifyUser(user) {
  if (!initialized || !posthog || !user?.id) return;
  try {
    posthog.identify(user.id, {
      email: user.email,
      first_name: user.first_name,
      city: user.city,
      created_at: user.created_at,
    });
  } catch {}
}

export function trackEvent(name, properties = {}) {
  if (!initialized || !posthog) return;
  try {
    posthog.capture(name, properties);
  } catch {}
}

export function trackPageview(routeName) {
  trackEvent('$pageview', { route: routeName });
}

export function resetAnalytics() {
  if (!initialized || !posthog) return;
  try { posthog.reset(); } catch {}
}
