// ════════════════════════════════════════════════════════
// YARAM — Helpers pour les commandes preorder (Import)
// ════════════════════════════════════════════════════════
//
// Une commande YARAM peut contenir :
//   - Produits LOCAUX (Dakar, livraison J+1)
//   - Produits IMPORT (USA/EU/etc, livraison sous 15j en général)
//
// Dès qu'il y a AU MOINS 1 produit import, la commande est marquée
// is_preorder = true et bascule sur le workflow 50/50 :
//   • Acompte 50% à la commande
//   • Solde 50% à l'arrivée Dakar
//
// Statuts orders preorder :
//   pending → confirmed (acompte payé)
//          → awaiting_supplier (YARAM commande USA)
//          → in_transit_intl (produit en route)
//          → arrived_local (produit à Dakar)
//          → awaiting_balance (solde demandé)
//          → in_delivery → delivered
//
// ════════════════════════════════════════════════════════

/**
 * Détecte si une commande est un preorder (= contient au moins 1 produit import).
 * @param {Array} cartItems - items du panier
 * @returns {boolean}
 */
export function isPreorderCart(cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return false;
  return cartItems.some(it => it?.is_imported === true);
}

/**
 * Retourne le délai max (en jours) parmi tous les items du panier.
 * On prend le MAX car la commande complète sera livrée quand le dernier
 * produit (le plus lent) arrive.
 *
 * @param {Array} cartItems
 * @returns {number} jours
 */
export function getMaxLeadTime(cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return 1;
  return Math.max(...cartItems.map(it => Number(it?.lead_time_days) || 1));
}

/**
 * Calcule la date estimée d'arrivée à Dakar.
 * NOW() + max lead_time_days
 *
 * @param {Array} cartItems
 * @param {Date} [from=new Date()] - date de référence (défaut : maintenant)
 * @returns {Date}
 */
export function getExpectedArrivalDate(cartItems, from = new Date()) {
  const days = getMaxLeadTime(cartItems);
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Formate la date d'arrivée en français lisible.
 * @param {Date|string} date
 * @returns {string} "mer. 9 juin 2026"
 */
export function formatArrivalDate(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Calcule le breakdown 50/50 pour un total donné.
 *
 * @param {number} total - montant total en FCFA
 * @param {number} [depositPercent=50] - % d'acompte
 * @returns {{ total, depositPercent, depositAmount, balanceAmount }}
 */
export function calculateBreakdown(total, depositPercent = 50) {
  const t = Number(total) || 0;
  const pct = Number(depositPercent) || 50;
  const deposit = Math.round((t * pct) / 100);
  const balance = t - deposit;
  return {
    total: t,
    depositPercent: pct,
    depositAmount: deposit,
    balanceAmount: balance,
  };
}

/**
 * Sépare un panier en deux groupes : items locaux vs items import.
 * Utilisé pour l'affichage en 2 sections dans Cart et Checkout.
 *
 * @param {Array} cartItems
 * @returns {{ local: Array, imported: Array }}
 */
export function splitCartByOrigin(cartItems) {
  if (!Array.isArray(cartItems)) return { local: [], imported: [] };
  const local = [];
  const imported = [];
  for (const it of cartItems) {
    if (it?.is_imported === true) imported.push(it);
    else local.push(it);
  }
  return { local, imported };
}

/**
 * Calcule les sous-totaux par origine.
 * @param {Array} cartItems
 * @returns {{ localTotal, importedTotal, grandTotal }}
 */
export function getSubtotalsByOrigin(cartItems) {
  const { local, imported } = splitCartByOrigin(cartItems);
  const sum = (arr) => arr.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
  const localTotal = sum(local);
  const importedTotal = sum(imported);
  return {
    localTotal,
    importedTotal,
    grandTotal: localTotal + importedTotal,
  };
}

/**
 * Récap complet pour Checkout : breakdown + dates + sous-totaux.
 *
 * @param {Array} cartItems
 * @param {number} [shippingFee=0]
 * @param {number} [depositPercent=50]
 * @returns {object}
 */
export function buildPreorderSummary(cartItems, shippingFee = 0, depositPercent = 50) {
  const isPreorder = isPreorderCart(cartItems);
  const subtotals = getSubtotalsByOrigin(cartItems);
  const total = subtotals.grandTotal + (Number(shippingFee) || 0);
  const breakdown = isPreorder
    ? calculateBreakdown(total, depositPercent)
    : { total, depositPercent: 100, depositAmount: total, balanceAmount: 0 };
  const expectedArrival = isPreorder ? getExpectedArrivalDate(cartItems) : null;

  return {
    isPreorder,
    cartItems,
    subtotals,
    shippingFee: Number(shippingFee) || 0,
    total,
    breakdown,
    expectedArrival,
    expectedArrivalFormatted: expectedArrival ? formatArrivalDate(expectedArrival) : null,
    leadTimeDays: getMaxLeadTime(cartItems),
  };
}

// ─── Statuts orders preorder ───
// Workflow officiel YARAM pour les commandes preorder import.
export const PREORDER_STATUS_FLOW = [
  'pending',             // commande créée
  'confirmed',           // acompte 50% reçu
  'awaiting_supplier',   // YARAM va commander chez le fournisseur USA
  'in_transit_intl',     // produit en route vers Dakar (DHL/UPS/avion)
  'arrived_local',       // produit reçu à Dakar
  'awaiting_balance',    // solde 50% demandé au client
  'in_delivery',         // livreur YARAM en route
  'delivered',           // livré ✅
];

// Labels FR pour affichage UX
export const PREORDER_STATUS_LABELS = {
  pending:           'En attente',
  confirmed:         'Acompte reçu',
  awaiting_supplier: 'Commande fournisseur',
  in_transit_intl:  'En route vers Dakar',
  arrived_local:    'Arrivé à Dakar',
  awaiting_balance: 'Solde à régler',
  in_delivery:      'Livraison en cours',
  delivered:        'Livré',
  cancelled:        'Annulée',
};

// Icônes (emojis) par statut pour timeline visuelle
export const PREORDER_STATUS_ICONS = {
  pending:           '⏳',
  confirmed:         '💳',
  awaiting_supplier: '🛍️',
  in_transit_intl:  '✈️',
  arrived_local:    '🇸🇳',
  awaiting_balance: '💰',
  in_delivery:      '🚚',
  delivered:        '✅',
  cancelled:        '❌',
};

/**
 * Retourne l'étape courante (index) dans le flow preorder.
 * @param {string} status
 * @returns {number} -1 si statut inconnu
 */
export function getPreorderStepIndex(status) {
  return PREORDER_STATUS_FLOW.indexOf(status);
}

/**
 * Détermine le statut "suivant" pour faire avancer une commande preorder.
 * Utilisé par l'admin (bouton "Avancer commande").
 *
 * @param {string} currentStatus
 * @returns {string|null} statut suivant ou null si déjà delivered/cancelled
 */
export function getNextPreorderStatus(currentStatus) {
  const idx = getPreorderStepIndex(currentStatus);
  if (idx === -1 || idx >= PREORDER_STATUS_FLOW.length - 1) return null;
  return PREORDER_STATUS_FLOW[idx + 1];
}
