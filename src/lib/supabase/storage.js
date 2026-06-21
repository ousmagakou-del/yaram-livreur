import { supabase } from './client';

// ═══════════════════════════════════════════════
// UPLOAD IMAGES + SIGNED URLs
// ═══════════════════════════════════════════════

// Helper interne : uploade un fichier dans le bucket donne et retourne l'URL publique.
// Throw une Error avec le vrai message en cas d'echec (au lieu de retourner null silencieusement).
async function uploadToBucket(bucket, file, { maxDim = 800, quality = 0.85, prefix = 'file' } = {}) {
  if (!file) throw new Error('Aucun fichier fourni');
  let compressed;
  try {
    compressed = await compressImage(file, maxDim, quality);
  } catch (e) {
    throw new Error('Compression image impossible : ' + (e?.message || 'format non supporte'));
  }
  if (!compressed) throw new Error('Image vide après compression');
  const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
  const { error: upErr } = await supabase.storage.from(bucket).upload(fileName, compressed, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (upErr) {
    console.error(`[uploadToBucket:${bucket}] storage error:`, upErr.message);
    // Messages frequents pour aider le user a comprendre :
    if (/bucket.*not.*found/i.test(upErr.message)) {
      throw new Error(`Bucket "${bucket}" introuvable dans Supabase Storage. Cree-le dans Studio.`);
    }
    if (/row.level.security|new.row.violates|permission|denied/i.test(upErr.message)) {
      throw new Error(`Permission refusee sur "${bucket}". Verifie la policy Storage dans Supabase Studio (INSERT pour anon).`);
    }
    throw new Error(upErr.message);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
  if (!data?.publicUrl) throw new Error('URL publique non recuperee (bucket en private ?)');
  return data.publicUrl;
}

export async function uploadProductImage(file) {
  try {
    return await uploadToBucket('product-images', file, { maxDim: 800, prefix: 'product' });
  } catch (e) {
    console.error('[uploadProductImage]', e.message);
    return null; // back-compat : on retourne null si erreur, le caller affiche un toast generique
  }
}

// Variante qui throw au lieu de null : pour les callers qui veulent afficher l'erreur exacte.
export async function uploadProductImageOrThrow(file) {
  return uploadToBucket('product-images', file, { maxDim: 800, prefix: 'product' });
}

export async function uploadBannerImage(file) {
  // Throw directement : le caller (BannersSection) gere le toast d'erreur avec le vrai message.
  return uploadToBucket('banner-images', file, { maxDim: 1200, prefix: 'banner' });
}

export async function compressImage(file, maxDim = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────────────
// SIGNED URLS pour buckets prives (skin-scans, delivery-proofs)
// ─────────────────────────────────────────────────────────────────────
const PRIVATE_BUCKETS = new Set(['skin-scans', 'delivery-proofs']);
const signedUrlCache = new Map(); // path → { url, expiresAt }
const SIGNED_TTL = 60 * 60 * 24 * 7; // 7 jours

/**
 * Transforme une URL publique Supabase (ou un path direct) en URL signee
 * valide 7 jours pour les buckets prives. Idempotent pour les buckets publics
 * (renvoie l'URL telle quelle).
 *
 * Usage : <img src={await getSignedStorageUrl(scan.image_url)} />
 */
export async function getSignedStorageUrl(urlOrPath) {
  if (!urlOrPath) return null;
  // Si pas une URL Supabase Storage, renvoie tel quel (URL externe Unsplash, etc.)
  const match = /\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+?)(?:\?|$)/.exec(urlOrPath);
  let bucket, path;
  if (match) {
    bucket = match[1];
    path = match[2];
  } else if (urlOrPath.includes('/')) {
    // Path direct genre "skin-scans/abc.jpg"
    const [b, ...rest] = urlOrPath.split('/');
    bucket = b;
    path = rest.join('/');
  } else {
    return urlOrPath;
  }

  // Bucket public : pas besoin de signer
  if (!PRIVATE_BUCKETS.has(bucket)) return urlOrPath;

  // Cache (evite de re-signer chaque render)
  const cacheKey = `${bucket}/${path}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) {
    console.warn('[signedUrl] failed for', cacheKey, error?.message);
    return urlOrPath; // fallback : l'URL ne marchera pas mais on evite null
  }
  signedUrlCache.set(cacheKey, {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_TTL - 60) * 1000, // refresh 1 min avant expiry
  });
  return data.signedUrl;
}
