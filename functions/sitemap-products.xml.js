// functions/sitemap-products.xml.js
// Genere /sitemap-products.xml dynamiquement depuis les produits Supabase.
// Cache 1h cote edge Cloudflare pour ne pas hammerer Supabase.

import { sbFetch, escapeXml } from './_lib.js';

export async function onRequest({ env }) {
  try {
    const products = await sbFetch(
      env,
      'products?select=id,updated_at&status=eq.approved&active=eq.true&order=updated_at.desc&limit=5000'
    );

    const urls = (products || []).map(p => `  <url>
    <loc>https://yaram.app/product/${escapeXml(p.id)}</loc>
    <lastmod>${(p.updated_at || new Date().toISOString()).slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        // Cache 1h cote edge + 1h cote client/Google
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (e) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- sitemap-products error: ${escapeXml(e.message)} -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
      { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
    );
  }
}
