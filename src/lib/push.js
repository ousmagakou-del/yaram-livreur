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
      // On pourrait afficher un toast custom ici si on veut
    });

    // ─── Listener : tap sur push notif (app ouverte ou fermée) ───
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[push] tap notif:', action.notification.data);
      // Si la notif contient une URL custom, naviguer vers cette page
      const url = action.notification.data?.url;
      if (url && typeof window !== 'undefined') {
        // Deep link vers la route correspondante
        try {
          const u = new URL(url);
          // Si l'URL est yaram.app, on la traite comme route interne
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

    // Step 2 : register avec APNs (déclenche le listener 'registration' où
    // on enverra le token à OneSignal via notre edge function)
    await PushNotifications.register();

    // Le device_token et player_id arrivent de manière asynchrone via le listener.
    // On attend max 5 sec qu'ils soient là.
    const playerId = await waitForPlayerId(5000);

    if (!playerId) {
      // Le register est lancé mais pas encore retourné. Pas grave, le listener
      // fera son boulot en arrière-plan.
      return { ok: true, pending: true };
    }

    return { ok: true, playerId };
  } catch (e) {
    console.warn('[push] permission failed:', e?.message);
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Helper : attend que le player_id soit récupéré (max timeoutMs).
 */
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

/**
 * Envoie le device token à notre edge function register-push-device.
 * Notre backend appelle OneSignal pour créer le player + sauve en DB.
 */
async function sendTokenToBackend(deviceToken) {
  try {
    const { data, error } = await supabase.functions.invoke('register-push-device', {
      body: {
        device_token: deviceToken,
        platform: getPlatform(),
        app_version: '1.0.2',
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

/**
 * Récupère le player_id OneSignal courant si dispo.
 */
export async function getPlayerId() {
  return cachedPlayerId;
}

/**
 * Récupère le device token APNs courant si dispo.
 */
export async function getDeviceToken() {
  return cachedDeviceToken;
}

/**
 * Désactive les push pour ce device.
 * On flag push_enabled = false en DB pour ne plus envoyer depuis send-push-notification.
 */
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
