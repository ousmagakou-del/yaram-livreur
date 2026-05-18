// functions/sitemap-pharmacies.xml.js
// Genere /sitemap-pharmacies.xml depuis les pharmacies actives.

import { sbFetch, escapeXml } from './_lib.js';

export async function onRequest({ env }) {
  try {
    const pharmacies = await sbFetch(
      env,
      'pharmacies?select=id,updated_at&active=eq.true&order=updated_at.desc&limit=500'
    );

    const urls = (pharmacies || []).map(p => `  <url>
    <loc>https://yaram.app/pharmacy/${escapeXml(p.id)}</loc>
    <lastmod>${(p.updated_at || new Date().toISOString()).slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (e) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- sitemap-pharmacies error: ${escapeXml(e.message)} -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
      { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
    );
  }
}
