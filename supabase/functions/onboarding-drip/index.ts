// ════════════════════════════════════════════════════════
// YARAM — Edge function : onboarding-drip
// ════════════════════════════════════════════════════════
//
// Drip d'onboarding pour les nouvelles users qui ne sont pas encore passées
// à l'achat. 3 emails à J+2, J+7 et J+30 après inscription.
//
//   J+2  → "Tu n'as pas encore essayé YARAM ?"   (rappel BIENVENUE10)
//   J+7  → "Le top 3 du moment"                  (3 best-sellers de la semaine)
//   J+30 → "Bonus fidélité"                      (+ crédit de 500 points)
//
// Idempotent : chaque envoi est marqué via les colonnes
//   users_profile.onboarding_drip_d{2,7,30}_sent_at
// Et bloqué si users_profile.onboarding_drip_disabled = true (opt-out marketing).
//
// AUTH : header Authorization: Bearer ${ONBOARDING_DRIP_TOKEN}
//        (le cron pg_cron passe app.cron_secret — voir migration associée)
//
// CRON : 1×/jour à 10h UTC (10h Dakar)
//
// SECRETS Supabase requis :
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - RESEND_API_KEY
//   - ONBOARDING_DRIP_TOKEN          (auth de la fonction)
//   - RESEND_FROM (optionnel, default: "YARAM <contact@yaram.app>")
// ════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ─── CORS / réponse JSON ────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ─── Constantes brand (miroir _shared.js) ───────────────────
const APP_URL = "https://yaram.app";
const BRAND_GREEN = "#1F8B4C";
const BRAND_ACCENT = "#F4B53A";
const BRAND_ORANGE = "#E94E1B";
const SUPPORT_EMAIL = "contact@yaram.app";
const SUPPORT_WA = "+221 77 438 87 66";
const FROM_DEFAULT = Deno.env.get("RESEND_FROM") || "YARAM <contact@yaram.app>";

// ─── Helpers HTML (inline only) ─────────────────────────────
function escapeHtml(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function fcfa(n: number | string | null | undefined) {
  return (Number(n) || 0).toLocaleString("fr-FR") + " FCFA";
}
function btn(label: string, href: string, color = BRAND_GREEN) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:${color};border-radius:10px;">
  <a href="${href}" style="display:inline-block;padding:14px 28px;color:white;font-weight:700;font-size:15px;text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}
function layout({ title, preheader, body }: { title: string; preheader?: string; body: string }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1A1A1A;">
<div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader || "")}</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F5F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
      <tr><td style="background:linear-gradient(135deg,${BRAND_GREEN} 0%,#166635 100%);padding:32px 24px;text-align:center;">
        <div style="display:inline-block;padding:8px 18px;background:rgba(255,255,255,0.14);border-radius:12px;color:white;font-weight:800;font-size:22px;letter-spacing:2px;">YARAM</div>
        <div style="margin-top:10px;color:rgba(255,255,255,0.9);font-size:11px;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;">Beauté · Sénégal</div>
      </td></tr>
      <tr><td style="padding:32px 32px 16px;">${body}</td></tr>
      <tr><td style="padding:24px 32px 32px;border-top:1px solid #EFEFEF;font-size:12px;color:#888;text-align:center;line-height:1.7;">
        Besoin d'aide&nbsp;? Réponds à cet email ou écris-nous sur WhatsApp <a href="https://wa.me/221774388766" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">${SUPPORT_WA}</a><br>
        <a href="${APP_URL}" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">${APP_URL}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_GREEN};text-decoration:none;">${SUPPORT_EMAIL}</a>
        <div style="margin-top:14px;color:#AAA;font-size:11px;">
          Tu reçois cet email parce que tu as un compte chez <a href="${APP_URL}" style="color:#888;text-decoration:underline;">yaram.app</a> —
          <a href="${APP_URL}/profile/notifications" style="color:#888;text-decoration:underline;">désactiver les emails marketing</a>
        </div>
        <div style="margin-top:10px;color:#BBB;">© ${year} YARAM · Dakar, Sénégal</div>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

