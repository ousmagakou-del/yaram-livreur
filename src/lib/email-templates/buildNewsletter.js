// ════════════════════════════════════════════════════════════════
// YARAM — Build un email newsletter complet à partir d'un objet simple
// ════════════════════════════════════════════════════════════════
//
// Utilisé par NewsletterSection admin pour :
//   1. Composer une newsletter en cliquant sur des produits (pas en codant HTML)
//   2. Avoir un preview live avant envoi
//   3. Envoyer le HTML final à l'edge function send-newsletter
//
// Usage admin :
//   const { subject, html } = await buildNewsletterHtml({
//     eyebrow: 'NOUVEAUTÉ DE LA SEMAINE',
//     title: 'Nos coups de cœur',
//     intro: 'Voici les produits qui font vibrer Dakar cette semaine.',
//     products: [{ id, name, brand, img, price, old_price, score }, ...],
//     heroCta: { label: 'Faire mon scan IA', url: 'https://yaram.app/scan' },
//     shopCta: { label: 'Tout le catalogue', url: 'https://yaram.app' },
//     outro: 'À très vite, l\'équipe YARAM 💚',
//     productsEyebrow: 'SÉLECTION',
//     productsTitle: '6 produits à découvrir',
//   });
// ════════════════════════════════════════════════════════════════

import { renderEmail } from './render.js';
import { renderProductsGrid } from './productsGrid.js';

export async function buildNewsletterHtml({
  subject = 'YARAM · Newsletter',
  eyebrow = 'NEWSLETTER YARAM',
  title = 'Nos coups de cœur',
  intro = '',
  products = [],
  heroCta = { label: 'Découvrir', url: 'https://yaram.app' },
  shopCta = { label: 'Tout le catalogue →', url: 'https://yaram.app' },
  productsEyebrow = 'SÉLECTION',
  productsTitle = 'Produits du moment',
  outro = "À très vite,\nL'équipe YARAM 💚",
  preview = '',
}) {
  // Génère le HTML grid produits (table 2 cols responsive)
  const productsHtml = renderProductsGrid(products, { columns: 2, maxItems: 6 });

  const html = await renderEmail('newsletter-products', {
    EYEBROW: eyebrow,
    TITLE: title,
    INTRO: intro.replace(/\n/g, '<br/>'),
    HERO_CTA_LABEL: heroCta.label,
    HERO_CTA_URL: heroCta.url,
    PRODUCTS_EYEBROW: productsEyebrow,
    PRODUCTS_TITLE: productsTitle,
    PRODUCTS_HTML: productsHtml,
    SHOP_CTA_LABEL: shopCta.label,
    SHOP_CTA_URL: shopCta.url,
    OUTRO: outro.replace(/\n/g, '<br/>'),
  }, {
    preview: preview || intro.slice(0, 100),
  });

  return { subject, html };
}
