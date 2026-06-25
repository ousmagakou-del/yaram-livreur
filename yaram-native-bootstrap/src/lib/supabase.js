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
  // SELECT calque sur le vrai schéma admin (audit confirmé) — colonnes garanties uniquement
  // Stratégie : SELECT * pour ne JAMAIS crash sur une colonne manquante.
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('active', true)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error('[getAllProducts]', error.message);
    // Fallback : sans le filtre status si la colonne n'existe pas
    const { data: dataFb } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(500);
    return normalizeProducts(dataFb || []);
  }
  return normalizeProducts(data || []);
}

function normalizeProducts(rows) {
  const norm = rows.map((p) => ({
    ...p,
    image_url: p.image_url || p.img || null,
    img: p.img || p.image_url || null,
    // Garantit des défauts safe
    rating: p.rating || 0,
    review_count: p.review_count || 0,
    score: p.score || 0,
    badges: Array.isArray(p.badges) ? p.badges : [],
  }));
  console.log('[getAllProducts] →', norm.length, 'products');
  return norm;
}

export async function getAllBrands() {
  // ⚠️ Schéma réel DB : id, name, tagline, story, img, city, country, local, rating, product_count
  // Pas de colonne logo_url ! On utilise seulement img.
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, img, country, city, tagline, story, local, rating, product_count')
    .order('name');
  if (error) {
    console.warn('[getAllBrands]', error.message);
    return [];
  }
  console.log('[getAllBrands] →', data?.length, 'brands');
  return data || [];
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

// ═══ Top brands sur Home : 16 marques avec img > marques locales > 12 max ═══
export async function getTopBrands() {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, img, country, local, product_count')
    .order('local', { ascending: false })
    .order('product_count', { ascending: false, nullsFirst: false })
    .limit(30);
  if (error) {
    console.warn('[getTopBrands]', error.message);
    return [];
  }
  // Priorité aux marques avec img (16 réelles en DB)
  return (data || []).sort((a, b) => (b.img ? 1 : 0) - (a.img ? 1 : 0)).slice(0, 12);
}

export async function getAllPharmacies() {
  const { data, error } = await supabase
    .from('pharmacies')
    .select('id, name, tagline, city, neighborhood, address, lat, lng, phone, whatsapp, hours, delivery_hours, logo, cover, rating, review_count, description')
    .eq('active', true);
  if (error) console.warn('[getAllPharmacies]', error.message);
  // Normalise pour rétro-compat composants existants (logo_url + opening_hours)
  return (data || []).map((p) => ({
    ...p,
    logo_url: p.logo,
    cover_url: p.cover,
    opening_hours: p.hours,
    latitude: p.lat,
    longitude: p.lng,
  }));
}

// ═══ Produits d'une pharmacie spécifique (via submitted_by_pharmacy_id) ═══
//    SELECT * pour ne JAMAIS rater une colonne (category essentiel pour chips)
//    Limit 2000 pour grosses pharmacies (893 produits actuellement OK)
export async function getProductsByPharmacy(pharmacyId, { limit = 2000 } = {}) {
  if (!pharmacyId) return [];
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('submitted_by_pharmacy_id', pharmacyId)
    .eq('active', true)
    .order('score', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.warn('[getProductsByPharmacy]', error.message);
    return [];
  }
  // Normalise img pour PremiumProductTile (qui s'attend à img ou image_url)
  return (data || []).map((p) => ({ ...p, img: p.image_url || p.img }));
}

// ═══ Count produits d'une pharmacie (rapide, pour stats) ═══
export async function getPharmacyProductCount(pharmacyId) {
  if (!pharmacyId) return 0;
  const { count, error } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('submitted_by_pharmacy_id', pharmacyId)
    .eq('active', true);
  if (error) {
    console.warn('[getPharmacyProductCount]', error.message);
    return 0;
  }
  return count || 0;
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
