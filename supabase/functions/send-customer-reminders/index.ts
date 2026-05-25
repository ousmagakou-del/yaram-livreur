// ════════════════════════════════════════════════════════
// YARAM — Edge function : send-customer-reminders (v1)
// ════════════════════════════════════════════════════════
//
// Envoie 4 types de rappels client via WhatsApp (WaSender) :
//
// 1. REPLENISHMENT : "Ton produit acheté il y a X jours va bientôt finir"
//    → Détecte les commandes 'delivered' où certains items approchent
//      la fin de leur durée d'utilisation moyenne (usage_duration_days)
//    → Envoyé entre 80% et 95% de la durée (ex: sérum 60j → entre J+48 et J+57)
//
// 2. REENGAGEMENT : "Ça fait 60+ jours qu'on ne t'a pas vue"
//    → User qui a déjà commandé MAIS pas commandé depuis >= 60 jours
//    → Envoyé 1 fois par 90 jours max
//
// 3. ANNIVERSARY : "Joyeux 1 an chez YARAM"
//    → Exactement 365 jours après la 1ère commande validée
//    → Envoyé 1 fois par user (anniversaire ne repasse pas)
//
// 4. SCAN_REFRESH : "Refais un scan, ta peau a peut-être évolué"
//    → User qui a fait un scan IA il y a >= 90 jours et n'a pas refait depuis
//    → Envoyé 1 fois par 120 jours max
//
// AUTH : pas de token requis (called from GitHub Actions cron avec un secret X-Cron-Token)
// CRON : tous les jours à 9h00 UTC (10h Dakar UTC+0)
// ════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-token, x-client-info, apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ─── Templates personnalisables (peuvent être déplacés en DB plus tard) ───
function tplReplenishment(p: {
  firstName: string;
  productName: string;
  brand: string;
  daysAgo: number;
  productUrl: string;
}) {
  return `Salut ${p.firstName} 👋\n\n` +
    `Ton ${p.brand} ${p.productName} acheté il y a ${p.daysAgo} jours ` +
    `devrait être bientôt terminé ✨\n\n` +
    `Renouvelle maintenant avec -10% :\n` +
    `🎁 Code : FIDELE10\n` +
    `👉 ${p.productUrl}\n\n` +
    `À bientôt 💚\nL'équipe YARAM`;
}

function tplReengagement(p: { firstName: string }) {
  return `Coucou ${p.firstName} 💚\n\n` +
    `Ça fait un moment qu'on ne s'est pas vues ! Notre catalogue a évolué ` +
    `— viens découvrir les nouveautés.\n\n` +
    `🎁 Code : COMEBACK15 (-15% sur ta prochaine commande)\n` +
    `👉 https://yaram.app\n\n` +
    `L'équipe YARAM`;
}

function tplAnniversary(p: { firstName: string }) {
  return `🎉 Joyeux 1 an chez YARAM, ${p.firstName} !\n\n` +
    `Merci pour ta confiance depuis le début. Voilà un petit cadeau :\n\n` +
    `🎁 Code : MERCI20 (-20% sur ta prochaine commande)\n` +
    `👉 https://yaram.app\n\n` +
    `Avec ❤️\nL'équipe YARAM`;
}

function tplScanRefresh(p: { firstName: string; daysAgo: number }) {
  return `Hey ${p.firstName} ✨\n\n` +
    `Ton dernier scan peau date d'il y a ${p.daysAgo} jours. Ta peau a peut-être ` +
    `évolué depuis — refais un scan en 30 secondes pour ajuster tes recommandations !\n\n` +
    `👉 https://yaram.app/scan\n\n` +
    `L'équipe YARAM`;
}

