// ════════════════════════════════════════════════════════════════════
// YARAM — Edge function : send-push-web
// ════════════════════════════════════════════════════════════════════
//
// Envoie une push notification via Web Push Protocol (RFC 8030 / 8291 / 8292).
// Implémentation 100% Deno Web Crypto + djwt (aucun npm).
//
// SECRETS Supabase requis :
//   - VAPID_PUBLIC   : VAPID public key (base64url uncompressed P-256, 65 bytes décodés)
//   - VAPID_PRIVATE  : VAPID private key (base64url scalar P-256, 32 bytes décodés)
//   - VAPID_SUBJECT  : ex "mailto:admin@yaram.app"
//
// Body POST attendu :
//   { endpoint: string,                    // FCM/Mozilla/Edge endpoint URL
//     p256dh: string,                      // base64url, clé publique du subscriber (65 bytes)
//     auth: string,                        // base64url, secret partagé (16 bytes)
//     payload: string | Record<string, unknown>,  // message à envoyer (sera JSON.stringify si objet)
//     ttl?: number }                       // default 60
//
// Réponse : { ok, status, response }
//
// Schéma de chiffrement : aes128gcm (RFC 8291 / draft-ietf-webpush-encryption-08).
// Auth header : "vapid t=<JWT>, k=<base64url(VAPID_PUBLIC)>" (RFC 8292).
//
// REFS :
//   - https://datatracker.ietf.org/doc/html/rfc8030  (Web Push Protocol)
//   - https://datatracker.ietf.org/doc/html/rfc8291  (Message Encryption aes128gcm)
//   - https://datatracker.ietf.org/doc/html/rfc8292  (VAPID)
//   - https://datatracker.ietf.org/doc/html/rfc8188  (encrypted-content-encoding aes128gcm)
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

const log = (...args: unknown[]) => console.log("[send-push-web]", ...args);
const warn = (...args: unknown[]) => console.warn("[send-push-web]", ...args);
const err = (...args: unknown[]) => console.error("[send-push-web]", ...args);

// ════════════════════════════════════════════════════════════════════
// Base64url helpers
// ════════════════════════════════════════════════════════════════════
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// VAPID JWT — ES256 signé avec VAPID_PRIVATE (PKCS#8 importé depuis raw scalar)
// ════════════════════════════════════════════════════════════════════
//
// Pour Web Crypto, on ne peut pas importer directement un raw scalar P-256.
// Trick : on construit un JWK depuis (privateScalar d, publicX, publicY)
// puis on importJWK avec ECDSA.
// ════════════════════════════════════════════════════════════════════

function parseUncompressedPubKey(pub: Uint8Array): { x: Uint8Array; y: Uint8Array } {
  // P-256 uncompressed : 0x04 || X (32 bytes) || Y (32 bytes) = 65 bytes
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error(`vapid_public_invalid_format (len=${pub.length}, prefix=${pub[0]?.toString(16)})`);
  }
  return { x: pub.slice(1, 33), y: pub.slice(33, 65) };
}

let cachedVapidKey: CryptoKey | null = null;

async function getVapidSigningKey(): Promise<CryptoKey> {
  if (cachedVapidKey) return cachedVapidKey;
  const pubB64 = Deno.env.get("VAPID_PUBLIC");
  const privB64 = Deno.env.get("VAPID_PRIVATE");
  if (!pubB64 || !privB64) throw new Error("VAPID_PUBLIC or VAPID_PRIVATE missing");

  const pubBytes = b64urlToBytes(pubB64);
  const privBytes = b64urlToBytes(privB64);
  if (privBytes.length !== 32) throw new Error(`vapid_private_invalid_length=${privBytes.length}`);

  const { x, y } = parseUncompressedPubKey(pubBytes);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: bytesToB64url(privBytes),
    x: bytesToB64url(x),
    y: bytesToB64url(y),
    ext: true,
  };
  cachedVapidKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  log("VAPID signing key imported (cached)");
  return cachedVapidKey;
}

