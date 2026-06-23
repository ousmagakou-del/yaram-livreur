import { supabase } from './client';
import { cachedFetch } from '../dataCache';

// ═══════════════════════════════════════════════
// PRODUITS & MARQUES — AVEC CACHE
// ═══════════════════════════════════════════════

// PERF : colonnes utilisees par les listes (Home, Search, ProductTile) +
// par la fiche produit RN qui ne refetch pas systematiquement.
//
// HISTORIQUE :
//   - V1 (avant) : select('*') = ~3-4KB par produit
//   - V2          : select trim minimal = ~400 octets  (Home / Search OK)
//   - V3 (2026-06): on rajoute les colonnes manquantes signalees par RN
//                  (image_url, inci, long_desc, reason, is_imported, etc.)
//                  pour que getAllProducts soit utilisable comme source
//                  de verite cote app native sans 2e round-trip.
//
// ⚠️ Toutes ces colonnes existent en DB (cf Product.jsx + admin upsert).
//    Si une colonne manque cote DB, Supabase renvoie une erreur 400 sur
//    tout le SELECT — il faut alors la creer avant de la rajouter ici.
//
// Champ `img` vs `image_url` : la table utilise les DEUX historiquement.
// Canonical = `image_url`. `img` est un alias maintenu pour back-compat
// (utilise par ProductTile, Product.jsx, etc.). On les selecte donc tous
// les deux et on laisse le code consommateur normaliser via
// `p.image_url || p.img`.
// NB : supplier_cost / supplier_url sont volontairement EXCLUS (donnees
// internes margin = admin-only — getAllProducts est public, anon peut le
// caller). Pour l'admin, fetch direct sur la ligne via Product.jsx ou
// admin_list_orders/products.
const PRODUCT_LIST_COLUMNS = [
  'id', 'name', 'brand', 'category', 'score', 'price', 'review_count',
  'rating', 'badges', 'img', 'image_url', 'active', 'created_at',
  // Import / origine
  'is_imported', 'origin_country', 'usage_duration_days', 'lead_time_days',
  // Contenu fiche (RN s'en sert pour rendre la fiche sans 2e fetch)
  'inci', 'long_desc', 'reason',
].join(', ');

export async function getAllProducts() {
  return cachedFetch('all_products', async () => {
    const { data } = await supabase
      .from('products')
      .select(PRODUCT_LIST_COLUMNS)
      .eq('active', true);
    // Normalize : image_url canonique. On garde aussi `img` pour la
    // back-compat (ProductTile, Product.jsx legacy lisent les deux).
    return (data || []).map((p) => ({
      ...p,
      image_url: p.image_url || p.img || null,
      img:       p.img || p.image_url || null,
    }));
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