// ─── Helper : envoie via WaSender ───
async function sendWhatsApp(phone: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const WASENDER_KEY = Deno.env.get("WASENDER_API_KEY");
  const WASENDER_URL = Deno.env.get("WASENDER_API_URL") || "https://wasenderapi.com/api/send-message";
  if (!WASENDER_KEY) return { ok: false, error: "WASENDER_API_KEY not set" };

  const cleanPhone = (phone || "").replace(/\D/g, "");
  if (!cleanPhone) return { ok: false, error: "phone_invalid" };

  try {
    const res = await fetch(WASENDER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WASENDER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: cleanPhone, text }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success !== false) return { ok: true };
    return { ok: false, error: data?.error || data?.message || `http_${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) };
  }
}

// ─── Helper : a-t-on déjà envoyé ce type de rappel à ce user dans X derniers jours ? ───
async function alreadySent(
  admin: ReturnType<typeof createClient>,
  userId: string,
  type: string,
  productId: string | null,
  withinDays: number,
): Promise<boolean> {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString();
  const q = admin
    .from("reminder_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("type", type)
    .gte("sent_at", since)
    .limit(1);

  // product_id matters for replenishment (different products → différents rappels)
  if (productId) q.eq("product_id", productId);

  const { data } = await q;
  return (data?.length || 0) > 0;
}

// ─── Helper : log l'envoi (succès ou échec) ───
async function logSend(
  admin: ReturnType<typeof createClient>,
  payload: {
    user_id: string;
    type: string;
    product_id?: string | null;
    order_id?: string | null;
    scan_id?: string | null;
    status: "sent" | "failed" | "skipped";
    message_preview: string;
    error_text?: string;
  },
) {
  await admin.from("reminder_logs").insert({
    user_id: payload.user_id,
    type: payload.type,
    product_id: payload.product_id || null,
    order_id: payload.order_id || null,
    scan_id: payload.scan_id || null,
    channel: "whatsapp",
    status: payload.status,
    message_preview: payload.message_preview.slice(0, 200),
    error_text: payload.error_text || null,
  });
}

// ─── MAIN ─────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  // Auth simple : header X-Cron-Token doit matcher le secret REMINDER_CRON_TOKEN
  const expected = Deno.env.get("REMINDER_CRON_TOKEN");
  const provided = req.headers.get("x-cron-token");
  if (!expected || provided !== expected) {
    return json({ success: false, error: "unauthorized" }, 401);
  }

  // Optionnel : filtre par type (replenishment | reengagement | anniversary | scan_refresh)
  // Si pas fourni, on traite les 4 types.
  let body: { types?: string[]; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* body optional */ }
  const types = body.types || ["replenishment", "reengagement", "anniversary", "scan_refresh"];
  const dryRun = body.dry_run === true;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const stats = {
    replenishment: { sent: 0, failed: 0, skipped: 0 },
    reengagement: { sent: 0, failed: 0, skipped: 0 },
    anniversary: { sent: 0, failed: 0, skipped: 0 },
    scan_refresh: { sent: 0, failed: 0, skipped: 0 },
  };

  // ═══ TYPE 1 : REPLENISHMENT (épuisement) ═══════════════
  if (types.includes("replenishment")) {
    // Commandes livrées entre J-180 et J-30 (fenêtre raisonnable)
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const until = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: orders } = await admin
      .from("orders")
      .select("id, user_id, items, created_at")
      .eq("status", "delivered")
      .gte("created_at", since)
      .lte("created_at", until);

    for (const order of (orders || [])) {
      const items = Array.isArray(order.items) ? order.items : [];
      for (const item of items) {
        const productId = item.id;
        if (!productId) continue;

        // Fetch durée d'utilisation du produit
        const { data: product } = await admin
          .from("products")
          .select("id, name, brand, usage_duration_days")
          .eq("id", productId)
          .maybeSingle();
        if (!product) continue;

        const duration = product.usage_duration_days || 60;
        const daysAgo = Math.floor((Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60 * 24));

        // Fenêtre de tir : entre 80% et 95% de la durée
        const fireMin = Math.floor(duration * 0.8);
        const fireMax = Math.floor(duration * 0.95);
        if (daysAgo < fireMin || daysAgo > fireMax) continue;

        // Anti-doublon : pas re-envoyé pour ce produit dans les 90 derniers jours
        if (await alreadySent(admin, order.user_id, "replenishment", productId, 90)) continue;

        // Fetch user
        const { data: user } = await admin
          .from("users_profile")
          .select("first_name, phone")
          .eq("id", order.user_id)
          .maybeSingle();
        if (!user?.phone) {
          stats.replenishment.skipped++;
          continue;
        }

        const msg = tplReplenishment({
          firstName: user.first_name || "toi",
          productName: product.name,
          brand: product.brand || "",
          daysAgo,
          productUrl: `https://yaram.app/product/${productId}`,
        });

        if (dryRun) {
          stats.replenishment.sent++; // simule envoi
          continue;
        }

        const res = await sendWhatsApp(user.phone, msg);
        await logSend(admin, {
          user_id: order.user_id,
          type: "replenishment",
          product_id: productId,
          order_id: order.id,
          status: res.ok ? "sent" : "failed",
          message_preview: msg,
          error_text: res.error,
        });
        if (res.ok) stats.replenishment.sent++;
        else stats.replenishment.failed++;

        // Rate limit anti-ban WhatsApp : 2 sec entre envois
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  // ═══ TYPE 2 : REENGAGEMENT (60+ jours sans commande) ═══
  if (types.includes("reengagement")) {
    const since60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    // Users qui ont déjà commandé MAIS pas dans les 60 derniers jours
    const { data: candidates } = await admin
      .from("users_profile")
      .select("id, first_name, phone")
      .not("phone", "is", null);

    for (const user of (candidates || [])) {
      // Sa dernière commande
      const { data: lastOrder } = await admin
        .from("orders")
        .select("created_at")
        .eq("user_id", user.id)
        .in("status", ["delivered", "completed", "paid", "shipped"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastOrder) continue; // jamais commandé → pas de réengagement (c'est de l'acquisition)
      if (new Date(lastOrder.created_at) > new Date(since60d)) continue; // a commandé < 60j

      // Anti-doublon : 1 réengagement par 90j max
      if (await alreadySent(admin, user.id, "reengagement", null, 90)) continue;

      const msg = tplReengagement({ firstName: user.first_name || "toi" });

      if (dryRun) {
        stats.reengagement.sent++;
        continue;
      }

      const res = await sendWhatsApp(user.phone, msg);
      await logSend(admin, {
        user_id: user.id,
        type: "reengagement",
        status: res.ok ? "sent" : "failed",
        message_preview: msg,
        error_text: res.error,
      });
      if (res.ok) stats.reengagement.sent++;
      else stats.reengagement.failed++;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ═══ TYPE 3 : ANNIVERSARY (1 an après 1ère commande) ═══
  if (types.includes("anniversary")) {
    // Users dont la 1ère commande est entre J-366 et J-364 (fenêtre 3 jours)
    const minDate = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString();
    const maxDate = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000).toISOString();

    const { data: firstOrders } = await admin
      .from("orders")
      .select("user_id, created_at, id")
      .in("status", ["delivered", "completed", "paid", "shipped"])
      .gte("created_at", minDate)
      .lte("created_at", maxDate);

    for (const order of (firstOrders || [])) {
      // Vérifier que c'est BIEN sa 1ère commande
      const { data: earlier } = await admin
        .from("orders")
        .select("id")
        .eq("user_id", order.user_id)
        .lt("created_at", order.created_at)
        .limit(1);
      if (earlier && earlier.length > 0) continue;

      // Anti-doublon : on n'envoie l'anniv qu'1 fois dans la vie
      if (await alreadySent(admin, order.user_id, "anniversary", null, 365 * 10)) continue;

      const { data: user } = await admin
        .from("users_profile")
        .select("first_name, phone")
        .eq("id", order.user_id)
        .maybeSingle();
      if (!user?.phone) {
        stats.anniversary.skipped++;
        continue;
      }

      const msg = tplAnniversary({ firstName: user.first_name || "toi" });

      if (dryRun) {
        stats.anniversary.sent++;
        continue;
      }

      const res = await sendWhatsApp(user.phone, msg);
      await logSend(admin, {
        user_id: order.user_id,
        type: "anniversary",
        order_id: order.id,
        status: res.ok ? "sent" : "failed",
        message_preview: msg,
        error_text: res.error,
      });
      if (res.ok) stats.anniversary.sent++;
      else stats.anniversary.failed++;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ═══ TYPE 4 : SCAN_REFRESH (90 jours sans nouveau scan) ═══
  if (types.includes("scan_refresh")) {
    const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Tous les users qui ont au moins 1 scan
    const { data: lastScans } = await admin
      .from("skin_scans")
      .select("user_id, created_at, id")
      .order("created_at", { ascending: false });

    // On garde uniquement le dernier scan de chaque user
    const lastScanByUser = new Map<string, { created_at: string; id: string }>();
    for (const scan of (lastScans || [])) {
      if (!lastScanByUser.has(scan.user_id)) {
        lastScanByUser.set(scan.user_id, { created_at: scan.created_at, id: scan.id });
      }
    }

    for (const [userId, scan] of lastScanByUser) {
      if (new Date(scan.created_at) > new Date(since90d)) continue; // récent

      // Anti-doublon : 1 rappel scan par 120j max
      if (await alreadySent(admin, userId, "scan_refresh", null, 120)) continue;

      const { data: user } = await admin
        .from("users_profile")
        .select("first_name, phone")
        .eq("id", userId)
        .maybeSingle();
      if (!user?.phone) {
        stats.scan_refresh.skipped++;
        continue;
      }

      const daysAgo = Math.floor((Date.now() - new Date(scan.created_at).getTime()) / (1000 * 60 * 60 * 24));
      const msg = tplScanRefresh({
        firstName: user.first_name || "toi",
        daysAgo,
      });

      if (dryRun) {
        stats.scan_refresh.sent++;
        continue;
      }

      const res = await sendWhatsApp(user.phone, msg);
      await logSend(admin, {
        user_id: userId,
        type: "scan_refresh",
        scan_id: scan.id,
        status: res.ok ? "sent" : "failed",
        message_preview: msg,
        error_text: res.error,
      });
      if (res.ok) stats.scan_refresh.sent++;
      else stats.scan_refresh.failed++;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return json({
    success: true,
    dry_run: dryRun,
    stats,
    total_sent: Object.values(stats).reduce((s, x) => s + x.sent, 0),
    total_failed: Object.values(stats).reduce((s, x) => s + x.failed, 0),
  });
});
