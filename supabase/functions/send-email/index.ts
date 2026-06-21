// ════════════════════════════════════════════════════════
// YARAM — Edge function : send-email (Resend wrapper)
// ════════════════════════════════════════════════════════
//
// 2 modes d'appel :
//
// 1. RAW : body = { to, subject, html, replyTo? }
//    → envoie directement via Resend, sans rendre de template.
//    Utilisé par src/lib/emails.js#sendEmail (le HTML est déjà rendu côté client).
//
// 2. ORDER : body = { order_id, template, params? }
//    → résout le destinataire côté serveur (users_profile.email pour la cliente,
//      pharmacies.notification_email pour pharmacyNewOrder), rend le template
//      avec les données de la commande, puis envoie via Resend.
//    Utilisé par src/lib/emails.js#sendOrderEmail.
//
// Templates supportés : welcome | orderConfirmed | orderShipped | orderDelivered
//                       | pharmacyNewOrder
//
// SECRETS Supabase requis :
//   - RESEND_API_KEY
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//
// Logs : pas de PII (pas d'email complet, pas de nom). On loggue juste
//        success/fail + template + ID Resend.
// ════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const FROM_DEFAULT = Deno.env.get("RESEND_FROM") || "YARAM <contact@yaram.app>";

// ─────────────────────────────────────────────────────────────────────
// CONSTANTES BRAND (miroir de src/lib/emails.js)
// ─────────────────────────────────────────────────────────────────────
const APP_URL = "https://yaram.app";
const BRAND_GREEN = "#1F8B4C";
const BRAND_ORANGE = "#E94E1B";
const SUPPORT_EMAIL = "contact@yaram.app";
const SUPPORT_WA = "+221 77 438 87 66";

function layout({ title, preheader, body }: { title: string; preheader?: string; body: string }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1A1A1A;">
<div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader || ""}</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F5F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
      <tr><td style="background:linear-gradient(135deg,${BRAND_GREEN} 0%,#166635 100%);padding:32px 24px;text-align:center;">
        <div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,0.12);border-radius:14px;line-height:56px;text-align:center;color:white;font-weight:800;font-size:28px;letter-spacing:-1px;">Y</div>
        <div style="margin-top:12px;color:rgba(255,255,255,0.9);font-size:11px;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;">YARAM · Beauté Sénégal</div>
      </td></tr>
      <tr><td style="padding:32px 32px 16px;">${body}</td></tr>
      <tr><td style="padding:24px 32px 32px;border-top:1px solid #EFEFEF;font-size:12px;color:#888;text-align:center;">
        Besoin d'aide&nbsp;? Réponds à cet email ou écris-nous sur WhatsApp <a href="https://wa.me/221774388766" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">${SUPPORT_WA}</a><br>
        <a href="${APP_URL}" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">${APP_URL}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_GREEN};text-decoration:none;">${SUPPORT_EMAIL}</a>
        <div style="margin-top:12px;color:#BBB;">© ${new Date().getFullYear()} YARAM</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function btn(label: string, href: string) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:${BRAND_GREEN};border-radius:10px;">
  <a href="${href}" style="display:inline-block;padding:14px 28px;color:white;font-weight:700;font-size:15px;text-decoration:none;">${label}</a>
