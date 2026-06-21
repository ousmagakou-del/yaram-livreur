// ════════════════════════════════════════════════════════════════
// YARAM — Grille HTML produits PREMIUM pour emails MJML
// ════════════════════════════════════════════════════════════════
//
// Design commercial qui claque :
//  - Cards ratio 4:5 vertical (mieux pour photos beauté)
//  - Hero image en aspect ratio fixé avec gradient overlay
//  - Badge promo animé (pulse via class .yp-pulse, defini dans _layout.mjml)
//  - Brand uppercase tracking large, premium
//  - Score badge avec étoile dorée + glow
//  - Prix MASSIF avec drop shadow
//  - CTA pill plein vert avec glow
//  - Animation fade-up stagger sur chaque card
// ════════════════════════════════════════════════════════════════

const BRAND_GREEN = '#1F8B4C';
const BRAND_DARK = '#0E5B33';
const BRAND_ACCENT = '#F4B53A';
const BRAND_ORANGE = '#E94E1B';

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

/**
 * Construit une card produit premium (table HTML compatible Outlook + iOS Mail).
 * @param {object} p Produit
 * @param {number} delayMs Délai stagger pour fade-up (en ms)
 */
function renderCard(p, delayMs = 0) {
  const href = `https://yaram.app/product/${p.id}`;
  const name = escape(p.name);
  const brand = escape(p.brand || '');
  const img = p.img || p.image_url || 'https://yaram.app/icon-512.png';
  const price = formatPrice(p.price);
  const oldPrice = p.old_price && p.old_price > p.price ? formatPrice(p.old_price) : null;
  const hasDiscount = !!oldPrice;
  const discountPct = hasDiscount ? Math.round(100 - (p.price / p.old_price) * 100) : 0;
  const score = p.score != null ? Math.round(p.score) : null;
  const hasScore = score != null && score >= 80;

  // Animation delay inline pour stagger fade-up (iOS Mail honore le delay)
  const animStyle = `animation:ypFadeUp 0.6s cubic-bezier(0.2,0.9,0.3,1.2) ${delayMs}ms both;`;

  return `
<td valign="top" width="50%" style="padding:7px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #ECECEC;border-radius:18px;overflow:hidden;box-shadow:0 4px 16px rgba(14,91,51,0.06);${animStyle}">
    <!-- ─── HERO IMAGE avec gradient YARAM en bas ─── -->
    <tr>
      <td style="position:relative;padding:0;background:linear-gradient(180deg,#FAFAFA 0%,#F4F4F2 100%);">
        <a href="${href}" style="display:block;text-decoration:none;">
          <img src="${img}" alt="${name}" width="100%" style="display:block;width:100%;max-width:280px;height:auto;aspect-ratio:4/5;object-fit:cover;" />
        </a>
        ${hasDiscount ? `
          <div class="yp-pulse" style="position:absolute;top:12px;left:12px;background:linear-gradient(135deg,${BRAND_ACCENT} 0%,${BRAND_ORANGE} 100%);color:#FFFFFF;padding:6px 12px;border-radius:14px;font-size:12px;font-weight:900;letter-spacing:0.4px;box-shadow:0 4px 12px rgba(244,181,58,0.5);">
            -${discountPct}%
          </div>` : ''}
        ${hasScore ? `
          <div style="position:absolute;top:12px;right:12px;background:rgba(255,255,255,0.95);backdrop-filter:blur(8px);color:${BRAND_DARK};padding:5px 10px;border-radius:14px;font-size:11px;font-weight:800;letter-spacing:0.2px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            ⭐ ${score}
          </div>` : ''}
      </td>
    </tr>
    <!-- ─── INFOS ─── -->
    <tr>
      <td style="padding:16px 14px 18px;">
        ${brand ? `
          <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:10px;color:#888;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:5px;">
            ${brand}
          </div>` : ''}
        <a href="${href}" style="text-decoration:none;color:#1A1A1A;">
          <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;font-weight:800;line-height:1.3;color:#0E5B33;min-height:36px;letter-spacing:-0.2px;">
            ${name}
          </div>
        </a>
        <!-- ─── Prix massif ─── -->
        <div style="margin-top:14px;">
          <span style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:22px;font-weight:900;color:${BRAND_DARK};letter-spacing:-0.5px;">
            ${price}<span style="font-size:11px;font-weight:700;color:#666;margin-left:2px;">FCFA</span>
          </span>
          ${hasDiscount ? `
            <span style="margin-left:8px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;color:#999;text-decoration:line-through;font-weight:600;">
              ${oldPrice}
            </span>` : ''}
        </div>
        <!-- ─── CTA pill plein vert avec glow ─── -->
        <a href="${href}" style="display:block;margin-top:14px;text-align:center;background:linear-gradient(135deg,${BRAND_GREEN} 0%,${BRAND_DARK} 100%);color:#FFFFFF;padding:12px 14px;border-radius:999px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;font-weight:800;text-decoration:none;letter-spacing:0.1px;box-shadow:0 6px 16px rgba(31,139,76,0.32);">
          Voir le produit →
        </a>
      </td>
    </tr>
  </table>
</td>`;
}

/**
 * Génère un HTML table 2 colonnes responsive avec N produits.
 * @param {Array} products
 * @param {object} [opts]
 * @param {number} [opts.columns=2]
 * @param {number} [opts.maxItems=6]
 */
export function renderProductsGrid(products = [], opts = {}) {
  const columns = opts.columns || 2;
  const maxItems = opts.maxItems || 6;
  const items = products.slice(0, maxItems);

  if (items.length === 0) {
    return `<div style="text-align:center;padding:40px;color:#888;font-style:italic;font-family:-apple-system,sans-serif;">Aucun produit sélectionné</div>`;
  }

  // Découpe en lignes de N colonnes avec stagger delay sur chaque card
  const rows = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }

  let cardIdx = 0;
  const rowsHtml = rows.map((row) => {
    const cells = [...row.map((p) => {
      const html = renderCard(p, cardIdx * 100); // stagger 100ms par card
      cardIdx++;
      return html;
    })];
    while (cells.length < columns) {
      cells.push('<td width="50%" style="padding:7px;">&nbsp;</td>');
      cardIdx++;
    }
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
  ${rowsHtml}
</table>`;
}
