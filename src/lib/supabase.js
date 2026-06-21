import { createClient } from '@supabase/supabase-js';
import { cachedFetch, invalidateCache } from './dataCache';
import { toast } from './toast';

const SUPABASE_URL = 'https://qxhhnrnworwrnwmqekmb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';

// ─── FETCH avec TIMEOUT — protège contre les fetches qui hang après reprise iOS ───
// Quand l'app reprend du background, certains fetches en cours sont "morts"
// (TCP socket fermé par iOS) et leur Promise ne resolve jamais → page stuck.
// On wrap le fetch global avec un timeout de 20s + AbortController.
const FETCH_TIMEOUT_MS = 20000; // 20s : large pour réseau africain mais ne hang pas indéfiniment

const customFetch = (input, init = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('fetch_timeout')), FETCH_TIMEOUT_MS);

  // Si l'appelant a déjà son propre signal (rare), on le respecte aussi
  const externalSignal = init.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
    }
  }

  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'yaram-auth',
  },
  global: {
    fetch: customFetch,
  },
});

// Re-export utility for admin sections
export { invalidateCache };

// ═══════════════════════════════════════════════
// SITE SETTINGS (admin) — table site_settings (key, value JSONB, updated_at)
// ═══════════════════════════════════════════════

// Cache module-level : settings charges au boot, exposes sync via getCachedSetting().
// Fallback hardcode garanti si DB indisponible ou cle non set.
const SETTINGS_FALLBACK = {
  siteName: 'YARAM',
  commission: 8,            // pourcentage
  deliveryFee: 1500,        // FCFA (Dakar)
  freeDeliveryFrom: 30000,  // FCFA (Dakar — au-dessus livraison gratuite)
  whatsapp: '+221 77 438 87 66',
  email: 'contact@yaram.sn',
  primaryColor: '#1F8B4C',
  accentColor: '#FFD700',
  // ─── Hero banner Home (éditable dans Admin → Settings → Hero) ───
  heroEnabled: true,
  heroLine1: 'Zéro',
  heroLine2: 'frais de',
  heroLine3: 'service',
  heroSubtext: 'Livraison à 1 500 FCFA',
  heroBackground: '#1F8B4C',
  heroLine1Color: '#FFF8E5',
  heroLineColor: '#FFFFFF',
  heroSubBg: '#F4B53A',
  heroSubColor: '#4A1B0C',
  heroCtaLabel: 'Découvrir les promos',
  heroCtaRoute: 'promos',
  // ─── Hero — cycles d'animation des 3 lignes (phrases séparées par |) ───
  // Si rempli, chaque ligne cycle entre ces phrases (2.6s par cycle).
  // Format : "Phrase 1|Phrase 2|Phrase 3"
  heroLine1Cycle: 'ZÉRO|100%|LIVRAISON',
  heroLine2Cycle: 'FRAIS DE|AUTHENTIQUE|EN 1H30',
  heroLine3Cycle: 'SERVICE|MARQUES|CHRONO',
  // ─── Boutique internationale — image de fond éditable (URL Supabase) ──
  intlBgImage: '',
};
let settingsCache = { ...SETTINGS_FALLBACK };
const settingsListeners = new Set();

export function getCachedSetting(key, fallback) {
  if (settingsCache && key in settingsCache && settingsCache[key] != null) {
    return settingsCache[key];
  }
  if (fallback !== undefined) return fallback;
  return SETTINGS_FALLBACK[key];
}

export function subscribeSettings(listener) {
  settingsListeners.add(listener);
  listener(settingsCache);
  return () => settingsListeners.delete(listener);
}

// Charge les settings depuis la DB et update le cache. A appeler au boot de l'app.
export async function loadSiteSettings() {
  const remote = await getSiteSettings();
  settingsCache = { ...SETTINGS_FALLBACK, ...remote };
  for (const l of settingsListeners) l(settingsCache);
  return settingsCache;
}

export async function getSiteSettings() {
  // Lit toutes les rows et merge en { key: value }
  const { data, error } = await supabase
    .from('site_settings')
    .select('key, value');
  if (error) {
    console.warn('[settings] read error:', error.message);
    return {};
  }
  const out = {};
  for (const row of (data || [])) {
    out[row.key] = row.value;
  }
  return out;
}

export async function updateSiteSettings(updates) {
  // Phase 2 RLS : on passe par la RPC admin_update_site_settings (SECURITY DEFINER,
  // requiert token admin). L'INSERT/UPDATE direct sur site_settings est bloque
  // pour anon depuis la vague 5.
  const keys = Object.keys(updates || {});
  if (keys.length === 0) return { success: true };

  // Recupere le token admin courant
  let token = null;
  try {
    const raw = sessionStorage.getItem('yaram-admin-session');
    if (raw) token = JSON.parse(raw)?.token || null;
  } catch { /* ignore */ }

  if (!token) {
    return { success: false, error: 'Session admin requise pour modifier les paramètres' };
  }

  const { data, error } = await supabase.rpc('admin_update_site_settings', {
    p_token:    token,
    p_settings: updates,
  });
  if (error) {
    console.error('[settings] write error:', error.message);
    return { success: false, error: error.message };
  }
  if (!data?.success) {
    return { success: false, error: data?.error || 'Echec mise a jour parametres' };
  }
  // Refresh le cache + notify les listeners (CSS variables, etc.)
  await loadSiteSettings();
  return { success: true };
}

// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════

export async function signUp(email, password, firstName) {
  return supabase.auth.signUp({
    email, password,
    options: { data: { first_name: firstName } },
  });
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

export async function signOut() {
  // PERF + SÉCURITÉ : vide TOUS les caches au logout pour éviter de servir des
  // données de l'ancien user au prochain login.
  invalidateFavoriteIdsCache();
  try {
    const dataCache = await import('./dataCache');
    dataCache.clearAllCache?.();
  } catch { /* ignore */ }
  try {
    sessionStorage.removeItem('yaram-home-cache-v1');
    localStorage.removeItem('yaram-home-cache-v1');
  } catch { /* ignore */ }
  return supabase.auth.signOut();
}

export async function getCurrentUser(prefetchedSession = null) {
  try {
    // Si on a deja la session (passee depuis App.jsx au boot), evite un 2e getSession()
    let session = prefetchedSession;
    if (!session) {
      const r = await supabase.auth.getSession();
      session = r.data?.session;
    }
    if (!session?.user) return null;
    const user = session.user;
    const { data: profile } = await supabase
      .from('users_profile').select('*').eq('id', user.id).single();
    return profile || { id: user.id, email: user.email };
  } catch (e) {
    console.error('getCurrentUser error:', e.message);
    return null;
  }
}

export async function updateProfile(updates) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { error: { message: 'Pas de session active' } };
  // Invalide les caches liés à l'utilisateur
  invalidateCache(`my_loyalty_${session.user.id}`);
  // UPSERT pour les cas où le users_profile n'existe pas encore (signup Google
  // sans trigger DB, ou signup email qui a saute l'etape upsert).
  // Bloque par les policies : seul l'utilisateur authentifie peut upsert sa propre ligne.
  return supabase
    .from('users_profile')
    .upsert(
      { id: session.user.id, email: session.user.email, ...updates },
      { onConflict: 'id' }
    )
    .select()
    .single();
}

