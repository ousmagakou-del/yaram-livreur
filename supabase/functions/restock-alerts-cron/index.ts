// ════════════════════════════════════════════════════════════════════
// YARAM — Edge function : restock-alerts-cron
// ════════════════════════════════════════════════════════════════════
//
// Cron qui scanne `restock_alerts` non encore notifiées, pousse une
// notif au pharmacien via le canal disponible :
//
//   1. Push device_tokens du pharmacien (via pharmacist_sessions.user_id
//      ou pharmacies.owner_user_id si présent)
//   2. WhatsApp URL  (stockée, déclenchée par un autre system)
//   3. Email pharmacien (send-email template restock_alert)
//
// Une fois notifiée, l'alerte voit `notified_at = now()`.
//
// Déploiement :
//   supabase functions deploy restock-alerts-cron --no-verify-jwt
//
// Activation cron (Supabase Dashboard → Database → Cron) :
//   schedule: */15 * * * *    (toutes les 15 min)
//   command : SELECT net.http_post(
//               url := 'https://<PROJECT_REF>.functions.supabase.co/restock-alerts-cron',
//               headers := jsonb_build_object('Content-Type','application/json',
//                                             'x-internal-secret', <INTERNAL_PUSH_SECRET>),
//               body := '{}'::jsonb
//             );
//
// SECRETS requis :
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - INTERNAL_PUSH_SECRET  (mêmes secret que send-push)
//
// verify_jwt = false  (activé manuellement par cron / admin)
// ════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-internal-secret, apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const log = (...a: unknown[]) => console.log("[restock-alerts-cron]", ...a);
const warn = (...a: unknown[]) => console.warn("[restock-alerts-cron]", ...a);
const err = (...a: unknown[]) => console.error("[restock-alerts-cron]", ...a);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_PUSH_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Severity = "info" | "warning" | "critical";
type AlertType = "low_stock" | "out_of_stock" | "expiry_soon";

interface PendingAlert {
  id: string;
  pharmacy_id: string;
  product_id: string;
  alert_type: AlertType;
  current_stock: number;
  threshold: number;
  severity: Severity;
}

interface Pharmacy {
  id: string;
  name: string | null;
  phone: string | null;
  whatsapp: string | null;
  notification_email: string | null;
  owner_user_id?: string | null;
}

interface Product {
  id: string;
  name: string | null;
  brand: string | null;
  image_url?: string | null;
  img?: string | null;
}

const productImg = (p: Product) => p.image_url || p.img || "";

const severityLabel = (s: Severity) =>
  s === "critical" ? "CRITIQUE" : s === "warning" ? "ATTENTION" : "INFO";

const alertTitle = (a: PendingAlert, p: Product) => {
  const base =
    a.alert_type === "out_of_stock"
      ? "RUPTURE STOCK"
      : a.alert_type === "expiry_soon"
        ? "EXPIRATION PROCHE"
        : "STOCK FAIBLE";
  return `${base} — ${p.name ?? "Produit"}`;
};

const alertBody = (a: PendingAlert, p: Product) => {
  const pname = p.name ?? "Produit";
  if (a.alert_type === "out_of_stock") {
    return `ALERTE STOCK : ${pname} en rupture (0 unité). Restock urgent.`;
  }
  if (a.alert_type === "expiry_soon") {
    return `ALERTE EXPIRATION : ${pname} arrive à expiration. Vérifie les lots.`;
  }
  return `ALERTE STOCK : ${pname} — reste ${a.current_stock} (seuil ${a.threshold})`;
};

// ─── Push notif pharmacien (via send-push edge function) ────────
async function pushToPharmacist(pharmacyOwnerId: string, title: string, body: string, alertId: string) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({
        internal_secret: INTERNAL_SECRET,
        user_id: pharmacyOwnerId,
        title,
        body,
        type: "manual",
        data: {
          url: "/pharmacist/alerts",
          alert_id: alertId,
          kind: "restock_alert",
        },
      }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      warn("send-push failed:", resp.status, result);
      return { ok: false, status: resp.status, error: result?.error };
    }
    return { ok: true, push_result: result };
  } catch (e) {
    err("send-push exception:", e);
    return { ok: false, error: String(e) };
  }
}

// ─── Email pharmacien (via send-email edge function) ────────────
async function emailToPharmacist(to: string, pharmacyName: string, alert: PendingAlert, product: Product) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({
        internal_secret: INTERNAL_SECRET,
        to,
        template: "restock_alert",
        data: {
          pharmacy_name: pharmacyName,
          product_name: product.name ?? "Produit",
          product_brand: product.brand ?? "",
          product_image: productImg(product),
          current_stock: alert.current_stock,
          threshold: alert.threshold,
          alert_type: alert.alert_type,
          severity: alert.severity,
          severity_label: severityLabel(alert.severity),
          dashboard_url: "https://yaram.app/pharmacist/alerts",
        },
      }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      warn("send-email failed:", resp.status, result);
      return { ok: false, status: resp.status, error: result?.error };
    }
    return { ok: true, email_result: result };
  } catch (e) {
    err("send-email exception:", e);
    return { ok: false, error: String(e) };
  }
}

