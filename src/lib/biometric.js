// ════════════════════════════════════════════════════════
// YARAM — Authentification biométrique (Face ID / Touch ID iOS)
// ════════════════════════════════════════════════════════
//
// Flow :
// 1. L'user signup/login normalement avec email + password
// 2. On lui propose "Activer Face ID pour la prochaine connexion ?"
// 3. Si oui : on stocke email + Supabase refresh_token dans le Keychain iOS sécurisé
// 4. Au prochain démarrage (s'il s'est déconnecté), bouton "Face ID" apparaît
// 5. Tap → bio prompt → si OK → on récupère le refresh_token → on rétablit la
//    session Supabase via `supabase.auth.setSession({ refresh_token })`
//
// Sécurité :
// - Aucun password n'est stocké (Apple le déconseille)
// - Le refresh_token est dans le Keychain iOS (crypté hardware par Secure Enclave)
// - Si Face ID est désactivé sur l'appareil, fallback automatique sur passcode iOS
// - Si refresh_token expiré (>30j d'inactivité), fallback : ressaisie password
//
// PLUGINS UTILISÉS :
// - @aparajita/capacitor-biometric-auth (Face ID / Touch ID natif)
// - @aparajita/capacitor-secure-storage  (Keychain iOS)
//
// No-op sur web (les plugins ne fonctionnent que sur iOS/Android natif).
// ════════════════════════════════════════════════════════

import { isNativeApp } from './platform';
import { supabase } from './supabase';

const STORAGE_KEY_EMAIL  = 'yaram_bio_email';
const STORAGE_KEY_RTOKEN = 'yaram_bio_refresh_token';
const STORAGE_KEY_ENABLED = 'yaram_bio_enabled';

// ─── Helpers : import dynamique (pour ne pas planter le web bundle) ───
async function getBio() {
  const mod = await import('@aparajita/capacitor-biometric-auth');
  return mod.BiometricAuth || mod.default;
}

async function getStorage() {
  const mod = await import('@aparajita/capacitor-secure-storage');
  return mod.SecureStorage || mod.default;
}

/**
 * Vérifie si Face ID / Touch ID est disponible sur l'appareil.
 * @returns {Promise<{available: boolean, type?: 'faceId'|'touchId'|'unknown', reason?: string}>}
 */
export async function isBiometricAvailable() {
  if (!isNativeApp()) return { available: false, reason: 'web_platform' };
  try {
    const BiometricAuth = await getBio();
    const result = await BiometricAuth.checkBiometry();
    if (!result?.isAvailable) {
      return { available: false, reason: result?.reason || 'not_available' };
    }
    // Type biométrique : faceAuthentication / touchAuthentication / iris
    let type = 'unknown';
    if (result.biometryType?.toLowerCase().includes('face')) type = 'faceId';
    else if (result.biometryType?.toLowerCase().includes('touch')) type = 'touchId';
    else if (result.biometryType?.toLowerCase().includes('fingerprint')) type = 'touchId';
    return { available: true, type };
  } catch (e) {
    console.warn('[bio] checkBiometry error:', e?.message);
    return { available: false, reason: e?.message || String(e) };
  }
}

/**
 * Active Face ID pour cet utilisateur.
 * Stocke email + refresh_token dans le Keychain après une auth bio réussie.
 *
 * @param {string} email - email de l'user
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function enableBiometric(email) {
  if (!isNativeApp()) return { ok: false, error: 'web_platform' };
  if (!email) return { ok: false, error: 'no_email' };

  // 1. Récupère la session Supabase courante (refresh_token)
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.refresh_token) {
    return { ok: false, error: 'no_active_session' };
  }

  try {
    // 2. Demande au user de confirmer avec Face ID (pour pas que quelqu'un
    //    qui a déjà ton tel actif puisse activer en cachette)
    const BiometricAuth = await getBio();
    await BiometricAuth.authenticate({
      reason: 'Active Face ID pour te reconnecter rapidement à YARAM',
      cancelTitle: 'Annuler',
      iosFallbackTitle: 'Utiliser le code',
    });

    // 3. Stocke email + refresh_token dans le Keychain iOS
    const SecureStorage = await getStorage();
    await SecureStorage.set(STORAGE_KEY_EMAIL, email);
    await SecureStorage.set(STORAGE_KEY_RTOKEN, session.refresh_token);
    await SecureStorage.set(STORAGE_KEY_ENABLED, '1');

    return { ok: true };
  } catch (e) {
    console.warn('[bio] enable failed:', e?.message);
    return { ok: false, error: e?.message || 'biometric_enable_failed' };
  }
}

/**
 * Vérifie si Face ID est activé pour un user déjà setup sur cet appareil.
 * @returns {Promise<{enabled: boolean, email?: string}>}
 */
