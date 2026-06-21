// src/lib/email-templates/order-status-update.js
// YARAM — Email de changement de statut commande.
// Statuts gérés : paid, preparing, shipped/in_delivery, delivered,
//                 awaiting_balance, awaiting_confirm, cancelled.

import { layout, btn, escapeHtml, maskPhone, APP_URL, BRAND_GREEN } from './_shared';

const STATUS_COPY = {
  paid: {
    label: 'Paiement reçu',
    emoji: '💚',
    title: 'Paiement confirmé',
    body: 'Ta commande passe en préparation dans la foulée. On t\'écrit dès qu\'elle part.',
    cta: 'Suivre ma commande',
  },
  preparing: {
    label: 'En préparation',
    emoji: '🧴',
    title: 'On prépare ta commande',
    body: 'Notre partenaire est en train de préparer tes produits avec soin. C\'est l\'affaire de quelques heures.',
    cta: 'Voir le suivi',
  },
  shipped: {
    label: 'En route',
    emoji: '🛵',
    title: 'Le livreur arrive !',
    body: 'Ta commande vient de partir. Reste joignable au numéro communiqué — le livreur va t\'appeler à l\'approche.',
    cta: 'Suivre en temps réel',
  },
  in_delivery: {
    label: 'En route',
    emoji: '🛵',
    title: 'Le livreur arrive !',
    body: 'Ta commande vient de partir. Reste joignable au numéro communiqué — le livreur va t\'appeler à l\'approche.',
    cta: 'Suivre en temps réel',
  },
  out_for_delivery: {
    label: 'En cours de livraison',
    emoji: '🛵',
    title: 'Livraison en cours',
    body: 'Le livreur est tout proche. Tiens-toi prêt·e à le recevoir.',
    cta: 'Suivre en temps réel',
  },
  delivered: {
    label: 'Livrée',
    emoji: '✅',
    title: 'Commande livrée 💚',
    body: 'On espère que tu vas adorer tes produits. N\'hésite pas à noter ta livraison — ça nous aide énormément.',
    cta: 'Noter ma livraison',
  },
  awaiting_balance: {
    label: 'Solde à payer',
    emoji: '💳',
    title: 'Ta précommande est arrivée à Dakar',
    body: 'On a bien réceptionné ton article importé. Pour finaliser la livraison, il reste à régler le solde.',
    cta: 'Payer le solde',
  },
  awaiting_confirm: {
    label: 'À confirmer',
    emoji: '⏳',
    title: 'Confirme la réception',
    body: 'Ton livreur a marqué la commande livrée. Confirme la bonne réception pour clôturer la transaction.',
    cta: 'Confirmer la réception',
  },
  cancelled: {
    label: 'Annulée',
    emoji: '⚠️',
    title: 'Commande annulée',
    body: 'Ta commande a été annulée. Si tu as déjà payé, le remboursement est traité sous 48h. Une question ? Réponds à cet email.',
    cta: 'Voir le détail',
  },
  refused: {
    label: 'Paiement refusé',
    emoji: '🚫',
    title: 'Paiement refusé — réessaie',
    body: 'On n\'a pas pu valider ton paiement. Pas de stress : tu peux retenter depuis l\'app. En cas de doute, réponds à cet email avec ta preuve de virement.',
    cta: 'Réessayer le paiement',
  },
};

export function orderStatusUpdateEmail({
  firstName,
  orderId,
  newStatus,
  statusLabel,
  livreurName,
  livreurPhone,
} = {}) {
  const name = escapeHtml((firstName || 'toi').trim() || 'toi');
  const id = escapeHtml(String(orderId || '—'));
  const meta = STATUS_COPY[newStatus] || {
    label: statusLabel || 'Mise à jour',
    emoji: '📦',
    title: 'Mise à jour de ta commande',
    body: 'Ta commande vient d\'être mise à jour. Ouvre le suivi pour les détails.',
    cta: 'Voir ma commande',
  };
  const label = escapeHtml(statusLabel || meta.label);

  const livreurBlock = (newStatus === 'shipped' || newStatus === 'in_delivery' || newStatus === 'out_for_delivery') && (livreurName || livreurPhone) ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F9FAFB;border-radius:12px;padding:16px;margin:18px 0;">
      <tr><td style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.1em;text-transform:uppercase;padding-bottom:8px;">Ton livreur</td></tr>
      ${livreurName ? `<tr><td style="font-size:15px;color:#1A1A1A;font-weight:700;padding-bottom:4px;">${escapeHtml(livreurName)}</td></tr>` : ''}
      ${livreurPhone ? `<tr><td style="font-size:14px;color:#444;">📞 <a href="tel:${escapeHtml(livreurPhone)}" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">${escapeHtml(maskPhone(livreurPhone))}</a></td></tr>` : ''}
    </table>` : '';

  return {
    subject: `Update commande #${id} · ${label}`,
    html: layout({
      title: `Commande #${id} — ${label}`,
      preheader: `${meta.title}.`,
      body: `
        <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:6px;">
          Commande #${id}
        </div>
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};line-height:1.25;">
          ${meta.emoji} ${escapeHtml(meta.title)}
        </h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">
          Bonjour ${name}, ${escapeHtml(meta.body)}
        </p>

        <div style="background:#EBF7EF;border-radius:10px;padding:12px 16px;margin:18px 0;font-size:14px;color:#1A1A1A;">
          <strong style="color:${BRAND_GREEN};">Nouveau statut :</strong> ${label}
        </div>

        ${livreurBlock}

        <div style="margin:24px 0 8px;">${btn(meta.cta, `${APP_URL}/order/${encodeURIComponent(orderId || '')}`)}</div>
      `,
    }),
  };
}

export default orderStatusUpdateEmail;
