// ════════════════════════════════════════════════════════
// YARAM — Détection de la plateforme runtime
// ════════════════════════════════════════════════════════
//
// Permet de conditionner certaines features selon la plateforme :
// - iOS (Capacitor) : pas de Google Sign-In tant qu'on n'a pas Sign in with Apple
//   (Apple Guideline 4.8 — obligatoire dès qu'il y a un login tiers)
// - Web standard : toutes les options de login
//
// Utilise window.Capacitor (injecté par le runtime Capacitor uniquement
// dans l'app native). Sur web standard, window.Capacitor est undefined.
// ════════════════════════════════════════════════════════

export function getPlatform() {
  if (typeof window === 'undefined') return 'web';
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.() && typeof cap.getPlatform === 'function') {
    return cap.getPlatform();
  }
  return 'web';
}

export function isIOSApp() {
  return getPlatform() === 'ios';
}

export function isAndroidApp() {
  return getPlatform() === 'android';
}

export function isNativeApp() {
  const p = getPlatform();
  return p === 'ios' || p === 'android';
}
