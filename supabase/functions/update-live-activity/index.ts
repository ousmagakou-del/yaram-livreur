// ════════════════════════════════════════════════════════════════════
// YARAM — Edge function : update-live-activity
// ════════════════════════════════════════════════════════════════════
//
// Pousse une mise à jour Live Activity iOS via APNs HTTP/2.
//
// Appelée par :
//   - Trigger Postgres `live_activity_on_order_status_trg` (orders.status change)
//   - Direct par l'admin / dispatch quand le livreur progresse
//   - Manuellement via curl pour debug
//
// SECRETS Supabase requis (réutilise la conf send-push-apns) :
//   - APNS_KEY_P8     : contenu PEM .p8
//   - APNS_KEY_ID     : ID clé Apple
//   - APNS_TEAM_ID    : Team ID Apple Developer
//   - APNS_BUNDLE_ID  : Bundle ID app principal (ex "app.yaram.mobile")
//                      → on dérive le topic Live Activity :
//                      "${APNS_BUNDLE_ID}.push-type.liveactivity"
//   - APNS_USE_SANDBOX (optionnel) : "true" → api.sandbox.push.apple.com
//   - SUPABASE_URL              : auto-injecté
//   - SUPABASE_SERVICE_ROLE_KEY : auto-injecté
//
// Body POST attendu :
//   {
//     order_id: string,
//     event?: 'update' | 'end' | 'start',   // default 'update'
//     content_state: {
//       step: string,                       // preparing | picked_up | shipped | arriving | delivered
//       eta_minutes: number,
//       driver_name: string,
//       distance_km: number,
//     },
//     alert?: { title?: string, body?: string },  // optionnel — affiche alert system
//     dismissal_date?: number,                    // epoch sec (event=end)
//   }
//
// verify_jwt = false (appelée par trigger + admin internes)
// ════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { create as createJwt, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
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

const log  = (...a: unknown[]) => console.log("[update-live-activity]", ...a);
const warn = (...a: unknown[]) => console.warn("[update-live-activity]", ...a);
const err  = (...a: unknown[]) => console.error("[update-live-activity]", ...a);

