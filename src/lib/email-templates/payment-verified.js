// src/lib/email-templates/payment-verified.js
// YARAM — Email de validation manuelle du paiement (Wave / Orange Money).
// Envoyé après que l'admin a confirmé la réception du transfert.

import { layout, btn, fcfa, escapeHtml, APP_URL, BRAND_GREEN } from './_shared';

const METHOD_LABEL = {
  wave: 'Wave',
  om: 'Orange Money',
  orange_money: 'Orange Money',
  free_money: 'Free Money',
  paytech: 'PayTech',
  cb: 'Carte bancaire',
  cod: 'À la livraison',
};

export function paymentVerifiedEmail({
  firstName,
  orderId,
  amount,
  paymentMethod,
} = {}) {
  const name = escapeHtml((firstName || 'toi').trim() || 'toi');
  const id = escapeHtml(String(orderId || '—'));
  const methodKey = String(paymentMethod || '').toLowerCase();
  const method = escapeHtml(METHOD_LABEL[methodKey] || paymentMethod || 'mobile money');

  return {
    subject: `Paiement validé · YARAM #${id}`,
    html: layout({
      title: 'Paiement validé',
      preheader: `Ton paiement ${method} est validé — commande #${id} en préparation.`,
      body: `
        <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:6px;">
          Commande #${id}
        </div>
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};line-height:1.25;">
          Paiement validé ✅
        </h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">
          Bonjour ${name}, on confirme la bonne réception de ton paiement ${method}.
          Ta commande passe maintenant en <strong>préparation</strong>.
        </p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F9FAFB;border-radius:12px;padding:18px;margin:8px 0 18px;">
          <tr>
            <td style="font-size:13px;color:#6B6B6B;padding:4px 0;">Montant validé</td>
            <td style="font-size:18px;color:${BRAND_GREEN};padding:4px 0;text-align:right;font-weight:800;">${fcfa(amount)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#6B6B6B;padding:4px 0;">Méthode</td>
            <td style="font-size:13px;color:#1A1A1A;padding:4px 0;text-align:right;font-weight:600;">${method}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#6B6B6B;padding:4px 0;">Statut</td>
            <td style="font-size:13px;color:#1A1A1A;padding:4px 0;text-align:right;font-weight:600;">En préparation</td>
          </tr>
        </table>

        <p style="margin:0 0 16px;font-size:14px;color:#444;line-height:1.6;">
          On t'enverra un nouveau message dès que ta commande prendra la route. En attendant, tu peux suivre l'avancement en temps réel.
        </p>

        <div style="margin:24px 0 8px;">${btn('Suivre ma commande', `${APP_URL}/order/${encodeURIComponent(orderId || '')}`)}</div>
      `,
    }),
  };
}

export default paymentVerifiedEmail;
