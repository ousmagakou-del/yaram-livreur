// ════════════════════════════════════════════════════════
// YARAM — Edge function : register-push-device (v1)
// ════════════════════════════════════════════════════════
//
// Reçoit un APNs device token depuis l'app iOS (via @capacitor/push-notifications)
// → l'enregistre chez OneSignal via leur REST API "Players"
// → récupère le player_id (subscription ID OneSignal)
// → sauvegarde en DB Supabase (table user_devices)
//
// Workflow :
//   1. Client iOS récupère APNs token via Capacitor
//   2. Client POST sur cette function avec { device_token, ... }
//   3. Cette function POST sur OneSignal /api/v1/players
//   4. OneSignal retourne le player_id
//   5. On stocke (user_id, player_id, device_token) dans user_devices
//   6. On retourne { success: true, player_id } au client
//
// SECRETS requis (mêmes que send-push-notification) :
//   - ONESIGNAL_APP_ID
//   - ONESIGNAL_REST_KEY
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

type Body = {
  device_token: string;     // APNs token (hex string)
  platform?: 'ios' | 'android' | 'web';
  app_version?: string;
  device_model?: string;
  language?: string;
  timezone_offset?: number; // secondes
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  // ─── Auth : Supabase JWT requis (user connecté) ─────────
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ success: false, error: "auth_required" }, 401);
  }
  const userJwt = authHeader.replace("Bearer ", "");

  // Crée 2 clients : 1 service-role pour DB, 1 user pour vérifier le JWT
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const userClient = createClient(SUPABASE_URL, userJwt, { auth: { persistSession: false } });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return json({ success: false, error: "invalid_jwt" }, 401);
  }

  // ─── Parse body ──────────────────────────────────────────
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "invalid_json" }, 400);
  }
  if (!body.device_token) {
    return json({ success: false, error: "device_token_required" }, 400);
  }

  // ─── Appel OneSignal Players API ─────────────────────────
  const APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
  const REST_KEY = Deno.env.get("ONESIGNAL_REST_KEY");
  if (!APP_ID || !REST_KEY) {
    return json({ success: false, error: "onesignal_credentials_missing" }, 500);
  }

  // device_type pour OneSignal :
  //   0 = iOS, 1 = Android, 11 = Safari, 17 = Web Push
  const deviceTypeMap: Record<string, number> = { ios: 0, android: 1, web: 17 };
  const deviceType = deviceTypeMap[body.platform || 'ios'] ?? 0;

  const onesignalPayload: Record<string, unknown> = {
    app_id: APP_ID,
    device_type: deviceType,
    identifier: body.device_token,
    language: body.language || 'fr',
    timezone: body.timezone_offset ?? 0,
    external_user_id: user.id, // lie le device au user Supabase
  };
  if (body.device_model) onesignalPayload.device_model = body.device_model;
  if (body.app_version) onesignalPayload.game_version = body.app_version;

  let osResult: { success?: boolean; id?: string; errors?: unknown };
  try {
    const res = await fetch("https://onesignal.com/api/v1/players", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${REST_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(onesignalPayload),
    });
    osResult = await res.json().catch(() => ({}));
    if (!res.ok || !osResult?.id) {
      console.warn("[register-push] OneSignal error:", osResult);
      return json({
        success: false,
        error: "onesignal_register_failed",
        detail: osResult,
        status: res.status,
      }, 500);
    }
  } catch (e) {
    return json({ success: false, error: (e as Error)?.message || String(e) }, 500);
  }

  const playerId = osResult.id!;

  // ─── Sauvegarde en DB ────────────────────────────────────
  // Utilise la RPC register_device qu'on a déjà créée
  // (mais on a besoin de passer aussi le device_token pour debug futur)
  try {
    // On insert directement (RLS permet à user d'inserter ses propres devices)
    const { error: dbErr } = await admin
      .from("user_devices")
      .upsert({
        user_id: user.id,
        onesignal_player_id: playerId,
        platform: body.platform || 'ios',
        app_version: body.app_version || null,
        device_model: body.device_model || null,
        language: body.language || 'fr',
        push_enabled: true,
        last_seen_at: new Date().toISOString(),
      }, {
        onConflict: 'onesignal_player_id',
      });

    if (dbErr) {
      console.warn("[register-push] DB insert failed:", dbErr.message);
      // On retourne quand même success car OneSignal est OK
      return json({
        success: true,
        player_id: playerId,
        warning: "db_save_failed",
        detail: dbErr.message,
      });
    }
  } catch (e) {
    return json({
      success: true,
      player_id: playerId,
      warning: "db_save_exception",
      detail: (e as Error)?.message || String(e),
    });
  }

  return json({
    success: true,
    player_id: playerId,
  });
});
