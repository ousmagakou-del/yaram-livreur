// src/lib/cart.js
// Gestion centralisée du panier localStorage

const KEY = 'yaram_cart';
const LAST_ADDED_KEY = 'yaram_cart_last_added_at';

// Sanitize : un cart hérité d'avant les nouveaux champs (is_imported, pharmacyName…)
// pouvait être malformé et planter `grouped.reduce` ou `buildPreorderSummary`,
// ce qui blanchissait la page Cart (React 19 unmount silencieux sans ErrorBoundary).
// On filtre tout item incomplet et on garantit des valeurs par défaut sûres.
function sanitizeCartItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it) => it && typeof it === 'object' && it.productId && it.pharmacyId)
    .map((it) => ({
      productId: it.productId,
      pharmacyId: it.pharmacyId,
      pharmacyName: it.pharmacyName || 'Pharmacie',
      name: it.name || 'Produit',
      brand: it.brand || '',
      img: it.img || '',
      price: Number(it.price) || 0,
      qty: Math.max(1, Number(it.qty) || 1),
      is_imported: !!it.is_imported,
      lead_time_days: Number(it.lead_time_days) || 1,
      origin_country: it.origin_country || 'SN',
    }));
}

export function getCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return sanitizeCartItems(raw);
  } catch {
    return [];
  }
}

export function setCart(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    // Si panier vide → on retire le timestamp (le user a checkout)
    if (!items || items.length === 0) {
      try { localStorage.removeItem(LAST_ADDED_KEY); } catch {}
    }
    // Évenement custom pour que d'autres composants (badge panier dans TabBar) réagissent
    window.dispatchEvent(new CustomEvent('yaram-cart-updated', { detail: { items } }));
  } catch (e) {
    console.error('setCart error:', e);
  }
}

export function getCartCount() {
  return getCart().reduce((s, it) => s + (Number(it.qty) || 0), 0);
}

// Ajoute un produit au panier pour une pharmacie donnée
export function addToCart({ product, pharmacy, qty = 1 }) {
  if (!product || !pharmacy) return { success: false, error: 'Produit ou pharmacie manquant' };
  const cart = getCart();
  const exists = cart.find(c => c.productId === product.id && c.pharmacyId === pharmacy.id);
  if (exists) {
    exists.qty += qty;
  } else {
    cart.push({
      productId: product.id,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      name: product.name,
      brand: product.brand,
      img: product.img,
      price: product.price,
      qty,
      // ─── Infos import (preorder) — undefined = produit local ───
      is_imported: product.is_imported || false,
      lead_time_days: product.lead_time_days || 1,
      origin_country: product.origin_country || 'SN',
    });
  }
  setCart(cart);
  // Track le dernier ajout pour la notif cart abandoned (24h)
  try { localStorage.setItem(LAST_ADDED_KEY, new Date().toISOString()); } catch {}
  return { success: true };
}

// Vide explicitement le panier (au checkout)
export function clearCart() {
  setCart([]);
}
