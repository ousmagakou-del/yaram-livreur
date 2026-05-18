// functions/pharmacy/[id].js
// Identique a functions/product/[id].js mais pour les pharmacies.
// Sert un HTML avec les og: tags de la pharmacie aux bots scraping.

import { sbFetch, isBotUA, buildMetaTags, injectMetaTags } from '../_lib.js';

export async function onRequest(context) {
  const { request, params, env, next } = context;
  const userAgent = request.headers.get('user-agent') || '';

  if (!isBotUA(userAgent)) return next();

  try {
    const pharmacies = await sbFetch(
      env,
      `pharmacies?id=eq.${encodeURIComponent(params.id)}&select=id,name,tagline,description,city,neighborhood,address,phone,whatsapp,logo,cover,rating,review_count,hours,delivery_hours&active=eq.true&limit=1`
    );
    const ph = pharmacies?.[0];
    if (!ph) return next();

    const title = `${ph.name} · Pharmacie YARAM ${ph.city || 'Sénégal'}`;
    const description = ph.tagline
      || ph.description
      || `${ph.name} — Pharmacie partenaire YARAM à ${ph.neighborhood ? ph.neighborhood + ', ' : ''}${ph.city || 'Dakar'}. Commandez en ligne, livraison rapide.`;
    const image = ph.cover || ph.logo || 'https://yaram.app/icon-512.png';
    const url = `https://yaram.app/pharmacy/${ph.id}`;

    const indexResponse = await env.ASSETS.fetch(new URL('/', request.url));
    let html = await indexResponse.text();

    const metaHtml = buildMetaTags({ title, description, image, url, type: 'website' });

    // JSON-LD LocalBusiness — important pour Google Maps / Local Pack
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Pharmacy',
      name: ph.name,
      description,
      image: ph.cover || ph.logo,
      address: {
        '@type': 'PostalAddress',
        streetAddress: ph.address || ph.neighborhood,
        addressLocality: ph.city || 'Dakar',
        addressCountry: 'SN',
      },
      telephone: ph.phone || ph.whatsapp,
      openingHours: ph.hours,
      aggregateRating: (ph.rating > 0 && ph.review_count > 0) ? {
        '@type': 'AggregateRating',
        ratingValue: ph.rating,
        reviewCount: ph.review_count,
      } : undefined,
      url,
    });

    html = injectMetaTags(html, metaHtml + `\n<script type="application/ld+json">${jsonLd}</script>`);

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (e) {
    console.error('[og-pharmacy] error:', e.message);
    return next();
  }
}
