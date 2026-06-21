// ════════════════════════════════════════════════════════
// YARAM — Push notifications : APNs natif (iOS) + Web Push (PWA)
// ════════════════════════════════════════════════════════
//
// MIGRATION : on bascule de OneSignal vers stack 100% indépendante.
//   - iOS natif (Capacitor) : @capacitor/push-notifications → APNs token
//     → upsert dans `device_tokens` (type='apns')
//   - PWA (web) : Notification API + ServiceWorker.pushManager
//     → upsert dans `device_tokens` (type='web_push')
//
// L'ENVOI passe par l'edge function `send-push` (router APNs + WebPush).
// L'edge function OneSignal `send-push-notification` reste en place pour
// la transition — on call la nouvelle en priorité, fallback OneSignal si KO.
//
// Tous les logs sont préfixés `[push]` pour grep.
// ════════════════════════════════════════════════════════

import { isNativeApp, getPlatform } from './platform';
import { supabase } from './supabase';

let initialized = false;
let cachedPlayerId = null;        // legacy OneSignal player_id (transition)
let cachedDeviceToken = null;     // APNs token natif iOS
let cachedWebSubscription = null; // PushSubscription web (PWA)

// VAPID public key exposée à la PWA via env Cloudflare Pages.
// MUST be set en build : VITE_VAPID_PUBLIC=<base64url uncompressed P-256>
const VAPID_PUBLIC = (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_VAPID_PUBLIC) || '';

// ─── helpers ──────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  if (!base64String) {
    throw new Error('VITE_VAPID_PUBLIC vide — env var pas propagée côté Cloudflare');
  }
  // Strip toute whitespace/newline accidentels lors du paste dans le dashboard
  const cleaned = String(base64String).replace(/\s+/g, '');
  const padding = '='.repeat((4 - (cleaned.length % 4)) % 4);
  const base64 = (cleaned + padding).replace(/-/g, '+').replace(/_/g, '/');
  let raw;
  try { raw = atob(base64); } catch (e) {
    throw new Error('VITE_VAPID_PUBLIC base64 invalide — vérifie qu\'il n\'y a pas de caractères en trop : "' + cleaned.slice(0, 20) + '..." (len=' + cleaned.length + ')');
  }
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  // Doit faire exactement 65 bytes et commencer par 0x04 (P-256 uncompressed)
  if (out.length !== 65 || out[0] !== 0x04) {
    throw new Error('VITE_VAPID_PUBLIC mauvais format : ' + out.length + ' bytes (attendu 65), premier byte 0x' + out[0]?.toString(16) + ' (attendu 0x04)');
  }
  return out;
}

function arrayBufferToBase64Url(buffer) {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function getPushPlugin() {
  const mod = await import('@capacitor/push-notifications');
  return mod.PushNotifications;
}

/**
 * Initialise le listener push (à appeler 1 fois au boot).
 * No-op sur web.
 */
export async function initPush() {
  if (!isNativeApp()) {
    return { skipped: true, reason: 'web_platform' };
  }
  if (initialized) {
    return { ok: true, alreadyInitialized: true };
  }

  try {
    const PushNotifications = await getPushPlugin();

    // ─── Listener : APNs token reçu après register() ───
    PushNotifications.addListener('registration', async (token) => {
      cachedDeviceToken = token.value;
      console.log('[push] APNs token received:', token.value.slice(0, 16) + '...');

      // 1) NEW : upsert direct dans device_tokens (APNs natif, sans OneSignal)
      try {
        await upsertApnsDeviceToken(token.value);
      } catch (e) {
        console.warn('[push] upsertApnsDeviceToken failed:', e?.message);
      }

      // 2) LEGACY : on continue d'envoyer à OneSignal pendant la transition.
      //    Une fois la migration validée en prod (~7j), retirer ce bloc.
      try {
        const result = await sendTokenToBackend(token.value);
        if (result?.player_id) {
          cachedPlayerId = result.player_id;
          console.log('[push] OneSignal player_id:', result.player_id);
        }
      } catch (e) {
        console.warn('[push] register-push-device (legacy) failed:', e?.message);
      }
    });

    // ─── Listener : registration error (rare) ───
    PushNotifications.addListener('registrationError', (err) => {
      console.warn('[push] registrationError:', err.error);
    });

    // ─── Listener : push reçu pendant que l'app est en foreground ───
    PushNotifications.addListener('pushNotificationReceived', (notif) => {
      console.log('[push] notification received (foreground):', notif.title, notif.body);
    });

    // ─── Listener : tap sur push notif (app ouverte ou fermée) ───
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[push] tap notif:', action.notification.data);
      const url = action.notification.data?.url;
      if (url && typeof window !== 'undefined') {
        try {
          const u = new URL(url);
          if (u.hostname === 'yaram.app') {
            window.location.assign(u.pathname + u.search);
          } else {
            window.open(url, '_blank');
          }
        } catch {
          /* ignore URL invalide */
        }
      }
    });

    initialized = true;
    return { ok: true };
  } catch (e) {
    console.warn('[push] init failed:', e?.message);
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Demande la permission notifications + register avec APNs.
 * À appeler après le login pour avoir le contexte "j'ai mon compte,
 * j'autorise les notifs" (= meilleur taux d'acceptation).
 */