// ─── Templates (dupliqués côté Deno car l'edge function ne peut pas
//     importer du JS via src/lib en prod) ───────────────────
function tplD2(firstName: string) {
  const name = escapeHtml(firstName || "toi");
  return {
    subject: "Tu n'as pas encore essayé YARAM ?",
    html: layout({
      title: "On t'attend chez YARAM",
      preheader: "Ton code BIENVENUE10 expire bientôt — profite vite de -10%.",
      body: `
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${BRAND_GREEN};line-height:1.2;">${name}, on t'attend 💚</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">On a vu que tu n'as pas encore fait ta 1ère commande chez YARAM. Pas de stress — ton code <strong>BIENVENUE10</strong> est toujours actif, mais il <strong>expire bientôt</strong>.</p>
        <div style="background:#FFF8E7;border-left:4px solid ${BRAND_ACCENT};padding:18px;border-radius:10px;margin:24px 0;">
          <div style="font-size:11px;font-weight:700;color:#8A6A12;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:6px;">Code promo bienvenue</div>
          <div style="font-size:26px;font-weight:800;color:#1A1A1A;letter-spacing:2px;font-family:Menlo,Consolas,monospace;">BIENVENUE10</div>
          <div style="font-size:13px;color:#6B6B6B;margin-top:6px;">-10% sur ta 1ère commande dès <strong>25 000 FCFA</strong>.</div>
        </div>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#444;">Ce que tu rates en attendant&nbsp;:</p>
        <ul style="padding-left:18px;margin:0 0 18px;color:#444;line-height:1.8;font-size:14px;">
          <li>800+ produits beauté validés pour peau africaine</li>
          <li>Livraison express à Dakar (24h ouvrées)</li>
          <li>Scan IA peau gratuit et personnalisé</li>
          <li>Paiement Wave, Orange Money ou à la livraison</li>
        </ul>
        <div style="margin:28px 0 16px;">${btn("Explorer le catalogue", `${APP_URL}/?utm_source=email&utm_medium=drip&utm_campaign=onboarding_d2`, BRAND_ORANGE)}</div>
        <p style="margin:24px 0 0;font-size:13px;color:#888;line-height:1.6;">Une question, un doute&nbsp;? Réponds simplement à cet email, on est là pour t'aider.</p>`,
    }),
  };
}

type LiteProduct = { id: string; name: string; brand?: string; price?: number; img?: string };

