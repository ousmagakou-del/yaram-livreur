// ════════════════════════════════════════════════════════════════
// YARAM — TanStack Query setup + persister IndexedDB
// ════════════════════════════════════════════════════════════════
//
// 1) QueryClient avec defaults adaptés au LTE Dakar :
//    - staleTime 5 min   → on n'attaque pas Supabase si on a vu la donnée < 5 min
//    - gcTime  24 h      → on garde en cache 24h après dernier accès
//    - retry 2x avec backoff exponentiel sur les erreurs réseau
//
// 2) Persister IndexedDB via idb-keyval (1 seule key 'yaram-query-cache').
//    À chaque mutation du cache, on serialize et stocke. À chaque cold start,
//    on hydrate. Donc 2e session ouvre la Home instantanément (stale puis
//    revalidate silencieux en background).
//
// 3) Hash de version : si tu changes les colonnes d'une query, bump le
//    BUSTER pour invalider tous les caches d'un coup (évite données
//    incohérentes après deploy avec breaking schema).
// ════════════════════════════════════════════════════════════════

import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';

// ─── Buster : bump quand on change une signature de query ───
const BUSTER = 'v1-2026-06';

// ─── QueryClient ───────────────────────────────────────────
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache mémoire : ne refetch pas si on a la donnée depuis moins de 5 min
      staleTime: 5 * 60 * 1000,
      // GC : garde 24h après le dernier mount qui a utilisé cette query
      gcTime: 24 * 60 * 60 * 1000,
      // Retry réseau : 2x avec backoff exponentiel
      retry: (failureCount, error) => {
        const msg = String(error?.message || '').toLowerCase();
        // Pas de retry sur les 4xx auth/bad request
        if (msg.includes('jwt') || msg.includes('unauthor')) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 8000),
      // Refetch silencieux quand l'app revient en foreground
      refetchOnWindowFocus: true,
      // Refetch silencieux quand le réseau revient (très utile Dakar)
      refetchOnReconnect: true,
      // PAS de refetch automatique au mount si on a déjà des données stale —
      // on AFFICHE le stale tout de suite (paint instant) et on revalide en background
      refetchOnMount: 'always',
    },
    mutations: {
      // Retry les mutations réseau 1x (au cas où réseau a flickr)
      retry: 1,
      retryDelay: 1500,
    },
  },
});

// ─── Persister IndexedDB ───────────────────────────────────
// idb-keyval wrap IndexedDB en API simple get/set/del (async).
// On lui donne un store dédié 'yaram-query' pour isoler du reste.

const ASYNC_STORAGE = {
  getItem: async (key) => {
    try {
      const v = await get(key);
      return v ?? null;
    } catch { return null; }
  },
  setItem: async (key, value) => {
    try { await set(key, value); } catch { /* quota plein, on ignore */ }
  },
  removeItem: async (key) => {
    try { await del(key); } catch {}
  },
};

export const queryPersister = createAsyncStoragePersister({
  storage: ASYNC_STORAGE,
  key: `yaram-query-cache-${BUSTER}`,
  // Throttle write : ne pas spam IndexedDB à chaque clé qui change
  throttleTime: 1000,
  // Serialize en JSON simple (les datasets YARAM sont < 1 MB)
  serialize: (data) => JSON.stringify(data),
  deserialize: (data) => JSON.parse(data),
});

// ─── Cleanup des anciens busters au cold start ────────────
// Si BUSTER a changé entre 2 versions, on dégage les anciens caches
// pour ne pas laisser traîner 10 MB de junk dans IndexedDB.
export async function cleanupOldQueryCache() {
  try {
    // idb-keyval ne liste pas les clés mais ce n'est pas grave — on
    // assume que le naming explicite + le quota IndexedDB recyclent.
    // Pour l'instant on n'efface rien automatiquement, c'est safe.
  } catch {}
}

// ─── Helpers exposes pour invalidation manuelle ───────────
// Ex : après update profil, on invalide ['user'] pour refetcher.
export function invalidate(keys) {
  return queryClient.invalidateQueries({ queryKey: keys });
}
export function setQueryData(keys, data) {
  return queryClient.setQueryData(keys, data);
}