export async function requestPushPermission() {
  if (!isNativeApp()) {
    return { skipped: true, reason: 'web_platform' };
  }
  if (!initialized) {
    await initPush();
  }

  try {
    const PushNotifications = await getPushPlugin();

    // Step 1 : demande permission iOS (popup système bleu)
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      return { ok: false, error: 'permission_denied', state: permResult.receive };
    }

    // Step 2 : register avec APNs (déclenche le listener 'registration')
    await PushNotifications.register();

    // Le token et player_id arrivent de manière asynchrone via le listener.
    // On attend max 5 sec qu'ils soient là.
    const playerId = await waitForPlayerId(5000);

    if (!playerId) {
      return { ok: true, pending: true };
    }

    return { ok: true, playerId };
  } catch (e) {
    console.warn('[push] permission failed:', e?.message);
    return { ok: false, error: e?.message || String(e) };
  }
}

function waitForPlayerId(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const checkInterval = setInterval(() => {
      if (cachedPlayerId) {
        clearInterval(checkInterval);
        resolve(cachedPlayerId);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(checkInterval);
        resolve(null);
      }
    }, 200);
  });
}

// ════════════════════════════════════════════════════════
// NEW : upsert dans `device_tokens` (sans OneSignal)
// ════════════════════════════════════════════════════════

async function upsertApnsDeviceToken(apnsToken) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      console.log('[push] upsertApnsDeviceToken skipped : no user logged in');
      return { ok: false, reason: 'no_user' };
    }
    // ON CONFLICT (user_id, apns_token) → toggle enabled = true + bump last_seen_at
    const { error } = await supabase
      .from('device_tokens')
      .upsert({
        user_id: user.id,
        type: 'apns',
        apns_token: apnsToken,
        platform: getPlatform(),
        app_version: '1.0.3',
        enabled: true,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'user_id,apns_token' });
    if (error) {
      console.warn('[push] device_tokens upsert (apns) error:', error.message);
      return { ok: false, error: error.message };
    }
    console.log('[push] device_tokens upsert (apns) OK');
    return { ok: true };
  } catch (e) {
    console.warn('[push] upsertApnsDeviceToken exception:', e?.message);
    return { ok: false, error: e?.message || String(e) };
  }
}

async function upsertWebDeviceToken(subscriptionJSON) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      console.log('[push] upsertWebDeviceToken skipped : no user logged in');
      return { ok: false, reason: 'no_user' };
    }
    const { endpoint, keys } = subscriptionJSON || {};
    const p256dh = keys?.p256dh || null;
    const auth = keys?.auth || null;
    if (!endpoint || !p256dh || !auth) {
      console.warn('[push] web subscription incomplete:', { has_endpoint: !!endpoint, has_p256dh: !!p256dh, has_auth: !!auth });
      return { ok: false, reason: 'incomplete_subscription' };
    }
    const { error } = await supabase
      .from('device_tokens')
      .upsert({
        user_id: user.id,
        type: 'web_push',
        web_endpoint: endpoint,
        web_p256dh: p256dh,
        web_auth: auth,
        platform: 'web',
        app_version: '1.0.3',
        enabled: true,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'user_id,web_endpoint' });
    if (error) {
      console.warn('[push] device_tokens upsert (web) error:', error.message);
      return { ok: false, error: error.message };
    }
    console.log('[push] device_tokens upsert (web) OK');
    return { ok: true };
  } catch (e) {
    console.warn('[push] upsertWebDeviceToken exception:', e?.message);
    return { ok: false, error: e?.message || String(e) };
  }
}

