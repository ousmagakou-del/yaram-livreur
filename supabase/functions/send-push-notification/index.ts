// ════════════════════════════════════════════════════════
// YARAM — Edge function : send-push-notification (OneSignal)
// ════════════════════════════════════════════════════════
//
// Envoie une push notification via OneSignal REST API.
//
// 2 modes d'envoi :
//
// 1. CIBLÉ par user_id : envoie à tous les devices d'un user spécifique
//    body: { type, user_id, title, message, url? }
//
// 2. BROADCAST : envoie à tous les devices iOS de l'app (avec filtres)
//    body: { type, broadcast: true, title, message, url?, filters?: [...] }
//
// AUTH :
// - Token admin (admin_sessions) pour les broadcasts manuels
// - Internal secret pour les pushs auto (déclenchés par les hooks DB)
//
// SECRETS Supabase requis :
//   - ONESIGNAL_APP_ID    : ID de l'app OneSignal
//   - ONESIGNAL_REST_KEY  : REST API Key OneSignal (commence par os_v2_app_...)
//   - INTERNAL_PUSH_SECRET
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

type PushBody = {
  token?: string;
  internal_secret?: string;
  type?: 'manual' | 'order_status' | 'order_created' | 'replenishment' | 'reengagement' | 'anniversary' | 'scan_refresh' | 'welcome';
  user_id?: string;
  broadcast?: boolean;
  filters?: Array<{ field: string; relation: string; value: string }>;
  title: string;
  message: string;
  url?: string;
  data?: Record<string, unknown>;
};

// Types autorisés en mode "self" (user authentifié envoie un push à lui-même)
const SELF_ALLOWED_TYPES = new Set(['welcome', 'order_created']);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  let body: PushBody;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "invalid_json" }, 400);
  }

  if (!body.title || !body.message) {
    return json({ success: false, error: "title_and_message_required" }, 400);
  }
  if (!body.user_id && !body.broadcast) {
    return json({ success: false, error: "user_id_or_broadcast_required" }, 400);
  }

  // ─── AUTH ─────────────────────────────────────────────
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const INTERNAL_SECRET = Deno.env.get("INTERNAL_PUSH_SECRET");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let authMethod: 'admin' | 'internal' | 'self' | null = null;
  let actorEmail = 'system';

  if (body.internal_secret && INTERNAL_SECRET && body.internal_secret === INTERNAL_SECRET) {
    authMethod = 'internal';
  } else if (body.token) {
    const { data: session } = await admin
      .from("admin_sessions")
      .select("admin_email, expires_at")
      .eq("token", body.token)
      .maybeSingle();
    if (session && new Date(session.expires_at) > new Date()) {
      authMethod = 'admin';
      actorEmail = session.admin_email;
    }
  } else {
    // ─── Mode "self" : user authentifié push à lui-même ───
    // Use cases : welcome après signup, confirmation commande au moment de la création.
    // Restreint aux types dans SELF_ALLOWED_TYPES + target = user lui-même.
    const authHeader = req.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const userJwt = authHeader.replace("Bearer ", "");
      const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { data: { user } } = await userClient.auth.getUser(userJwt);
      if (user && body.type && SELF_ALLOWED_TYPES.has(body.type) && body.user_id === user.id && !body.broadcast) {
        authMethod = 'self';
        actorEmail = user.email || `user:${user.id}`;
      }
    }
  }

  if (!authMethod) {
    return json({ success: false, error: "unauthorized" }, 401);
  }

  // ─── OneSignal API ────────────────────────────────────
  const APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
  const REST_KEY = Deno.env.get("ONESIGNAL_REST_KEY");
  if (!APP_ID || !REST_KEY) {
    return json({ success: false, error: "ONESIGNAL_credentials_missing" }, 500);
  }

  const payload: Record<string, unknown> = {
    app_id: APP_ID,
    headings: { en: body.title, fr: body.title },
    contents: { en: body.message, fr: body.message },
  };

  if (body.url || body.data) {
    payload.data = { ...(body.data || {}), url: body.url || null };
  }

  if (body.url) {
    payload.url = body.url;
    payload.app_url = body.url;
  }

  // ─── Ciblage ──────────────────────────────────────────
  let playerIdsForLog: string[] = [];

  if (body.broadcast) {
    payload.included_segments = ["Subscribed Users"];
    if (body.filters && body.filters.length > 0) {
      payload.filters = body.filters;
    }
  } else {
    const { data: devices } = await admin
      .from("user_devices")
      .select("onesignal_player_id")
      .eq("user_id", body.user_id)
      .eq("push_enabled", true);

    const playerIds = (devices || []).map(d => d.onesignal_player_id).filter(Boolean);
    if (playerIds.length === 0) {
      await admin.from("push_logs").insert({
        user_id: body.user_id || null,
        type: body.type || 'manual',
        title: body.title,
        message: body.message,
        url: body.url || null,
        status: 'failed',
        error_text: 'no_active_devices',
      });
      return json({ success: false, error: "no_active_devices", user_id: body.user_id });
    }
    payload.include_subscription_ids = playerIds;
    playerIdsForLog = playerIds;
  }

  // ─── Appel OneSignal ──────────────────────────────────
  let osResult: { id?: string; recipients?: number; errors?: unknown };
  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${REST_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    osResult = await res.json().catch(() => ({}));
    if (!res.ok) {
      await admin.from("push_logs").insert({
        user_id: body.user_id || null,
        type: body.type || 'manual',
        title: body.title,
        message: body.message,
        url: body.url || null,
        status: 'failed',
        error_text: `http_${res.status}: ${JSON.stringify(osResult).slice(0, 500)}`,
      });
      return json({ success: false, error: "onesignal_error", detail: osResult, status: res.status }, 500);
    }
  } catch (e) {
    return json({ success: false, error: (e as Error)?.message || String(e) }, 500);
  }

  // ─── Log success ──────────────────────────────────────
  if (body.broadcast) {
    await admin.from("push_logs").insert({
      user_id: null,
      type: body.type || 'manual',
      notification_id: osResult.id || null,
      title: body.title,
      message: body.message,
      url: body.url || null,
      status: 'sent',
    });
  } else {
    const rows = playerIdsForLog.map(pid => ({
      user_id: body.user_id,
      player_id: pid,
      notification_id: osResult.id || null,
      type: body.type || 'manual',
      title: body.title,
      message: body.message,
      url: body.url || null,
      status: 'sent',
    }));
    if (rows.length > 0) await admin.from("push_logs").insert(rows);
  }

  return json({
    success: true,
    notification_id: osResult.id,
    recipients: osResult.recipients,
    auth_method: authMethod,
    actor: actorEmail,
  });
});