// ═══════════════════════════════════════════════
// PRODUITS & MARQUES — AVEC CACHE
// ═══════════════════════════════════════════════

// PERF : colonnes minimales utilisees par les listes (Home, Search, ProductTile).
// La fiche produit (Product.jsx) fetch deja un seul produit avec select('*')
// donc elle aura toutes les infos. Cette liste ne sert qu'aux LISTES.
// Avant : select('*') = ~3-4KB par produit (long_desc, inci, usage, reason...).
// Apres : ~400 octets par produit = ~7x moins de bande passante.
// ⚠️ Toutes ces colonnes ONT ETE verifiees comme existantes (cf Product.jsx +
// admin upsert). Si on rajoute une colonne ici, la verifier d'abord dans la DB.
const PRODUCT_LIST_COLUMNS = 'id, name, brand, category, score, price, review_count, rating, badges, img, active, created_at, is_imported, lead_time_days, origin_country';

export async function getAllProducts() {
  return cachedFetch('all_products', async () => {
    const { data } = await supabase
      .from('products')
      .select(PRODUCT_LIST_COLUMNS)
      .eq('active', true);
    return data || [];
  }, { ttl: 5 * 60 * 1000 }); // 5 min
}

export async function getAllCategories() {
  return cachedFetch('all_categories', async () => {
    const { data } = await supabase
      .from('categories')
      .select('*')
      .eq('active', true)
      .order('display_order', { ascending: true });
    return data || [];
  }, { ttl: 10 * 60 * 1000 }); // 10 min — categories changent rarement
}

// PERF : ne renvoie que les slugs (1 colonne) pour faire un comptage par categorie.
// Utilise par Categories.jsx — bien plus leger que getAllProducts().
export async function getProductCategorySlugs() {
  return cachedFetch('product_category_slugs', async () => {
    const { data } = await supabase
      .from('products')
      .select('category')
      .eq('active', true);
    return data || [];
  }, { ttl: 5 * 60 * 1000 });
}

export async function getAllBrands() {
  return cachedFetch('all_brands', async () => {
    const { data } = await supabase.from('brands').select('*');
    return data || [];
  }, { ttl: 10 * 60 * 1000 });
}

export async function getProductAvailability(productId) {
  // ⚠️ pharmacy:pharmacies(*) etait CASSE depuis qu'on a fait le GRANT SELECT
  // (le * expand a TOUTES les colonnes pharmacies, dont `pin` qui est REVOKE
  // pour anon -> Postgres rejette toute la query avec 400).
  // -> on liste explicitement les colonnes safe pour la jointure.
  const PH_COLS = 'id, name, tagline, owner_name, manager_name, city, neighborhood, address, lat, lng, phone, whatsapp, hours, delivery_hours, logo, cover, description, commission, active, rating, review_count, pin_set_at, created_at, updated_at, notification_email, notification_phone';
  const { data, error } = await supabase
    .from('inventory')
    .select(`*, pharmacy:pharmacies(${PH_COLS})`)
    .eq('product_id', productId)
    .gt('stock', 0)
    .eq('active', true);
  if (error) {
    console.warn('[getProductAvailability] error:', error.message);
    return [];
  }
  return data || [];
}

// ═══════════════════════════════════════════════
// PHARMACIES — AVEC CACHE
// ═══════════════════════════════════════════════

// Liste des colonnes safe a exposer cote client (PAS de PIN)
// pin_set_at est conserve : c'est juste un timestamp non sensible qui permet
// au flow de connexion pharmacie de savoir si la pharma doit creer son PIN.
// Doit rester aligne avec le GRANT SELECT cote DB (cf Supabase Studio).
const PHARMACY_PUBLIC_COLUMNS = 'id, name, tagline, owner_name, manager_name, city, neighborhood, address, lat, lng, phone, whatsapp, notification_email, notification_phone, hours, delivery_hours, logo, cover, description, commission, active, rating, review_count, pin_set_at, created_at, updated_at';

export async function getAllPharmacies() {
  return cachedFetch('all_pharmacies', async () => {
    const { data } = await supabase
      .from('pharmacies')
      .select(PHARMACY_PUBLIC_COLUMNS)
      .eq('active', true);
    return data || [];
  }, { ttl: 10 * 60 * 1000 });
}

// ═══════════════════════════════════════════════
// COMMANDES
// ═══════════════════════════════════════════════

function generateOrderId() {
  return 'DIA-' + Date.now().toString(36).toUpperCase();
}

export async function createOrder({
  items, address, paymentMethod, subtotal, shipping, total,
  promoCode, promoDiscount,
  // ─── Preorder (Import) ───
  isPreorder = false,
  depositAmount = null,
  balanceAmount = null,
  expectedArrivalDate = null,
}) {
  const { data: { session } } = await supabase.auth.getSession();
  const order = {
    id: generateOrderId(),
    user_id: session?.user?.id,
    status: 'pending_payment',
    items, address,
    payment_method: paymentMethod,
    subtotal, shipping, total,
    promo_code: promoCode,
    promo_discount: promoDiscount || 0,
    confirmation_token: 'CFM-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
  };
  // ─── Champs preorder (Import) — uniquement si commande contient des items import ───
  if (isPreorder) {
    order.is_preorder = true;
    order.deposit_amount = depositAmount;
    order.balance_amount = balanceAmount;
    if (expectedArrivalDate) order.expected_arrival_date = expectedArrivalDate;
  }
  const { data, error } = await supabase.from('orders').insert(order).select().single();
  if (error) console.error('createOrder error:', error);
  // Invalide le cache de mes commandes pour que la nouvelle apparaisse
  if (session?.user?.id) invalidateCache(`my_orders_${session.user.id}`);
  return error ? null : data;
}

export async function getMyOrders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];
  return cachedFetch(`my_orders_${session.user.id}`, async () => {
    // PERF : SELECT explicite des colonnes utilisées par Orders.jsx
    // Avant : SELECT * ramenait 30+ colonnes par order = 5-10 KB chacune.
    // Maintenant : ~1 KB par order, 5× plus rapide sur réseau lent.
    const { data } = await supabase
      .from('orders')
      .select('id, status, total, subtotal, shipping, payment_method, items, address, created_at, is_preorder, deposit_amount, balance_amount, expected_arrival_date, lead_time_days')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    return data || [];
  }, { ttl: 60 * 1000 }); // 1 min (les commandes changent souvent)
}

export async function updateOrderStatus(id, status) {
  // Vague 13 RLS : UPDATE direct bloque pour anon. Cette fonction n'est
  // utilisee QUE par Payment.jsx pour passer pending_payment -> paid.
  // Donc on route vers la RPC dediee client_mark_order_paid.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) invalidateCache(`my_orders_${session.user.id}`);
  } catch {}
  if (status === 'paid') {
    const { data, error } = await supabase.rpc('client_mark_order_paid', { p_order_id: id });
    if (error) return { error };
    if (!data?.success) return { error: { message: data?.error || 'paiement refuse' } };
    return { data };
  }
  // Autres statuts : il n'y en a pas en client. Si un futur cas apparait,
  // creer une RPC dediee plutot que d'autoriser l'UPDATE direct.
  return { error: { message: 'updateOrderStatus: status ' + status + ' non autorise cote client' } };
}

