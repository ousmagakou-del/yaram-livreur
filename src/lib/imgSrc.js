// ════════════════════════════════════════════════════════════════
// YARAM — Helper imgSrc(url, opts) pour transformer les URL d'images
// ════════════════════════════════════════════════════════════════
//
// Si Cloudflare Image Resizing est actif sur yaram.app, on prefixe
// les URL Supabase storage public par /cdn-cgi/image/<options> qui
// retourne du WebP/AVIF + resize côté edge.
//
// Sinon retourne l'URL telle quelle (no-op safe).
//
// Usage :
//   <img src={imgSrc(product.img, { w: 400 })} loading="lazy" />
//
// Détection :
//  - Si on est sur yaram.app (prod) ET URL Supabase public storage
//    → on transforme. Sinon on garde l'URL d'origine.
// ════════════════════════════════════════════════════════════════

const SUPABASE_STORAGE_PREFIX = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/';

/**
 * @param {string} url URL d'origine
 * @param {object} [opts]
 * @param {number} [opts.w]   Largeur en px (le navigateur DPR triplera si besoin)
 * @param {number} [opts.q]   Qualité 1-100 (défaut 80)
 * @param {'auto'|'webp'|'avif'} [opts.f] Format (auto = négocie avec Accept)
 */
// ─── Flag d'activation : NO-OP tant que Cloudflare Image Resizing
// n'est pas activé sur yaram.app. Pour l'activer :
//   1. Cloudflare dashboard → yaram.app → Speed → Optimization → Image Resizing → On
//   2. Ajoute VITE_CF_IMAGES_ENABLED=true dans tes env Cloudflare Pages
//   3. Redeploy
// Tant que ce flag n'est pas explicit, on renvoie l'URL d'origine (safe).
const CF_IMAGES_ENABLED =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.VITE_CF_IMAGES_ENABLED === 'true';

export function imgSrc(url, opts = {}) {
  if (!url || typeof url !== 'string') return url;
  // data: et blob: → tel quel
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;

  // FLAG : tant que CF Image Resizing pas activé, retourne l'URL d'origine
  // (sinon /cdn-cgi/image/... renvoie 404 et casse les images).
  if (!CF_IMAGES_ENABLED) return url;

  const isYaramHost =
    typeof window !== 'undefined' &&
    /yaram\.app$/.test(window.location.hostname);

  // Hors prod yaram.app → no-op
  if (!isYaramHost) return url;

  // On ne transforme QUE les URL Supabase storage public.
  if (!url.startsWith(SUPABASE_STORAGE_PREFIX)) return url;

  const w = opts.w || 400;
  const q = opts.q || 80;
  const f = opts.f || 'auto';

  const optsStr = `width=${w},quality=${q},format=${f}`;
  return `/cdn-cgi/image/${optsStr}/${encodeURIComponent(url)}`;
}
