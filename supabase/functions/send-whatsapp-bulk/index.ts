// ════════════════════════════════════════════════════════
// YARAM Edge Function : send-whatsapp-bulk (v2 — avec image)
// ════════════════════════════════════════════════════════
//
// Envoie un message WhatsApp (texte OU image+caption) à un lot de
// destinataires via WaSenderAPI. Conçue pour la section Marketing.
//
// SECRETS Supabase requis (Dashboard → Edge Functions → Secrets) :
//   - WASENDER_API_KEY    : ta clé API depuis wasenderapi.com
//   - WASENDER_API_URL    : (optionnel) URL endpoint, par défaut
//                           https://wasenderapi.com/api/send-message
//   - WASENDER_RATE_MS    : (optionnel) délai entre 2 envois en ms,
//                           par défaut 2500 (anti-ban WhatsApp)
//
// REQUEST BODY (JSON) :
//   {
//     token: "admin-session-token",
//     campaign_name: "Promo flash mai 2026",
//     image_url: "https://...jpg" | null,       // optionnel : commun à tous
//     recipients: [
//       { phone: "221774388766", text: "Salut Aïssa 👋 ..." },
//       { phone: "221773456789", text: "Salut Fatou 👋 ..." }
//     ]
//   }
//
// Si image_url est fourni → c'est envoyé en image+caption pour TOUS.
// Sinon → message texte simple.
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  // ─── 1. Parse body ───────────────────────────────────────
  let body: {
    token?: string;
    campaign_name?: string;
    image_url?: string | null;
    recipients?: { phone: string; text: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "invalid_json" }, 400);
  }

  const { token, campaign_name, image_url, recipients } = body || {};
  if (!token) return json({ success: false, error: "token_required" }, 401);
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return json({ success: false, error: "recipients_required" }, 400);
  }
  if (recipients.length > 500) {
    return json({ success: false, error: "max_500_per_batch" }, 400);
  }

  // ─── 2. Vérifie le token admin ───────────────────────────
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: session, error: sessErr } = await admin
    .from("admin_sessions")
    .select("admin_email, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (sessErr || !session) return json({ success: false, error: "invalid_token" }, 401);
  if (new Date(session.expires_at) < new Date()) {
    return json({ success: false, error: "session_expired" }, 401);
  }

  // ─── 3. Crée la campagne en DB ───────────────────────────
  const { data: campaign, error: campErr } = await admin
    .from("marketing_campaigns")
    .insert({
      name: campaign_name || "Campagne sans nom",
      sent_by: session.admin_email,
      target_count: recipients.length,
      status: "in_progress",
    })
    .select()
    .single();

  const campaignId = campaign?.id || null;
  if (campErr) console.warn("[whatsapp] campaign insert failed:", campErr.message);

  // ─── 4. Appelle WaSender en boucle avec délai anti-ban ───
  const WASENDER_KEY = Deno.env.get("WASENDER_API_KEY");
  const WASENDER_URL = Deno.env.get("WASENDER_API_URL") || "https://wasenderapi.com/api/send-message";
  const RATE_MS = parseInt(Deno.env.get("WASENDER_RATE_MS") || "2500", 10);

  if (!WASENDER_KEY) {
    return json({ success: false, error: "WASENDER_API_KEY not configured" }, 500);
  }

  const details: Array<{ phone: string; status: string; message_id?: string; error?: string }> = [];
  let sent = 0;
  let failed = 0;

  const cleanImageUrl = (image_url && typeof image_url === "string" && image_url.trim()) ? image_url.trim() : null;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const phone = (r.phone || "").replace(/\D/g, "");
    if (!phone || (!r.text && !cleanImageUrl)) {
      details.push({ phone: r.phone, status: "skipped", error: "phone_or_text_empty" });
      failed++;
      continue;
    }

    // ─── Construction du payload WaSenderAPI ───
    // Format texte simple : { to, text }
    // Format image + caption : { to, text, imageUrl }
    // (WaSenderAPI utilise le même endpoint, on ajoute imageUrl si présent.)
    const payload: Record<string, unknown> = { to: phone, text: r.text || "" };
    if (cleanImageUrl) payload.imageUrl = cleanImageUrl;

    try {
      const res = await fetch(WASENDER_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${WASENDER_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && (data?.success !== false)) {
        sent++;
        details.push({
          phone,
          status: "sent",
          message_id: data?.data?.messageId || data?.message_id || data?.id || null,
        });
      } else {
        failed++;
        details.push({
          phone,
          status: "failed",
          error: data?.error || data?.message || `http_${res.status}`,
        });
      }
    } catch (e) {
      failed++;
      details.push({ phone, status: "failed", error: (e as Error)?.message || String(e) });
    }

    // Délai anti-ban entre 2 envois (sauf le dernier)
    if (i < recipients.length - 1 && RATE_MS > 0) {
      await new Promise((r) => setTimeout(r, RATE_MS));
    }
  }

  // ─── 5. Met à jour la campagne avec le résultat ──────────
  if (campaignId) {
    await admin
      .from("marketing_campaigns")
      .update({
        status: "completed",
        sent_count: sent,
        failed_count: failed,
        details: details,
        finished_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
  }

  return json({
    success: true,
    campaign_id: campaignId,
    sent,
    failed,
    total: recipients.length,
    image_used: !!cleanImageUrl,
    details,
  });
});