export function subscribeToNewOrders(callback) {
  // FIX memory leak : chaque appel utilisait le même channel name fixe ('orders-changes')
  // → si appelée 2+ fois sans unsubscribe, Supabase crée des channels orphelins.
  // Maintenant : channel name unique + retourne une fonction cleanup.
  const channelName = `orders-changes-${Math.random().toString(36).slice(2, 10)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      (payload) => callback(payload.new))
    .subscribe();

  // Cleanup : à appeler depuis le useEffect return
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}

// ═══════════════════════════════════════════════
// FAVORIS
// ═══════════════════════════════════════════════

export async function getMyFavorites() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];
  return cachedFetch(`my_favs_${session.user.id}`, async () => {
    // PERF : SELECT précis au lieu de products(*) qui ramenait inci, long_desc, etc.
    // Pour la liste favoris on a juste besoin de quoi afficher les ProductTile.
    const { data } = await supabase
      .from('favorites')
      .select('product_id, products(id, name, brand, price, old_price, img, score, rating, review_count, category, badges, is_imported, lead_time_days)')
      .eq('user_id', session.user.id)
      .limit(200);
    return (data || []).map(f => f.products).filter(Boolean);
  }, { ttl: 2 * 60 * 1000 }); // 2 min
}

// ─── PERF : cache global des IDs favoris pour éviter N requêtes ───
// Sans ça, chaque ProductTile faisait 1 query Supabase pour son coeur.
// Maintenant : 1 query au boot/refresh, instant pour TOUS les tiles ensuite.
let _favoriteIdsCache = null;
let _favoriteIdsPromise = null;

async function getFavoriteIdsSet() {
  if (_favoriteIdsCache) return _favoriteIdsCache;

  // Si une promise est déjà en cours, la wrap avec timeout pour éviter zombie
  if (_favoriteIdsPromise) {
    return Promise.race([
      _favoriteIdsPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('fav_timeout')), 8000)),
    ]).catch(() => {
      // Si timeout : reset la promise et retourne Set vide en fallback
      _favoriteIdsPromise = null;
      return new Set();
    });
  }

  _favoriteIdsPromise = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        _favoriteIdsCache = new Set();
        return _favoriteIdsCache;
      }
      const { data } = await supabase
        .from('favorites')
        .select('product_id')
        .eq('user_id', session.user.id);
      _favoriteIdsCache = new Set((data || []).map(f => f.product_id));
      return _favoriteIdsCache;
    } finally {
      _favoriteIdsPromise = null;
    }
  })();

  // Wrap la première promise aussi pour timeout
  return Promise.race([
    _favoriteIdsPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('fav_timeout')), 8000)),
  ]).catch(() => {
    _favoriteIdsPromise = null;
    return new Set();
  });
}

function invalidateFavoriteIdsCache() {
  _favoriteIdsCache = null;
  _favoriteIdsPromise = null;
}

export async function isFavorite(productId) {
  const ids = await getFavoriteIdsSet();
  return ids.has(productId);
}

export async function toggleFavorite(productId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  // Invalide les caches favoris (l'ancien + le nouveau cache global)
  invalidateCache(`my_favs_${session.user.id}`);
  invalidateCache(`my_favs_count_${session.user.id}`);

  // PERF : update optimiste du cache local pour réactivité instant
  const ids = await getFavoriteIdsSet();
  const wasAlreadyFav = ids.has(productId);

  if (wasAlreadyFav) {
    ids.delete(productId);
    await supabase.from('favorites').delete()
      .eq('user_id', session.user.id)
      .eq('product_id', productId);
    return false;
  } else {
    ids.add(productId);
    await supabase.from('favorites').insert({
      user_id: session.user.id,
      product_id: productId,
    });
    return true;
  }
}

// À appeler au login pour pré-charger les favoris (utilisé par App.jsx)
export function preloadFavorites() {
  return getFavoriteIdsSet().catch(() => null);
}

// À appeler au logout pour vider le cache
export function clearFavoritesCache() {
  invalidateFavoriteIdsCache();
}

export async function getFavoritesCount() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return 0;
  return cachedFetch(`my_favs_count_${session.user.id}`, async () => {
    const { count } = await supabase
      .from('favorites')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', session.user.id);
    return count || 0;
  }, { ttl: 2 * 60 * 1000 });
}

// ═══════════════════════════════════════════════
// ADRESSES
// ═══════════════════════════════════════════════

export async function getMyAddresses() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];
  return cachedFetch(`my_addresses_${session.user.id}`, async () => {
    const { data } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', session.user.id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    return data || [];
  }, { ttl: 5 * 60 * 1000 });
}

export async function saveAddress(address) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    toast.error('Tu dois être connectée');
    return null;
  }
  // Invalide le cache adresses a la sauvegarde
  invalidateCache(`my_addresses_${session.user.id}`);
  try {
    if (address.is_default) {
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', session.user.id);
    }
    if (address.id) {
      const { data, error } = await supabase
        .from('addresses')
        .update({
          label: address.label, icon: address.icon, name: address.name,
          phone: address.phone, city: address.city, neighborhood: address.neighborhood,
          line: address.line, is_default: address.is_default,
        })
        .eq('id', address.id).select().single();
      if (error) { toast.error('Erreur update : ' + error.message); return null; }
      return data;
    } else {
      const newAddr = {
        user_id: session.user.id,
        label: address.label || 'Domicile', icon: address.icon || '🏠',
        name: address.name || '', phone: address.phone || '',
        city: address.city, neighborhood: address.neighborhood || '',
        line: address.line, is_default: address.is_default || false,
      };
      const { data, error } = await supabase.from('addresses').insert(newAddr).select().single();
      if (error) { toast.error('Erreur insert : ' + error.message); return null; }
      return data;
    }
  } catch (e) {
    toast.error('Erreur technique : ' + e.message);
    return null;
  }
}

export async function deleteAddress(id) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) invalidateCache(`my_addresses_${session.user.id}`);
  } catch {}
  return supabase.from('addresses').delete().eq('id', id);
}

export async function setDefaultAddress(id) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  invalidateCache(`my_addresses_${session.user.id}`);
  // PERF : 2 updates en parallèle au lieu de séquentiel
  // (sur réseau lent : 300-600ms d'écart visible)
  const [, result] = await Promise.all([
    supabase.from('addresses').update({ is_default: false }).eq('user_id', session.user.id).neq('id', id),
    supabase.from('addresses').update({ is_default: true }).eq('id', id),
  ]);
  return result;
}

// ═══════════════════════════════════════════════
// WHATSAPP & CONFIRMATION
// ═══════════════════════════════════════════════

export function generateConfirmToken() {
  return 'CFM-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

export async function getOrderByConfirmToken(token) {
  // Vague 11 RLS : SELECT direct par confirmation_token bloque pour anon
  // depuis le drop de "Anyone can read by confirmation token". On passe par
  // la RPC SECURITY DEFINER qui valide le token cote serveur.
  const { data, error } = await supabase.rpc('client_get_order_by_token', { p_token: token });
  if (error) return null;
  return data;
}

export async function clientConfirmDelivery(tokenOrOrderId) {
  // Vague 13 RLS : passe par RPC SECURITY DEFINER.
  // La RPC accepte le token (ClientConfirm.jsx l'utilise depuis l'URL).
  // Pour back-compat, si on recoit un orderId, on cherche d'abord par token.
  return supabase.rpc('client_confirm_delivery', { p_token: tokenOrOrderId });
}

export async function clientReportDispute(tokenOrOrderId, reason) {
  // eslint-disable-next-line no-unused-vars
  return supabase.rpc('client_dispute_delivery', { p_token: tokenOrOrderId, p_reason: reason });
}

export async function sendWhatsApp(to, text) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, text }),
    });
    return await response.json();
  } catch (e) {
    console.error('sendWhatsApp exception:', e);
    return { success: false, error: e.message };
  }
}

export const WhatsAppTemplates = {
  driverAssigned: (driverName, order, trackingUrl) =>
    `Salut ${driverName}! 🛵\n\nNouvelle livraison YARAM :\n\n📦 N° ${order.id}\n👤 ${order.address?.name}\n📍 ${order.address?.line}, ${order.address?.city}\n💰 ${order.total?.toLocaleString('fr-FR')} FCFA${order.payment_method === 'cod' ? ' (à ENCAISSER cash 💵)' : ' (déjà payé en ligne ✅)'}\n\n🔗 Lien tracking GPS :\n${trackingUrl}\n\nOuvre ce lien sur ton téléphone, partage ta position et suis les étapes.\n\nYARAM 💚`,
  orderCreatedDigital: (clientName, orderId, total, method) =>
    `Salut ${clientName} 💚\n\nTa commande YARAM ${orderId} est reçue !\n\n💳 Paiement ${method} : ${total.toLocaleString('fr-FR')} FCFA\n\nDès validation, on prépare ton colis 📦\n\nYARAM`,
  orderCreatedCash: (clientName, orderId, total) =>
    `Salut ${clientName} 💚\n\nTa commande YARAM ${orderId} est reçue !\n\n💵 Prépare ${total.toLocaleString('fr-FR')} FCFA cash pour la livraison\n\nOn te notifie dès que le livreur arrive 🛵\n\nYARAM`,
  orderPaid: (clientName, orderId) =>
    `Salut ${clientName} 💚\n\nTon paiement pour la commande ${orderId} est confirmé ✅\n\nOn prépare ta commande, tu seras notifiée quand le livreur arrive 🛵\n\nYARAM`,
  orderShipped: (clientName, orderId, driverName, driverPhone) =>
    `Hey ${clientName} 🛵\n\nTa commande ${orderId} est en route !\n\n👤 Livreur : ${driverName}\n📞 WhatsApp : ${driverPhone || '—'}\n\nSuis sa progression en temps réel dans l'app YARAM.\n\nYARAM 💚`,
  orderAwaitingConfirm: (clientName, orderId, confirmUrl) =>
    `Bonjour ${clientName} 💚\n\nLe livreur indique avoir livré ta commande ${orderId}.\n\n👉 Confirme ta réception ici :\n${confirmUrl}\n\nDis-nous si tout va bien ou si tu as un souci.\n\nYARAM 💚`,
  orderAwaitingConfirmCash: (clientName, orderId, total, confirmUrl) =>
    `Bonjour ${clientName} 💚\n\nLe livreur indique avoir livré ta commande ${orderId} et reçu ${total.toLocaleString('fr-FR')} FCFA cash.\n\n👉 Confirme ta réception ici :\n${confirmUrl}\n\nDis-nous si tout va bien ou si tu as un souci.\n\nYARAM 💚`,
  orderDelivered: (clientName, orderId) =>
    `🎉 Bonjour ${clientName} !\n\nTa commande ${orderId} est officiellement livrée !\n\nMerci pour ta confiance 💚\n\nN'hésite pas à noter ton expérience dans l'app.\n\nYARAM`,
  newOrderToPharmacy: (pharmacyName, order) =>
    `🏥 Hello ${pharmacyName}\n\nNouvelle commande YARAM à préparer :\n\n📦 N° ${order.id}\n👤 ${order.address?.name}\n📍 ${order.address?.city}\n\nVoir tes commandes : ${window.location.origin}/?pharma\n\nYARAM 💚`,
  disputeToAdmin: (orderId, clientName, reason) =>
    `⚠️ LITIGE YARAM\n\nCommande : ${orderId}\nCliente : ${clientName}\nMotif : ${reason}\n\nVérifie les preuves dans l'admin et contacte la cliente.\n\nYARAM`,
};

