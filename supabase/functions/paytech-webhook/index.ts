// ════════════════════════════════════════════════════════
// YARAM — Edge function : paytech-webhook (IPN handler)
// ════════════════════════════════════════════════════════
//
// Reçoit l'IPN (Instant Payment Notification) de PayTech quand un paiement
// est confirmé. Met automatiquement à jour orders.status = 'paid' et
// déclenche les notifs (WhatsApp + push + email) au client.
//
// Sécurité : on vérifie l'authenticité de l'IPN via les hash SHA256
// fournis par PayTech (api_key_sha256 + api_secret_sha256).
//
// SECRETS Supabase requis :
//   - PAYTECH_API_KEY      : pour vérifier le hash
//   - PAYTECH_API_SECRET   : pour vérifier le hash
//   - INTERNAL_PUSH_SECRET : pour invoquer send-push-notification
//
// Cette function NE DOIT PAS exiger de JWT (PayTech ne sait pas envoyer un).
// → Désactive "Verify JWT" dans les settings de cette function Supabase.
// ════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// SHA256 via Web Crypto API (compatible Deno edge)
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const PAYTECH_API_KEY = Deno.env.get("PAYTECH_API_KEY");
  const PAYTECH_API_SECRET = Deno.env.get("PAYTECH_API_SECRET");
  const INTERNAL_SECRET = Deno.env.get("INTERNAL_PUSH_SECRET");

  if (!PAYTECH_API_KEY || !PAYTECH_API_SECRET) {
    console.error("[paytech-webhook] Missing PAYTECH credentials");
    return json({ success: false, error: "credentials_missing" }, 500);
  }

  // ─── Parse body (PayTech envoie x-www-form-urlencoded OU JSON) ───
  let payload: Record<string, unknown> = {};
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else {
      const formData = await req.formData();
      formData.forEach((v, k) => { payload[k] = v.toString(); });
    }
  } catch (e) {
    console.warn("[paytech-webhook] body parse failed:", (e as Error)?.message);
    return json({ success: false, error: "invalid_body" }, 400);
  }

  console.log("[paytech-webhook] Received:", JSON.stringify(payload).slice(0, 500));

  // ─── Vérif authenticité via hash SHA256 ───
  const expectedApiKeyHash    = await sha256Hex(PAYTECH_API_KEY);
  const expectedApiSecretHash = await sha256Hex(PAYTECH_API_SECRET);

  const receivedApiKeyHash    = payload.api_key_sha256 as string;
  const receivedApiSecretHash = payload.api_secret_sha256 as string;

  if (receivedApiKeyHash !== expectedApiKeyHash || receivedApiSecretHash !== expectedApiSecretHash) {
    console.warn("[paytech-webhook] Auth hash mismatch — possible fake IPN");
    return json({ success: false, error: "auth_hash_mismatch" }, 401);
  }

  // ─── Extrait les infos commande ───
  const refCommand = (payload.ref_command as string) || '';
  const eventType  = (payload.type_event as string) || ''; // 'sale_complete' | 'sale_cancel' | ...
  const amount     = Number(payload.item_price || 0);
  const paymentMethod = (payload.payment_method as string) || '';
  const clientPhone   = (payload.client_phone as string) || null;

  if (!refCommand) {
    return json({ success: false, error: "no_ref_command" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ─── Récupère la commande ───
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, user_id, status, total, items, address, is_preorder")
    .eq("id", refCommand)
    .maybeSingle();
  if (orderErr || !order) {
    console.warn("[paytech-webhook] Order not found:", refCommand);
    return json({ success: false, error: "order_not_found" }, 404);
  }

  // ─── Traite selon le type d'événement ───
  let newStatus: string | null = null;
  if (eventType === 'sale_complete') {
    newStatus = order.is_preorder ? 'paid' : 'paid'; // pour preorder : acompte payé
  } else if (eventType === 'sale_cancel') {
    newStatus = 'cancelled';
  } else {
    console.log("[paytech-webhook] Unknown event type:", eventType);
    // On accepte mais on ne change rien
    return json({ success: true, ignored: true, event: eventType });
  }

  // ─── Idempotence : si déjà passée à ce status, skip ───
  if (order.status === newStatus) {
    return json({ success: true, already_processed: true, status: newStatus });
  }

  // ─── Update la commande ───
  const updates: Record<string, unknown> = {
    status: newStatus,
    payment_confirmed_at: newStatus === 'paid' ? new Date().toISOString() : null,
    paytech_payment_method: paymentMethod,
    paytech_client_phone: clientPhone,
  };
  if (order.is_preorder && newStatus === 'paid') {
    updates.deposit_paid_at = new Date().toISOString();
  }

  const { error: updateErr } = await admin
    .from("orders")
    .update(updates)
    .eq("id", refCommand);
  if (updateErr) {
    console.error("[paytech-webhook] Update failed:", updateErr.message);
    return json({ success: false, error: "update_failed", detail: updateErr.message }, 500);
  }

  // ─── Notifs auto (non-bloquant) ───
  if (newStatus === 'paid' && INTERNAL_SECRET) {
    const notifPromise = fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        internal_secret: INTERNAL_SECRET,
        user_id: order.user_id,
        type: 'order_status',
        title: '✅ Paiement confirmé !',
        message: `Ta commande ${order.id} est payée. On la prépare pour toi 🚀`,
        url: `https://yaram.app/tracking/${order.id}`,
      }),
    }).catch(e => console.warn("[paytech-webhook] push notif failed:", e?.message));

    // Logue pour analytics
    admin.from("payment_logs").insert({
      order_id: order.id,
      provider: 'paytech',
      event_type: eventType,
      amount,
      payment_method: paymentMethod,
      client_phone: clientPhone,
      raw_payload: payload,
    }).then(() => {}).catch(() => {});

    await notifPromise;
  }

  return json({
    success: true,
    order_id: refCommand,
    new_status: newStatus,
  });
});
