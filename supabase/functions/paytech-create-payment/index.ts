// ════════════════════════════════════════════════════════
// YARAM — Edge function : paytech-create-payment
// ════════════════════════════════════════════════════════
//
// Crée une session de paiement PayTech pour une commande YARAM.
// L'utilisateur est redirigé vers la page PayTech qui gère
// Wave / Orange Money / Free / Carte automatiquement.
//
// PayTech IPN (webhook) → paytech-webhook → update orders.status = paid
//
// SECRETS Supabase requis :
//   - PAYTECH_API_KEY    : clé API depuis le dashboard PayTech
//   - PAYTECH_API_SECRET : clé secrète depuis le dashboard PayTech
//   - PAYTECH_ENV        : 'test' ou 'prod' (par défaut 'prod')
//
// Docs PayTech : https://docs.intech.sn/doc_paytech.php
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
  order_id: string;
  amount: number;
  is_preorder?: boolean;
  item_name?: string;
  target_payment?: 'Wave' | 'Orange Money' | 'Free Money' | string | null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const PAYTECH_API_KEY = Deno.env.get("PAYTECH_API_KEY");
  const PAYTECH_API_SECRET = Deno.env.get("PAYTECH_API_SECRET");
  const PAYTECH_ENV = Deno.env.get("PAYTECH_ENV") || "prod";

  if (!PAYTECH_API_KEY || !PAYTECH_API_SECRET) {
    return json({ success: false, error: "paytech_credentials_missing" }, 500);
  }

  // ─── Auth user (JWT) ───────────────────────────────────
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ success: false, error: "auth_required" }, 401);
  }
  const userJwt = authHeader.replace("Bearer ", "");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: { user }, error: userErr } = await userClient.auth.getUser(userJwt);
  if (userErr || !user) {
    return json({ success: false, error: "invalid_jwt" }, 401);
  }

  // ─── Parse body ────────────────────────────────────────
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "invalid_json" }, 400);
  }
  if (!body.order_id || !body.amount) {
    return json({ success: false, error: "order_id_and_amount_required" }, 400);
  }

  // ─── Vérifie que la commande appartient bien à l'user ───
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, user_id, total, status, payment_method, is_preorder, deposit_amount")
    .eq("id", body.order_id)
    .maybeSingle();
  if (orderErr || !order) {
    return json({ success: false, error: "order_not_found" }, 404);
  }
  if (order.user_id !== user.id) {
    return json({ success: false, error: "order_not_owned" }, 403);
  }
  if (
    order.status === 'paid' ||
    order.status === 'confirmed' ||
    order.status === 'shipped' ||
    order.status === 'delivered'
  ) {
    return json({ success: false, error: "order_already_paid", status: order.status }, 400);
  }

  // ─── ANTI-FRAUDE : on IGNORE le body.amount envoyé par le client et on
  // recalcule côté serveur depuis la commande. Empêche le client de demander
  // un PayTech sur 100 FCFA pour une commande de 200 000 FCFA. ───
  const expectedAmount = order.is_preorder && order.deposit_amount
    ? Math.round(Number(order.deposit_amount))
    : Math.round(Number(order.total));
  // body.amount n'est plus que indicatif — on log la divergence si elle existe
  if (Number(body.amount) && Math.abs(Number(body.amount) - expectedAmount) > 1) {
    console.warn(
      `[paytech-create] amount mismatch ignored : client=${body.amount} server=${expectedAmount} order=${order.id}`
    );
  }

  // ─── Construit l'IPN URL (notre webhook) ───────────────
  const ipnUrl = `${SUPABASE_URL}/functions/v1/paytech-webhook`;
  // URL de retour après succès / échec / cancel
  const successUrl = `https://yaram.app/?confirm=paytech-success&order=${order.id}`;
  const cancelUrl  = `https://yaram.app/?confirm=paytech-cancel&order=${order.id}`;

  // ─── PayTech API : Request Payment ──────────────────────
  // Doc : https://docs.intech.sn/doc_paytech.php
  const payTechPayload: Record<string, unknown> = {
    item_name: body.item_name || `YARAM ${order.id}`,
    // SOURCE DE VÉRITÉ : montant calculé serveur, pas le body client
    item_price: expectedAmount,
    currency: "XOF",
    ref_command: order.id,
    command_name: `YARAM Commande ${order.id}`,
    env: PAYTECH_ENV,
    ipn_url: ipnUrl,
    success_url: successUrl,
    cancel_url: cancelUrl,
    custom_field: JSON.stringify({
      yaram_user_id: user.id,
      yaram_order_id: order.id,
    }),
  };

  // Pour pré-sélectionner Wave/OM (skip l'écran de choix PayTech)
  if (body.target_payment) {
    payTechPayload.target_payment = body.target_payment;
  }

  let payTechResult: { success?: number; redirect_url?: string; token?: string; redirectUrl?: string; error_message?: string };
  try {
    const res = await fetch("https://paytech.sn/api/payment/request-payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API_KEY": PAYTECH_API_KEY,
        "API_SECRET": PAYTECH_API_SECRET,
      },
      body: JSON.stringify(payTechPayload),
    });
    payTechResult = await res.json().catch(() => ({}));
    if (!res.ok || (!payTechResult.redirect_url && !payTechResult.redirectUrl)) {
      console.warn("[paytech-create] error:", payTechResult);
      return json({
        success: false,
        error: "paytech_request_failed",
        detail: payTechResult?.error_message || payTechResult,
        status: res.status,
      }, 500);
    }
  } catch (e) {
    return json({ success: false, error: (e as Error)?.message || String(e) }, 500);
  }

  const redirectUrl = payTechResult.redirect_url || payTechResult.redirectUrl;

  // ─── Sauvegarde le token de session PayTech sur la commande ───
  // (utile pour matcher l'IPN avec la commande)
  try {
    await admin.from("orders").update({
      payment_provider: 'paytech',
      payment_session_token: payTechResult.token || null,
      payment_session_started_at: new Date().toISOString(),
    }).eq("id", order.id);
  } catch (e) {
    console.warn("[paytech-create] order update failed:", (e as Error)?.message);
    // Non-bloquant : la session est créée chez PayTech, l'user peut quand même payer
  }

  return json({
    success: true,
    redirect_url: redirectUrl,
    token: payTechResult.token,
  });
});
