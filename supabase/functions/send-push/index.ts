// ════════════════════════════════════════════════════════════════════
// YARAM — Edge function : send-push (unified router APNs + WebPush)
// ════════════════════════════════════════════════════════════════════
//
// Remplace l'edge function OneSignal `send-push-notification`.
// Lit les tokens dans `device_tokens` puis dispatch vers :
//   - send-push-apns   (type=apns)
//   - send-push-web    (type=web_push)
//
// Modes d'auth :
//   1. `internal_secret` header → trigger DB (pg_net)
//   2. JWT user `Authorization: Bearer ...` → self-push (type ∈ welcome/order_created, target = self)
//   3. `admin_token` header → broadcast / push admin
//
// Body :
//   {
//     user_id?: string,            // cible single user
//     user_ids?: string[],         // cible multi user
//     broadcast?: boolean,         // tous les users avec device_tokens.enabled = true
//     title: string,
//     body: string,
//     data?: Record<string, unknown>,
//     type?: 'order_status' | 'broadcast' | 'custom' | 'welcome' | 'order_created' | 'manual'
//   }
//
// SECRETS Supabase requis :
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - INTERNAL_PUSH_SECRET   (pour auth trigger)
//   - PUSH_ADMIN_TOKEN       (pour auth broadcast manuel admin)
//   - SUPABASE_ANON_KEY      (pour vérifier JWT user en self-push)
//   + tous les secrets requis par send-push-apns / send-push-web
//
// Retour : { ok, mode, results: [{ device_id, type, ok, status, error? }], totals }
// ════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey, x-internal-secret, x-admin-token",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const log = (...args: unknown[]) => console.log("[send-push]", ...args);
const warn = (...args: unknown[]) => console.warn("[send-push]", ...args);
const err = (...args: unknown[]) => console.error("[send-push]", ...args);

const SELF_ALLOWED_TYPES = new Set(["welcome", "order_created"]);

type Body = {
  user_id?: string;
  user_ids?: string[];
  broadcast?: boolean;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  type?: string;
  // legacy / convenience aliases
  internal_secret?: string;
  admin_token?: string;
  message?: string;  // legacy alias of body
  url?: string;      // legacy : injected into data.url
};

