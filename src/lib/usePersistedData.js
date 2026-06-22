// ════════════════════════════════════════════════════════════════
//  YARAM — usePersistedData hook
// ════════════════════════════════════════════════════════════════
//
//  Hook universel pour les pages qui n'utilisent PAS TanStack Query
//  mais ont leur propre fetch via useState + useEffect.
//
//  Sans ce hook, à chaque remount (back navigation, retour foreground
//  même rare), useState repart à null/[] → loading=true → skeleton 1-3s
//  pendant que le fetch tourne. C'est ÇA la "page blanche au retour"
//  que l'user voyait partout.
//
//  Avec ce hook :
//    • Au mount, hydrate IMMÉDIATEMENT depuis un cache module-level
//      si data fraîche dispo (TTL configurable, défaut 5 min)
//    • loading=false dès qu'on a un cache → pas de skeleton
//    • Refresh en arrière-plan systématiquement (données toujours fraîches)
//    • Auto-cache après chaque fetch réussi
//
//  Usage :
//    const { data, loading, refresh, setData } = usePersistedData(
//      'profile-stats-' + userId,
//      async () => fetchStats(userId),
//      { ttl: 5 * 60 * 1000 }
//    );
//
//  Le namespace doit être UNIQUE par scope de données (inclure userId si
//  user-scoped pour éviter le data leak entre comptes).
// ════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from 'react';

// Cache module-level partagé entre tous les composants utilisateurs du hook.
// Map<namespace, { data, ts }>
const _persistedCache = new Map();

/**
 * Invalide un namespace donné (par ex. après une mutation).
 */
export function invalidatePersisted(namespace) {
  _persistedCache.delete(namespace);
}

/**
 * Invalide TOUT (par ex. au logout).
 */
export function invalidateAllPersisted() {
  _persistedCache.clear();
}

/**
 * Récupère la valeur en cache sans hook (utile pour optimistic update).
 */
export function getPersisted(namespace) {
  return _persistedCache.get(namespace)?.data;
}

/**
 * Hook principal.
 * @param {string} namespace - clé unique pour cette data
 * @param {Function} fetcher - async function qui retourne la data
 * @param {Object} options
 * @param {number} options.ttl - durée de fraîcheur en ms (default 5min)
 * @param {boolean} options.enabled - si false, ne fetch pas (utile si user pas prêt)
 * @returns {{ data, loading, error, refresh, setData }}
 */
export function usePersistedData(namespace, fetcher, options = {}) {
  const ttl = options.ttl ?? 5 * 60 * 1000;
  const enabled = options.enabled ?? true;

  // ─── Hydratation initiale depuis le cache ──────────────────
  const cached = _persistedCache.get(namespace);
  const isFresh = cached && (Date.now() - cached.ts) < ttl;
  // On affiche le cache même s'il n'est plus frais (mieux que rien)
  // → l'UI reste peuplée, le refetch arrive en background.
  const initialData = cached?.data ?? null;

  const [data, setDataState] = useState(initialData);
  // loading=true UNIQUEMENT si on n'a aucun cache (vrai cold start).
  // Si on a du cache (même stale), on affiche → loading=false.
  const [loading, setLoading] = useState(initialData === null);
  const [error, setError] = useState(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // ─── setData qui sync le cache ─────────────────────────────
  const setData = useCallback((next) => {
    setDataState(next);
    _persistedCache.set(namespace, { data: next, ts: Date.now() });
  }, [namespace]);

  // ─── Fetch / refresh ───────────────────────────────────────
  const doFetch = useCallback(async (silent = false) => {
    if (!enabled) return;
    try {
      if (!silent && !cached) setLoading(true);
      const result = await fetcherRef.current();
      setDataState(result);
      _persistedCache.set(namespace, { data: result, ts: Date.now() });
      setError(null);
    } catch (e) {
      console.warn(`[usePersistedData ${namespace}]`, e?.message);
      setError(e);
      // En cas d'erreur, on GARDE le cache stale s'il existe
      // → l'UI reste peuplée même si le serveur fail momentanément.
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, enabled]);

  // ─── Effect : revalidate au mount + quand namespace change ─
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    // Si pas de cache OU cache stale → refresh
    if (!isFresh) {
      doFetch(false);
    }
    // Sinon, on a du data frais → pas besoin de refetch immédiat
    // (mais on revalidate quand même en silent pour avoir le plus à jour)
    else {
      doFetch(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, enabled]);

  // ─── FIX iOS juin 2026 : refresh silencieux au pageshow bfcache ─
  // iOS Safari restore les pages depuis bfcache sans firer visibilitychange.
  // Le hook doit refresh ses data dès qu'on revient sur la page.
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onPageShow = (event) => {
      if (event.persisted) {
        // bfcache restore iOS → refresh silencieux
        doFetch(true);
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [enabled, doFetch]);

  // ─── Refresh manuel (ex: pull-to-refresh) ──────────────────
  const refresh = useCallback(() => doFetch(false), [doFetch]);

  return { data, loading, error, refresh, setData };
}