// ═══════════════════════════════════════════════
// SCAN IA
// ═══════════════════════════════════════════════

export async function analyzeSkinPhotos({ frontBase64, leftBase64, rightBase64 }) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/analyze-skin`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        photos: { front: frontBase64, left: leftBase64, right: rightBase64 },
      }),
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function uploadScanPhoto(file, scanId, type) {
  const fileName = `${scanId}/${type}_${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('skin-scans').upload(fileName, file, {
    contentType: 'image/jpeg', upsert: true
  });
  if (error) return null;
  // Vague D : bucket prive, on garde le format URL "publique" pour back-compat DB
  // mais l'affichage passera par getSignedStorageUrl() pour generer une URL signee.
  const { data } = supabase.storage.from('skin-scans').getPublicUrl(fileName);
  return data.publicUrl;
}

// ─────────────────────────────────────────────────────────────────────
// SIGNED URLS pour buckets prives (skin-scans, delivery-proofs)
// ─────────────────────────────────────────────────────────────────────
const PRIVATE_BUCKETS = new Set(['skin-scans', 'delivery-proofs']);
const signedUrlCache = new Map(); // path → { url, expiresAt }
const SIGNED_TTL = 60 * 60 * 24 * 7; // 7 jours

/**
 * Transforme une URL publique Supabase (ou un path direct) en URL signee
 * valide 7 jours pour les buckets prives. Idempotent pour les buckets publics
 * (renvoie l'URL telle quelle).
 *
 * Usage : <img src={await getSignedStorageUrl(scan.image_url)} />
 */
