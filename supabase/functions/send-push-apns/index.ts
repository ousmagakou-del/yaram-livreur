// ════════════════════════════════════════════════════════════════════
// YARAM — Edge function : send-push-apns
// ════════════════════════════════════════════════════════════════════
//
// Envoie une push notification directement via APNs HTTP/2 (sans OneSignal).
// Signe un JWT ES256 avec la clé .p8 Apple, le cache 50 min (validité 1h).
//
// SECRETS Supabase requis :
//   - APNS_KEY_P8     : contenu PEM complet de la clé .p8 (-----BEGIN PRIVATE KEY-----...)
//   - APNS_KEY_ID     : ID de la clé Apple (ex "ABC123DEF4")
//   - APNS_TEAM_ID    : Team ID Apple Developer (ex "6779DNV7Y5")
//   - APNS_BUNDLE_ID  : Bundle ID iOS (ex "app.yaram")
//   - APNS_USE_SANDBOX (optionnel) : "true" → api.sandbox.push.apple.com (dev)
//
// Body POST attendu :
//   { token: string,                       // APNs device token (hex 64 chars)
//     title: string,
//     body: string,
//     badge?: number,
//     sound?: string,
//     data?: Record<string, unknown>,
//     priority?: 5 | 10 }                  // 10 par défaut (immediate)
//
// Réponse : { ok, status, response, token_preview }
// ════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { create as createJwt, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

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

const log = (...args: unknown[]) => console.log("[send-push-apns]", ...args);
const warn = (...args: unknown[]) => console.warn("[send-push-apns]", ...args);
const err = (...args: unknown[]) => console.error("[send-push-apns]", ...args);

// ─── JWT cache (Apple = 1h max, on rafraîchit à 50min) ───
let cachedJwt: string | null = null;
let cachedJwtExpiresAt = 0; // epoch ms
const JWT_LIFETIME_MS = 50 * 60 * 1000;

// ─── CryptoKey cache (parse le .p8 une seule fois) ───
let cachedSigningKey: CryptoKey | null = null;

/**
 * Convertit un PEM PKCS#8 (.p8 Apple) en ArrayBuffer pour Web Crypto.
 * Apple distribue ses clés au format :
 *   -----BEGIN PRIVATE KEY-----
 *   <base64 body, possibly with newlines>
 *   -----END PRIVATE KEY-----
 */
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
  log("APNs signing key imported (cached)");
  return cachedSigningKey;
}

async function getApnsJwt(): Promise<string> {
  const now = Date.now();
  if (cachedJwt && cachedJwtExpiresAt > now + 30_000) {
    return cachedJwt;
  }
  const keyId = Deno.env.get("APNS_KEY_ID");
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
  log("Generated new APNs JWT (cached 50min)");
  return jwt;
}

type ApnsBody = {
  token?: string;
  title?: string;
  body?: string;
  badge?: number;
  sound?: string;
  data?: Record<string, unknown>;
  priority?: 5 | 10;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: ApnsBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const { token, title, body: msgBody, badge, sound, data, priority } = body;
  if (!token || typeof token !== "string") {
    return json({ ok: false, error: "token_required" }, 400);
  }
  if (!title && !msgBody) {
    return json({ ok: false, error: "title_or_body_required" }, 400);
  }

  const bundleId = Deno.env.get("APNS_BUNDLE_ID");
  if (!bundleId) {
    err("APNS_BUNDLE_ID missing");
    return json({ ok: false, error: "APNS_BUNDLE_ID_missing" }, 500);
  }

  const useSandbox = Deno.env.get("APNS_USE_SANDBOX") === "true";
  const apnsHost = useSandbox
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
  const url = `${apnsHost}/3/device/${token}`;

  // Build payload — APS structure conforme docs Apple.
  const apsAlert: Record<string, string> = {};
  if (title) apsAlert.title = title;
  if (msgBody) apsAlert.body = msgBody;

  const aps: Record<string, unknown> = {
    alert: apsAlert,
    sound: sound || "default",
  };
  if (typeof badge === "number") aps.badge = badge;

  const payload = {
    aps,
    ...(data ? { data } : {}),
  };

  let jwt: string;
  try {
    jwt = await getApnsJwt();
  } catch (e) {
    err("JWT generation failed:", (e as Error)?.message);
    return json({ ok: false, error: "jwt_generation_failed", detail: String(e) }, 500);
  }

  const tokenPreview = token.slice(0, 8) + "…" + token.slice(-4);
  log("POST APNs", { host: apnsHost, token_preview: tokenPreview, title });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "authorization": `bearer ${jwt}`,
        "apns-topic": bundleId,
        "apns-push-type": "alert",
        "apns-priority": String(priority ?? 10),
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await res.text();
    let responseParsed: unknown = responseText;
    try { responseParsed = responseText ? JSON.parse(responseText) : null; } catch { /* keep text */ }

    if (!res.ok) {
      warn("APNs error", { status: res.status, response: responseParsed, token_preview: tokenPreview });
      return json({
        ok: false,
        status: res.status,
        response: responseParsed,
        token_preview: tokenPreview,
      }, 200); // 200 to caller, error info in body — caller decides what to do
    }

    log("APNs success", { status: res.status, token_preview: tokenPreview });
    return json({
      ok: true,
      status: res.status,
      response: responseParsed,
      token_preview: tokenPreview,
    });
  } catch (e) {
    err("fetch failed:", (e as Error)?.message);
    return json({
      ok: false,
      error: "apns_fetch_failed",
      detail: (e as Error)?.message || String(e),
      token_preview: tokenPreview,
    }, 500);
  }
});
