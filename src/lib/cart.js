// src/lib/cart.js
// Gestion centralisée du panier localStorage

const KEY = 'yaram_cart';
const LAST_ADDED_KEY = 'yaram_cart_last_added_at';

export function getCart() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
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