async function buildVapidJwt(audience: string): Promise<string> {
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@yaram.app";
  const key = await getVapidSigningKey();
  // RFC 8292 : aud = origin of push endpoint, exp = now + max 24h, sub = mailto:/https:
  return await createJwt(
    { alg: "ES256", typ: "JWT" },
    {
      aud: audience,
      exp: getNumericDate(12 * 60 * 60), // 12h validity
      sub: subject,
    },
    key,
  );
}

// ════════════════════════════════════════════════════════════════════
// HKDF helper (RFC 5869)
// ════════════════════════════════════════════════════════════════════
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    baseKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ════════════════════════════════════════════════════════════════════
// RFC 8291 aes128gcm encryption
// ════════════════════════════════════════════════════════════════════
//
// Steps (RFC 8291 §3.4) :
//   1. Generate ephemeral ECDH P-256 keypair (as_pubkey, as_privkey)
//   2. ECDH(as_privkey, ua_pubkey) = ecdh_secret
//   3. PRK_key = HKDF(salt=auth_secret, ikm=ecdh_secret, info=key_info, len=32)
//      key_info = "WebPush: info\x00" || ua_pubkey(65) || as_pubkey(65)
//   4. salt = random(16)
//   5. CEK = HKDF(salt=salt, ikm=PRK_key, info="Content-Encoding: aes128gcm\x00", len=16)
//   6. NONCE = HKDF(salt=salt, ikm=PRK_key, info="Content-Encoding: nonce\x00", len=12)
//   7. plaintext_padded = payload || 0x02 (RFC 8188 last-record delimiter)
//   8. ciphertext = AES-128-GCM(key=CEK, iv=NONCE, data=plaintext_padded)
//   9. header = salt(16) || rs(4, BE uint32) || idlen(1) || keyid(idlen)
//      Here keyid = as_pubkey (65 bytes), idlen = 65.
//      rs = record size (we use one record, rs >= ciphertext.length + 16+1 padding overhead)
//  10. body = header || ciphertext
// ════════════════════════════════════════════════════════════════════

async function encryptAes128Gcm(
  payload: Uint8Array,
  uaPublic: Uint8Array,   // 65 bytes (subscriber p256dh)
  authSecret: Uint8Array, // 16 bytes (subscriber auth)
): Promise<Uint8Array> {
  // 1. Ephemeral keypair
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const asPubJwk = await crypto.subtle.exportKey("jwk", ephemeral.publicKey);
  const asPubBytes = concat(
    new Uint8Array([0x04]),
    b64urlToBytes(asPubJwk.x!),
    b64urlToBytes(asPubJwk.y!),
  );

  // 2. Import UA public + derive ECDH shared secret
  const { x: uaX, y: uaY } = parseUncompressedPubKey(uaPublic);
  const uaPubKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: bytesToB64url(uaX), y: bytesToB64url(uaY), ext: true },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaPubKey },
    ephemeral.privateKey,
    256,
  );
  const ecdhSecret = new Uint8Array(ecdhBits);

  // 3. PRK_key = HKDF(auth_secret, ecdh, "WebPush: info\0" || ua_pub || as_pub, 32)
  const enc = new TextEncoder();
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPubBytes);
  const prkKey = await hkdf(ecdhSecret, authSecret, keyInfo, 32);

  // 4. Random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 5. CEK
  const cek = await hkdf(prkKey, salt, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  // 6. NONCE
  const nonce = await hkdf(prkKey, salt, enc.encode("Content-Encoding: nonce\0"), 12);

  // 7. Pad : append 0x02 (last record delimiter per RFC 8188)
  const padded = concat(payload, new Uint8Array([0x02]));

  // 8. AES-GCM encrypt
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded);
  const ciphertext = new Uint8Array(cipherBuf);

  // 9. Header : salt(16) || rs(4, big-endian) || idlen(1) || keyid(idlen=65)
  // rs = record size — must be >= padded.length + 16 (GCM tag). We use 4096 by default.
  const rs = Math.max(4096, ciphertext.length);
  const header = new Uint8Array(16 + 4 + 1 + asPubBytes.length);
  header.set(salt, 0);
  const dv = new DataView(header.buffer);
  dv.setUint32(16, rs, false); // big-endian
  header[20] = asPubBytes.length; // 65
  header.set(asPubBytes, 21);

  return concat(header, ciphertext);
}

