// ════════════════════════════════════════════════════════════════════
//  YARAM — Edge function : process-deletion-requests
// ════════════════════════════════════════════════════════════════════
//
//  Cron job daily : scanne account_deletion_requests pending dont
//  scheduled_for <= now() et exécute pour chacune :
//    1. RPC process_account_deletion (anonymise users_profile, DELETE
//       PII, garde orders sans PII)
//    2. Envoi email final via send-email (best effort)
//    3. UPDATE final_email_sent = true
//
//  Déploiement :
//    supabase functions deploy process-deletion-requests --no-verify-jwt
//
//  Activation cron (Supabase Dashboard → Database → Cron) :
//    schedule : 0 3 * * *      (daily 3h00 UTC)
//    command  : SELECT net.http_post(
//                 url := 'https://qxhhnrnworwrnwmqekmb.functions.supabase.co/process-deletion-requests',
//                 headers := jsonb_build_object(
//                   'Content-Type', 'application/json',
//                   'x-internal-secret', current_setting('app.internal_secret')
//                 ),
//                 body := '{}'::jsonb
//               );
//
//  SECRETS requis :
//    - SUPABASE_URL
//    - SUPABASE_SERVICE_ROLE_KEY
//    - INTERNAL_PUSH_SECRET (réutilisé)
//
//  verify_jwt = false  (cron / admin only)
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

const log = (...a: unknown[]) => console.log("[process-deletion-requests]", ...a);
const warn = (...a: unknown[]) => console.warn("[process-deletion-requests]", ...a);
const err = (...a: unknown[]) => console.error("[process-deletion-requests]", ...a);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_PUSH_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface PendingRow {
  id: string;
  user_id: string;
  reason: string | null;
  requested_at: string;
  scheduled_for: string;
  final_email_sent: boolean;
}

async function fetchUserEmail(userId: string): Promise<string | null> {
  // L'admin API permet de récupérer l'email AVANT anonymisation
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) {
      warn("getUserById error:", error.message);
      return null;
    }
    return data?.user?.email ?? null;
  } catch (e) {
    warn("getUserById throw:", (e as Error)?.message);
    return null;
  }
}

async function sendFinalEmail(toEmail: string): Promise<boolean> {
  if (!toEmail) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        to: toEmail,
        subject: "Ton compte YARAM a été supprimé",
        html: `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#F4F4F2;padding:24px;color:#0F1419;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:60px;height:60px;border-radius:14px;background:#1F8B4C;color:#fff;font-size:36px;font-weight:900;line-height:60px;">Y</div>
    </div>
    <h1 style="font-size:22px;margin:0 0 16px 0;color:#0F1419;">Ton compte YARAM a été supprimé</h1>
    <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 12px 0;">
      Conformément à ta demande, ton compte YARAM a bien été supprimé.
    </p>
    <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 12px 0;">
      Tes données personnelles (profil, favoris, scans, conversations IA, avis, etc.) ont été effacées de nos serveurs.
    </p>
    <p style="font-size:13px;line-height:1.6;color:#6B7280;margin:16px 0;">
      Pour respecter la réglementation comptable sénégalaise, l'historique de commandes (sans tes données personnelles) est conservé 10 ans.
    </p>
    <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
    <p style="font-size:13px;color:#6B7280;margin:0;">
      Merci d'avoir fait confiance à YARAM. À bientôt peut-être.
    </p>
    <p style="font-size:11px;color:#9CA3AF;margin:16px 0 0 0;text-align:center;">
      YARAM · Beauté Sénégal · contact@yaram.app
    </p>
  </div>
</body></html>`,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      warn("send-email failed:", res.status, txt.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    warn("send-email throw:", (e as Error)?.message);
    return false;
  }
}

async function processOne(row: PendingRow): Promise<{ id: string; ok: boolean; reason?: string }> {
  log("processing request", row.id, "for user", row.user_id);

  // 1) Récupère email AVANT anonymisation
  const email = await fetchUserEmail(row.user_id);

  // 2) Appelle la RPC qui anonymise + DELETE PII + UPDATE orders
  const { data, error } = await supabase.rpc("process_account_deletion", {
    p_request_id: row.id,
  });

  if (error) {
    err("rpc process_account_deletion failed:", error.message);
    return { id: row.id, ok: false, reason: error.message };
  }
  log("rpc done:", JSON.stringify(data));

  // 3) Email final (best effort, ne bloque pas)
  let emailSent = false;
  if (email) {
    emailSent = await sendFinalEmail(email);
  } else {
    warn("no email for user", row.user_id, "— skipping final email");
  }

  // 4) Update final_email_sent
  if (emailSent) {
    const { error: upErr } = await supabase
      .from("account_deletion_requests")
      .update({ final_email_sent: true })
      .eq("id", row.id);
    if (upErr) warn("update final_email_sent failed:", upErr.message);
  }

  return { id: row.id, ok: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Auth check : secret header ou service-role bearer
  const auth = req.headers.get("authorization") || "";
  const secret = req.headers.get("x-internal-secret") || "";
  const isService =
    auth.includes(SERVICE_KEY) ||
    (INTERNAL_SECRET && secret === INTERNAL_SECRET);

  if (!isService) {
    return json({ error: "forbidden" }, 403);
  }

  try {
    const { data: pending, error } = await supabase
      .from("account_deletion_requests")
      .select("id, user_id, reason, requested_at, scheduled_for, final_email_sent")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(100);

    if (error) {
      err("fetch pending failed:", error.message);
      return json({ error: error.message }, 500);
    }

    log("found", pending?.length ?? 0, "pending requests to process");

    if (!pending || pending.length === 0) {
      return json({ ok: true, processed: 0, results: [] });
    }

    const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
    for (const row of pending as PendingRow[]) {
      try {
        const r = await processOne(row);
        results.push(r);
      } catch (e) {
        err("processOne threw:", (e as Error)?.message);
        results.push({ id: row.id, ok: false, reason: (e as Error)?.message });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return json({
      ok: true,
      processed: okCount,
      total: results.length,
      results,
    });
  } catch (e) {
    err("handler threw:", (e as Error)?.message);
    return json({ error: (e as Error)?.message }, 500);
  }
});
