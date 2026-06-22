// ════════════════════════════════════════════════════════════════
// YARAM — Hooks queries (TanStack Query)
// ════════════════════════════════════════════════════════════════
//
// Couche unifiée pour TOUTES les lectures Supabase. Chaque hook :
//   - retourne { data, isLoading, isFetching, isStale, error, refetch }
//   - cache mémoire 5 min via defaultOptions
//   - persiste 24h en IndexedDB (transparent)
//   - se révalide automatiquement au focus + reconnexion
//   - optimistic-friendly via useQueryClient().setQueryData(...)
//
// Pattern naming :
//   QUERY_KEYS.home = ['home']
//   QUERY_KEYS.product(id) = ['product', id]
//   QUERY_KEYS.orders(userId) = ['orders', userId]
// ════════════════════════════════════════════════════════════════

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase, getAllProducts, getAllBrands, getAllCategories, getAllBanners, getAllPharmacies, getProductCategorySlugs } from './supabase';
import { getHomePayload } from './supabase/homePayload';
import { getMyOrders } from './supabase/orders';
import { getMyFavorites, toggleFavorite } from './supabase/favorites';

// ─── Cle namespace ─────────────────────────────────────────
export const QUERY_KEYS = {
  home:        ['home'],
  homePayload: ['home', 'payload'],
  products:    ['products', 'list'],
  product:     (id) => ['product', id],
  brands:      ['brands', 'list'],
  categories:  ['categories', 'list'],
  categorySlugs: ['products', 'categorySlugs'],
  banners:     ['banners', 'list'],
  pharmacies:  ['pharmacies', 'list'],
  orders:      (userId) => ['orders', userId],
  favorites:   (userId) => ['favorites', userId],
  user:        ['user', 'me'],
};

// ════════════════════════════════════════════════════════════════
//  QUERIES (lectures)
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//  FIX juin 2026 #7 — placeholderData partout (CAUSE RACINE BLANCHE)
//
//  3 agents convergents : sans placeholderData, à chaque remount/key
//  change, data devient undefined 1 tick → isLoading=true → si le
//  composant render null/skeleton invisible → page blanche.
//  Avec keepPreviousData : l'UI reste PEUPLÉE pendant le refetch.
// ════════════════════════════════════════════════════════════════

/**
 * Le Home payload en 1 seule RPC : categories + brands + banners + promos.
 */
export function useHomePayload() {
  return useQuery({
    queryKey: QUERY_KEYS.homePayload,
    queryFn: getHomePayload,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Tous les produits actifs. Liste à colonnes minimales.
 */
export function useProducts() {
  return useQuery({
    queryKey: QUERY_KEYS.products,
    queryFn: getAllProducts,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Toutes les marques.
 */
export function useBrands() {
  return useQuery({
    queryKey: QUERY_KEYS.brands,
    queryFn: getAllBrands,
    staleTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Toutes les catégories.
 */
export function useCategories() {
  return useQuery({
    queryKey: QUERY_KEYS.categories,
    queryFn: getAllCategories,
    staleTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Bannières actives (filtre par dates côté serveur).
 */
export function useBanners() {
  return useQuery({
    queryKey: QUERY_KEYS.banners,
    queryFn: getAllBanners,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Toutes les pharmacies partenaires.
 */
export function usePharmacies() {
  return useQuery({
    queryKey: QUERY_KEYS.pharmacies,
    queryFn: getAllPharmacies,
    staleTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Slugs catégories des produits (pour le count par catégorie sur Categories.jsx).
 * FIX juin 2026 : exposé via TanStack pour que Categories.jsx bénéficie
 * de keepPreviousData (plus de skeletons au remount).
 */
export function useProductCategorySlugs() {
  return useQuery({
    queryKey: QUERY_KEYS.categorySlugs,
    queryFn: getProductCategorySlugs,
    staleTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Les commandes de l'utilisateur connecté.
 * Ne fetch QUE si userId fourni.
 *
 * FIX juin 2026 : skeletons figés au retour navigation.
 *   • placeholderData: keepPreviousData → garde l'ancien data pendant
 *     le refetch silencieux, évite l'état isLoading=true au remount.
 *   • refetchOnMount: 'always' → refetch garanti même si stale<60s.
 *   • Si user?.id devient brièvement undefined au remount (race avec
 *     useUser context reset), keepPreviousData garde l'UI peuplée
 *     au lieu d'afficher le skeleton.
 */
export function useMyOrders(userId) {
  return useQuery({
    queryKey: QUERY_KEYS.orders(userId),
    queryFn: getMyOrders,
    enabled: !!userId,
    // Les commandes changent vite (status updates) → stale 1 min
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}

/**
 * Les favoris de l'utilisateur.
 * userId optionnel : si fourni, scope la cache key par user (multi-account safe).
 * Sinon utilise 'me' (la session courante dans Supabase client résout l'user).
 *
 * FIX juin 2026 : même problème de skeletons figés → même fix.
 */
export function useMyFavorites(userId = 'me') {
  return useQuery({
    queryKey: QUERY_KEYS.favorites(userId),
    queryFn: getMyFavorites,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}

// ════════════════════════════════════════════════════════════════
//  MUTATIONS (écritures avec optimistic update)
// ════════════════════════════════════════════════════════════════

/**
 * Toggle favori avec optimistic update.
 *
 * Comportement :
 *   1. User clique → on bascule l'état dans le cache immédiatement
 *   2. La requête Supabase part en arrière-plan
 *   3. Si elle échoue → rollback automatique + toast erreur côté caller
 */
export function useToggleFavorite(userId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId) => toggleFavorite(productId),

    onMutate: async (productId) => {
      // 1) Stop les fetches en cours pour pas écraser notre optimistic
      await qc.cancelQueries({ queryKey: QUERY_KEYS.favorites(userId) });

      // 2) Snapshot l'état actuel pour rollback en cas d'erreur
      const previous = qc.getQueryData(QUERY_KEYS.favorites(userId));

      // 3) Optimistic : on bascule localement avant le serveur
      qc.setQueryData(QUERY_KEYS.favorites(userId), (old) => {
        const list = Array.isArray(old) ? old : [];
        const exists = list.some(f => f.product_id === productId);
        if (exists) return list.filter(f => f.product_id !== productId);
        return [...list, { product_id: productId, created_at: new Date().toISOString() }];
      });

      return { previous };
    },

    onError: (err, productId, context) => {
      // Rollback
      if (context?.previous) {
        qc.setQueryData(QUERY_KEYS.favorites(userId), context.previous);
      }
    },

    onSettled: () => {
      // Re-sync avec le serveur quand la requête termine
      qc.invalidateQueries({ queryKey: QUERY_KEYS.favorites(userId) });
    },
  });
}

// ════════════════════════════════════════════════════════════════
//  HELPERS d'invalidation
// ════════════════════════════════════════════════════════════════

/** Invalide tout le payload Home (utile après update admin) */
export function invalidateHome(qc) {
  qc.invalidateQueries({ queryKey: QUERY_KEYS.home });
  qc.invalidateQueries({ queryKey: QUERY_KEYS.products });
  qc.invalidateQueries({ queryKey: QUERY_KEYS.brands });
  qc.invalidateQueries({ queryKey: QUERY_KEYS.banners });
}

/** Invalide les commandes après un nouvel ordre */
export function invalidateOrders(qc, userId) {
  qc.invalidateQueries({ queryKey: QUERY_KEYS.orders(userId) });
}
