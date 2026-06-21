import { supabase } from './client';
import { cachedFetch } from '../dataCache';

// ═══════════════════════════════════════════════
// PRODUITS & MARQUES — AVEC CACHE
// ═══════════════════════════════════════════════

// PERF : colonnes minimales utilisees par les listes (Home, Search, ProductTile).
// La fiche produit (Product.jsx) fetch deja un seul produit avec select('*')
// donc elle aura toutes les infos. Cette liste ne sert qu'aux LISTES.
// Avant : select('*') = ~3-4KB par produit (long_desc, inci, usage, reason...).
// Apres : ~400 octets par produit = ~7x moins de bande passante.
// ⚠️ Toutes ces colonnes ONT ETE verifiees comme existantes (cf Product.jsx +
// admin upsert). Si on rajoute une colonne ici, la verifier d'abord dans la DB.
const PRODUCT_LIST_COLUMNS = 'id, name, brand, category, score, price, review_count, rating, badges, img, active, created_at, is_imported, lead_time_days, origin_country';

export async function getAllProducts() {
  return cachedFetch('all_products', async () => {
    const { data } = await supabase
      .from('products')
      .select(PRODUCT_LIST_COLUMNS)
      .eq('active', true);
    return data || [];
  }, { ttl: 5 * 60 * 1000 }); // 5 min
}

// PERF : ne renvoie que les slugs (1 colonne) pour faire un comptage par categorie.
// Utilise par Categories.jsx — bien plus leger que getAllProducts().
export async function getProductCategorySlugs() {
  return cachedFetch('product_category_slugs', async () => {
    const { data } = await supabase
      .from('products')
      .select('category')
      .eq('active', true);
    return data || [];
  }, { ttl: 5 * 60 * 1000 });
}

export async function getProductAvailability(productId) {
  // ⚠️ pharmacy:pharmacies(*) etait CASSE depuis qu'on a fait le GRANT SELECT
  // (le * expand a TOUTES les colonnes pharmacies, dont `pin` qui est REVOKE
  // pour anon -> Postgres rejette toute la query avec 400).
  // -> on liste explicitement les colonnes safe pour la jointure.
  const PH_COLS = 'id, name, tagline, owner_name, manager_name, city, neighborhood, address, lat, lng, phone, whatsapp, hours, delivery_hours, logo, cover, description, commission, active, rating, review_count, pin_set_at, created_at, updated_at, notification_email, notification_phone';
  const { data, error } = await supabase
    .from('inventory')
    .select(`*, pharmacy:pharmacies(${PH_COLS})`)
    .eq('product_id', productId)
    .gt('stock', 0)
    .eq('active', true);
  if (error) {
    console.warn('[getProductAvailability] error:', error.message);
    return [];
  }
  return data || [];
}
