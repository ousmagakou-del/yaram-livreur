// src/lib/emails.js
// YARAM — Templates HTML + envoi via edge function send-email (Resend wrapper)

import { supabase } from './supabase';
import { welcomeEmail } from './email-templates/welcome';
import { orderConfirmationEmail } from './email-templates/order-confirmation';
import { orderStatusUpdateEmail } from './email-templates/order-status-update';
import { resetPasswordEmail } from './email-templates/reset-password';
import { paymentVerifiedEmail } from './email-templates/payment-verified';
import { onboardingD2Email } from './email-templates/onboarding-d2';
import { onboardingD7Email } from './email-templates/onboarding-d7';
import { onboardingD30Email } from './email-templates/onboarding-d30';

const APP_URL = 'https://yaram.app';
const BRAND_GREEN = '#1F8B4C';
const BRAND_ORANGE = '#E94E1B';
const SUPPORT_EMAIL = 'contact@yaram.app';
const SUPPORT_WA = '+221 77 760 89 83';

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
            Besoin d'aide&nbsp;? Réponds à cet email ou écris-nous sur WhatsApp <a href="https://wa.me/221777608983" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">${SUPPORT_WA}</a><br>
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
  // ─── Nouveaux templates centralisés dans src/lib/email-templates/ ───
  // (utilisés par les wrappers ci-dessous + l'edge function via mode RAW)
  welcomeV2: (params) => welcomeEmail(params),
  orderConfirmation: (params) => orderConfirmationEmail(params),
  orderStatusUpdate: (params) => orderStatusUpdateEmail(params),
  resetPassword: (params) => resetPasswordEmail(params),
  paymentVerified: (params) => paymentVerifiedEmail(params),

  // ─── Templates legacy (gardés pour compat avec Payment.jsx / Checkout.jsx) ───
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

  orderConfirmed: ({ firstName, order }) => {
    // Distinction commande standard vs preorder import
    const isPreorder = order.is_preorder === true;
    const leadDays = order.lead_time_days || 15;

    // Détails du paiement spécifique au preorder (acompte + solde)
    const paymentBlock = isPreorder ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F0F7FF;border-left:3px solid #0066CC;border-radius:10px;padding:16px;margin:16px 0;">
        <tr><td style="font-size:13px;color:#0066CC;font-weight:700;padding-bottom:8px;">💳 Acompte payé maintenant (50%)</td></tr>
        <tr><td style="font-size:22px;font-weight:800;color:#0066CC;">${fcfa(order.deposit_amount || order.total / 2)}</td></tr>
        <tr><td style="font-size:13px;color:#6B6B6B;padding:12px 0 6px;border-top:1px dashed #C7D7E8;margin-top:12px;">Solde à payer à l'arrivée (50%)</td></tr>
        <tr><td style="font-size:18px;font-weight:700;color:#444;">${fcfa(order.balance_amount || order.total / 2)}</td></tr>
        <tr><td style="font-size:12px;color:#888;padding-top:8px;">Paiement acompte : ${(order.payment_method || '').toUpperCase()}</td></tr>
      </table>
    ` : `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F9FAFB;border-radius:10px;padding:16px;margin:16px 0;">
        <tr><td style="font-size:13px;color:#6B6B6B;padding-bottom:8px;">Montant total</td></tr>
        <tr><td style="font-size:24px;font-weight:800;color:${BRAND_GREEN};">${fcfa(order.total)}</td></tr>
        <tr><td style="font-size:12px;color:#888;padding-top:4px;">Paiement : ${(order.payment_method || '').toUpperCase()}</td></tr>
      </table>
    `;

    // Texte de livraison adapté
    const deliveryBlock = isPreorder ? `
      <div style="background:#FFF5E6;border-left:3px solid ${BRAND_ORANGE};padding:14px 16px;border-radius:8px;margin:16px 0;">
        <div style="font-size:13px;font-weight:700;color:${BRAND_ORANGE};margin-bottom:6px;">✈️ Import direct YARAM</div>
        <p style="margin:0;font-size:14px;color:#444;line-height:1.5;">
          On commande ton produit pour toi à l'international. Délai d'arrivée à Dakar : <strong>~${leadDays} jours</strong>.
        </p>
        <p style="margin:8px 0 0;font-size:13px;color:#6B6B6B;line-height:1.5;">
          Tu seras notifié·e à chaque étape :<br>
          • Commande passée chez le fournisseur<br>
          • Produit en transit international<br>
          • Arrivé à Dakar — solde à payer<br>
          • En livraison vers toi
        </p>
      </div>
    ` : `
      <p style="margin:16px 0 24px;font-size:14px;color:#444;line-height:1.6;">
        Livraison estimée : <strong>24h ouvrées</strong> à l'adresse renseignée.
      </p>
    `;

    return {
      subject: isPreorder
        ? `✈️ Précommande ${order.id} confirmée — livraison sous ${leadDays}j`
        : `Commande ${order.id} confirmée ✓`,
      html: layout({
        title: isPreorder ? 'Précommande confirmée' : 'Commande confirmée',
        preheader: isPreorder
          ? `Ta précommande arrive sous ${leadDays} jours. Tu paies le solde à la réception.`
          : `Ta commande ${order.id} est en cours de préparation.`,
        body: `
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">Merci ${firstName} 🎉</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#444;">
            ${isPreorder
              ? `Ta précommande <strong>${order.id}</strong> est confirmée. Tu recevras un WhatsApp + email à chaque étape de l'import.`
              : `Ta commande <strong>${order.id}</strong> est confirmée. Tu recevras un WhatsApp + email à chaque étape.`}
          </p>
          ${paymentBlock}
          ${deliveryBlock}
          <div style="margin:24px 0;">${btn(isPreorder ? 'Suivre ma précommande' : 'Suivre ma commande', `${APP_URL}/order/${order.id}`)}</div>
        `,
      }),
    };
  },

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
        <div style="margin:24px 0;">${btn('Suivre en temps réel', `${APP_URL}/order/${order.id}`)}</div>
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
        <div style="margin:24px 0;">${btn('Noter ma livraison', `${APP_URL}/order/${order.id}`)}</div>
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

/**
 * Envoie le welcome email si l'utilisateur ne l'a pas encore reçu.
 * À appeler à chaque hydratation de la session (couvre signup email/password,
 * Google OAuth, magic link — tous les flows convergent ici).
 * Marque welcomed_at en DB pour éviter de re-envoyer.
 */
export async function maybeSendWelcomeEmail(user) {
  if (!user?.id || !user?.email) return;
  if (user.welcomed_at) return; // deja envoye
  const firstName = (user.first_name || (user.email.split('@')[0])).trim();

  const res = await sendEmail({
    to: user.email,
    template: 'welcome',
    params: { firstName },
  });
  if (!res.success) {
    // Si Resend KO, on ne marque pas → re-tentera au prochain login
    console.warn('[welcome] envoi echec, retry au prochain login:', res.error);
    return;
  }
  // Marque welcomed_at (UPSERT au cas où la row n'existe pas)
  try {
    await supabase
      .from('users_profile')
      .upsert(
        { id: user.id, email: user.email, welcomed_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
  } catch (e) {
    console.warn('[welcome] update welcomed_at failed:', e?.message);
  }
}

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

// ─────────────────────────────────────────────────────────────────────
// WRAPPERS HAUT-NIVEAU (templates centralisés v2)
// Les 4 fonctions ci-dessous récupèrent les data nécessaires depuis Supabase
// puis appellent l'edge function send-email en mode RAW.
// ─────────────────────────────────────────────────────────────────────

async function fetchOrderForEmail(orderId) {
  // FIX juin 2026 : on passe par la RPC SECURITY DEFINER get_order_for_email
  // qui bypass la RLS sur users_profile. Sans ça, quand l'admin valide un
  // paiement côté /?admin, la query users_profile retournait NULL (la RLS
  // n'autorise pas l'admin à lire le profile du client) → no_recipient → email
  // jamais envoyé. La RPC fait le lookup en service-level côté DB.
  try {
    const { data, error } = await supabase.rpc('get_order_for_email', {
      p_order_id: orderId,
    });
    if (error) {
      console.warn('[fetchOrderForEmail] rpc error:', error.message);
      return { order: null, profile: null };
    }
    if (!data || data.error) {
      return { order: null, profile: null };
    }
    return {
      order:   data.order   || null,
      profile: data.profile || null,
    };
  } catch (e) {
    console.warn('[fetchOrderForEmail] crash:', e?.message);
    return { order: null, profile: null };
  }
}

/**
 * Envoie la confirmation de commande à la cliente.
 * Récupère order + items + profil depuis Supabase et build le template côté client.
 */
export async function sendOrderConfirmation(orderId, userId = null) {
  if (!orderId) return { success: false, error: 'orderId requis' };
  const { order, profile } = await fetchOrderForEmail(orderId);
  if (!order) return { success: false, error: 'order_not_found' };

  const to = profile?.email;
  if (!to) return { success: false, error: 'no_recipient' };

  const firstName = profile?.first_name || order.address?.name?.split?.(' ')?.[0] || 'toi';
  const { subject, html } = orderConfirmationEmail({
    firstName,
    orderId: order.id,
    items: order.items || [],
    total: order.total,
    deliveryFee: order.delivery_fee,
    paymentMethod: order.payment_method,
    deliveryAddress: order.address,
    estimatedDeliveryDate: order.estimated_delivery_date,
  });

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, html },
    });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'envoi echec' };
    return { success: true, id: data.id };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Envoie un update de statut commande.
 * Si livreur affecté (status shipped/in_delivery), récupère son nom/tel.
 */
export async function sendOrderStatusUpdate(orderId, newStatus) {
  if (!orderId || !newStatus) return { success: false, error: 'orderId + newStatus requis' };
  const { order, profile } = await fetchOrderForEmail(orderId);
  if (!order) return { success: false, error: 'order_not_found' };

  const to = profile?.email;
  if (!to) return { success: false, error: 'no_recipient' };

  let livreurName = null;
  let livreurPhone = null;
  if (newStatus === 'shipped' || newStatus === 'in_delivery' || newStatus === 'out_for_delivery') {
    try {
      const { data: tracking } = await supabase
        .from('order_tracking')
        .select('livreur_name, livreur_phone, driver_name, driver_phone')
        .eq('order_id', orderId)
        .maybeSingle();
      livreurName = tracking?.livreur_name || tracking?.driver_name || null;
      livreurPhone = tracking?.livreur_phone || tracking?.driver_phone || null;
    } catch { /* table optionnelle */ }
  }

  const firstName = profile?.first_name || order.address?.name?.split?.(' ')?.[0] || 'toi';
  const { subject, html } = orderStatusUpdateEmail({
    firstName,
    orderId: order.id,
    newStatus,
    livreurName,
    livreurPhone,
  });

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, html },
    });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'envoi echec' };
    return { success: true, id: data.id };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Envoie un email de réinitialisation de mot de passe (Supabase auth side).
 * Utilise supabase.auth.resetPasswordForEmail() pour générer le lien magique,
 * puis l'envoie via Resend en HTML brandé YARAM (au lieu du template Supabase par défaut).
 *
 * Note : si l'app utilise déjà la config Supabase native (template SMTP dans
 * dashboard Supabase), cette fonction permet de la remplacer côté client.
 */
export async function sendResetPassword(email, { redirectTo, firstName, expiresInMinutes = 60 } = {}) {
  if (!email) return { success: false, error: 'email requis' };
  const cleanEmail = String(email).trim().toLowerCase();

  // 1. Génère le lien Supabase (envoie aussi l'email natif si SMTP configuré côté
  //    Supabase — sinon, on s'appuie sur Resend ci-dessous).
  let resetLink = `${APP_URL}/auth/reset`;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: redirectTo || `${APP_URL}/auth/reset`,
    });
    if (error) {
      console.warn('[resetPassword] supabase.auth error:', error.message);
      return { success: false, error: error.message };
    }
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }

  // 2. Email brandé via Resend en complément (si template Supabase natif désactivé).
  //    Si le template Supabase natif est actif, ce mail s'ajoute simplement par-dessus.
  let resolvedFirstName = firstName;
  if (!resolvedFirstName) {
    try {
      const { data } = await supabase
        .from('users_profile')
        .select('first_name')
        .eq('email', cleanEmail)
        .maybeSingle();
      resolvedFirstName = data?.first_name || cleanEmail.split('@')[0];
    } catch {
      resolvedFirstName = cleanEmail.split('@')[0];
    }
  }

  const { subject, html } = resetPasswordEmail({
    firstName: resolvedFirstName,
    resetLink,
    expiresInMinutes,
  });

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to: cleanEmail, subject, html },
    });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'envoi echec' };
    return { success: true, id: data.id };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Envoie l'email "Paiement reçu" IMMÉDIATEMENT quand le client clique "J'ai payé"
 * pour Wave/OM/Card. Confirme la réception et rassure que l'admin va vérifier.
 * À appeler depuis Payment.jsx juste après updateOrderStatus succès, en parallèle
 * des notifs pharmacie.
 */
export async function sendPaymentReceived(orderId) {
  if (!orderId) return { success: false, error: 'orderId requis' };
  const { order, profile } = await fetchOrderForEmail(orderId);
  if (!order) return { success: false, error: 'order_not_found' };

  const to = profile?.email;
  if (!to) return { success: false, error: 'no_recipient' };

  const firstName = profile?.first_name || order.address?.name?.split?.(' ')?.[0] || 'toi';
  const amount = order.is_preorder
    ? (order.deposit_amount || order.total)
    : order.total;

  // Import dynamique pour éviter d'alourdir le bundle initial.
  const { paymentReceivedEmail } = await import('./email-templates/payment-received');
  const { subject, html } = paymentReceivedEmail({
    firstName,
    orderId: order.id,
    amount,
    paymentMethod: order.payment_method,
  });

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, html },
    });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'envoi echec' };
    return { success: true, id: data.id };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Envoie l'email "paiement validé" après validation manuelle admin (Wave/OM).
 */
export async function sendPaymentVerified(orderId) {
  if (!orderId) return { success: false, error: 'orderId requis' };
  const { order, profile } = await fetchOrderForEmail(orderId);
  if (!order) return { success: false, error: 'order_not_found' };

  const to = profile?.email;
  if (!to) return { success: false, error: 'no_recipient' };

  const firstName = profile?.first_name || order.address?.name?.split?.(' ')?.[0] || 'toi';
  // Pour les preorders, c'est l'acompte qui est validé.
  const amount = order.is_preorder
    ? (order.deposit_amount || order.total)
    : order.total;

  const { subject, html } = paymentVerifiedEmail({
    firstName,
    orderId: order.id,
    amount,
    paymentMethod: order.payment_method,
  });

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, html },
    });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'envoi echec' };
    return { success: true, id: data.id };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Envoie un email lie a une commande. L'edge function resout l'email
 * destinataire cote serveur (cliente via users_profile, ou pharmas via
 * notification_email). Plus simple que de passer l'email depuis le client.
 *
 * Templates : orderConfirmed | orderShipped | orderDelivered | pharmacyNewOrder
 */
export async function sendOrderEmail(orderId, template, extraParams = {}) {
  if (!orderId || !template) return { success: false, error: 'orderId + template requis' };
  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { order_id: orderId, template, params: extraParams },
    });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'envoi echec' };
    return { success: true, data };
  } catch (e) {
    console.warn('[orderEmail] exception:', e?.message);
    return { success: false, error: e?.message || String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────
// ONBOARDING DRIP — wrappers haut-niveau
// Utilisés pour tester un envoi à la main (admin) ou depuis un script.
// Le cron quotidien passe par l'edge function `onboarding-drip` qui
// gère la sélection des candidats + l'idempotence côté serveur.
// ─────────────────────────────────────────────────────────────────────

async function fetchProfileForDrip(userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from('users_profile')
    .select('id, email, first_name, onboarding_drip_disabled, onboarding_drip_d2_sent_at, onboarding_drip_d7_sent_at, onboarding_drip_d30_sent_at')
    .eq('id', userId)
    .maybeSingle();
  return data || null;
}

async function markDripStep(userId, column) {
  try {
    await supabase
      .from('users_profile')
      .update({ [column]: new Date().toISOString() })
      .eq('id', userId);
  } catch (e) {
    console.warn(`[drip] mark ${column} failed:`, e?.message);
  }
}

/**
 * Envoie le drip J+2 ("on t'attend") à un user.
 * Idempotent : skip si déjà envoyé ou opt-out.
 */
export async function sendOnboardingD2(userId) {
  const profile = await fetchProfileForDrip(userId);
  if (!profile?.email) return { success: false, error: 'no_recipient' };
  if (profile.onboarding_drip_disabled) return { success: false, error: 'opted_out' };
  if (profile.onboarding_drip_d2_sent_at) return { success: false, error: 'already_sent' };

  const { subject, html } = onboardingD2Email({ firstName: profile.first_name || profile.email.split('@')[0] });
  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to: profile.email, subject, html },
    });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'envoi echec' };
    await markDripStep(userId, 'onboarding_drip_d2_sent_at');
    return { success: true, id: data.id };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Envoie le drip J+7 ("top 3 du moment") à un user.
 * `topProducts` est optionnel : si non fourni, fetch les 3 plus récents actifs.
 */
export async function sendOnboardingD7(userId, topProducts = null) {
  const profile = await fetchProfileForDrip(userId);
  if (!profile?.email) return { success: false, error: 'no_recipient' };
  if (profile.onboarding_drip_disabled) return { success: false, error: 'opted_out' };
  if (profile.onboarding_drip_d7_sent_at) return { success: false, error: 'already_sent' };

  let products = topProducts;
  if (!Array.isArray(products) || products.length === 0) {
    try {
      const { data } = await supabase
        .from('products')
        .select('id, name, brand, price, img, active')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(3);
      products = data || [];
    } catch {
      products = [];
    }
  }

  const { subject, html } = onboardingD7Email({
    firstName: profile.first_name || profile.email.split('@')[0],
    topProducts: products,
  });
  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to: profile.email, subject, html },
    });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'envoi echec' };
    await markDripStep(userId, 'onboarding_drip_d7_sent_at');
    return { success: true, id: data.id };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Envoie le drip J+30 ("bonus fidélité") à un user.
 * Si l'envoi réussit, crédite aussi 500 points via RPC add_loyalty_points.
 */
export async function sendOnboardingD30(userId) {
  const profile = await fetchProfileForDrip(userId);
  if (!profile?.email) return { success: false, error: 'no_recipient' };
  if (profile.onboarding_drip_disabled) return { success: false, error: 'opted_out' };
  if (profile.onboarding_drip_d30_sent_at) return { success: false, error: 'already_sent' };

  const { subject, html } = onboardingD30Email({ firstName: profile.first_name || profile.email.split('@')[0] });
  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to: profile.email, subject, html },
    });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'envoi echec' };
    await markDripStep(userId, 'onboarding_drip_d30_sent_at');
    // Securite : l'attribution des 500 points est faite cote serveur par
    // l'Edge Function `onboarding-drip` (qui utilise service_role).
    // Le RPC `add_loyalty_points` est verrouille `is_admin()` apres audit
    // securite du 2026-06-21.
    return { success: true, id: data.id };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}
