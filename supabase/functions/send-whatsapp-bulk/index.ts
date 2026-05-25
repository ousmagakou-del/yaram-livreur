// ════════════════════════════════════════════════════════
// YARAM Edge Function : send-whatsapp-bulk (v3 — blocks)
// ════════════════════════════════════════════════════════
//
// Envoie une SÉQUENCE de messages WhatsApp (1 à 4 blocks) à un lot
// de destinataires via WaSenderAPI.
//
// Chaque "block" est un message WhatsApp séparé. Types supportés :
// - { type: "image", image_url, caption }  → envoie image avec caption
// - { type: "text",  text }                → envoie texte (WhatsApp génère
//                                            le link preview automatiquement
//                                            si une URL est dans le texte)
//
// Pour chaque recipient :
//   - Envoie block 1
//   - Délai 1 sec
//   - Envoie block 2
//   - etc.
// Puis délai 2.5 sec avant le recipient suivant (anti-ban).
//
// SECRETS Supabase requis :
//   - WASENDER_API_KEY    : ta clé wasenderapi.com
//   - WASENDER_API_URL    : (optionnel) défaut https://wasenderapi.com/api/send-message
//   - WASENDER_RATE_MS    : (optionnel) défaut 2500 (entre recipients)
//   - WASENDER_BLOCK_MS   : (optionnel) défaut 1000 (entre blocks d'un même recipient)
//
// REQUEST BODY (JSON) :
//   {
//     token: "admin-session-token",
//     campaign_name: "Promo flash mai 2026",
//     blocks: [                                       // commun à tous
//       { type: "image", image_url: "https://...", caption: "" },
//       { type: "text",  text: "Découvre : https://yaram.app/promo" }
//     ],
//     recipients: [
//       { phone: "221774388766", name: "Aïssa", skin_type: "mixte" },
//       ...
//     ]
//   }
//
// Note : les blocks contiennent des placeholders {name}/{skinType}
// qui sont remplacés côté serveur avec les données de chaque recipient.
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

type Block =
  | { type: "image"; image_url: string; caption?: string }
  | { type: "text"; text: string };

type Recipient = {
  phone: string;
  name?: string;
  skin_type?: string;
  text?: string; // legacy : si pas de blocks, on accepte un text simple
};

function personalize(template: string, r: Recipient): string {
  if (!template) return "";
  return template
    .replace(/\{name\}/g, r.name || "toi")
    .replace(/\{skinType\}/g, r.skin_type || "");
}

async function sendOneBlock(
  url: string,
  apiKey: string,
  phone: string,
  block: Block,
  recipient: Recipient,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  let payload: Record<string, unknown>;

  if (block.type === "image") {
    const caption = personalize(block.caption || "", recipient);
    payload = { to: phone, text: caption, imageUrl: block.image_url };
  } else {
    const text = personalize(block.text || "", recipient);
    payload = { to: phone, text, previewUrl: true };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success !== false) {
      return {
        ok: true,
        messageId: data?.data?.messageId || data?.message_id || data?.id || undefined,
      };
    }
    return { ok: false, error: data?.error || data?.message || `http_${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  // ─── 1. Parse body ───────────────────────────────────────
  let body: {
    token?: string;
    campaign_name?: string;
    blocks?: Block[];
    image_url?: string | null;       // legacy v2
    recipients?: Recipient[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "invalid_json" }, 400);
  }

  const { token, campaign_name, recipients } = body || {};
  if (!token) return json({ success: false, error: "token_required" }, 401);
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return json({ success: false, error: "recipients_required" }, 400);
  }
  if (recipients.length > 500) {
    return json({ success: false, error: "max_500_per_batch" }, 400);
  }

  // ─── Construction de la liste de blocks (avec fallback legacy) ───
  let blocks: Block[] = Array.isArray(body.blocks) ? body.blocks : [];

  // Fallback v2 : si pas de blocks mais image_url + recipients[].text → 1 block image
  if (blocks.length === 0) {
    const firstText = recipients[0]?.text || "";
    if (body.image_url) {
      blocks = [{ type: "image", image_url: body.image_url, caption: firstText }];
    } else if (firstText) {
      blocks = [{ type: "text", text: firstText }];
    }
  }

  if (blocks.length === 0) {
    return json({ success: false, error: "no_blocks_to_send" }, 400);
  }
  if (blocks.length > 4) {
    return json({ success: false, error: "max_4_blocks" }, 400);
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

  // ─── 3. Log de la campagne ───────────────────────────────
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

  // ─── 4. Envoi en cascade ─────────────────────────────────
  const WASENDER_KEY = Deno.env.get("WASENDER_API_KEY");
  const WASENDER_URL = Deno.env.get("WASENDER_API_URL") || "https://wasenderapi.com/api/send-message";
  const RATE_MS = parseInt(Deno.env.get("WASENDER_RATE_MS") || "2500", 10);
  const BLOCK_MS = parseInt(Deno.env.get("WASENDER_BLOCK_MS") || "1000", 10);

  if (!WASENDER_KEY) {
    return json({ success: false, error: "WASENDER_API_KEY not configured" }, 500);
  }

  const details: Array<{
    phone: string;
    status: "sent" | "partial" | "failed" | "skipped";
    blocks_sent: number;
    blocks_total: number;
    errors?: string[];
  }> = [];
  let totalSent = 0;
  let totalFailed = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const phone = (r.phone || "").replace(/\D/g, "");
    if (!phone) {
      details.push({
        phone: r.phone,
        status: "skipped",
        blocks_sent: 0,
        blocks_total: blocks.length,
        errors: ["phone_empty"],
      });
      totalFailed++;
      continue;
    }

    let blocksSent = 0;
    const errors: string[] = [];

    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      const result = await sendOneBlock(WASENDER_URL, WASENDER_KEY, phone, block, r);
      if (result.ok) {
        blocksSent++;
      } else {
        errors.push(`block_${b}: ${result.error}`);
      }

      // Délai entre blocks d'un même recipient (sauf le dernier)
      if (b < blocks.length - 1 && BLOCK_MS > 0) {
        await new Promise((res) => setTimeout(res, BLOCK_MS));
      }
    }

    const status =
      blocksSent === blocks.length ? "sent"
      : blocksSent === 0          ? "failed"
      :                              "partial";

    details.push({
      phone,
      status,
      blocks_sent: blocksSent,
      blocks_total: blocks.length,
      errors: errors.length ? errors : undefined,
    });

    if (status === "sent" || status === "partial") totalSent++;
    if (status === "failed" || status === "skipped") totalFailed++;

    // Délai entre recipients (sauf le dernier)
    if (i < recipients.length - 1 && RATE_MS > 0) {
      await new Promise((res) => setTimeout(res, RATE_MS));
    }
  }

  // ─── 5. Update campagne ──────────────────────────────────
  if (campaignId) {
    await admin
      .from("marketing_campaigns")
      .update({
        status: "completed",
        sent_count: totalSent,
        failed_count: totalFailed,
        details: details,
        finished_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
  }

  return json({
    success: true,
    campaign_id: campaignId,
    sent: totalSent,
    failed: totalFailed,
    total: recipients.length,
    blocks_per_recipient: blocks.length,
    details,
  });
});
