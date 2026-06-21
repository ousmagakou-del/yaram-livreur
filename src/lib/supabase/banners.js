import { supabase, invalidateCache } from './client';
import { cachedFetch } from '../dataCache';

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