function tplD7(firstName: string, topProducts: LiteProduct[]) {
  const name = escapeHtml(firstName || "toi");
  const products = (topProducts || []).slice(0, 3);
  const cards = products.length
    ? products.map((p) => {
        const pname = escapeHtml(p?.name || "");
        const brand = escapeHtml(p?.brand || "");
        const price = fcfa(p?.price || 0);
        const img = p?.img ? escapeHtml(p.img) : "";
        const url = `${APP_URL}/product/${escapeHtml(p?.id || "")}`;
        const imgCell = img
          ? `<img src="${img}" alt="${pname}" width="80" height="80" style="display:block;width:80px;height:80px;border-radius:10px;object-fit:cover;background:#F0F2F5;">`
          : `<div style="width:80px;height:80px;border-radius:10px;background:#F0F2F5;"></div>`;
        return `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:10px 0;border:1px solid #EFEFEF;border-radius:12px;">
            <tr>
              <td style="padding:14px;width:96px;vertical-align:top;">${imgCell}</td>
              <td style="padding:14px 14px 14px 0;vertical-align:top;">
                <div style="font-size:11px;color:#888;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">${brand}</div>
                <div style="font-size:15px;color:#1A1A1A;font-weight:700;margin:4px 0 6px;line-height:1.3;">${pname}</div>
                <div style="font-size:15px;color:${BRAND_GREEN};font-weight:800;">${price}</div>
                <div style="margin-top:8px;"><a href="${url}" style="display:inline-block;font-size:13px;color:${BRAND_GREEN};text-decoration:none;font-weight:700;">Voir le produit →</a></div>
              </td>
            </tr>
          </table>`;
      }).join("")
    : `<p style="margin:8px 0;font-size:14px;color:#666;">Découvre notre top 3 directement sur l'app.</p>`;

  return {
    subject: "Voici ce que les Sénégalaises adorent en ce moment",
    html: layout({
      title: "Le top 3 YARAM de la semaine",
      preheader: "3 best-sellers validés par nos clientes — à découvrir.",
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};line-height:1.25;">${name}, voici les chouchous du moment ✨</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#444;">Tu hésites par où commencer&nbsp;? Voici les <strong>3 produits préférés des Sénégalaises cette semaine</strong> — testés, approuvés, livrés en 24h à Dakar.</p>
        ${cards}
        <div style="background:#FFF8E7;border-left:4px solid ${BRAND_ACCENT};padding:14px 16px;border-radius:10px;margin:24px 0;font-size:13px;color:#6B6B6B;line-height:1.5;">Petit rappel&nbsp;: ton code <strong style="color:#1A1A1A;font-family:Menlo,Consolas,monospace;letter-spacing:1px;">BIENVENUE10</strong> te donne -10% sur ta 1ère commande dès 25 000 FCFA.</div>
        <div style="margin:28px 0 16px;">${btn("Voir le top 3", `${APP_URL}/?utm_source=email&utm_medium=drip&utm_campaign=onboarding_d7`)}</div>
        <p style="margin:24px 0 0;font-size:13px;color:#888;line-height:1.6;">Tu cherches un produit précis&nbsp;? Réponds à cet email avec ton type de peau ou tes besoins — on te fait une reco perso.</p>`,
    }),
  };
}

function tplD30(firstName: string) {
  const name = escapeHtml(firstName || "toi");
  return {
    subject: "On t'offre 500 points fidélité pour revenir",
    html: layout({
      title: "Cadeau YARAM : 500 points fidélité",
      preheader: "500 points crédités sur ton compte — équivalent -500 FCFA.",
      body: `
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${BRAND_GREEN};line-height:1.2;">${name}, on te connaît pas encore 🎁</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">Ça fait un mois que tu as rejoint YARAM mais on n'a pas encore eu le plaisir de te livrer un colis. On veut absolument te faire découvrir, alors voici un petit cadeau pour t'aider à franchir le pas.</p>
        <div style="background:linear-gradient(135deg,${BRAND_GREEN} 0%,#166635 100%);padding:24px 22px;border-radius:14px;margin:24px 0;color:white;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85;margin-bottom:8px;">Bonus offert</div>
          <div style="font-size:32px;font-weight:900;letter-spacing:-0.5px;">500 points fidélité</div>
          <div style="font-size:13px;opacity:0.9;margin-top:6px;line-height:1.5;">Crédités directement sur ton compte YARAM — <strong>équivalent à -500 FCFA</strong> sur ta 1ère commande.</div>
        </div>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#444;">Comment les utiliser&nbsp;?</p>
        <ol style="padding-left:20px;margin:0 0 18px;color:#444;line-height:1.8;font-size:14px;">
          <li>Connecte-toi à l'app YARAM</li>
          <li>Choisis tes produits préférés</li>
          <li>Au checkout, applique tes points fidélité</li>
        </ol>
        <div style="background:#FFF8E7;border-left:4px solid ${BRAND_ACCENT};padding:14px 16px;border-radius:10px;margin:20px 0;font-size:13px;color:#6B6B6B;line-height:1.5;">Bonus&nbsp;: cumule-les avec ton code <strong style="color:#1A1A1A;font-family:Menlo,Consolas,monospace;letter-spacing:1px;">BIENVENUE10</strong> pour économiser encore plus sur ta 1ère commande.</div>
        <div style="margin:28px 0 16px;">${btn("Commencer maintenant", `${APP_URL}/?utm_source=email&utm_medium=drip&utm_campaign=onboarding_d30`, BRAND_ORANGE)}</div>
        <p style="margin:24px 0 0;font-size:13px;color:#888;line-height:1.6;">Une question, un blocage&nbsp;? On est là, réponds simplement à cet email.</p>`,
    }),
  };
}

// ─── Resend ─────────────────────────────────────────────────
async function resendSend({ to, subject, html }: { to: string; subject: string; html: string }) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY_missing" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_DEFAULT, to: [to], subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `resend_http_${res.status}`, detail: data };
    return { ok: true, id: data?.id as string | undefined };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) };
  }
}

// ─── Best-sellers de la semaine (utilisé J+7) ───────────────
// Stratégie : on calcule à la volée le nombre de commandes des 7 derniers jours
// par product_id (via les items des orders payées). Fallback : produits récents actifs.
async function fetchTopProducts(
  admin: ReturnType<typeof createClient>,
  limit = 3,
): Promise<LiteProduct[]> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: orders } = await admin
      .from("orders")
      .select("items, status, created_at")
      .gte("created_at", since)
      .in("status", ["paid", "preparing", "shipped", "in_delivery", "delivered", "completed"]);

    const counts: Record<string, number> = {};
    for (const o of orders || []) {
      const items = Array.isArray((o as { items?: unknown }).items) ? ((o as { items?: { id?: string; qty?: number }[] }).items ?? []) : [];
      for (const it of items) {
        if (!it?.id) continue;
        counts[it.id] = (counts[it.id] || 0) + (Number(it.qty) || 1);
      }
    }
    const topIds = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);

    if (topIds.length) {
      const { data: products } = await admin
        .from("products")
        .select("id, name, brand, price, img, active")
        .in("id", topIds)
        .eq("active", true);
      const map = new Map((products || []).map((p) => [p.id as string, p]));
      const ordered = topIds.map((id) => map.get(id)).filter(Boolean) as LiteProduct[];
      if (ordered.length) return ordered.slice(0, limit);
    }
  } catch (e) {
    console.warn("[onboarding-drip] fetchTopProducts soft-fail:", (e as Error)?.message);
  }

  // Fallback : derniers produits actifs
  try {
    const { data: fallback } = await admin
      .from("products")
      .select("id, name, brand, price, img, active")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (fallback || []) as LiteProduct[];
  } catch {
    return [];
  }
}

// ─── Vérifie si user a au moins 1 order non annulée ──
async function userHasOrder(admin: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { count } = await admin
    .from("orders")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .not("status", "in", "(cancelled,canceled,failed)");
  return (count || 0) > 0;
}

// ─── Crédit 500 points loyalty pour J+30 (via RPC existant) ──
async function credit500Points(admin: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  try {
    const { error } = await admin.rpc("add_loyalty_points", {
      p_user_id: userId,
      p_points: 500,
      p_type: "bonus",
      p_reason: "Bonus onboarding J+30",
    });
    if (error) {
      console.warn(`[onboarding-drip] add_loyalty_points failed: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[onboarding-drip] add_loyalty_points exception: ${(e as Error)?.message}`);
    return false;
  }
}

// ─── MAIN ──────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ success: false, error: "method_not_allowed" }, 405);
  }

  // Auth : Bearer token attendu (= ONBOARDING_DRIP_TOKEN)
  const expected = Deno.env.get("ONBOARDING_DRIP_TOKEN");
  const provided = req.headers.get("authorization") || "";
  const token = provided.replace(/^Bearer\s+/i, "").trim();
  if (!expected || token !== expected) {
    return json({ success: false, error: "unauthorized" }, 401);
  }

  let body: { dry_run?: boolean; only?: ("d2" | "d7" | "d30")[] } = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { /* body optional */ }
  }
  const dryRun = body.dry_run === true;
  const only = Array.isArray(body.only) && body.only.length > 0 ? body.only : null;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ success: false, error: "supabase_env_missing" }, 500);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const now = Date.now();
  const d2Cut = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();   // <= J-2 (inscrit il y a >= 2 jours)
  const d7Cut = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();   // <= J-7
  const d30Cut = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(); // <= J-30
  // borne basse pour éviter de scanner toute la base : on plafonne à 120 jours d'ancienneté.
  const oldestCut = new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString();

  // On charge en un seul SELECT les candidats potentiels (drip pas désactivé,
  // inscrits il y a 2 à 120 jours, au moins un sent_at NULL).
  const { data: candidates, error: candErr } = await admin
    .from("users_profile")
    .select("id, email, first_name, created_at, onboarding_drip_d2_sent_at, onboarding_drip_d7_sent_at, onboarding_drip_d30_sent_at, onboarding_drip_disabled")
    .eq("onboarding_drip_disabled", false)
    .lte("created_at", d2Cut)
    .gte("created_at", oldestCut)
    .not("email", "is", null);

  if (candErr) {
    console.warn(`[onboarding-drip] select candidates error: ${candErr.message}`);
    return json({ success: false, error: candErr.message }, 500);
  }

  const stats = {
    d2: { sent: 0, failed: 0, skipped: 0 },
    d7: { sent: 0, failed: 0, skipped: 0 },
    d30: { sent: 0, failed: 0, skipped: 0 },
    points_credited: 0,
    scanned: candidates?.length || 0,
  };

  // Pre-fetch best-sellers une seule fois pour J+7 (économise des queries)
  let cachedTop: LiteProduct[] | null = null;
  const getTop = async () => {
    if (cachedTop) return cachedTop;
    cachedTop = await fetchTopProducts(admin, 3);
    return cachedTop;
  };

  for (const u of candidates || []) {
    if (!u.email || !u.id || !u.created_at) continue;
    const createdAt = new Date(u.created_at as string).getTime();
    const ageDays = (now - createdAt) / (24 * 60 * 60 * 1000);
    const firstName = (u.first_name as string) || String(u.email).split("@")[0] || "toi";

    // ─── Étape J+30 ───
    const wantD30 =
      (!only || only.includes("d30")) &&
      ageDays >= 30 &&
      !u.onboarding_drip_d30_sent_at &&
      new Date(u.created_at as string) <= new Date(d30Cut);
    if (wantD30) {
      if (await userHasOrder(admin, u.id as string)) {
        stats.d30.skipped++;
      } else {
        const { subject, html } = tplD30(firstName);
        if (dryRun) {
          stats.d30.sent++;
        } else {
          const r = await resendSend({ to: u.email as string, subject, html });
          if (r.ok) {
            stats.d30.sent++;
            const credited = await credit500Points(admin, u.id as string);
            if (credited) stats.points_credited += 500;
            await admin.from("users_profile")
              .update({ onboarding_drip_d30_sent_at: new Date().toISOString() })
              .eq("id", u.id);
          } else {
            stats.d30.failed++;
            console.warn(`[onboarding-drip] d30 failed user=${u.id} err=${r.error}`);
          }
        }
      }
      continue; // J+30 prioritaire : on n'envoie pas 2 emails au même user dans le même run
    }

    // ─── Étape J+7 ───
    const wantD7 =
      (!only || only.includes("d7")) &&
      ageDays >= 7 &&
      !u.onboarding_drip_d7_sent_at &&
      new Date(u.created_at as string) <= new Date(d7Cut);
    if (wantD7) {
      if (await userHasOrder(admin, u.id as string)) {
        stats.d7.skipped++;
      } else {
        const top = await getTop();
        const { subject, html } = tplD7(firstName, top);
        if (dryRun) {
          stats.d7.sent++;
        } else {
          const r = await resendSend({ to: u.email as string, subject, html });
          if (r.ok) {
            stats.d7.sent++;
            await admin.from("users_profile")
              .update({ onboarding_drip_d7_sent_at: new Date().toISOString() })
              .eq("id", u.id);
          } else {
            stats.d7.failed++;
            console.warn(`[onboarding-drip] d7 failed user=${u.id} err=${r.error}`);
          }
        }
      }
      continue;
    }

    // ─── Étape J+2 ───
    const wantD2 =
      (!only || only.includes("d2")) &&
      ageDays >= 2 &&
      !u.onboarding_drip_d2_sent_at;
    if (wantD2) {
      if (await userHasOrder(admin, u.id as string)) {
        stats.d2.skipped++;
      } else {
        const { subject, html } = tplD2(firstName);
        if (dryRun) {
          stats.d2.sent++;
        } else {
          const r = await resendSend({ to: u.email as string, subject, html });
          if (r.ok) {
            stats.d2.sent++;
            await admin.from("users_profile")
              .update({ onboarding_drip_d2_sent_at: new Date().toISOString() })
              .eq("id", u.id);
          } else {
            stats.d2.failed++;
            console.warn(`[onboarding-drip] d2 failed user=${u.id} err=${r.error}`);
          }
        }
      }
    }
  }

  console.log(`[onboarding-drip] done dry=${dryRun} scanned=${stats.scanned} d2=${JSON.stringify(stats.d2)} d7=${JSON.stringify(stats.d7)} d30=${JSON.stringify(stats.d30)} pts=${stats.points_credited}`);
  return json({ success: true, dry_run: dryRun, stats });
});
