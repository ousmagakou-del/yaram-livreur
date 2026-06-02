// ════════════════════════════════════════════════════════
// YARAM — Push notifications via @capacitor/push-notifications + OneSignal
// ════════════════════════════════════════════════════════
//
// Approche hybride :
// - Côté CLIENT : on utilise @capacitor/push-notifications (plugin officiel
//   Capacitor) pour demander la permission et récupérer le device token APNs natif
// - Côté BACKEND : on envoie ce token à notre edge function register-push-device
//   qui l'enregistre chez OneSignal et nous retourne un player_id
// - Côté ENVOI : OneSignal envoie les pushs via leur API (déjà setup)
//
// Pourquoi cette approche au lieu du SDK OneSignal Cordova ?
//   → Le plugin onesignal-cordova-plugin a des conflits Live Activities avec
//     Capacitor SPM modern (header OneSignalLiveActivities-Swift.h not found).
//   → @capacitor/push-notifications est officiel, à jour, sans compatibility issue.
//
// Pourquoi pas Firebase iOS SDK direct ?
//   → Le SDK Firebase iOS pèse ~150 MB et explose le temps de build SPM.
//     Pour de simples push notifs, l'API APNs native via Capacitor + OneSignal
//     (qui parle APNs en backend) suffit largement.
//
// No-op sur web (le plugin ne fonctionne que sur iOS/Android natif).
// ════════════════════════════════════════════════════════

import { isNativeApp, getPlatform } from './platform';
import { supabase } from './supabase';

let initialized = false;
let cachedPlayerId = null;
let cachedDeviceToken = null;

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

      // Envoie le token à OneSignal via notre edge function
      try {
        const result = await sendTokenToBackend(token.value);
        if (result.player_id) {
          cachedPlayerId = result.player_id;
          console.log('[push] OneSignal player_id:', result.player_id);
        }
      } catch (e) {
        console.warn('[push] register-push-device failed:', e?.message);
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
 * 1. Init listeners (si pas déjà fait)
 * 2. Demande permission + register APNs
 * 3. Le listener envoie auto le token à OneSignal en arrière-plan
 */
export async function setupPushForUser(user) {
  if (!user?.id) return { ok: false, error: 'no_user' };
  if (!isNativeApp()) return { skipped: true };

  const initRes = await initPush();
  if (!initRes.ok && !initRes.alreadyInitialized) {
    return { ok: false, error: 'init_failed', detail: initRes.error };
  }

  const permRes = await requestPushPermission();
  return permRes;
}

// Aliases pour compatibilité avec le code FCM transitoire
export const getFcmToken = getDeviceToken;
export const getRegistrationId = getPlayerId;