</td></tr></table>`;
}

function fcfa(n: number | string | null | undefined) {
  return (Number(n) || 0).toLocaleString("fr-FR") + " FCFA";
}

// ─────────────────────────────────────────────────────────────────────
// TEMPLATES SERVEUR (utilisés seulement en mode ORDER)
// Pour le mode RAW le HTML est déjà rendu côté client.
// ─────────────────────────────────────────────────────────────────────

type OrderRow = {
  id: string;
  total: number;
  payment_method?: string;
  is_preorder?: boolean;
  lead_time_days?: number;
  deposit_amount?: number;
  balance_amount?: number;
};

const Templates: Record<
  string,
  (p: { firstName?: string; pharmacyName?: string; order?: OrderRow; statusLabel?: string; newStatus?: string }) => { subject: string; html: string }
> = {
  welcome: ({ firstName }) => ({
    subject: `Bienvenue sur YARAM, ${firstName} 💚`,
    html: layout({
      title: "Bienvenue sur YARAM",
      preheader: "Profite de -10% sur ta 1ère commande avec BIENVENUE10",
      body: `
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${BRAND_GREEN};">Bienvenue, ${firstName} 💚</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">Merci de rejoindre YARAM, la marketplace beauté validée pour ta peau africaine.</p>
        <div style="background:#FFF5E6;border-left:3px solid ${BRAND_ORANGE};padding:16px;border-radius:8px;margin:20px 0;">
          <div style="font-size:11px;font-weight:700;color:${BRAND_ORANGE};letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">CODE PROMO BIENVENUE</div>
          <div style="font-size:22px;font-weight:800;color:#1A1A1A;letter-spacing:1px;">BIENVENUE10</div>
          <div style="font-size:12px;color:#6B6B6B;margin-top:4px;">-10% sur ta 1ère commande dès 25 000 FCFA</div>
        </div>
        <div style="margin:28px 0;">${btn("Découvrir le catalogue", APP_URL)}</div>
      `,
    }),
  }),

  orderConfirmed: ({ firstName, order }) => {
    const o = order!;
    const isPre = o.is_preorder === true;
    const leadDays = o.lead_time_days || 15;
    const paymentBlock = isPre
      ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F0F7FF;border-left:3px solid #0066CC;border-radius:10px;padding:16px;margin:16px 0;">
          <tr><td style="font-size:13px;color:#0066CC;font-weight:700;padding-bottom:8px;">💳 Acompte payé (50%)</td></tr>
          <tr><td style="font-size:22px;font-weight:800;color:#0066CC;">${fcfa(o.deposit_amount || o.total / 2)}</td></tr>
          <tr><td style="font-size:13px;color:#6B6B6B;padding:12px 0 6px;">Solde à la livraison (50%) : <strong>${fcfa(o.balance_amount || o.total / 2)}</strong></td></tr>
        </table>`
      : `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F9FAFB;border-radius:10px;padding:16px;margin:16px 0;">
          <tr><td style="font-size:13px;color:#6B6B6B;padding-bottom:8px;">Montant total</td></tr>
          <tr><td style="font-size:24px;font-weight:800;color:${BRAND_GREEN};">${fcfa(o.total)}</td></tr>
          <tr><td style="font-size:12px;color:#888;padding-top:4px;">Paiement : ${(o.payment_method || "").toUpperCase()}</td></tr>
        </table>`;
    return {
      subject: isPre ? `✈️ Précommande ${o.id} confirmée — livraison sous ${leadDays}j` : `Commande ${o.id} confirmée ✓`,
      html: layout({
        title: isPre ? "Précommande confirmée" : "Commande confirmée",
        body: `
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">Merci ${firstName} 🎉</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#444;">Ta commande <strong>${o.id}</strong> est confirmée.</p>
          ${paymentBlock}
          <div style="margin:24px 0;">${btn(isPre ? "Suivre ma précommande" : "Suivre ma commande", `${APP_URL}/order/${o.id}`)}</div>
        `,
      }),
    };
  },

  orderShipped: ({ firstName, order }) => ({
    subject: `🛵 Commande ${order!.id} en route`,
    html: layout({
      title: "Commande en route",
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">${firstName}, le livreur arrive 🛵</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">Ta commande <strong>${order!.id}</strong> vient de partir.</p>
        <p style="margin:16px 0;font-size:14px;color:#444;">💵 Paiement à la livraison : <strong>${fcfa(order!.total)}</strong></p>
        <div style="margin:24px 0;">${btn("Suivre en temps réel", `${APP_URL}/order/${order!.id}`)}</div>
      `,
    }),
  }),

  orderDelivered: ({ firstName, order }) => ({
    subject: `Commande ${order!.id} livrée 💚`,
    html: layout({
      title: "Livrée !",
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">Bien reçu, ${firstName} 💚</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">Ta commande <strong>${order!.id}</strong> a été livrée.</p>
        <div style="margin:24px 0;">${btn("Noter ma livraison", `${APP_URL}/order/${order!.id}`)}</div>
      `,
    }),
  }),

  paymentVerified: ({ firstName, order }) => {
    const o = order!;
    const methodMap: Record<string, string> = {
      wave: "Wave", om: "Orange Money", orange_money: "Orange Money",
      free_money: "Free Money", paytech: "PayTech", cb: "Carte bancaire", cod: "À la livraison",
    };
    const method = methodMap[(o.payment_method || "").toLowerCase()] || (o.payment_method || "mobile money");
    const amount = o.is_preorder ? (o.deposit_amount || o.total) : o.total;
    return {
      subject: `Paiement validé · YARAM #${o.id}`,
      html: layout({
        title: "Paiement validé",
        preheader: `Ton paiement ${method} est validé — commande #${o.id} en préparation.`,
        body: `
          <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:6px;">Commande #${o.id}</div>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">Paiement validé ✅</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">Bonjour ${firstName}, on confirme la bonne réception de ton paiement ${method}. Ta commande passe maintenant en <strong>préparation</strong>.</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F9FAFB;border-radius:12px;padding:18px;margin:8px 0 18px;">
            <tr><td style="font-size:13px;color:#6B6B6B;padding:4px 0;">Montant validé</td><td style="font-size:18px;color:${BRAND_GREEN};padding:4px 0;text-align:right;font-weight:800;">${fcfa(amount)}</td></tr>
            <tr><td style="font-size:13px;color:#6B6B6B;padding:4px 0;">Méthode</td><td style="font-size:13px;color:#1A1A1A;padding:4px 0;text-align:right;font-weight:600;">${method}</td></tr>
          </table>
          <div style="margin:24px 0 8px;">${btn("Suivre ma commande", `${APP_URL}/order/${o.id}`)}</div>
        `,
      }),
    };
  },

  orderStatusUpdate: ({ firstName, order, statusLabel, newStatus }: any) => {
    const o = order!;
    const STATUS: Record<string, { label: string; emoji: string; title: string; body: string; cta: string }> = {
      paid: { label: "Paiement reçu", emoji: "💚", title: "Paiement confirmé", body: "Ta commande passe en préparation. On t'écrit dès qu'elle part.", cta: "Suivre ma commande" },
      preparing: { label: "En préparation", emoji: "🧴", title: "On prépare ta commande", body: "Notre partenaire prépare tes produits avec soin.", cta: "Voir le suivi" },
      shipped: { label: "En route", emoji: "🛵", title: "Le livreur arrive !", body: "Ta commande vient de partir. Reste joignable au numéro communiqué.", cta: "Suivre en temps réel" },
      in_delivery: { label: "En route", emoji: "🛵", title: "Le livreur arrive !", body: "Ta commande vient de partir. Reste joignable au numéro communiqué.", cta: "Suivre en temps réel" },
      delivered: { label: "Livrée", emoji: "✅", title: "Commande livrée 💚", body: "On espère que tu vas adorer tes produits.", cta: "Noter ma livraison" },
      awaiting_balance: { label: "Solde à payer", emoji: "💳", title: "Ta précommande est arrivée à Dakar", body: "Pour finaliser la livraison, il reste à régler le solde.", cta: "Payer le solde" },
      awaiting_confirm: { label: "À confirmer", emoji: "⏳", title: "Confirme la réception", body: "Confirme la bonne réception pour clôturer la transaction.", cta: "Confirmer la réception" },
      cancelled: { label: "Annulée", emoji: "⚠️", title: "Commande annulée", body: "Si tu as déjà payé, le remboursement est traité sous 48h.", cta: "Voir le détail" },
    };
    const meta = STATUS[newStatus] || { label: statusLabel || "Mise à jour", emoji: "📦", title: "Mise à jour de ta commande", body: "Ta commande vient d'être mise à jour.", cta: "Voir ma commande" };
    const label = statusLabel || meta.label;
    return {
      subject: `Update commande #${o.id} · ${label}`,
      html: layout({
        title: `Commande #${o.id} — ${label}`,
        preheader: meta.title,
        body: `
          <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:6px;">Commande #${o.id}</div>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">${meta.emoji} ${meta.title}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">Bonjour ${firstName}, ${meta.body}</p>
          <div style="background:#EBF7EF;border-radius:10px;padding:12px 16px;margin:18px 0;font-size:14px;color:#1A1A1A;"><strong style="color:${BRAND_GREEN};">Nouveau statut :</strong> ${label}</div>
          <div style="margin:24px 0 8px;">${btn(meta.cta, `${APP_URL}/order/${o.id}`)}</div>
        `,
      }),
    };
  },

  pharmacyNewOrder: ({ pharmacyName, order }) => ({
    subject: `Nouvelle commande YARAM #${order!.id}`,
    html: layout({
      title: "Nouvelle commande",
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:800;color:${BRAND_GREEN};">${pharmacyName}, nouvelle commande 📦</h1>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F9FAFB;border-radius:10px;padding:16px;margin:16px 0;">
          <tr><td style="font-size:13px;color:#6B6B6B;padding-bottom:4px;">Commande</td></tr>
          <tr><td style="font-size:18px;font-weight:700;">#${order!.id}</td></tr>
          <tr><td style="font-size:13px;color:#6B6B6B;padding-top:12px;">Montant</td></tr>
          <tr><td style="font-size:18px;font-weight:700;color:${BRAND_GREEN};">${fcfa(order!.total)}</td></tr>
        </table>
        <div style="margin:24px 0;">${btn("Ouvrir mon dashboard", `${APP_URL}/pharma`)}</div>
      `,
    }),
  }),
};

// ─────────────────────────────────────────────────────────────────────
// RESEND
// ─────────────────────────────────────────────────────────────────────

async function resendSend({
  to,
  subject,
  html,
  replyTo,
}: { to: string; subject: string; html: string; replyTo?: string | null }) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    return { success: false, error: "RESEND_API_KEY_missing" } as const;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_DEFAULT,
        to: [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: `resend_http_${res.status}`, detail: data } as const;
    }
    return { success: true, id: data?.id } as const;
  } catch (e) {
    return { success: false, error: (e as Error)?.message || String(e) } as const;
  }
}

// ─────────────────────────────────────────────────────────────────────
// SERVE
// ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "invalid_json" }, 400);
  }

  // ─── Mode 2 : ORDER (résolution destinataire côté serveur) ───
  if (typeof body.order_id === "string" && typeof body.template === "string") {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ success: false, error: "supabase_env_missing" }, 500);
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const template = body.template as string;
    const builder = Templates[template];
    if (!builder) return json({ success: false, error: `unknown_template:${template}` }, 400);

    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select("id, total, payment_method, is_preorder, lead_time_days, deposit_amount, balance_amount, user_id, pharmacy_id, address")
      .eq("id", body.order_id)
      .maybeSingle();
    if (orderErr || !order) {
      return json({ success: false, error: "order_not_found" }, 404);
    }

    let to: string | null = null;
    let firstName = "toi";
    let pharmacyName = "";

    if (template === "pharmacyNewOrder") {
      const { data: pharma } = await admin
        .from("pharmacies")
        .select("name, notification_email")
        .eq("id", order.pharmacy_id)
        .maybeSingle();
      to = pharma?.notification_email || null;
      pharmacyName = pharma?.name || "Partenaire";
    } else {
      const { data: profile } = await admin
        .from("users_profile")
        .select("email, first_name")
        .eq("id", order.user_id)
        .maybeSingle();
      to = profile?.email || null;
      firstName = profile?.first_name || (order.address?.name?.split?.(" ")?.[0]) || "toi";
    }

    if (!to) {
      console.warn(`[send-email] no recipient resolved for template=${template} order=${order.id}`);
      return json({ success: false, error: "no_recipient" }, 200);
    }

    const extraParams = (body.params && typeof body.params === "object") ? body.params as Record<string, unknown> : {};
    const { subject, html } = builder({
      firstName,
      pharmacyName,
      order: order as OrderRow,
      statusLabel: typeof extraParams.statusLabel === "string" ? extraParams.statusLabel : undefined,
      newStatus: typeof extraParams.newStatus === "string" ? extraParams.newStatus : undefined,
    });
    const result = await resendSend({ to, subject, html });
    console.log(`[send-email] template=${template} order=${order.id} success=${result.success}`);
    return json(result);
  }

  // ─── Mode 1 : RAW (HTML déjà rendu) ───
  const { to, subject, html, replyTo } = body as { to?: string; subject?: string; html?: string; replyTo?: string };
  if (!to || !subject || !html) {
    return json({ success: false, error: "to_subject_html_required" }, 400);
  }
  const result = await resendSend({ to, subject, html, replyTo: replyTo || null });
  console.log(`[send-email] raw subject_len=${subject.length} success=${result.success}`);
  return json(result);
});
