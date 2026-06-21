// src/lib/email-templates/order-confirmation.js
// YARAM — Confirmation de commande (récap items + total + ETA)

import { layout, btn, fcfa, escapeHtml, APP_URL, BRAND_GREEN } from './_shared';

function renderItemsTable(items) {
  const safe = Array.isArray(items) ? items : [];
  if (safe.length === 0) {
    return `<p style="margin:0 0 12px;font-size:14px;color:#888;">Détails des articles disponibles dans l'app.</p>`;
  }

  const rows = safe.map((it) => {
    const name = escapeHtml(it?.name || it?.product_name || it?.title || 'Article');
    const qty = Number(it?.quantity ?? it?.qty ?? 1) || 1;
    const unit = Number(it?.unit_price ?? it?.price ?? 0) || 0;
    const line = unit * qty;
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #F0F0F0;font-size:14px;color:#1A1A1A;">
          ${name}
          <div style="font-size:12px;color:#888;margin-top:2px;">x${qty} · ${fcfa(unit)}</div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #F0F0F0;font-size:14px;color:#1A1A1A;text-align:right;white-space:nowrap;font-weight:600;">
          ${fcfa(line)}
        </td>
      </tr>`;
  }).join('');

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:8px 0 16px;">
      <thead>
        <tr>
          <th align="left" style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.1em;text-transform:uppercase;padding-bottom:6px;border-bottom:2px solid #1A1A1A;">Article</th>
          <th align="right" style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.1em;text-transform:uppercase;padding-bottom:6px;border-bottom:2px solid #1A1A1A;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function formatAddress(addr) {
  if (!addr) return '';
  if (typeof addr === 'string') return escapeHtml(addr);
  const parts = [
    addr.name,
    addr.line1 || addr.address || addr.street,
    addr.zone || addr.neighborhood,
    addr.city,
    addr.phone,
  ].filter(Boolean).map(escapeHtml);
  return parts.join('<br>');
}

function formatDate(d) {
  if (!d) return null;
  try {
    const dt = typeof d === 'string' ? new Date(d) : d;
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { return null; }
}

export function orderConfirmationEmail({
  firstName,
  orderId,
  items = [],
  total,
  deliveryFee,
  paymentMethod,
  deliveryAddress,
  estimatedDeliveryDate,
} = {}) {
  const name = escapeHtml((firstName || 'toi').trim() || 'toi');
  const id = escapeHtml(String(orderId || '—'));
  const pay = escapeHtml(String(paymentMethod || 'À confirmer').toUpperCase());
  const eta = formatDate(estimatedDeliveryDate);
  const addrHtml = formatAddress(deliveryAddress);
  const subtotal = (Number(total) || 0) - (Number(deliveryFee) || 0);

  return {
    subject: `Commande confirmée · YARAM #${id}`,
    html: layout({
      title: 'Commande confirmée',
      preheader: `Ta commande #${id} est confirmée — récap à l'intérieur.`,
      body: `
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">Merci ${name} 🎉</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#444;">
          Ta commande <strong>#${id}</strong> est confirmée. Voici le récapitulatif —
          tu recevras un email + WhatsApp à chaque étape.
        </p>

        ${renderItemsTable(items)}

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F9FAFB;border-radius:12px;padding:18px;margin:8px 0 18px;">
          <tr>
            <td style="font-size:13px;color:#6B6B6B;padding:4px 0;">Sous-total</td>
            <td style="font-size:13px;color:#1A1A1A;padding:4px 0;text-align:right;font-weight:600;">${fcfa(subtotal)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#6B6B6B;padding:4px 0;">Livraison</td>
            <td style="font-size:13px;color:#1A1A1A;padding:4px 0;text-align:right;font-weight:600;">${fcfa(deliveryFee)}</td>
          </tr>
          <tr>
            <td colspan="2" style="border-top:1px dashed #DDD;padding:6px 0 0;"></td>
          </tr>
          <tr>
            <td style="font-size:14px;color:#1A1A1A;padding:8px 0;font-weight:700;">Total</td>
            <td style="font-size:18px;color:${BRAND_GREEN};padding:8px 0;text-align:right;font-weight:800;">${fcfa(total)}</td>
          </tr>
          <tr>
            <td style="font-size:12px;color:#888;padding-top:2px;">Paiement</td>
            <td style="font-size:12px;color:#888;padding-top:2px;text-align:right;">${pay}</td>
          </tr>
        </table>

        ${addrHtml ? `
        <div style="margin:18px 0;">
          <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Livraison à</div>
          <div style="font-size:14px;color:#1A1A1A;line-height:1.5;">${addrHtml}</div>
        </div>` : ''}

        ${eta ? `
        <div style="background:#EBF7EF;border-radius:10px;padding:14px 16px;margin:18px 0;font-size:14px;color:#1A1A1A;">
          <strong style="color:${BRAND_GREEN};">Livraison estimée :</strong> ${eta}
        </div>` : ''}

        <div style="margin:24px 0 8px;">${btn('Suivre ma commande', `${APP_URL}/order/${encodeURIComponent(orderId || '')}`)}</div>
      `,
    }),
  };
}

export default orderConfirmationEmail;
