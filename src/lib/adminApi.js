// src/lib/adminApi.js
// Wrappers RPC pour les operations admin (Phase 2 RLS).
//
// Tous les wrappers :
//   1. Recuperent le token admin courant via getAdminToken()
//   2. Verifient qu'il est present (sinon renvoient une session expiree)
//   3. Appellent la RPC correspondante (SECURITY DEFINER cote DB)
//   4. Renvoient { data, error, count } pour rester compatible avec
//      l'API supabase-js attendue dans les sections admin

import { supabase } from './supabase';
import { getAdminToken } from './adminAuth';

function requireToken() {
  const token = getAdminToken();
  if (!token) {
    const err = new Error('admin_session_expired');
    err.code = 'PGRST301';
    return { token: null, err };
  }
  return { token, err: null };
}

function splitCount(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { rows: rows || [], count: 0 };
  const count = Number(rows[0].full_count || 0);
  return { rows, count };
}

// ─────────────────────────────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────────────────────────────

export async function adminListOrders({ limit = 20, offset = 0, status = null } = {}) {
  const { token, err } = requireToken();
  if (err) return { data: null, count: 0, error: err };

  const { data, error } = await supabase.rpc('admin_list_orders', {
    p_token:  token,
    p_limit:  limit,
    p_offset: offset,
    p_status: status,
  });

  if (error) return { data: null, count: 0, error };
  const { rows, count } = splitCount(data);
  return { data: rows, count, error: null };
}

export async function adminUpdateOrder(orderId, patch) {
  const { token, err } = requireToken();
  if (err) return { error: err };
  const { error } = await supabase.rpc('admin_update_order', {
    p_token: token,
    p_id:    orderId,
    p_patch: patch,
  });
  return { error };
}

// ─────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────

export async function adminListUsers({ limit = 20, offset = 0, search = null } = {}) {
  const { token, err } = requireToken();
  if (err) return { data: null, count: 0, error: err };

  const { data, error } = await supabase.rpc('admin_list_users', {
    p_token:  token,
    p_limit:  limit,
    p_offset: offset,
    p_search: search,
  });

  if (error) return { data: null, count: 0, error };
  const { rows, count } = splitCount(data);
  return { data: rows, count, error: null };
}

// ─────────────────────────────────────────────────────────────────────
// COMMISSIONS
// ─────────────────────────────────────────────────────────────────────

export async function adminListCommissions({ limit = 50, offset = 0, status = null } = {}) {
  const { token, err } = requireToken();
  if (err) return { data: null, count: 0, error: err };

  const { data, error } = await supabase.rpc('admin_list_commissions', {
    p_token:  token,
    p_limit:  limit,
    p_offset: offset,
    p_status: status,
  });

  if (error) return { data: null, count: 0, error };
  const { rows, count } = splitCount(data);
  return { data: rows, count, error: null };
}

// ─────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────────────────

export async function adminListAuditLog({ limit = 100, offset = 0 } = {}) {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };

  const { data, error } = await supabase.rpc('admin_list_audit_log', {
    p_token:  token,
    p_limit:  limit,
    p_offset: offset,
  });

  return { data: data || [], error };
}

// ─────────────────────────────────────────────────────────────────────
// PUSH SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────────

export async function adminListPushSubscriptions() {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };

  const { data, error } = await supabase.rpc('admin_list_push_subscriptions', {
    p_token: token,
  });

  return { data: data || [], error };
}

// ─────────────────────────────────────────────────────────────────────
// STATS / DASHBOARD
// ─────────────────────────────────────────────────────────────────────

export async function adminUsersStats({ since = null } = {}) {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };
  const { data, error } = await supabase.rpc('admin_users_stats', {
    p_token: token,
    p_since: since,
  });
  return { data, error };
}

export async function adminDashboardCounts() {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };
  const { data, error } = await supabase.rpc('admin_dashboard_counts', { p_token: token });
  return { data, error };
}

// ─────────────────────────────────────────────────────────────────────
// USERS (variantes)
// ─────────────────────────────────────────────────────────────────────

export async function adminListUserOrders(userId) {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };
  const { data, error } = await supabase.rpc('admin_list_user_orders', {
    p_token:   token,
    p_user_id: userId,
  });
  return { data: data || [], error };
}

export async function adminListLoyaltyUsers({ limit = 200 } = {}) {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };
  const { data, error } = await supabase.rpc('admin_list_loyalty_users', {
    p_token: token,
    p_limit: limit,
  });
  return { data: data || [], error };
}

export async function adminListUsersFull() {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };
  const { data, error } = await supabase.rpc('admin_list_users_full', { p_token: token });
  return { data: data || [], error };
}

// ─────────────────────────────────────────────────────────────────────
// STAFF
// ─────────────────────────────────────────────────────────────────────

export async function adminListStaff() {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };
  const { data, error } = await supabase.rpc('admin_list_staff', { p_token: token });
  return { data: data || [], error };
}

