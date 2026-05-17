// ═══════════════════════════════════════════════════
// YARAM — Gestion du code promo "pending"
// ═══════════════════════════════════════════════════
// Quand la cliente clique sur le coupon BIENVENUE10 (Home)
// ou sur "J'achète →" depuis une promo (page Promos),
// on stocke le code en localStorage pour qu'il soit applique
// automatiquement au checkout.
// ═══════════════════════════════════════════════════

const KEY = 'yaram_pending_promo';

export function setPendingPromo(code) {
  if (!code) return;
  try {
    localStorage.setItem(KEY, code.toUpperCase());
    // Event pour notifier d'autres composants si besoin
    window.dispatchEvent(new CustomEvent('yaram-promo-pending', { detail: { code } }));
  } catch {}
}

export function getPendingPromo() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function clearPendingPromo() {
  try { localStorage.removeItem(KEY); } catch {}
}

// ─── Loyalty credit FCFA (pose par la page Loyalty quand redeem) ───
export function getLoyaltyCredit() {
  try {
    return parseInt(localStorage.getItem('yaram_loyalty_credit') || '0', 10) || 0;
  } catch {
    return 0;
  }
}

export function clearLoyaltyCredit() {
  try { localStorage.removeItem('yaram_loyalty_credit'); } catch {}
}
