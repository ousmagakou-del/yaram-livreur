import { supabase } from './client';
import { cachedFetch } from '../dataCache';

// ═══════════════════════════════════════════════
// MARQUES — AVEC CACHE
// ═══════════════════════════════════════════════

export async function getAllBrands() {
  return cachedFetch('all_brands', async () => {
    const { data } = await supabase.from('brands').select('*');
    return data || [];
  }, { ttl: 10 * 60 * 1000 });
}
