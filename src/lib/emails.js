// src/lib/emails.js
// YARAM — Templates HTML + envoi via edge function send-email (Resend wrapper)

import { supabase } from './supabase';

const APP_URL = 'https://yaram.app';
const BRAND_GREEN = '#1F8B4C';
const BRAND_ORANGE = '#E94E1B';
const SUPPORT_EMAIL = 'contact@yaram.app';
const SUPPORT_WA = '+221 77 438 87 66';

// ─────────────────────────────────────────────────────────────────────
// LAYOUT COMMUN
// ─────────────────────────────────────────────────────────────────────

function layout({ title, preheader, body }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1A1A1A;">
<!-- preheader (preview text masque dans inbox) -->
<div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader || ''}</div>

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F5F6F8;padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,${BRAND_GREEN} 0%,#166635 100%);padding:32px 24px;text-align:center;">
            <div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,0.12);border-radius:14px;line-height:56px;text-align:center;color:white;font-weight:800;font-size:28px;letter-spacing:-1px;">Y</div>
            <div style="margin-top:12px;color:rgba(255,255,255,0.9);font-size:11px;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;">YARAM · Beauté Sénégal</div>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:32px 32px 16px;">
            ${body}
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:24px 32px 32px;border-top:1px solid #EFEFEF;font-size:12px;color:#888;text-align:center;">
            Besoin d'aide&nbsp;? Réponds à cet email ou écris-nous sur WhatsApp <a href="https://wa.me/221774388766" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">${SUPPORT_WA}</a><br>
            <a href="${APP_URL}" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">${APP_URL}</a>
            &nbsp;·&nbsp;
            <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_GREEN};text-decoration:none;">${SUPPORT_EMAIL}</a>
            <div style="margin-top:12px;color:#BBB;">© ${new Date().getFullYear()} YARAM</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function btn(label, href) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:${BRAND_GREEN};border-radius:10px;">
  <a href="${href}" style="display:inline-block;padding:14px 28px;color:white;font-weight:700;font-size:15px;text-decoration:none;">${label}</a>