export async function getSignedStorageUrl(urlOrPath) {
  if (!urlOrPath) return null;
  // Si pas une URL Supabase Storage, renvoie tel quel (URL externe Unsplash, etc.)
  const match = /\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+?)(?:\?|$)/.exec(urlOrPath);
  let bucket, path;
  if (match) {
    bucket = match[1];
    path = match[2];
  } else if (urlOrPath.includes('/')) {
    // Path direct genre "skin-scans/abc.jpg"
    const [b, ...rest] = urlOrPath.split('/');
    bucket = b;
    path = rest.join('/');
  } else {
    return urlOrPath;
  }

  // Bucket public : pas besoin de signer
  if (!PRIVATE_BUCKETS.has(bucket)) return urlOrPath;

  // Cache (evite de re-signer chaque render)
  const cacheKey = `${bucket}/${path}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) {
    console.warn('[signedUrl] failed for', cacheKey, error?.message);
    return urlOrPath; // fallback : l'URL ne marchera pas mais on evite null
  }
  signedUrlCache.set(cacheKey, {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_TTL - 60) * 1000, // refresh 1 min avant expiry
  });
  return data.signedUrl;
}

export async function saveSkinScan({ userId, photoFrontUrl, photoLeftUrl, photoRightUrl, analysis }) {
  const { data, error } = await supabase.from('skin_scans').insert({
    user_id: userId,
    photo_front_url: photoFrontUrl, photo_left_url: photoLeftUrl, photo_right_url: photoRightUrl,
    skin_type: analysis.skin_type, skin_score: analysis.skin_score, diagnosis: analysis,
  }).select().single();
  if (error) return null;
  return data;
}

export async function getMySkinScans() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];
  // PERF : limit 100 + colonnes nécessaires uniquement (le diagnostic JSON peut être lourd)
  const { data } = await supabase.from('skin_scans')
    .select('id, skin_type, skin_score, diagnosis, photo_front_url, created_at')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  return data || [];
}

export async function getLatestSkinScan() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data } = await supabase.from('skin_scans').select('*')
    .eq('user_id', session.user.id).order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  return data;
}

export async function getProductsForSkinDiagnosis(diagnosis) {
  const allProducts = await getAllProducts();
  const recommendedIngredients = (diagnosis.ingredients_recommandes || []).map(i => i.toLowerCase());
  const avoidIngredients = (diagnosis.ingredients_a_eviter || []).map(i => i.toLowerCase());
  const compatibles = [], avoid = [];
  for (const product of allProducts) {
    const productText = `${product.name || ''} ${product.description || ''} ${product.ingredients || ''}`.toLowerCase();
    if (avoidIngredients.some(ing => productText.includes(ing))) {
      avoid.push(product); continue;
    }
    if (recommendedIngredients.some(ing => productText.includes(ing))) {
      compatibles.push(product);
    }
  }
  return { compatibles, avoid };
}

// ═══════════════════════════════════════════════
// UPLOAD IMAGES
// ═══════════════════════════════════════════════

// Helper interne : uploade un fichier dans le bucket donne et retourne l'URL publique.
// Throw une Error avec le vrai message en cas d'echec (au lieu de retourner null silencieusement).
async function uploadToBucket(bucket, file, { maxDim = 800, quality = 0.85, prefix = 'file' } = {}) {
  if (!file) throw new Error('Aucun fichier fourni');
  let compressed;
  try {
    compressed = await compressImage(file, maxDim, quality);
  } catch (e) {
    throw new Error('Compression image impossible : ' + (e?.message || 'format non supporte'));
  }
  if (!compressed) throw new Error('Image vide après compression');
  const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
  const { error: upErr } = await supabase.storage.from(bucket).upload(fileName, compressed, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (upErr) {
    console.error(`[uploadToBucket:${bucket}] storage error:`, upErr.message);
    // Messages frequents pour aider le user a comprendre :
    if (/bucket.*not.*found/i.test(upErr.message)) {
      throw new Error(`Bucket "${bucket}" introuvable dans Supabase Storage. Cree-le dans Studio.`);
    }
    if (/row.level.security|new.row.violates|permission|denied/i.test(upErr.message)) {
      throw new Error(`Permission refusee sur "${bucket}". Verifie la policy Storage dans Supabase Studio (INSERT pour anon).`);
    }
    throw new Error(upErr.message);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
  if (!data?.publicUrl) throw new Error('URL publique non recuperee (bucket en private ?)');
  return data.publicUrl;
}

export async function uploadProductImage(file) {
  try {
    return await uploadToBucket('product-images', file, { maxDim: 800, prefix: 'product' });
  } catch (e) {
    console.error('[uploadProductImage]', e.message);
    return null; // back-compat : on retourne null si erreur, le caller affiche un toast generique
  }
}

// Variante qui throw au lieu de null : pour les callers qui veulent afficher l'erreur exacte.
export async function uploadProductImageOrThrow(file) {
  return uploadToBucket('product-images', file, { maxDim: 800, prefix: 'product' });
}

export async function uploadBannerImage(file) {
  // Throw directement : le caller (BannersSection) gere le toast d'erreur avec le vrai message.
  return uploadToBucket('banner-images', file, { maxDim: 1200, prefix: 'banner' });
}

export async function compressImage(file, maxDim = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════
// BANNIÈRES — AVEC CACHE
// ═══════════════════════════════════════════════

export async function getActiveBanners() {
  return cachedFetch('active_banners', async () => {
    const now = new Date().toISOString();
    const { data } = await supabase.from('banners').select('*').eq('active', true)
      .or(`end_date.is.null,end_date.gt.${now}`)
      .lte('start_date', now).order('display_order', { ascending: true });
    return data || [];
  }, { ttl: 3 * 60 * 1000 }); // 3 min, banners changent rarement
}

export async function getAllBanners() {
  return cachedFetch('all_banners', async () => {
    const { data } = await supabase.from('banners').select('*').order('display_order', { ascending: true });
    return data || [];
  }, { ttl: 2 * 60 * 1000 });
}

export async function createBanner(banner) {
  const { data, error } = await supabase.from('banners').insert(banner).select().single();
  invalidateCache('all_banners');
  invalidateCache('active_banners');
  return error ? null : data;
}

export async function updateBanner(id, updates) {
  invalidateCache('all_banners');
  invalidateCache('active_banners');
  return supabase.from('banners').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function deleteBanner(id) {
  invalidateCache('all_banners');
  invalidateCache('active_banners');
  return supabase.from('banners').delete().eq('id', id);
}

export async function incrementBannerClick(id) {
  // PERF : RPC atomique côté DB (1 query au lieu de SELECT + UPDATE).
  // Évite aussi les race conditions si 2 users cliquent en même temps.
  // Fallback : si RPC pas encore déployée, fait l'ancien pattern.
  try {
    const { error } = await supabase.rpc('increment_banner_click', { banner_id: id });
    if (!error) return;
  } catch { /* fallback */ }

  // Fallback (ancien pattern) si la RPC n'existe pas encore
  const { data: current } = await supabase.from('banners').select('click_count').eq('id', id).single();
  if (current) {
    await supabase.from('banners').update({ click_count: (current.click_count || 0) + 1 }).eq('id', id);
  }
}

// ═══════════════════════════════════════════════
// PHARMACIE
// ═══════════════════════════════════════════════

// Reset le PIN d'une pharmacie via RPC server-side qui verifie que le caller
// est un admin actif (super_admin ou admin).
// Cf migration SQL : create function admin_set_pharmacy_pin(p_admin_id uuid, p_pharmacy_id text, p_new_pin text)
export async function adminSetPharmacyPin(adminId, pharmacyId, newPin) {
  if (!adminId) return { success: false, error: 'Session admin invalide' };
  if (!newPin || newPin.length < 4) return { success: false, error: 'PIN trop court (4 chiffres min)' };
  const { data, error } = await supabase.rpc('admin_set_pharmacy_pin', {
    p_admin_id: adminId,
    p_pharmacy_id: String(pharmacyId),
    p_new_pin: String(newPin),
  });
  if (error) {
    console.error('[adminSetPharmacyPin] RPC error:', error.message);
    return { success: false, error: error.message };
  }
  return data || { success: false, error: 'Reponse vide' };
}

export async function pharmacyLogin(pharmacyId, pin) {
  // Vague 9 RLS : on appelle pharma_start_session qui (a) valide le PIN via
  // verify_pharmacy_pin et (b) emet un token signe cote serveur. Le token
  // est stocke ici en sessionStorage et utilise par les futures RPCs pharma_*.
  const { data, error } = await supabase.rpc('pharma_start_session', {
    p_pharmacy_id: String(pharmacyId),
    p_pin: pin,
    p_user_agent: (typeof navigator !== 'undefined' ? navigator.userAgent : null),
  });

  if (error) {
    if (String(error.message).includes('invalid_credentials')) {
      return { success: false, error: 'PIN incorrect ou pharmacie inactive' };
    }
    console.error('[pharmacyLogin] RPC error:', error.message);
    return { success: false, error: 'Erreur serveur (RPC indisponible ?)' };
  }
  if (!data || !data.token) {
    return { success: false, error: 'PIN incorrect ou pharmacie inactive' };
  }

  // Stocke le token en sessionStorage pour que les wrappers pharmaApi.js le retrouvent
  try {
    sessionStorage.setItem('yaram-pharma-token', data.token);
  } catch { /* ignore */ }

  // Compat : on garde le shape { success, pharmacy } pour ne pas casser l'existant
  return { success: true, pharmacy: data.pharmacy, token: data.token };
}

export function getPharmaToken() {
  try {
    return sessionStorage.getItem('yaram-pharma-token') || null;
  } catch { return null; }
}

export async function pharmacyLogout() {
  const token = getPharmaToken();
  if (token) {
    try { await supabase.rpc('pharma_end_session', { p_token: token }); } catch { /* ignore */ }
    try { sessionStorage.removeItem('yaram-pharma-token'); } catch { /* ignore */ }
  }
}

// setPharmacyPin retiree : la colonne pin n'est plus updatable directement par anon.
// Utiliser :
//   - public.pharma_change_pin(pharmacy_id, old_pin, new_pin) cote pharma
//   - public.admin_set_pharmacy_pin(admin_id, pharmacy_id, new_pin) cote admin
// (les deux sont SECURITY DEFINER et valident l'identite avant d'updater)

export async function getPharmacyOrders(pharmacyId, status = null) {
  // Vague 9 RLS : on passe par pharma_list_orders (SECURITY DEFINER, requiert token).
  // La RPC fait le filtrage cote serveur (assigned_pharmacy_id OU items contient pharmacyId).
  const token = getPharmaToken();
  if (!token) {
    console.warn('[getPharmacyOrders] pas de token pharma — session expiree ?');
    return [];
  }
  // Si status est un array, on appelle 1 fois sans filter (limite cote RPC = 500)
  // puis on filtre cote client. C'est rare (utilise dans Pharma.jsx pour ['paid','preparing']).
  if (Array.isArray(status)) {
    const { data } = await supabase.rpc('pharma_list_orders', { p_token: token, p_status: null });
    return (data || []).filter(o => status.includes(o.status));
  }
  const { data } = await supabase.rpc('pharma_list_orders', {
    p_token: token,
    p_status: status || null,
  });
  // pharmacyId param ignore : la RPC connait deja le pharmacyId via le token.
  return data || [];
}

// Vague 9.5 : ces 3 fonctions passent par pharma_update_order (SECURITY DEFINER,
// requiert token pharma, verifie que la commande appartient bien a la pharmacie).
export async function acceptOrder(orderId, _pharmacyId) {
  const token = getPharmaToken();
  if (!token) return { error: { message: 'Session pharma expirée' } };
  return supabase.rpc('pharma_update_order', {
    p_token: token, p_order_id: orderId, p_action: 'accept',
  });
}

export async function refuseOrder(orderId, reason) {
  const token = getPharmaToken();
  if (!token) return { error: { message: 'Session pharma expirée' } };
  return supabase.rpc('pharma_update_order', {
    p_token: token, p_order_id: orderId, p_action: 'refuse', p_reason: reason,
  });
}

export async function markOrderReady(orderId) {
  const token = getPharmaToken();
  if (!token) return { error: { message: 'Session pharma expirée' } };
  return supabase.rpc('pharma_update_order', {
    p_token: token, p_order_id: orderId, p_action: 'ready',
  });
}

export async function getPharmacyCommissions(_pharmacyId) {
  // Vague 9.5 : tout est aggrege cote serveur par pharma_get_commissions.
  // pharmacyId param ignore (la RPC connait deja le pharmacyId via le token).
  const token = getPharmaToken();
  if (!token) return {
    orders: [], totalRevenue: 0, totalCommission: 0, totalNet: 0,
    monthOrders: [], monthRevenue: 0, monthCommission: 0, monthNet: 0, payments: [],
  };
  const { data } = await supabase.rpc('pharma_get_commissions', { p_token: token });
  if (!data) return {
    orders: [], totalRevenue: 0, totalCommission: 0, totalNet: 0,
    monthOrders: [], monthRevenue: 0, monthCommission: 0, monthNet: 0, payments: [],
  };

  const enrichedOrders = data.orders || [];
  const totalRevenue    = enrichedOrders.reduce((s, o) => s + (Number(o.pharmacy_revenue)    || 0), 0);
  const totalCommission = enrichedOrders.reduce((s, o) => s + (Number(o.pharmacy_commission) || 0), 0);
  const totalNet        = enrichedOrders.reduce((s, o) => s + (Number(o.pharmacy_net)        || 0), 0);

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthOrders = enrichedOrders.filter(o => new Date(o.created_at) >= firstDay);
  const monthRevenue    = monthOrders.reduce((s, o) => s + (Number(o.pharmacy_revenue)    || 0), 0);
  const monthCommission = monthOrders.reduce((s, o) => s + (Number(o.pharmacy_commission) || 0), 0);
  const monthNet        = monthOrders.reduce((s, o) => s + (Number(o.pharmacy_net)        || 0), 0);

  return {
    orders: enrichedOrders, totalRevenue, totalCommission, totalNet,
    monthOrders, monthRevenue, monthCommission, monthNet,
    payments: data.payments || [],
  };
}

export async function getPharmacyStats(pharmacyId) {
  // Vague 9.5 : compteurs orders via RPC pharma_get_stats (SECURITY DEFINER).
  // Le count des produits actifs reste un SELECT direct (products SELECT public).
  const token = getPharmaToken();
  const statsRpc = token
    ? (await supabase.rpc('pharma_get_stats', { p_token: token })).data
    : null;

  const { data: products } = await supabase.from('products')
    .select('id').eq('submitted_by_pharmacy_id', pharmacyId).eq('status', 'approved');

  return {
    todayOrdersCount:    (statsRpc?.today_pending || 0) + (statsRpc?.today_preparing || 0) + (statsRpc?.today_delivered || 0),
    pendingCount:        statsRpc?.today_pending   || 0,
    preparingCount:      statsRpc?.today_preparing || 0,
    deliveredTodayCount: statsRpc?.today_delivered || 0,
    todayRevenue:        Number(statsRpc?.today_revenue || 0),
    activeProductsCount: products?.length || 0,
  };
}

// ═══════════════════════════════════════════════
// LOYALTY (programme fidélité)
// ═══════════════════════════════════════════════

export async function getMyLoyalty(userId) {
  const { data } = await supabase.from('users_profile')
    .select('loyalty_points, loyalty_total_earned, loyalty_tier').eq('id', userId).single();
  return data || { loyalty_points: 0, loyalty_total_earned: 0, loyalty_tier: 'bronze' };
}

export async function getLoyaltyTransactions(userId, limit = 50) {
  const { data } = await supabase.from('loyalty_transactions').select('*')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

export async function earnLoyaltyPoints(userId, amount, orderId = null) {
  const points = Math.floor(amount);
  const { error } = await supabase.rpc('add_loyalty_points', {
    p_user_id: userId, p_points: points, p_type: 'earn',
    p_reason: `Achat ${orderId || ''}`, p_order_id: orderId,
  });
  return !error;
}

export async function spendLoyaltyPoints(userId, points, reason = 'Réduction') {
  const my = await getMyLoyalty(userId);
  if (my.loyalty_points < points) return { success: false, error: 'Solde insuffisant' };
  const { error } = await supabase.rpc('add_loyalty_points', {
    p_user_id: userId, p_points: -points, p_type: 'spend', p_reason: reason,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function bonusLoyaltyPoints(userId, points, reason) {
  const { error } = await supabase.rpc('add_loyalty_points', {
    p_user_id: userId, p_points: points, p_type: 'bonus', p_reason: reason,
  });
  return !error;
}

export function pointsToFcfa(points) { return Math.floor(points / 100) * 1000; }
export function fcfaToPoints(fcfa) { return Math.floor(fcfa / 1000) * 100; }
export function getTierInfo(tier) {
  if (tier === 'gold') return { label: 'Or 🥇', color: '#F4B53A', emoji: '🥇' };
  if (tier === 'silver') return { label: 'Argent 🥈', color: '#9B9B9B', emoji: '🥈' };
  return { label: 'Bronze 🥉', color: '#CD7F32', emoji: '🥉' };
}

// ═══════════════════════════════════════════════
// PROMOS / PARRAINAGE
// ═══════════════════════════════════════════════

export async function validatePromoCode(code, userId, orderTotal = 0) {
  if (!code) return { valid: false, error: 'Code requis' };
  const { data: promo } = await supabase.from('promo_codes').select('*')
    .eq('code', code.toUpperCase()).eq('active', true).maybeSingle();
  if (!promo) return { valid: false, error: 'Code invalide' };
  const now = new Date();
  if (promo.expires_at && new Date(promo.expires_at) < now) return { valid: false, error: 'Code expiré' };
  if (promo.starts_at && new Date(promo.starts_at) > now) return { valid: false, error: 'Code pas encore actif' };
  if (promo.max_uses && promo.uses_count >= promo.max_uses) return { valid: false, error: 'Code épuisé' };
  if (promo.min_order && orderTotal < promo.min_order) {
    return { valid: false, error: `Minimum ${promo.min_order.toLocaleString('fr-FR')} FCFA requis` };
  }
  if (userId && promo.per_user_limit) {
    const { count } = await supabase.from('promo_uses')
      .select('id', { count: 'exact', head: true }).eq('promo_id', promo.id).eq('user_id', userId);
    if (count >= promo.per_user_limit) return { valid: false, error: 'Tu as déjà utilisé ce code' };
  }
  let discount = 0;
  if (promo.type === 'percent') discount = Math.floor((orderTotal * promo.value) / 100);
  else if (promo.type === 'fixed') discount = Math.min(promo.value, orderTotal);
  else if (promo.type === 'free_shipping') discount = 1000;
  return { valid: true, promo, discount };
}

export async function applyPromoCode(promoId, userId, orderId, discount) {
  const { error } = await supabase.from('promo_uses').insert({
    promo_id: promoId, user_id: userId, order_id: orderId, discount_amount: discount,
  });
  if (error) return false;
  // Vague 6 RLS : UPDATE direct sur promo_codes bloque pour anon.
  // On passe par la RPC dediee qui incremente le compteur en SECURITY DEFINER.
  await supabase.rpc('increment_promo_uses', { p_promo_id: promoId });
  return true;
}

export async function getOrCreateReferralCode(userId) {
  const { data } = await supabase.from('users_profile')
    .select('referral_code').eq('id', userId).single();
  if (data?.referral_code) return data.referral_code;
  const { data: result, error } = await supabase.rpc('generate_referral_code', { p_user_id: userId });
  if (error) return null;
  return result;
}

export async function applyReferralCode(referredUserId, referralCode) {
  // Phase 2 RLS : on passe par la RPC resolve_referral_code (SECURITY DEFINER)
  // au lieu de lire users_profile par code (anon n'aura plus ce droit).
  const { data: referrer } = await supabase.rpc('resolve_referral_code', {
    p_code: referralCode.toUpperCase(),
  });
  if (!referrer) return { success: false, error: 'Code parrainage invalide' };
  if (referrer.id === referredUserId) return { success: false, error: 'Tu ne peux pas te parrainer toi-même' };

  // Lecture du propre profil OK car policy "users see own profile" via auth.uid()
  const { data: me } = await supabase.from('users_profile')
    .select('referred_by').eq('id', referredUserId).single();
  if (me?.referred_by) return { success: false, error: 'Tu as déjà été parrainée' };

  // PERF : 3 mutations en parallèle au lieu de séquentielles
  // (3 round-trips → 1 round-trip = gain 600ms sur 3G)
  await Promise.all([
    supabase.from('users_profile').update({ referred_by: referrer.id }).eq('id', referredUserId),
    supabase.rpc('add_loyalty_points', {
      p_user_id: referredUserId, p_points: 500, p_type: 'bonus',
      p_reason: `Bonus inscription via ${referrer.first_name}`,
    }),
    supabase.rpc('add_loyalty_points', {
      p_user_id: referrer.id, p_points: 500, p_type: 'bonus', p_reason: `Bonus parrainage`,
    }),
  ]);
  return { success: true, referrer };
}

export async function getReferralStats(userId) {
  // Phase 2 RLS : passe par la RPC my_referrals (SECURITY DEFINER)
  const { data } = await supabase.rpc('my_referrals', { p_user_id: userId });
  const count = data?.count || 0;
  const list  = Array.isArray(data?.list) ? data.list : [];
  return {
    count,
    list,
    bonusEarned: count * 500,
  };
}

// ═══════════════════════════════════════════════
// PUSH NOTIFICATIONS (existant, conserve)
// ═══════════════════════════════════════════════

const VAPID_PUBLIC_KEY = 'BNxe7DjGiK8jp_LdEKgZbI3oFG9p_X0wmKHHfsXOlVHwBE3FB_pIRgFb_VxkN1xnzPxRzz0w8hYqYnFw7yWEpQk';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function getNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function subscribeToPush(userId) {
  if (!isPushSupported()) return { success: false, error: 'Pas supporté' };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { success: false, error: 'Permission refusée' };
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const sub = subscription.toJSON();
    await supabase.from('push_subscriptions').upsert({
      user_id: userId, endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh, auth: sub.keys.auth,
      user_agent: navigator.userAgent, enabled: true,
    }, { onConflict: 'endpoint' });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function unsubscribeFromPush(userId) {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    }
    return true;
  } catch { return false; }
}

export async function showLocalNotification(title, body, options = {}) {
  if (!isPushSupported() || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body, icon: '/icon-192.png', badge: '/icon-96.png',
    vibrate: [200, 100, 200], ...options,
  });
}

export async function getNotifications(userId, limit = 50) {
  const { data } = await supabase.from('notifications').select('*')
    .eq('user_id', userId).order('sent_at', { ascending: false }).limit(limit);
  return data || [];
}

export async function getUnreadCount(userId) {
  const { count } = await supabase.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('read', false);
  return count || 0;
}

// markNotificationRead + markAllNotificationsRead : versions RPC plus bas dans
// le fichier (utilisent count_unread_notifications/mark_*_read SECURITY DEFINER).
// Les anciennes versions update direct ont été supprimées pour éviter la
// duplication d'export (qui bloquait le build Vite/Rolldown).

export async function createNotification({ userId, title, body, url, type = 'info' }) {
  return supabase.from('notifications').insert({
    user_id: userId, title, body, url, type,
  });
}

export function scheduleSkinRoutineReminders(morningTime, eveningTime) {
  localStorage.setItem('yaram-routine-morning', morningTime || '');
  localStorage.setItem('yaram-routine-evening', eveningTime || '');
  startRoutineReminderCheck();
}

let reminderInterval = null;
function startRoutineReminderCheck() {
  if (reminderInterval) clearInterval(reminderInterval);
  reminderInterval = setInterval(() => {
    if (Notification.permission !== 'granted') return;
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const morning = localStorage.getItem('yaram-routine-morning');
    const evening = localStorage.getItem('yaram-routine-evening');
    const lastNotif = localStorage.getItem('yaram-last-reminder');
    const today = now.toDateString();
    if (morning && currentTime === morning && lastNotif !== `${today}-morning`) {
      showLocalNotification('☀️ Routine matin', 'C\'est l\'heure de ta routine matinale !');
      localStorage.setItem('yaram-last-reminder', `${today}-morning`);
    }
    if (evening && currentTime === evening && lastNotif !== `${today}-evening`) {
      showLocalNotification('🌙 Routine soir', 'C\'est l\'heure de ta routine du soir !');
      localStorage.setItem('yaram-last-reminder', `${today}-evening`);
    }
  }, 60000);
}

// ═══════════════════════════════════════════════
// REVIEWS
// ═══════════════════════════════════════════════

export async function getProductReviews(productId) {
  const { data } = await supabase.from('reviews').select('*')
    .eq('product_id', productId).eq('status', 'approved')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function createReview({ productId, userId, userName, rating, title, comment, photoUrls = [] }) {
  const { data: existing } = await supabase.from('reviews').select('id')
    .eq('product_id', productId).eq('user_id', userId).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('reviews').update({ rating, title, comment, photo_urls: photoUrls }).eq('id', existing.id);
    return !error;
  }
  const { error } = await supabase.from('reviews').insert({
    product_id: productId, user_id: userId, user_name: userName,
    rating, title, comment, photo_urls: photoUrls, verified_purchase: true,
  });
  return !error;
}

export async function uploadReviewPhoto(file) {
  const fileName = `review_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
  const compressed = await compressImage(file, 800, 0.85);
  const { error } = await supabase.storage.from('review-photos').upload(fileName, compressed, {
    contentType: 'image/jpeg', upsert: true,
  });
  if (error) { console.error('uploadReviewPhoto error:', error); return null; }
  const { data } = supabase.storage.from('review-photos').getPublicUrl(fileName);
  return data.publicUrl;
}

