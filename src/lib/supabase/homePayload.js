// ════════════════════════════════════════════════════════════════
// YARAM — Helper RPC `public_home_payload`
// ════════════════════════════════════════════════════════════════
//
// Récupère en 1 seul appel : categories + brands + banners + promos.
// Au lieu des 4 requêtes séquentielles précédentes (-300ms sur LTE Dakar).
//
// Cache mémoire 60s pour éviter les re-fetch si user navigue Home → autre → Home.
// ════════════════════════════════════════════════════════════════

import { supabase } from './client';

let _cache = null;
let _cacheAt = 0;
const TTL_MS = 60_000;

/**
 * @returns {Promise<{ categories, brands, banners, promos, generated_at }>}
 */
export async function getHomePayload() {
  // Cache mémoire 60s
  if (_cache && (Date.now() - _cacheAt) < TTL_MS) {
    return _cache;
  }

  try {
    const { data, error } = await supabase.rpc('public_home_payload');
    if (error) throw error;
    if (data) {
      _cache = data;
      _cacheAt = Date.now();
      return data;
    }
  } catch (e) {
    console.warn('[getHomePayload] RPC failed:', e?.message);
  }
  // Fallback : valeurs vides — le caller doit avoir un fallback
  return { categories: [], brands: [], banners: [], promos: [] };
}

export function invalidateHomePayload() {
  _cache = null;
  _cacheAt = 0;
}