</td></tr></table>`;
}

function fcfa(n) {
  return (Number(n) || 0).toLocaleString('fr-FR') + ' FCFA';
}

// ─────────────────────────────────────────────────────────────────────
// TEMPLATES
// ─────────────────────────────────────────────────────────────────────

export const EmailTemplates = {
  welcome: ({ firstName }) => ({
    subject: `Bienvenue sur YARAM, ${firstName} 💚`,
    html: layout({
      title: 'Bienvenue sur YARAM',
      preheader: 'Profite de -10% sur ta 1ère commande avec BIENVENUE10',
      body: `
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${BRAND_GREEN};">Bienvenue, ${firstName} 💚</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">
          Merci de rejoindre YARAM, la marketplace beauté validée pour ta peau africaine.
        </p>
        <div style="background:#FFF5E6;border-left:3px solid ${BRAND_ORANGE};padding:16px;border-radius:8px;margin:20px 0;">
          <div style="font-size:11px;font-weight:700;color:${BRAND_ORANGE};letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">CODE PROMO BIENVENUE</div>
          <div style="font-size:22px;font-weight:800;color:#1A1A1A;letter-spacing:1px;">BIENVENUE10</div>
          <div style="font-size:12px;color:#6B6B6B;margin-top:4px;">-10% sur ta 1ère commande dès 25 000 FCFA</div>
        </div>
        <ul style="padding-left:18px;margin:16px 0;color:#444;line-height:1.8;font-size:14px;">
          <li>🌿 800+ produits beauté validés par dermato</li>
          <li>🛵 Livraison en 24h à Dakar</li>
          <li>🧴 Scan IA peau gratuit & personnalisé</li>
        </ul>
        <div style="margin:28px 0;">${btn('Découvrir le catalogue', APP_URL)}</div>
      `,
    }),
  }),

  orderConfirmed: ({ firstName, order }) => ({
    subject: `Commande ${order.id} confirmée ✓`,
    html: layout({
      title: 'Commande confirmée',
      preheader: `Ta commande ${order.id} est en cours de préparation.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">Merci ${firstName} 🎉</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#444;">
          Ta commande <strong>${order.id}</strong> est confirmée. Tu recevras un WhatsApp + email à chaque étape.
        </p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F9FAFB;border-radius:10px;padding:16px;margin:16px 0;">
          <tr><td style="font-size:13px;color:#6B6B6B;padding-bottom:8px;">Montant total</td></tr>
          <tr><td style="font-size:24px;font-weight:800;color:${BRAND_GREEN};">${fcfa(order.total)}</td></tr>
          <tr><td style="font-size:12px;color:#888;padding-top:4px;">Paiement : ${(order.payment_method || '').toUpperCase()}</td></tr>
        </table>
        <p style="margin:16px 0 24px;font-size:14px;color:#444;line-height:1.6;">
          Livraison estimée : <strong>24h ouvrées</strong> à l'adresse renseignée.
        </p>
        <div style="margin:24px 0;">${btn('Suivre ma commande', `${APP_URL}/tracking/${order.id}`)}</div>
      `,
    }),
  }),

  orderShipped: ({ firstName, order }) => ({
    subject: `🛵 Commande ${order.id} en route`,
    html: layout({
      title: 'Commande en route',
      preheader: `Le livreur est en route vers toi.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">${firstName}, le livreur arrive 🛵</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">
          Ta commande <strong>${order.id}</strong> vient de partir. Reste joignable au numéro communiqué.
        </p>
        <p style="margin:16px 0;font-size:14px;color:#444;">
          💵 Paiement à la livraison : <strong>${fcfa(order.total)}</strong>
        </p>
        <div style="margin:24px 0;">${btn('Suivre en temps réel', `${APP_URL}/tracking/${order.id}`)}</div>
      `,
    }),
  }),

  orderDelivered: ({ firstName, order }) => ({
    subject: `Commande ${order.id} livrée 💚`,
    html: layout({
      title: 'Livrée !',
      preheader: 'Merci de noter ton expérience.',
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">Bien reçu, ${firstName} 💚</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">
          Ta commande <strong>${order.id}</strong> a été livrée. On espère que tu vas adorer.
        </p>
        <p style="margin:16px 0;font-size:14px;color:#444;">
          Ça te dit de partager ton avis ? Ça nous aide énormément à améliorer le service et fait gagner 50 points fidélité 🎁
        </p>
        <div style="margin:24px 0;">${btn('Noter ma livraison', `${APP_URL}/tracking/${order.id}`)}</div>
      `,
    }),
  }),

  pharmacyNewOrder: ({ pharmacyName, order }) => ({
    subject: `Nouvelle commande YARAM #${order.id}`,
    html: layout({
      title: 'Nouvelle commande',
      preheader: `${pharmacyName}, une commande t'attend.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:800;color:${BRAND_GREEN};">${pharmacyName}, nouvelle commande 📦</h1>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F9FAFB;border-radius:10px;padding:16px;margin:16px 0;">
          <tr><td style="font-size:13px;color:#6B6B6B;padding-bottom:4px;">Commande</td></tr>
          <tr><td style="font-size:18px;font-weight:700;">#${order.id}</td></tr>
          <tr><td style="font-size:13px;color:#6B6B6B;padding-top:12px;">Montant</td></tr>
          <tr><td style="font-size:18px;font-weight:700;color:${BRAND_GREEN};">${fcfa(order.total)}</td></tr>
        </table>
        <p style="margin:16px 0;font-size:14px;color:#444;">
          Connecte-toi à ton dashboard pour accepter et préparer la commande.
        </p>
        <div style="margin:24px 0;">${btn('Ouvrir mon dashboard', `${APP_URL}/pharma`)}</div>
      `,
    }),
  }),
};

// ─────────────────────────────────────────────────────────────────────
// ENVOI VIA EDGE FUNCTION
// ─────────────────────────────────────────────────────────────────────

export async function sendEmail({ to, template, params = {}, replyTo = null }) {
  if (!to || !template) return { success: false, error: 'to + template requis' };
  const builder = EmailTemplates[template];
  if (!builder) return { success: false, error: 'template inconnu: ' + template };

  const { subject, html } = builder(params);

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, html, replyTo },
    });
    if (error) {
      console.warn('[email] invoke error:', error.message);
      return { success: false, error: error.message };
    }
    if (!data?.success) {
      console.warn('[email] resend error:', data?.error);
      return { success: false, error: data?.error || 'envoi echec' };
    }
    return { success: true, id: data.id };
  } catch (e) {
    console.warn('[email] exception:', e?.message);
    return { success: false, error: e?.message || String(e) };
  }
}
