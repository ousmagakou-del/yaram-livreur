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
export function imgSrc(url, opts = {}) {
  if (!url || typeof url !== 'string') return url;
  // data: et blob: → tel quel
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;

  const isYaramHost =
    typeof window !== 'undefined' &&
    /yaram\.app$/.test(window.location.hostname);

  // Hors prod yaram.app → no-op (Cloudflare Image Resizing n'est dispo
  // que derrière les zones Cloudflare Pro+ rattachées au domaine yaram.app)
  if (!isYaramHost) return url;

  // On ne transforme QUE les URL Supabase storage public.
  // Signed URLs (?token=...) et URL externes (Unsplash, etc.) → on évite.
  if (!url.startsWith(SUPABASE_STORAGE_PREFIX)) return url;

  const w = opts.w || 400;
  const q = opts.q || 80;
  const f = opts.f || 'auto';

  // Format Cloudflare : /cdn-cgi/image/<opts>/<URL_ENCODED_ORIGIN>
  // Cloudflare Pages remet les chemins relatifs à l'origine du site.
  // Donc on construit `/cdn-cgi/image/w=400,q=80,f=auto/<encoded full URL>`.
  const optsStr = `width=${w},quality=${q},format=${f}`;
  return `/cdn-cgi/image/${optsStr}/${encodeURIComponent(url)}`;
}