export async function markReviewHelpful(reviewId) {
  // PERF : RPC atomique (1 query au lieu de SELECT + UPDATE)
  // + race-safe si 2 users tapent "utile" en simultané.
  try {
    const { error } = await supabase.rpc('increment_review_helpful', { review_id: reviewId });
    if (!error) return;
  } catch { /* fallback */ }

  // Fallback si RPC pas encore déployée
  const { data } = await supabase.from('reviews').select('helpful_count').eq('id', reviewId).single();
  if (data) {
    await supabase.from('reviews').update({ helpful_count: (data.helpful_count || 0) + 1 }).eq('id', reviewId);
  }
}

export async function reportReview(reviewId) {
  await supabase.from('reviews').update({ reported: true }).eq('id', reviewId);
}

export async function getReviewStats(productId) {
  const reviews = await getProductReviews(productId);
  if (reviews.length === 0) return { avg: 0, total: 0, distribution: [0, 0, 0, 0, 0] };
  const sum = reviews.reduce((s, r) => s + r.rating, 0);
  const avg = sum / reviews.length;
  const distribution = [0, 0, 0, 0, 0];
  reviews.forEach(r => { if (r.rating >= 1 && r.rating <= 5) distribution[r.rating - 1]++; });
  return { avg, total: reviews.length, distribution };
}

