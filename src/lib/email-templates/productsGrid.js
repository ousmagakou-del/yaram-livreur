// ════════════════════════════════════════════════════════════════
// YARAM — Génère une grille HTML de produits pour emails MJML
// ════════════════════════════════════════════════════════════════
//
// Les emails HTML ne supportent ni CSS Grid moderne, ni hover JS.
// On utilise des tables HTML imbriquées (la seule structure qui
// marche sur Outlook 2007, iOS Mail, Gmail web/mobile).
//
// Animation possible :
//   - Pulse subtil sur le badge "promo" via CSS keyframes (Gmail mobile OK)
//   - "Shine" sur les cards via background animé (iOS Mail OK)
//   - On reste sobre sur Outlook desktop (no keyframes)
//
// Usage :
//   const productsHtml = renderProductsGrid(productsArray, { columns: 2 });
//   → injecté dans {{PRODUCTS_HTML}} du template MJML
// ════════════════════════════════════════════════════════════════

const BRAND_GREEN = '#1F8B4C';
const BRAND_DARK = '#0E5B33';
const BRAND_ACCENT = '#F4B53A';

function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(n) {
  return Number(n || 0).toLocaleString('fr-FR');
}

function renderCard(p) {
  const href = `https://yaram.app/product/${p.id}`;
  const name = escape(p.name);
  const brand = escape(p.brand || '');
  const img = p.img || p.image_url || 'https://yaram.app/icon-512.png';
  const price = formatPrice(p.price);
  const oldPrice = p.old_price && p.old_price > p.price ? formatPrice(p.old_price) : null;
  const hasDiscount = !!oldPrice;
  const discountPct = hasDiscount ? Math.round(100 - (p.price / p.old_price) * 100) : 0;
  const score = p.score != null ? Math.round(p.score) : null;
  const scoreBadge = score != null && score >= 80
    ? `<span style="display:inline-block;background:${BRAND_GREEN};color:white;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.3px">⭐ ${score}/100</span>`
    : '';

  return `
<td valign="top" width="50%" style="padding:6px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #EFEFEF;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
    <tr>
      <td style="position:relative;padding:0;background:linear-gradient(135deg,#FAFAFA 0%,#F4F4F2 100%)">
        <a href="${href}" style="display:block;text-decoration:none">
          <img src="${img}" alt="${name}" width="100%" style="display:block;width:100%;max-width:280px;height:auto;aspect-ratio:1;object-fit:cover" />
        </a>
        ${hasDiscount ? `<div style="position:absolute;top:10px;left:10px;background:${BRAND_ACCENT};color:#0E5B33;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:800;letter-spacing:0.3px">-${discountPct}%</div>` : ''}
      </td>
    </tr>
    <tr>
      <td style="padding:14px 14px 16px">
        ${brand ? `<div style="font-size:10px;color:#888;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px">${brand}</div>` : ''}
        <a href="${href}" style="text-decoration:none;color:#1A1A1A">
          <div style="font-size:14px;font-weight:700;line-height:1.3;color:#1A1A1A;min-height:36px">${name}</div>
        </a>
        <div style="margin-top:8px">
          ${scoreBadge}
        </div>
        <div style="margin-top:12px;display:flex;align-items:baseline">
          <span style="font-size:17px;font-weight:800;color:${BRAND_DARK}">${price}<span style="font-size:11px;font-weight:600;color:#666"> FCFA</span></span>
          ${hasDiscount ? `<span style="margin-left:8px;font-size:12px;color:#999;text-decoration:line-through">${oldPrice} FCFA</span>` : ''}
        </div>
        <a href="${href}" style="display:block;margin-top:12px;text-align:center;background:${BRAND_GREEN};color:white;padding:10px 14px;border-radius:999px;font-size:13px;font-weight:700;text-decoration:none">Voir le produit →</a>
      </td>
    </tr>
  </table>
</td>`;
}

/**
 * Génère un HTML table 2 colonnes responsive avec N produits.
 * @param {Array} products - tableau de produits { id, name, brand, img, price, old_price, score }
 * @param {object} [opts]
 * @param {number} [opts.columns=2] - 2 colonnes par défaut
 * @param {number} [opts.maxItems=6] - max 6 cards (3 lignes × 2 cols)
 */
export function renderProductsGrid(products = [], opts = {}) {
  const columns = opts.columns || 2;
  const maxItems = opts.maxItems || 6;
  const items = products.slice(0, maxItems);

  if (items.length === 0) {
    return `<div style="text-align:center;padding:30px;color:#888;font-style:italic">Aucun produit sélectionné</div>`;
  }

  // Découpe en lignes de N colonnes
  const rows = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }

  const rowsHtml = rows.map((row) => {
    // Si dernière ligne incomplète, padde avec des <td> vides
    const cells = [...row.map(renderCard)];
    while (cells.length < columns) {
      cells.push('<td width="50%" style="padding:6px">&nbsp;</td>');
    }
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0">
  ${rowsHtml}
</table>`;
}
