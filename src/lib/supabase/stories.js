// ═══ Admin web : CRUD stories ═══

import { supabase } from './client';

// ─── Admin : list all (active + inactive + expired) ─────────
export async function getAllStoriesAdmin() {
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) { console.warn('[stories] list error:', error.message); return []; }
  return data || [];
}

// ─── Create ─────────
export async function createStory(payload) {
  const { data, error } = await supabase.from('stories').insert(payload).select().single();
  if (error) throw error;
  return data;
}

// ─── Update ─────────
export async function updateStory(id, patch) {
  const { data, error } = await supabase.from('stories').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ─── Delete ─────────
export async function deleteStory(id) {
  const { error } = await supabase.from('stories').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ─── Upload media (image/video) ─────────
export async function uploadStoryMedia(file) {
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('stories-media')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from('stories-media').getPublicUrl(path);
  return publicUrl;
}

// ─── Stats (combien de vues) ─────────
export async function getStoryViewsCount(storyId) {
  const { count, error } = await supabase
    .from('story_views')
    .select('id', { count: 'exact', head: true })
    .eq('story_id', storyId);
  if (error) return 0;
  return count || 0;
}
