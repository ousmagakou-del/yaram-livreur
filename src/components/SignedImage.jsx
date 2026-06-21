// src/components/SignedImage.jsx
// Wrapper <img> qui resout les URLs des buckets prives (skin-scans, delivery-proofs)
// vers des signed URLs via getSignedStorageUrl().
//
// Usage : <SignedImage src={scan.image_url} alt="..." className="..." />
//   ou  : <SignedImage bucket="delivery-proofs" path="<token>/file.jpg" alt="..." />
//
// Pour les URLs externes (Unsplash, etc.) ou les data: URLs (signature dessinee),
// comportement identique a un <img> normal — la signature ne s'applique qu'aux
// URLs Supabase Storage des buckets prives (cf. PRIVATE_BUCKETS dans supabase.js).
//
// Cache interne : la signed URL est mise en cache jusqu'a (ttl - 60s).
// L'invalidation automatique fait que si on re-render apres expiry, on re-signe.

import { useState, useEffect, memo } from 'react';
import { supabase, getSignedStorageUrl } from '../lib/supabase';

const SIGNED_TTL = 60 * 60 * 24 * 7; // 7 jours par defaut

// Cache local au composant : evite de re-signer la meme URL a chaque render
// d'une liste avec plusieurs SignedImage (admin DeliveriesSection, ScanHistory).
// Cle = `${bucket}/${path}`, valeur = { url, expiresAt }.
const localCache = new Map();

function cacheGet(key) {
  const entry = localCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    localCache.delete(key);
    return null;
  }
  return entry.url;
}

function cacheSet(key, url, ttlSeconds) {
  localCache.set(key, {
    url,
    expiresAt: Date.now() + (ttlSeconds - 60) * 1000, // refresh 1 min avant expiry
  });
}

function SignedImage({
  src,
  bucket,
  path,
  alt = '',
  fallback = null,
  loadingClassName,
  ttl = SIGNED_TTL,
  ...rest
}) {
  const [resolvedSrc, setResolvedSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setLoading(true);

    // Mode 1 : src URL classique (peut etre URL publique Supabase, externe ou data:)
    if (src) {
      // data: URLs (signature pad) ou data URI : pas besoin de signer
      if (typeof src === 'string' && src.startsWith('data:')) {
        setResolvedSrc(src);
        setLoading(false);
        return () => { cancelled = true; };
      }

      (async () => {
        try {
          const url = await getSignedStorageUrl(src);
          if (!cancelled) {
            setResolvedSrc(url || src);
            setLoading(false);
          }
        } catch {
          if (!cancelled) {
            setResolvedSrc(src);
            setLoading(false);
            setError(true);
          }
        }
      })();
      return () => { cancelled = true; };
    }

    // Mode 2 : bucket + path explicites
    if (bucket && path) {
      const cacheKey = `${bucket}/${path}`;
      const cached = cacheGet(cacheKey);
      if (cached) {
        setResolvedSrc(cached);
        setLoading(false);
        return () => { cancelled = true; };
      }

      (async () => {
        try {
          const { data, error: err } = await supabase
            .storage
            .from(bucket)
            .createSignedUrl(path, ttl);
          if (cancelled) return;
          if (err || !data?.signedUrl) {
            setError(true);
            setLoading(false);
            return;
          }
          cacheSet(cacheKey, data.signedUrl, ttl);
          setResolvedSrc(data.signedUrl);
          setLoading(false);
        } catch {
          if (!cancelled) { setError(true); setLoading(false); }
        }
      })();
      return () => { cancelled = true; };
    }

    // Ni src ni bucket+path : rien a afficher
    setResolvedSrc(null);
    setLoading(false);
    return () => { cancelled = true; };
  }, [src, bucket, path, ttl]);

  if (loading) {
    if (loadingClassName) {
      return <div className={loadingClassName} aria-label="Chargement image" />;
    }
    // Placeholder neutre : meme dimensions que l'img final (via rest.style/className)
    return (
      <div
        aria-label="Chargement image"
        style={{
          background: 'linear-gradient(90deg, #F0F0EE 0%, #E5E5E3 50%, #F0F0EE 100%)',
          backgroundSize: '200% 100%',
          animation: 'signedImgPulse 1.4s ease-in-out infinite',
          minHeight: 60,
          borderRadius: 8,
          ...(rest.style || {}),
        }}
        className={rest.className}
      />
    );
  }

  if (error || !resolvedSrc) {
    if (fallback) return fallback;
    return null;
  }

  return <img src={resolvedSrc} alt={alt} loading="lazy" decoding="async" onError={() => setError(true)} {...rest} />;
}

// PERF : memo + comparator sur les props qui declenchent un nouveau signed URL.
// Les listes (DeliveriesSection, ScanHistory) re-render souvent sans changer ces props.
export default memo(SignedImage, (prev, next) => (
  prev.src === next.src &&
  prev.bucket === next.bucket &&
  prev.path === next.path &&
  prev.ttl === next.ttl &&
  prev.className === next.className &&
  prev.alt === next.alt
));

// Injecte le keyframes une seule fois (idempotent)
if (typeof document !== 'undefined' && !document.getElementById('signed-image-styles')) {
  const style = document.createElement('style');
  style.id = 'signed-image-styles';
  style.textContent = `
    @keyframes signedImgPulse {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  document.head.appendChild(style);
}
