// src/lib/sentry.js
// Initialisation Sentry monitoring d'erreurs prod.
// Toute la logique est CONDITIONNELLE : si @sentry/browser n'est pas installé
// OU si VITE_SENTRY_DSN n'est pas défini OU en dev → silent skip.
// Aucun crash possible côté Cloudflare Pages même si la dep est absente.
//
// Pour activer en prod :
//   1. npm install @sentry/browser (déjà dans package.json)
//   2. Crée un compte gratuit sur https://sentry.io (5000 événements/mois free)
//   3. Crée un projet React → copie le DSN
//   4. Ajoute VITE_SENTRY_DSN=https://... dans Cloudflare Pages → Settings → Env vars
//   5. Redeploie
//
// PII filtering : email/phone/password/token/whatsapp sont scrubés des contextes.

let sentryReady = false;
let Sentry = null;

export async function initSentry() {
  if (sentryReady) return;
  if (import.meta.env.DEV) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  try {
    // Import dynamique : si @sentry/browser n'est pas installé,
    // l'erreur est swallowed par le catch en bas.
    Sentry = await import('@sentry/browser');
    Sentry.init({
      dsn,
      release: import.meta.env.VITE_APP_VERSION || 'yaram@unknown',
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0.5,
      beforeSend(event) {
        // strip PII de l'user
        if (event.user) {
          delete event.user.email;
          delete event.user.ip_address;
          if (event.user.username) delete event.user.username;
        }
        // strip headers sensibles
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        if (event.request?.cookies) delete event.request.cookies;
        return event;
      },
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        'Non-Error promise rejection captured',
        /AbortError/i,
        /NetworkError/i,
        'Failed to fetch',
        'Load failed',
        'top.GLOBALS',
      ],
    });
    sentryReady = true;
    // eslint-disable-next-line no-console
    console.log('[Sentry] initialized');
  } catch {
    // Sentry pas installé ou échec init → silent
  }
}

export function captureError(err, context = {}) {
  if (!sentryReady || !Sentry) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[Sentry-stub]', err, context);
    }
    return;
  }
  try {
    Sentry.captureException(err, { extra: scrubPII(context) });
  } catch { /* ignore */ }
}

// Alias rétro-compat avec l'ancien nom utilisé par ErrorBoundary
export const captureException = captureError;

export function captureMessage(message, level = 'info') {
  if (!sentryReady || !Sentry) return;
  try {
    Sentry.captureMessage(message, level);
  } catch { /* ignore */ }
}

export function identifySentry(user) {
  if (!sentryReady || !Sentry) return;
  try {
    Sentry.setUser(user ? { id: user.id } : null);
  } catch { /* ignore */ }
}

function scrubPII(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    if (/email|phone|password|token|secret|whatsapp/i.test(k)) {
      out[k] = '[redacted]';
    } else {
      out[k] = obj[k];
    }
  }
  return out;
}