// ════════════════════════════════════════════════════════════════════
// Handler
// ════════════════════════════════════════════════════════════════════

type WebPushBody = {
  endpoint?: string;
  p256dh?: string;
  auth?: string;
  payload?: string | Record<string, unknown>;
  ttl?: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: WebPushBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const { endpoint, p256dh, auth, payload, ttl } = body;
  if (!endpoint || !p256dh || !auth) {
    return json({ ok: false, error: "endpoint_p256dh_auth_required" }, 400);
  }

  // Parse endpoint origin for VAPID aud
  let audience: string;
  try {
    const u = new URL(endpoint);
    audience = `${u.protocol}//${u.host}`;
  } catch {
    return json({ ok: false, error: "invalid_endpoint_url" }, 400);
  }

  // Build VAPID auth header
  let vapidJwt: string;
  let vapidPubB64: string;
  try {
    vapidJwt = await buildVapidJwt(audience);
    vapidPubB64 = Deno.env.get("VAPID_PUBLIC")!;
  } catch (e) {
    err("VAPID JWT failed:", (e as Error)?.message);
    return json({ ok: false, error: "vapid_jwt_failed", detail: String(e) }, 500);
  }

  // Encrypt payload (aes128gcm)
  let encryptedBody: Uint8Array | null = null;
  const enc = new TextEncoder();
  if (payload != null && payload !== "") {
    try {
      const plaintext = typeof payload === "string"
        ? enc.encode(payload)
        : enc.encode(JSON.stringify(payload));
      const uaPub = b64urlToBytes(p256dh);
      const authSecret = b64urlToBytes(auth);
      if (uaPub.length !== 65) {
        return json({ ok: false, error: `p256dh_invalid_length=${uaPub.length}` }, 400);
      }
      if (authSecret.length !== 16) {
        return json({ ok: false, error: `auth_invalid_length=${authSecret.length}` }, 400);
      }
      encryptedBody = await encryptAes128Gcm(plaintext, uaPub, authSecret);
    } catch (e) {
      err("encryption failed:", (e as Error)?.message);
      return json({ ok: false, error: "encryption_failed", detail: String(e) }, 500);
    }
  }

  const endpointPreview = endpoint.slice(0, 60) + "…";
  log("POST web push", { endpoint_preview: endpointPreview, encrypted_len: encryptedBody?.length ?? 0 });

  const headers: Record<string, string> = {
    "TTL": String(ttl ?? 60),
    "Authorization": `vapid t=${vapidJwt}, k=${vapidPubB64}`,
  };
  if (encryptedBody) {
    headers["Content-Encoding"] = "aes128gcm";
    headers["Content-Type"] = "application/octet-stream";
    headers["Content-Length"] = String(encryptedBody.length);
  } else {
    headers["Content-Length"] = "0";
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: encryptedBody ?? undefined,
    });

    const responseText = await res.text().catch(() => "");
    if (!res.ok) {
      warn("web push error", { status: res.status, response: responseText.slice(0, 300), endpoint_preview: endpointPreview });
      return json({
        ok: false,
        status: res.status,
        response: responseText.slice(0, 500),
      }, 200);
    }

    log("web push success", { status: res.status, endpoint_preview: endpointPreview });
    return json({
      ok: true,
      status: res.status,
      response: responseText.slice(0, 500),
    });
  } catch (e) {
    err("fetch failed:", (e as Error)?.message);
    return json({
      ok: false,
      error: "web_push_fetch_failed",
      detail: (e as Error)?.message || String(e),
    }, 500);
  }
});
