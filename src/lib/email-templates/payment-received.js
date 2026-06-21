/* ═══════════════════════════════════════════════════════════════════
   payment-received — Email envoyé immédiatement quand le client clique
   "J'ai payé" pour Wave/OM/Card. Confirme la réception + rassure que
   l'admin va vérifier avant de débloquer la livraison.
   ═══════════════════════════════════════════════════════════════════ */

import { layout, btn, fcfa, BRAND_GREEN, BRAND_ORANGE } from './_shared';

export function paymentReceivedEmail({ firstName, orderId, amount, paymentMethod }) {
  const method =
    paymentMethod === 'wave' ? 'Wave' :
    paymentMethod === 'om' ? 'Orange Money' :
    paymentMethod === 'card' || paymentMethod === 'paytech' ? 'Carte bancaire' :
    'ton paiement';

  const subject = `Paiement reçu · YARAM #${orderId}`;

  const body = `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:${BRAND_GREEN};line-height:1.2;">
      Merci ${firstName} 💚
    </h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#333;">
      On a bien reçu ton paiement <strong>${method}</strong> de
      <strong>${fcfa(amount)}</strong> pour la commande
      <strong>#${orderId}</strong>.
    </p>

    <div style="background:#FFF8E5;border-left:4px solid ${BRAND_ORANGE};border-radius:8px;padding:14px 16px;margin:18px 0;">
      <div style="font-size:13px;font-weight:700;color:${BRAND_ORANGE};margin-bottom:4px;">
        ⏱ Vérification en cours
      </div>
      <div style="font-size:13px;color:#444;line-height:1.5;">
        Notre équipe vérifie ton virement (généralement sous 30 min en journée).
        Dès validation, on déclenche la livraison et tu reçois un nouveau mail
        + une notification push.
      </div>
    </div>

    <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#555;">
      Tu peux suivre ta commande en temps réel ici :
    </p>

    <div style="margin:0 0 24px;">
      ${btn("Suivre ma commande", `https://yaram.app/order/${orderId}`)}
    </div>

    <p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.5;">
      Un souci avec ton virement ? Réponds directement à ce mail ou contacte-nous
      sur WhatsApp <a href="https://wa.me/221777608983" style="color:${BRAND_GREEN};font-weight:600;text-decoration:none;">+221 77 760 89 83</a>.
    </p>
  `;

  return {
    subject,
    html: layout({
      title: 'Paiement reçu',
      preheader: `On a bien reçu ton paiement ${method} de ${fcfa(amount)}, on vérifie maintenant.`,
      body,
    }),
  };
}