export async function adminUpsertStaff(id, payload) {
  const { token, err } = requireToken();
  if (err) return { error: err };
  const { error } = await supabase.rpc('admin_upsert_staff', {
    p_token:   token,
    p_id:      id || null,
    p_payload: payload,
  });
  return { error };
}

export async function adminDeleteStaff(id) {
  const { token, err } = requireToken();
  if (err) return { error: err };
  const { error } = await supabase.rpc('admin_delete_staff', {
    p_token: token,
    p_id:    id,
  });
  return { error };
}

// ─────────────────────────────────────────────────────────────────────
// ORDERS — variante full pour aggregations admin (Commissions, Performance, ...)
// ─────────────────────────────────────────────────────────────────────

export async function adminListOrdersFull({ since = null, statuses = null } = {}) {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };
  const { data, error } = await supabase.rpc('admin_list_orders_full', {
    p_token:    token,
    p_since:    since,
    p_statuses: statuses,
  });
  return { data: data || [], error };
}

// ─────────────────────────────────────────────────────────────────────
// STATS — aggregations SQL en UNE query (admin_get_stats)
// ─────────────────────────────────────────────────────────────────────

export async function adminGetStats({ periodStart = null, periodEnd = null } = {}) {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };
  const { data, error } = await supabase.rpc('admin_get_stats', {
    p_token:        token,
    p_period_start: periodStart,
    p_period_end:   periodEnd,
  });
  return { data, error };
}

// ─────────────────────────────────────────────────────────────────────
// ORDERS — recherche full-table (admin_search_orders)
// ─────────────────────────────────────────────────────────────────────

export async function adminSearchOrders({ query, limit = 50, offset = 0 } = {}) {
  const { token, err } = requireToken();
  if (err) return { data: null, count: 0, error: err };
  const { data, error } = await supabase.rpc('admin_search_orders', {
    p_token:  token,
    p_query:  query,
    p_limit:  limit,
    p_offset: offset,
  });
  if (error) return { data: null, count: 0, error };
  const { rows, count } = splitCount(data);
  return { data: rows, count, error: null };
}

// ─────────────────────────────────────────────────────────────────────
// PAYMENTS — vérification manuelle des virements Wave/OM/PayTech
// ─────────────────────────────────────────────────────────────────────
//
// Flow sécurité paiement : quand la cliente clique "J'ai payé" dans Payment.jsx,
// la commande passe en 'awaiting_verification' (et pas direct en 'paid'). L'admin
// doit vérifier MANUELLEMENT sur son app Wave/OM que le virement est bien arrivé,
// puis appeler adminConfirmPayment pour passer en 'paid' (ou 'confirmed' si
// preorder). Si le montant ne match pas ou que rien n'est arrivé, il appelle
// adminRejectPayment qui repasse la commande en 'pending_payment' pour que la
// cliente puisse réessayer.
//
// Les RPC côté DB sont SECURITY DEFINER, gèrent l'audit interne et émettent
// les notifs push à la cliente. Ces wrappers se contentent de :
//   1. récupérer le token admin depuis sessionStorage (clé "yaram-admin-session")
//   2. appeler la RPC
//   3. renvoyer { success, order_id, error } pour la UI

function readSessionToken() {
  try {
    const raw = typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem('yaram-admin-session')
      : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.token || null;
  } catch {
    return null;
  }
}

export async function adminConfirmPayment(orderId, note) {
  const token = readSessionToken();
  if (!token) return { success: false, error: 'session_required' };

  const { data, error } = await supabase.rpc('admin_confirm_payment', {
    p_admin_token: token,
    p_order_id:    orderId,
    p_note:        note || null,
  });

  if (error) return { success: false, error: error.message || 'rpc_error' };
  // La RPC renvoie déjà { success, order_id }
  return data || { success: false, error: 'empty_response' };
}

export async function adminRejectPayment(orderId, reason) {
  const token = readSessionToken();
  if (!token) return { success: false, error: 'session_required' };

  const { data, error } = await supabase.rpc('admin_reject_payment', {
    p_admin_token: token,
    p_order_id:    orderId,
    p_reason:      reason || null,
  });

  if (error) return { success: false, error: error.message || 'rpc_error' };
  return data || { success: false, error: 'empty_response' };
}

// ─────────────────────────────────────────────────────────────────────
// AUDIT — tracer une action admin avant exécution destructive
// ─────────────────────────────────────────────────────────────────────

export async function adminLogAction({ action, targetType = null, targetId = null, before = null, after = null } = {}) {
  const { token, err } = requireToken();
  if (err) return { data: null, error: err };
  // user_agent passé côté DB (jamais l'IP — collectée par edge function si besoin)
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  const { data, error } = await supabase.rpc('admin_log_action', {
    p_token:       token,
    p_action:      action,
    p_target_type: targetType,
    p_target_id:   targetId,
    p_before:      before,
    p_after:       after,
    p_user_agent:  ua,
    p_ip_address:  null,
  });
  return { data, error };
}
