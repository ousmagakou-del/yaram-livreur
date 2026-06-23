// ════════════════════════════════════════════════════════════════
//  YARAM Native — Supabase Client (React Native)
// ════════════════════════════════════════════════════════════════

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const SUPABASE_URL = Constants.expoConfig?.extra?.supabaseUrl;
const SUPABASE_ANON_KEY = Constants.expoConfig?.extra?.supabaseAnonKey;

console.log('[YARAM] Supabase URL:', SUPABASE_URL ? '✓ OK' : '❌ MISSING');
console.log('[YARAM] Supabase Key:', SUPABASE_ANON_KEY ? `✓ OK (${SUPABASE_ANON_KEY.slice(0, 20)}...)` : '❌ MISSING');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[YARAM] Supabase config missing — vérifie app.json -> extra.supabaseUrl/Key');
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

// ═══ Helpers (mêmes signatures que le web pour réutiliser les hooks) ═══

export async function getAllProducts() {
  // Aligne avec src/lib/supabase/products.js cote web (diaara) :
  // colonnes etendues pour permettre a la RN d'afficher la fiche sans
  // refetch. supplier_cost/url EXCLUS (admin-only).
  // image_url canonique, img alias retro-compat.
  const { data, error } = await supabase
    .from('products')
    .select([
      'id', 'name', 'brand', 'price', 'img', 'image_url', 'score', 'rating',
      'review_count', 'category', 'badges', 'status', 'active', 'short_desc',
      // Import / origine
      'is_imported', 'origin_country', 'usage_duration_days', 'lead_time_days',
      // Contenu fiche
      'inci', 'long_desc', 'reason',
      'created_at',
    ].join(', '))
    .eq('active', true)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error('[getAllProducts]', error.message);
    throw error;
  }
  // Normalize image_url <-> img.
  const norm = (data || []).map((p) => ({
    ...p,
    image_url: p.image_url || p.img || null,
    img:       p.img || p.image_url || null,
  }));
  console.log('[getAllProducts] →', norm.length, 'products');
  return norm;
}

export async function getAllBrands() {
  // Calque EXACT web : select '*' avec colonnes img + local + tagline + country
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, img, logo_url, country, city, tagline, story, local')
    .order('name');
  if (error) console.warn('[getAllBrands]', error.message);
  // Normalize : utilise img en priorité (champ web), fallback logo_url
  const norm = (data || []).map((b) => ({ ...b, img: b.img || b.logo_url }));
  console.log('[getAllBrands] →', norm.length, 'brands');
  return norm;
}

export async function getAllCategories() {
  // Calque EXACT web Categories.jsx : select * + active + display_order
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, icon_url, bg_color, text_color, display_order, active')
    .eq('active', true)
    .order('display_order', { ascending: true });
  if (error) console.warn('[getAllCategories]', error.message);
  console.log('[getAllCategories] →', data?.length, 'categories');
  return data || [];
}

// ═══ Top brands sur Home : marques avec img > marques locales > 12 max ═══
export async function getTopBrands() {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, img, logo_url, country, local')
    .order('local', { ascending: false }) // locales en 1er
    .limit(20);
  if (error) return [];
  const norm = (data || []).map((b) => ({ ...b, img: b.img || b.logo_url }));
  // Priorité aux marques avec img
  return norm.sort((a, b) => (b.img ? 1 : 0) - (a.img ? 1 : 0)).slice(0, 12);
}

export async function getAllPharmacies() {
  const { data, error } = await supabase
    .from('pharmacies')
    .select('id, name, slug, address, phone, neighborhood, latitude, longitude, opening_hours, logo_url')
    .eq('active', true);
  if (error) console.warn('[getAllPharmacies]', error.message);
  return data || [];
}

export async function getMyOrders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('session_not_ready');
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, total, subtotal, shipping, payment_method, items, address, created_at, is_preorder, deposit_amount, balance_amount, expected_arrival_date')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function signOut() {
  return supabase.auth.signOut();
}