// ─── JWT cache APNs (50 min, validité Apple = 1h) ───
let cachedJwt: string | null = null;
let cachedJwtExpiresAt = 0;
const JWT_LIFETIME_MS = 50 * 60 * 1000;
let cachedSigningKey: CryptoKey | null = null;

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getSigningKey(): Promise<CryptoKey> {
  if (cachedSigningKey) return cachedSigningKey;
  const pem = Deno.env.get("APNS_KEY_P8");
  if (!pem) throw new Error("APNS_KEY_P8 secret missing");
  const buf = pemToArrayBuffer(pem);
  cachedSigningKey = await crypto.subtle.importKey(
    "pkcs8",
    buf,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return cachedSigningKey;
}

async function getApnsJwt(): Promise<string> {
  const now = Date.now();
  if (cachedJwt && cachedJwtExpiresAt > now + 30_000) return cachedJwt;

  const keyId  = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  if (!keyId || !teamId) throw new Error("APNS_KEY_ID or APNS_TEAM_ID missing");

  const key = await getSigningKey();
  const jwt = await createJwt(
    { alg: "ES256", kid: keyId, typ: "JWT" },
    { iss: teamId, iat: getNumericDate(0) },
    key,
  );
  cachedJwt = jwt;
  cachedJwtExpiresAt = now + JWT_LIFETIME_MS;
  return jwt;
}

type ContentState = {
  step: string;
  eta_minutes: number;
  driver_name: string;
  distance_km: number;
};

type ReqBody = {
  order_id?: string;
  event?: "update" | "end" | "start";
  content_state?: ContentState;
  alert?: { title?: string; body?: string };
  dismissal_date?: number;
};

const STEP_LABELS: Record<string, string> = {
  preparing:  "En préparation",
  picked_up:  "Récupérée",
  shipped:    "En route",
  arriving:   "Arrive bientôt",
  delivered:  "Livrée",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const orderId = body.order_id;
  const event   = body.event ?? "update";
  const state   = body.content_state;

  if (!orderId) return json({ ok: false, error: "order_id_required" }, 400);
  if (!state || typeof state !== "object") {
    return json({ ok: false, error: "content_state_required" }, 400);
  }

  // Sanitize content_state
  const cleanState: ContentState = {
    step: String(state.step ?? "preparing"),
    eta_minutes: Number.isFinite(state.eta_minutes)
      ? Math.max(0, Math.round(Number(state.eta_minutes)))
      : 0,
    driver_name: String(state.driver_name ?? "YARAM").slice(0, 60),
    distance_km: Number.isFinite(state.distance_km)
      ? Math.max(0, Number(state.distance_km))
      : 0,
  };

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    err("SUPABASE env missing");
    return json({ ok: false, error: "supabase_env_missing" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Récupère l'activity active pour cette commande
  const { data: activity, error: actErr } = await supabase
    .from("delivery_live_activities")
    .select("id, apns_token, user_id, status")
    .eq("order_id", orderId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (actErr) {
    err("query activity failed:", actErr);
    return json({ ok: false, error: "db_query_failed", detail: actErr.message }, 500);
  }
  if (!activity) {
    log("no active activity for order", orderId);
    return json({ ok: true, skipped: "no_active_activity" });
  }

  const apnsToken = activity.apns_token;
  if (!apnsToken) {
    return json({ ok: false, error: "apns_token_missing_on_activity" }, 500);
  }

  // 2. Construit topic + URL APNs
  const bundleId = Deno.env.get("APNS_BUNDLE_ID");
  if (!bundleId) {
    err("APNS_BUNDLE_ID missing");
    return json({ ok: false, error: "APNS_BUNDLE_ID_missing" }, 500);
  }
  const topic = `${bundleId}.push-type.liveactivity`;

  const useSandbox = Deno.env.get("APNS_USE_SANDBOX") === "true";
  const apnsHost = useSandbox
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
  const apnsUrl = `${apnsHost}/3/device/${apnsToken}`;

  // 3. Payload Live Activity (cf. Apple docs ActivityKit)
  const timestamp = Math.floor(Date.now() / 1000);

  const aps: Record<string, unknown> = {
    timestamp,
    event,
    "content-state": cleanState,
  };

  if (event === "end") {
    aps["dismissal-date"] = body.dismissal_date ?? (timestamp + 60);
  }

  // Alert optionnelle (affiche notif système quand l'activity est mise à jour)
  if (body.alert && (body.alert.title || body.alert.body)) {
    aps.alert = {
      title: body.alert.title ?? "YARAM",
      body:  body.alert.body  ?? (STEP_LABELS[cleanState.step] ?? "Mise à jour livraison"),
    };
  } else if (event === "end") {
    aps.alert = {
      title: "YARAM",
      body: "Ta commande est livrée !",
    };
  }

  const payload = { aps };

  // 4. JWT APNs
  let jwt: string;
  try {
    jwt = await getApnsJwt();
  } catch (e) {
    err("JWT failed:", (e as Error)?.message);
    return json({ ok: false, error: "jwt_failed", detail: String(e) }, 500);
  }

  // 5. POST APNs
  const tokenPreview = apnsToken.slice(0, 8) + "…" + apnsToken.slice(-4);
  log("POST APNs liveactivity", { event, step: cleanState.step, token_preview: tokenPreview });

  let apnsRes: Response;
  try {
    apnsRes = await fetch(apnsUrl, {
      method: "POST",
      headers: {
        "authorization":     `bearer ${jwt}`,
        "apns-topic":        topic,
        "apns-push-type":    "liveactivity",
        "apns-priority":     "10",
        "apns-expiration":   "0",
        "content-type":      "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    err("APNs fetch failed:", e);
    return json({ ok: false, error: "apns_fetch_failed", detail: String(e) }, 502);
  }

  const responseText = await apnsRes.text();
  let responseParsed: unknown = responseText;
  try { responseParsed = responseText ? JSON.parse(responseText) : null; } catch { /* keep text */ }

  // 6. Maj DB : last_update_at, ou status=ended si event=end
  try {
    if (event === "end") {
      await supabase
        .from("delivery_live_activities")
        .update({ status: "ended", ended_at: new Date().toISOString(), last_update_at: new Date().toISOString() })
        .eq("id", activity.id);
    } else {
      await supabase
        .from("delivery_live_activities")
        .update({ last_update_at: new Date().toISOString() })
        .eq("id", activity.id);
    }
  } catch (e) {
    warn("DB update post-APNs failed (non-fatal):", e);
  }

  // 7. Si APNs renvoie BadDeviceToken / Unregistered → mark stale
  if (!apnsRes.ok) {
    const status = apnsRes.status;
    const reason = (responseParsed && typeof responseParsed === "object")
      ? (responseParsed as Record<string, unknown>).reason
      : null;

    if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") {
      try {
        await supabase
          .from("delivery_live_activities")
          .update({ status: "stale", ended_at: new Date().toISOString() })
          .eq("id", activity.id);
        log("marked activity stale due to APNs reason:", reason);
      } catch (e) {
        warn("mark stale failed:", e);
      }
    }

    warn("APNs returned error", { status, reason, response: responseParsed });
    return json({
      ok: false,
      apns_status: status,
      response: responseParsed,
      token_preview: tokenPreview,
    }, 502);
  }

  return json({
    ok: true,
    event,
    step: cleanState.step,
    apns_status: apnsRes.status,
    token_preview: tokenPreview,
  });
});
