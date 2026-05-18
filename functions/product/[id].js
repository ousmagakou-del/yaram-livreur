// functions/product/[id].js
// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Pages Function : /product/:id
//
// COMPORTEMENT :
// - Humain (navigateur standard) : sert le SPA normal (next() = laisse passer au static)
// - Bot scraper (FB, WhatsApp, Twitter, etc.) : fetch le produit Supabase et sert
//   un HTML avec les BONS og: tags (titre produit + photo + prix + description).
//
// POURQUOI :
// - WhatsApp/Facebook NE LIT PAS le JS de la SPA → ils voient les og: par defaut
//   de index.html (logo YARAM). Maintenant ils voient la VRAIE photo du produit.
// - Conversion x2-x5 sur les partages depuis l'app.
// ─────────────────────────────────────────────────────────────────────────────

import { sbFetch, escapeHtml, isBotUA, buildMetaTags, injectMetaTags } from '../_lib.js';

export async function onRequest(context) {
  const { request, params, env, next } = context;
  const userAgent = request.headers.get('user-agent') || '';

  // Humain : laisse passer le SPA standard (index.html + JS)
  if (!isBotUA(userAgent)) {
    return next();
  }

  // Bot : fetch produit + sert HTML enrichi
  try {
    const products = await sbFetch(
      env,
      `products?id=eq.${encodeURIComponent(params.id)}&select=id,name,brand,short_desc,long_desc,img,price,score,rating,review_count&limit=1`
    );
    const p = products?.[0];

    // Produit introuvable → laisse passer (le SPA affichera "Produit introuvable")
    if (!p) return next();

    const title = `${p.brand ? p.brand + ' — ' : ''}${p.name} · YARAM`;
    const description = p.short_desc
      || (p.long_desc ? p.long_desc.slice(0, 155) : null)
      || `${p.name} · Score YARAM ${p.score || '?'}/100 · ${(p.price || 0).toLocaleString('fr-FR')} FCFA · Livraison Dakar`;
    const image = p.img || 'https://yaram.app/icon-512.png';
    const url = `https://yaram.app/product/${p.id}`;

    // Recupere le index.html standard servi par le SPA
    const indexResponse = await env.ASSETS.fetch(new URL('/', request.url));
    let html = await indexResponse.text();

    // Injecte les nouveaux meta tags (en remplacement des defauts)
    const metaHtml = buildMetaTags({ title, description, image, url, type: 'product' });

    // JSON-LD Product pour Google rich snippets
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org/',
      '@type': 'Product',
      name: p.name,
      image: p.img,
      description,
      brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
      sku: p.id,
      aggregateRating: (p.rating > 0 && p.review_count > 0) ? {
        '@type': 'AggregateRating',
        ratingValue: p.rating,
        reviewCount: p.review_count,
      } : undefined,
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'XOF',
        price: p.price,
        availability: 'https://schema.org/InStock',
      },
    });

    html = injectMetaTags(html, metaHtml + `\n<script type="application/ld+json">${jsonLd}</script>`);

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Bots peuvent cache 5 min (frais sans hammerer Supabase)
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (e) {
    // Si erreur (Supabase down, etc.), on fallback sur le SPA standard
    console.error('[og-product] error:', e.message);
    return next();
  }
}
