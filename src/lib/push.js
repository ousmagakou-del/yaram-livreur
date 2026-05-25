// ════════════════════════════════════════════════════════
// YARAM — Push notifications via OneSignal (v1)
// ════════════════════════════════════════════════════════
//
// Couche d'abstraction au-dessus de OneSignal Cordova/Capacitor SDK.
//
// Comportement :
// - Sur app native iOS/Android (Capacitor) : initialise OneSignal SDK,
//   demande la permission, sauvegarde le player_id en DB
// - Sur web (yaram.app dans Safari/Chrome) : skip silencieusement
//   (OneSignal Web Push c'est un autre setup, optionnel pour plus tard)
//
// PLUGIN : onesignal-cordova-plugin
//   (malgré "cordova" dans le nom, c'est le SDK officiel OneSignal qui
//   fonctionne aussi pour Capacitor selon leur doc — cf
//   https://documentation.onesignal.com/docs/capacitor-sdk-setup)
//
// L'import est dynamique pour ne PAS planter le bundle web.
// ════════════════════════════════════════════════════════

import { isNativeApp, getPlatform } from './platform';
import { supabase } from './supabase';

const ONESIGNAL_APP_ID = '8ea329a7-538c-427f-9df7-f09a22046cb1';

let initialized = false;
let cachedPlayerId = null;

// Helper : récupère l'objet OneSignal du module (gère default export ET named export
// selon la version du plugin)
async function getOneSignal() {
  const mod = await import('onesignal-cordova-plugin');
  return mod.default || mod.OneSignal || mod;
}

/**
 * Initialise OneSignal au boot de l'app native.
 * À appeler une seule fois (dans App.jsx au montage).
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
    const OneSignal = await getOneSignal();
    OneSignal.initialize(ONESIGNAL_APP_ID);
    initialized = true;
    return { ok: true };
  } catch (e) {
    console.warn('[push] init failed:', e?.message);
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Demande la permission notifications à l'utilisateur (popup iOS).
 */
export async function requestPushPermission() {
  if (!isNativeApp()) {
    return { skipped: true, reason: 'web_platform' };
  }
  if (!initialized) {
    await initPush();
  }

  try {
    const OneSignal = await getOneSignal();

    // Demande la permission native (popup iOS bleu).
    // Le 2e arg `fallbackToSettings = false` : si l'user a déjà refusé une fois,
    // on ne le redirige PAS vers Réglages → YARAM (trop agressif).
    const granted = await OneSignal.Notifications.requestPermission(false);

    if (!granted) {
      return { ok: false, error: 'permission_denied' };
    }

    // Récupère le player_id (= subscription ID OneSignal)
    // Différentes versions du SDK ont différents noms : getIdAsync, getId, id
    let playerId;
    try {
      playerId = await OneSignal.User.pushSubscription.getIdAsync();
    } catch {
      try {
        playerId = OneSignal.User.pushSubscription.getId();
      } catch {
        playerId = OneSignal.User.pushSubscription.id;
      }
    }

    if (!playerId) {
      return { ok: false, error: 'no_player_id' };
    }
    cachedPlayerId = playerId;
    return { ok: true, playerId };
  } catch (e) {
    console.warn('[push] permission failed:', e?.message);
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Enregistre le device courant dans la DB Supabase (table user_devices).
 */
export async function registerDeviceInDb(playerId, opts = {}) {
  if (!playerId) {
    playerId = cachedPlayerId || await getPlayerId();
  }
  if (!playerId) {
    return { ok: false, error: 'no_player_id' };
  }

  try {
    const { data, error } = await supabase.rpc('register_device', {
      p_player_id: playerId,
      p_platform: getPlatform(),
      p_app_version: opts.appVersion || null,
      p_device_model: opts.deviceModel || null,
      p_language: opts.language || 'fr',
    });

    if (error) {
      console.warn('[push] register_device RPC error:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, deviceId: data };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Récupère le player_id courant si dispo.
 */
export async function getPlayerId() {
  if (cachedPlayerId) return cachedPlayerId;
  if (!isNativeApp()) return null;

  try {
    const OneSignal = await getOneSignal();
    let id;
    try {
      id = await OneSignal.User.pushSubscription.getIdAsync();
    } catch {
      try {
        id = OneSignal.User.pushSubscription.getId();
      } catch {
        id = OneSignal.User.pushSubscription.id;
      }
    }
    cachedPlayerId = id;
    return id;
  } catch {
    return null;
  }
}

/**
 * Toggle push enabled/disabled pour ce device.
 */
export async function setPushEnabled(enabled) {
  if (!isNativeApp()) {
    return { skipped: true };
  }
  const playerId = await getPlayerId();
  if (!playerId) return { ok: false, error: 'no_player_id' };

  try {
    const OneSignal = await getOneSignal();
    if (enabled) {
      OneSignal.User.pushSubscription.optIn();
    } else {
      OneSignal.User.pushSubscription.optOut();
    }
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
 * Flow complet à appeler après un login réussi :
 * 1. Init OneSignal si pas déjà fait
 * 2. Demande permission (popup iOS bleu, 1 fois)
 * 3. Sauvegarde player_id en DB
 */
export async function setupPushForUser(user) {
  if (!user?.id) return { ok: false, error: 'no_user' };
  if (!isNativeApp()) return { skipped: true };

  const initRes = await initPush();
  if (!initRes.ok && !initRes.alreadyInitialized) {
    return { ok: false, error: 'init_failed', detail: initRes.error };
  }

  const permRes = await requestPushPermission();
  if (!permRes.ok) {
    return { ok: false, error: permRes.error };
  }

  const regRes = await registerDeviceInDb(permRes.playerId);
  return regRes;
}