// ─── Génère le lien WhatsApp (NB : pas d'envoi auto possible) ───
function whatsappLink(phone: string, message: string) {
  const clean = phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

// ─── Tentative de résolution du push token pharmacien ───────────
// Le token push pharmacien dépend de l'auth qu'il utilise. On cherche
// dans cet ordre :
//   1. pharmacies.owner_user_id  → device_tokens.user_id
//   2. pharmacist_sessions.user_id  (Agent 1) → device_tokens
async function resolvePharmacistPushUserId(pharmacy: Pharmacy): Promise<string | null> {
  if (pharmacy.owner_user_id) return pharmacy.owner_user_id;

  try {
    const { data } = await supabase
      .from("pharmacist_sessions")
      .select("user_id, pharmacist_user_id, last_used_at")
      .eq("pharmacy_id", pharmacy.id)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const row = (data ?? [])[0] as any;
    if (!row) return null;
    return row.user_id ?? row.pharmacist_user_id ?? null;
  } catch (e) {
    warn("pharmacist_sessions lookup failed:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Auth : INTERNAL_PUSH_SECRET header OU body
  let bodyJson: any = {};
  try {
    bodyJson = await req.json().catch(() => ({}));
  } catch {
    bodyJson = {};
  }
  const reqSecret =
    req.headers.get("x-internal-secret") ?? bodyJson?.internal_secret ?? "";
  if (INTERNAL_SECRET && reqSecret !== INTERNAL_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // 1. Fetch pending alerts
  const { data: alerts, error: alertsErr } = await supabase
    .from("restock_alerts")
    .select("id, pharmacy_id, product_id, alert_type, current_stock, threshold, severity")
    .is("notified_at", null)
    .eq("dismissed", false)
    .eq("restocked", false)
    .order("created_at", { ascending: true })
    .limit(200);

  if (alertsErr) {
    err("fetch alerts failed:", alertsErr);
    return json({ ok: false, error: alertsErr.message }, 500);
  }

  const pending = (alerts ?? []) as PendingAlert[];
  log(`pending alerts: ${pending.length}`);

  if (pending.length === 0) {
    return json({ ok: true, processed: 0, results: [] });
  }

  // 2. Hydrate pharmacy + product en bulk
  const pharmacyIds = Array.from(new Set(pending.map((a) => a.pharmacy_id)));
  const productIds = Array.from(new Set(pending.map((a) => a.product_id)));

  const [{ data: pharmaciesData }, { data: productsData }] = await Promise.all([
    supabase
      .from("pharmacies")
      .select("id, name, phone, whatsapp, notification_email, owner_user_id")
      .in("id", pharmacyIds),
    supabase
      .from("products")
      .select("id, name, brand, image_url, img")
      .in("id", productIds),
  ]);

  const pharmaciesMap = new Map<string, Pharmacy>(
    (pharmaciesData ?? []).map((p: any) => [p.id as string, p as Pharmacy])
  );
  const productsMap = new Map<string, Product>(
    (productsData ?? []).map((p: any) => [p.id as string, p as Product])
  );

  const results: any[] = [];

  // 3. For each alert : push / email / wa-link
  for (const alert of pending) {
    const pharmacy = pharmaciesMap.get(alert.pharmacy_id);
    const product = productsMap.get(alert.product_id) ?? {
      id: alert.product_id,
      name: "Produit",
      brand: "",
      image_url: "",
      img: "",
    };

    if (!pharmacy) {
      results.push({ alert_id: alert.id, ok: false, reason: "pharmacy_missing" });
      continue;
    }

    const title = alertTitle(alert, product);
    const body = alertBody(alert, product);

    const channels: any[] = [];

    // ─── Channel 1 : push notif ──────────────────────────────
    const pushUserId = await resolvePharmacistPushUserId(pharmacy);
    if (pushUserId) {
      const r = await pushToPharmacist(pushUserId, title, body, alert.id);
      channels.push({ channel: "push", user_id: pushUserId, ...r });
    } else {
      channels.push({ channel: "push", ok: false, reason: "no_user_id" });
    }

    // ─── Channel 2 : WhatsApp link (stored only) ─────────────
    const waNumber = pharmacy.whatsapp || pharmacy.phone || null;
    if (waNumber) {
      channels.push({
        channel: "whatsapp",
        ok: true,
        link: whatsappLink(waNumber, body),
        note: "manual_dispatch_required",
      });
    }

    // ─── Channel 3 : email fallback ──────────────────────────
    if (pharmacy.notification_email) {
      const r = await emailToPharmacist(
        pharmacy.notification_email,
        pharmacy.name ?? "Pharmacie",
        alert,
        product
      );
      channels.push({ channel: "email", to: pharmacy.notification_email, ...r });
    }

    // 4. Mark notified
    const { error: upErr } = await supabase
      .from("restock_alerts")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", alert.id);

    if (upErr) warn("mark notified failed:", alert.id, upErr);

    results.push({
      alert_id: alert.id,
      pharmacy_id: alert.pharmacy_id,
      product_id: alert.product_id,
      severity: alert.severity,
      channels,
    });
  }

  return json({ ok: true, processed: pending.length, results });
});
