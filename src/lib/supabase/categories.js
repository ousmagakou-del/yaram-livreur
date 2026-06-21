import { supabase } from './client';
import { cachedFetch } from '../dataCache';

// ═══════════════════════════════════════════════
// CATEGORIES — AVEC CACHE
// ═══════════════════════════════════════════════

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