export async function isBiometricEnabled() {
  if (!isNativeApp()) return { enabled: false };
  try {
    const SecureStorage = await getStorage();
    const enabled = await SecureStorage.get(STORAGE_KEY_ENABLED).catch(() => null);
    if (enabled !== '1') return { enabled: false };
    const email = await SecureStorage.get(STORAGE_KEY_EMAIL).catch(() => null);
    return { enabled: true, email };
  } catch {
    return { enabled: false };
  }
}

/**
 * Login via Face ID : demande bio → récupère refresh_token → setSession Supabase.
 * À appeler quand l'user tap le bouton "Face ID" sur l'écran login.
 *
 * @returns {Promise<{ok: boolean, error?: string, user?: object}>}
 */
export async function loginWithBiometric() {
  if (!isNativeApp()) return { ok: false, error: 'web_platform' };

  try {
    // 1. Vérifier qu'on a bien des credentials stockés
    const { enabled, email } = await isBiometricEnabled();
    if (!enabled) {
      return { ok: false, error: 'biometric_not_enabled' };
    }

    // 2. Demander Face ID
    const BiometricAuth = await getBio();
    await BiometricAuth.authenticate({
      reason: `Connecte-toi à YARAM en tant que ${email || 'utilisateur'}`,
      cancelTitle: 'Annuler',
      iosFallbackTitle: 'Utiliser le code',
    });

    // 3. Récupérer le refresh_token du Keychain
    const SecureStorage = await getStorage();
    const refreshToken = await SecureStorage.get(STORAGE_KEY_RTOKEN);
    if (!refreshToken) {
      return { ok: false, error: 'no_stored_token' };
    }

    // 4. Restaure la session Supabase
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data?.session) {
      // Refresh token expiré ou invalide → on désactive Face ID pour cet user
      // (forcera une re-saisie password complète)
      await disableBiometric();
      return { ok: false, error: 'session_expired_relogin_required' };
    }

    // 5. Update le refresh_token stocké avec le nouveau (Supabase en génère 1 nouveau)
    if (data.session.refresh_token) {
      await SecureStorage.set(STORAGE_KEY_RTOKEN, data.session.refresh_token).catch(() => {});
    }

    return { ok: true, user: data.session.user };
  } catch (e) {
    console.warn('[bio] login failed:', e?.message);
    // L'user a annulé Face ID
    if (String(e?.message || e).toLowerCase().includes('cancel')) {
      return { ok: false, error: 'cancelled' };
    }
    return { ok: false, error: e?.message || 'biometric_login_failed' };
  }
}

/**
 * Désactive Face ID pour cet appareil (nettoie le Keychain).
 * À appeler quand l'user :
 * - Se déconnecte manuellement
 * - Change de compte
 * - Toggle off dans les settings
 */
export async function disableBiometric() {
  if (!isNativeApp()) return { ok: true };
  try {
    const SecureStorage = await getStorage();
    await SecureStorage.remove(STORAGE_KEY_EMAIL).catch(() => {});
    await SecureStorage.remove(STORAGE_KEY_RTOKEN).catch(() => {});
    await SecureStorage.remove(STORAGE_KEY_ENABLED).catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

/**
 * Met à jour le refresh_token stocké après chaque refresh Supabase.
 * À appeler après un signIn réussi pour que le token Face ID reste frais.
 */
export async function refreshStoredToken() {
  if (!isNativeApp()) return;
  try {
    const { enabled } = await isBiometricEnabled();
    if (!enabled) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.refresh_token) return;
    const SecureStorage = await getStorage();
    await SecureStorage.set(STORAGE_KEY_RTOKEN, session.refresh_token);
  } catch { /* silent */ }
}