export async function respondToReview(reviewId, response) {
  return supabase.from('reviews').update({
    pharmacy_response: response,
    pharmacy_responded_at: new Date().toISOString(),
  }).eq('id', reviewId);
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS — list, mark as read, count unread
// ═══════════════════════════════════════════════════════════════════

export async function getMyNotifications(limit = 50) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, icon, url, type, read, sent_at')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[notifs] getMy error:', error.message);
    return [];
  }
  return data || [];
}

export async function getUnreadNotificationsCount() {
  try {
    const { data, error } = await supabase.rpc('count_unread_notifications');
    if (error) return 0;
    return Number(data) || 0;
  } catch { return 0; }
}

export async function markAllNotificationsRead() {
  try {
    const { data, error } = await supabase.rpc('mark_all_notifications_read');
    if (error) return 0;
    return Number(data) || 0;
  } catch { return 0; }
}

export async function markNotificationRead(notificationId) {
  try {
    const { data, error } = await supabase.rpc('mark_notification_read', {
      p_notification_id: notificationId,
    });
    if (error) return false;
    return !!data;
  } catch { return false; }
}

// Real-time subscription : appelle onUpdate(count) à chaque INSERT/UPDATE
// sur la table notifications du user courant. Retourne unsubscribe.
export function subscribeNotificationsCount(userId, onUpdate) {
  if (!userId) return () => {};
  const channel = supabase
    .channel(`notif-count-${userId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, async () => {
      try {
        const c = await getUnreadNotificationsCount();
        onUpdate(c);
      } catch { /* ignore */ }
    })
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}
