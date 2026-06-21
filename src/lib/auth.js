// ════════════════════════════════════════════════════════
// YARAM — Helpers d'authentification tiers (Apple, etc.)
// ════════════════════════════════════════════════════════
//
// Sign in with Apple : REQUIS par Apple Review Guideline 4.8
// (toute app qui propose un login social comme Google DOIT aussi proposer
// Sign in with Apple, sinon REJET en review iOS).
//
// Stratégie :
//   - Sur iOS natif (Capacitor) : on utilise le plugin natif
//     @capacitor-community/apple-sign-in qui ouvre le sheet AuthenticationServices.
//     On récupère un identityToken (JWT signé par Apple) qu'on échange contre
//     une session Supabase via signInWithIdToken.
//   - Sur web (Safari, Chrome) : on utilise le flow OAuth standard de Supabase
//     (qui redirige vers appleid.apple.com puis revient sur notre callback).
//   - Sur Android natif : on cache le bouton (peu pertinent, Google OAuth
//     suffit là-bas).
// ════════════════════════════════════════════════════════

import { supabase } from './supabase';
import { getPlatform, isIOSApp } from './platform';

/**
 * Génère un nonce cryptographiquement sûr (32 octets en hex).
 * Apple exige un nonce pour empêcher les replay attacks sur l'identityToken.
 * On l'envoie en clair au plugin natif (Apple le hashe en SHA-256 côté serveur)
 * puis on le repasse à Supabase qui doit pouvoir vérifier le hash.
 */
function generateNonce() {
  // crypto.getRandomValues : dispo sur Capacitor iOS (WebKit) et tous les browsers modernes
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Lance le flow Sign in with Apple et établit une session Supabase.
 * @returns {Promise<{user, session}|{provider, url}>} user/session sur iOS natif,
 *   { provider, url } sur web (Supabase fait la redirection).
 * @throws Error si l'utilisateur annule ou si l'échange de token échoue.
 */
export async function signInWithApple() {
  // ─── iOS NATIF : plugin AuthenticationServices ───
  if (isIOSApp()) {
    let SignInWithApple;
    try {
      const mod = await import('@capacitor-community/apple-sign-in');
      SignInWithApple = mod.SignInWithApple;
    } catch (e) {
      throw new Error('Plugin Apple Sign-In non installé. Lance `npm i && npx cap sync ios`.');
    }

    const nonce = generateNonce();
    const options = {
      // clientId = bundle ID iOS de l'app (configuré côté Apple Developer)
      clientId: 'app.yaram',
      // redirectURI requis par le plugin mais ignoré sur iOS natif (le sheet
      // se ferme dans l'app). On met le domaine prod pour cohérence.
      redirectURI: 'https://yaram.app',
      scopes: 'email name',
      // state : protection CSRF (Apple le renvoie tel quel)
      state: generateNonce().substring(0, 16),
      nonce,
    };

    let result;
    try {
      result = await SignInWithApple.authorize(options);
    } catch (e) {
      // Le plugin throw quand l'utilisateur annule (touche Cancel)
      const msg = e?.message || '';
      if (/cancel|1001/i.test(msg)) {
        throw new Error('Connexion Apple annulée');
      }
      throw new Error('Connexion Apple échouée : ' + (msg || 'erreur inconnue'));
    }

    const identityToken = result?.response?.identityToken;
    if (!identityToken) {
      throw new Error('Connexion Apple : token manquant');
    }

    // Échange l'identityToken contre une session Supabase
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
      nonce, // Supabase vérifie que le hash SHA-256 du nonce correspond à celui du JWT
    });
    if (error) throw error;
    return { user: data.user, session: data.session };
  }

  // ─── WEB / SAFARI : OAuth standard ───
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  });
  if (error) throw error;
  return data;
}

/**
 * Indique si le bouton "Continuer avec Apple" doit être affiché.
 * - iOS natif : OUI (obligatoire Apple Guideline 4.8)
 * - Web Safari : OUI (UX cohérente pour les users Apple)
 * - Web autres browsers : OUI aussi (Apple OAuth fonctionne sur tout browser)
 * - Android natif : NON (pas pertinent, Google OAuth suffit)
 */
export function shouldShowAppleButton() {
  const platform = getPlatform();
  if (platform === 'ios') return true;
  if (platform === 'android') return false;
  // web : on l'affiche toujours, Apple OAuth fonctionne partout
  return true;
}