// ════════════════════════════════════════════════════════
// NEW : Web Push (PWA) — Notification API + ServiceWorker.pushManager
// ════════════════════════════════════════════════════════

/**
 * Demande la permission web + subscribe au push manager + upsert le sub
 * dans `device_tokens` (type='web_push').
 *
 * Prérequis : VITE_VAPID_PUBLIC défini en build (Cloudflare Pages env).
 * No-op sur native app (utilise APNs natif) ou sur browser sans support.
 */
export async function setupWebPushForUser() {
  if (isNativeApp()) {
    return { skipped: true, reason: 'native_platform' };
  }
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, error: 'web_push_unsupported' };
  }
  if (!VAPID_PUBLIC) {
    console.warn('[push] VITE_VAPID_PUBLIC missing — web push disabled');
    return { ok: false, error: 'vapid_public_missing' };
  }

  try {
    // Permission
    let perm = Notification.permission;
    if (perm === 'default') {
      perm = await Notification.requestPermission();
    }
    if (perm !== 'granted') {
      console.log('[push] web permission state:', perm);
      return { ok: false, error: 'permission_' + perm };
    }

    // Service worker registration (déjà installé par le boot — /sw.js)
    const reg = await navigator.serviceWorker.ready;
    if (!reg) {
      return { ok: false, error: 'no_service_worker' };
    }

    // Subscribe (si pas déjà)
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
      console.log('[push] new web push subscription created');
    } else {
      console.log('[push] reusing existing web push subscription');
    }
    cachedWebSubscription = sub;

    const subJson = sub.toJSON ? sub.toJSON() : {
      endpoint: sub.endpoint,
      keys: {
        p256dh: arrayBufferToBase64Url(sub.getKey?.('p256dh')),
        auth: arrayBufferToBase64Url(sub.getKey?.('auth')),
      },
    };

    const up = await upsertWebDeviceToken(subJson);
    return up.ok ? { ok: true, subscription: subJson } : { ok: false, error: up.error || 'upsert_failed' };
  } catch (e) {
    console.warn('[push] setupWebPushForUser failed:', e?.message);
    return { ok: false, error: e?.message || String(e) };
  }
}

async function sendTokenToBackend(deviceToken) {
  try {
    const { data, error } = await supabase.functions.invoke('register-push-device', {
      body: {
        device_token: deviceToken,
        platform: getPlatform(),
        app_version: '1.0.3',
        device_model: navigator.userAgent || null,
        language: navigator.language?.split('-')[0] || 'fr',
        timezone_offset: -new Date().getTimezoneOffset() * 60,
      },
    });
    if (error) {
      console.warn('[push] register-push-device error:', error.message);
      return { success: false, error: error.message };
    }
    return data;
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

export async function getPlayerId() {
  return cachedPlayerId;
}

export async function getDeviceToken() {
  return cachedDeviceToken;
}

export async function setPushEnabled(enabled) {
  if (!isNativeApp()) {
    return { skipped: true };
  }
  const playerId = await getPlayerId();
  if (!playerId) return { ok: false, error: 'no_player_id' };

  try {
    await supabase.rpc('set_device_push_enabled', {
      p_player_id: playerId,
      p_enabled: enabled,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Flow complet à appeler après login :
 *   - iOS natif : init listeners + permission + register APNs (le listener
 *     upsert dans device_tokens type='apns')
 *   - PWA / web : Notification.requestPermission + pushManager.subscribe
 *     → upsert dans device_tokens type='web_push'
 */
export async function setupPushForUser(user) {
  if (!user?.id) return { ok: false, error: 'no_user' };

  // ─── iOS / Android natif ───
  if (isNativeApp()) {
    const initRes = await initPush();
    if (!initRes.ok && !initRes.alreadyInitialized) {
      return { ok: false, error: 'init_failed', detail: initRes.error };
    }
    return await requestPushPermission();
  }

  // ─── Web / PWA ───
  return await setupWebPushForUser();
}

// Aliases pour compatibilité avec le code FCM transitoire
export const getFcmToken = getDeviceToken;
export const getRegistrationId = getPlayerId;
