// ═══════════════════════════════════════════════
// YARAM — Cache léger pour données Supabase (v6)
// ═══════════════════════════════════════════════
// Stratégie : stale-while-revalidate
//   1. Si data en cache et fresh (<TTL) → renvoie tout de suite
//   2. Si data en cache mais stale → renvoie le stale + fetch en BG
//   3. Si pas de cache → fetch
//
// Cache : Map en mémoire (rapide) + localStorage (persiste après reload)
//
// NOUVEAU EN v6 :
// - Versioning pour purger le cache obsolète après deploy
// - Auto-clean des entrées localStorage trop vieilles (> 7 jours)
// ═══════════════════════════════════════════════

// ⚠️ INCRÉMENTER ce numéro à chaque deploy qui change le format des données
// Ça force la purge du cache localStorage côté client → fini les vieilles données
// v7 : purge les caches vides crees par le bug PRODUCT_LIST_COLUMNS de la 1.0(2)
const CACHE_VERSION = 'v7';

const memCache = new Map(); // { key: { data, time } }

const LS_PREFIX = `yaram_cache_${CACHE_VERSION}_`;
const OLD_PREFIXES = ['yaram_cache_', 'yaram_cache_v5_', 'yaram_cache_v6_']; // À nettoyer

// Default TTL = 5 minutes
const DEFAULT_TTL = 5 * 60 * 1000;
// Hard expiry : on supprime du LS si plus vieux que 7 jours peu importe le TTL
const HARD_EXPIRY = 7 * 24 * 60 * 60 * 1000;

// ─── Cleanup au boot : retire les anciennes versions de cache ───
(function cleanupOldCache() {
  try {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // Anciens prefix → suppression
      if (OLD_PREFIXES.some(p => k.startsWith(p))) {
        toDelete.push(k);
        continue;
      }
      // Notre prefix v6 → vérifie l'expiry dur
      if (k.startsWith(LS_PREFIX)) {
        try {
          const parsed = JSON.parse(localStorage.getItem(k));
          if (parsed && (Date.now() - parsed.time) > HARD_EXPIRY) {
            toDelete.push(k);
          }
        } catch {
          toDelete.push(k); // Corrompu → suppression
        }
      }
    }
    toDelete.forEach(k => localStorage.removeItem(k));
    if (toDelete.length > 0) {
      console.log(`[YARAM cache] Cleaned ${toDelete.length} stale entries`);
    }
  } catch (e) {
    // localStorage indisponible, on s'en moque
  }
})();

/**
 * Wrapper autour d'une fonction async qui ajoute un cache stale-while-revalidate
 */
export async function cachedFetch(key, fetchFn, opts = {}) {
  const ttl = opts.ttl ?? DEFAULT_TTL;
  const persistLS = opts.persistLS !== false;

  // 1. Check memory cache
  const memHit = memCache.get(key);
  if (memHit && (Date.now() - memHit.time) < ttl) {
    return memHit.data;
  }

  // 2. Check localStorage cache
  if (persistLS && !memHit) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (Date.now() - parsed.time) < ttl) {
          memCache.set(key, parsed);
          refreshInBackground(key, fetchFn, persistLS);
          return parsed.data;
        }
      }
    } catch {}
  }

  // 3. Stale-while-revalidate
  if (memHit) {
    refreshInBackground(key, fetchFn, persistLS);
    return memHit.data;
  }

  // 4. Pas de cache → fetch direct
  const data = await fetchFn();
  saveToCache(key, data, persistLS);
  return data;
}

function refreshInBackground(key, fetchFn, persistLS) {
  setTimeout(() => {
    fetchFn().then(data => saveToCache(key, data, persistLS)).catch(() => {});
  }, 100);
}

function saveToCache(key, data, persistLS) {
  const entry = { data, time: Date.now() };
  memCache.set(key, entry);
  if (persistLS) {
    try {
      const json = JSON.stringify(entry);
      if (json.length < 1024 * 1024) {
        localStorage.setItem(LS_PREFIX + key, json);
      }
    } catch (e) {
      // localStorage plein → on tente un cleanup
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(LS_PREFIX)) keys.push(k);
        }
        // Supprime les plus anciens (50%)
        keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => localStorage.removeItem(k));
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
      } catch {}
    }
  }
}

/** Invalide une clé de cache spécifique (après mutation) */
export function invalidateCache(key) {
  memCache.delete(key);
  try { localStorage.removeItem(LS_PREFIX + key); } catch {}
}

/** Vide tout le cache YARAM */
export function clearAllCache() {
  memCache.clear();
  try {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(LS_PREFIX) || OLD_PREFIXES.some(p => k.startsWith(p))) {
        localStorage.removeItem(k);
      }
    });
  } catch {}
}

/** Version sans cache, force fetch frais */
export async function freshFetch(key, fetchFn, opts = {}) {
  const persistLS = opts.persistLS !== false;
  const data = await fetchFn();
  saveToCache(key, data, persistLS);
  return data;
}
