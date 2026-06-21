import { supabase, invalidateCache } from './client';
import { cachedFetch } from '../dataCache';

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
      .select('product_id, products(id, name, brand, price, img, score, rating, review_count, category, badges, is_imported, lead_time_days)')
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

export function invalidateFavoriteIdsCache() {
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