type DeviceRow = {
  id: string;
  user_id: string;
  type: "apns" | "web_push";
  apns_token: string | null;
  web_endpoint: string | null;
  web_p256dh: string | null;
  web_auth: string | null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  // Allow legacy field "message" to populate body
  const title = body.title?.trim();
  const msgBody = (body.body || body.message || "").trim();
  const data: Record<string, unknown> = { ...(body.data || {}) };
  if (body.url && !data.url) data.url = body.url;

  if (!title || !msgBody) {
    return json({ ok: false, error: "title_and_body_required" }, 400);
  }
  if (!body.user_id && !body.user_ids?.length && !body.broadcast) {
    return json({ ok: false, error: "user_id_or_user_ids_or_broadcast_required" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    err("supabase env missing");
    return json({ ok: false, error: "supabase_env_missing" }, 500);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ─── AUTH ─────────────────────────────────────────────
  const internalHeader = req.headers.get("x-internal-secret") || body.internal_secret || "";
  const adminHeader = req.headers.get("x-admin-token") || body.admin_token || "";
  const INTERNAL_SECRET = Deno.env.get("INTERNAL_PUSH_SECRET");
  const ADMIN_TOKEN = Deno.env.get("PUSH_ADMIN_TOKEN");

  let authMethod: "internal" | "admin" | "self" | null = null;
  let actor = "unknown";

  if (INTERNAL_SECRET && internalHeader && internalHeader === INTERNAL_SECRET) {
    authMethod = "internal";
    actor = "trigger";
  } else if (ADMIN_TOKEN && adminHeader && adminHeader === ADMIN_TOKEN) {
    authMethod = "admin";
    actor = "admin";
  } else {
    const authHeader = req.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      try {
        const userJwt = authHeader.replace("Bearer ", "");
        const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
        if (ANON_KEY) {
          const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
          const { data: { user } } = await userClient.auth.getUser(userJwt);
          if (
            user &&
            body.type && SELF_ALLOWED_TYPES.has(body.type) &&
            body.user_id === user.id && !body.broadcast && !body.user_ids?.length
          ) {
            authMethod = "self";
            actor = user.email || `user:${user.id}`;
          }
        }
      } catch (e) {
        warn("self-auth verify failed:", (e as Error)?.message);
      }
    }
  }

  if (!authMethod) {
    warn("unauthorized request", { has_internal: !!internalHeader, has_admin: !!adminHeader });
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  log("auth ok", { authMethod, actor, type: body.type, broadcast: !!body.broadcast });

  // ─── Fetch device tokens ──────────────────────────────
  let devices: DeviceRow[] = [];
  try {
    let q = admin
      .from("device_tokens")
      .select("id, user_id, type, apns_token, web_endpoint, web_p256dh, web_auth")
      .eq("enabled", true);

    if (body.broadcast) {
      // no extra filter — broadcast hits all enabled devices
    } else if (body.user_ids?.length) {
      q = q.in("user_id", body.user_ids);
    } else if (body.user_id) {
      q = q.eq("user_id", body.user_id);
    }
    const { data: rows, error: qErr } = await q;
    if (qErr) {
      err("device_tokens query error:", qErr.message);
      return json({ ok: false, error: "device_tokens_query_failed", detail: qErr.message }, 500);
    }
    devices = (rows || []) as DeviceRow[];
  } catch (e) {
    err("device_tokens fetch exception:", (e as Error)?.message);
    return json({ ok: false, error: "device_tokens_fetch_exception", detail: String(e) }, 500);
  }

  if (devices.length === 0) {
    log("no_active_devices");
    try {
      await admin.from("push_logs").insert({
        user_id: body.user_id || null,
        type: body.type || "manual",
        title,
        message: msgBody,
        url: (data.url as string) || null,
        status: "failed",
        error_text: "no_active_devices",
      });
    } catch (e) {
      warn("push_logs insert (no_devices) failed:", (e as Error)?.message);
    }
    return json({ ok: false, error: "no_active_devices", totals: { devices: 0, success: 0, failed: 0 } });
  }

  // ─── Dispatch per device ──────────────────────────────
  const apnsUrl = `${SUPABASE_URL}/functions/v1/send-push-apns`;
  const webUrl = `${SUPABASE_URL}/functions/v1/send-push-web`;
  const fnAuth = `Bearer ${SERVICE_KEY}`;

  const results: Array<{
    device_id: string;
    user_id: string;
    type: string;
    ok: boolean;
    status?: number;
    error?: string;
  }> = [];

  const payloadCommon = { title, body: msgBody, data };

  await Promise.all(devices.map(async (d) => {
    try {
      if (d.type === "apns") {
        if (!d.apns_token) {
          results.push({ device_id: d.id, user_id: d.user_id, type: d.type, ok: false, error: "missing_apns_token" });
          return;
        }
        const r = await fetch(apnsUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "authorization": fnAuth },
          body: JSON.stringify({ token: d.apns_token, ...payloadCommon }),
        });
        const out = await r.json().catch(() => ({}));
        const ok = !!out?.ok;
        results.push({ device_id: d.id, user_id: d.user_id, type: d.type, ok, status: out?.status, error: ok ? undefined : (out?.error || `apns_${out?.status}`) });
      } else if (d.type === "web_push") {
        if (!d.web_endpoint || !d.web_p256dh || !d.web_auth) {
          results.push({ device_id: d.id, user_id: d.user_id, type: d.type, ok: false, error: "missing_web_fields" });
          return;
        }
        const r = await fetch(webUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "authorization": fnAuth },
          body: JSON.stringify({
            endpoint: d.web_endpoint,
            p256dh: d.web_p256dh,
            auth: d.web_auth,
            payload: payloadCommon,
          }),
        });
        const out = await r.json().catch(() => ({}));
        const ok = !!out?.ok;
        results.push({ device_id: d.id, user_id: d.user_id, type: d.type, ok, status: out?.status, error: ok ? undefined : (out?.error || `web_${out?.status}`) });
      } else {
        results.push({ device_id: d.id, user_id: d.user_id, type: d.type, ok: false, error: `unknown_type_${d.type}` });
      }
    } catch (e) {
      err("dispatch error", d.id, (e as Error)?.message);
      results.push({ device_id: d.id, user_id: d.user_id, type: d.type, ok: false, error: (e as Error)?.message || String(e) });
    }
  }));

  // Auto-disable APNs tokens that returned 410 Gone (BadDeviceToken / Unregistered)
  const goneDevices = results.filter(r => r.status === 410 || r.error?.includes("BadDeviceToken") || r.error?.includes("Unregistered"));
  if (goneDevices.length > 0) {
    try {
      await admin
        .from("device_tokens")
        .update({ enabled: false })
        .in("id", goneDevices.map(r => r.device_id));
      log("auto-disabled gone devices:", goneDevices.length);
    } catch (e) {
      warn("auto-disable gone devices failed:", (e as Error)?.message);
    }
  }

  // ─── Push logs ────────────────────────────────────────
  const success = results.filter(r => r.ok).length;
  const failed = results.length - success;

  try {
    const rows = results.map(r => ({
      user_id: r.user_id,
      type: body.type || "manual",
      title,
      message: msgBody,
      url: (data.url as string) || null,
      status: r.ok ? "sent" : "failed",
      error_text: r.ok ? null : (r.error || "unknown").slice(0, 500),
    }));
    if (rows.length > 0) {
      await admin.from("push_logs").insert(rows);
    }
  } catch (e) {
    warn("push_logs insert failed:", (e as Error)?.message);
  }

  log("done", { mode: authMethod, devices: results.length, success, failed });
  return json({
    ok: success > 0,
    mode: authMethod,
    actor,
    totals: { devices: results.length, success, failed },
    results,
  });
});
