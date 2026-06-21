import { supabase } from './client';
import { cachedFetch } from '../dataCache';

// ═══════════════════════════════════════════════
// PHARMACIES — AVEC CACHE
// ═══════════════════════════════════════════════

// Liste des colonnes safe a exposer cote client (PAS de PIN)
// pin_set_at est conserve : c'est juste un timestamp non sensible qui permet
// au flow de connexion pharmacie de savoir si la pharma doit creer son PIN.
// Doit rester aligne avec le GRANT SELECT cote DB (cf Supabase Studio).
const PHARMACY_PUBLIC_COLUMNS = 'id, name, tagline, owner_name, manager_name, city, neighborhood, address, lat, lng, phone, whatsapp, notification_email, notification_phone, hours, delivery_hours, logo, cover, description, commission, active, rating, review_count, pin_set_at, created_at, updated_at';

export async function getAllPharmacies() {
  return cachedFetch('all_pharmacies', async () => {
    const { data } = await supabase
      .from('pharmacies')
      .select(PHARMACY_PUBLIC_COLUMNS)
      .eq('active', true);
    return data || [];
  }, { ttl: 10 * 60 * 1000 });
}

// ═══════════════════════════════════════════════
// PHARMACIE — SESSION + ORDERS
// ═══════════════════════════════════════════════

// Reset le PIN d'une pharmacie via RPC server-side qui verifie que le caller
// est un admin actif (super_admin ou admin).
// Cf migration SQL : create function admin_set_pharmacy_pin(p_admin_id uuid, p_pharmacy_id text, p_new_pin text)
export async function adminSetPharmacyPin(adminId, pharmacyId, newPin) {
  if (!adminId) return { success: false, error: 'Session admin invalide' };
  if (!newPin || newPin.length < 4) return { success: false, error: 'PIN trop court (4 chiffres min)' };
  const { data, error } = await supabase.rpc('admin_set_pharmacy_pin', {
    p_admin_id: adminId,
    p_pharmacy_id: String(pharmacyId),
    p_new_pin: String(newPin),
  });
  if (error) {
    console.error('[adminSetPharmacyPin] RPC error:', error.message);
    return { success: false, error: error.message };
  }
  return data || { success: false, error: 'Reponse vide' };
}

export async function pharmacyLogin(pharmacyId, pin) {
  // Vague 9 RLS : on appelle pharma_start_session qui (a) valide le PIN via
  // verify_pharmacy_pin et (b) emet un token signe cote serveur. Le token
  // est stocke ici en sessionStorage et utilise par les futures RPCs pharma_*.
  const { data, error } = await supabase.rpc('pharma_start_session', {
    p_pharmacy_id: String(pharmacyId),
    p_pin: pin,
    p_user_agent: (typeof navigator !== 'undefined' ? navigator.userAgent : null),
  });

  if (error) {
    if (String(error.message).includes('invalid_credentials')) {
      return { success: false, error: 'PIN incorrect ou pharmacie inactive' };
    }
    console.error('[pharmacyLogin] RPC error:', error.message);
    return { success: false, error: 'Erreur serveur (RPC indisponible ?)' };
  }
  if (!data || !data.token) {
    return { success: false, error: 'PIN incorrect ou pharmacie inactive' };
  }

  // Stocke le token en sessionStorage pour que les wrappers pharmaApi.js le retrouvent
  try {
    sessionStorage.setItem('yaram-pharma-token', data.token);
  } catch { /* ignore */ }

  // Compat : on garde le shape { success, pharmacy } pour ne pas casser l'existant
  return { success: true, pharmacy: data.pharmacy, token: data.token };
}

export function getPharmaToken() {
  try {
    return sessionStorage.getItem('yaram-pharma-token') || null;
  } catch { return null; }
}

export async function pharmacyLogout() {
  const token = getPharmaToken();
  if (token) {
    try { await supabase.rpc('pharma_end_session', { p_token: token }); } catch { /* ignore */ }
    try { sessionStorage.removeItem('yaram-pharma-token'); } catch { /* ignore */ }
  }
}

// setPharmacyPin retiree : la colonne pin n'est plus updatable directement par anon.
// Utiliser :
//   - public.pharma_change_pin(pharmacy_id, old_pin, new_pin) cote pharma
//   - public.admin_set_pharmacy_pin(admin_id, pharmacy_id, new_pin) cote admin
// (les deux sont SECURITY DEFINER et valident l'identite avant d'updater)

export async function getPharmacyOrders(pharmacyId, status = null) {
  // Vague 9 RLS : on passe par pharma_list_orders (SECURITY DEFINER, requiert token).
  // La RPC fait le filtrage cote serveur (assigned_pharmacy_id OU items contient pharmacyId).
  const token = getPharmaToken();
  if (!token) {
    console.warn('[getPharmacyOrders] pas de token pharma — session expiree ?');
    return [];
  }
  // Si status est un array, on appelle 1 fois sans filter (limite cote RPC = 500)
  // puis on filtre cote client. C'est rare (utilise dans Pharma.jsx pour ['paid','preparing']).
  if (Array.isArray(status)) {
    const { data } = await supabase.rpc('pharma_list_orders', { p_token: token, p_status: null });
    return (data || []).filter(o => status.includes(o.status));
  }
  const { data } = await supabase.rpc('pharma_list_orders', {
    p_token: token,
    p_status: status || null,
  });
  // pharmacyId param ignore : la RPC connait deja le pharmacyId via le token.
  return data || [];
}

// Vague 9.5 : ces 3 fonctions passent par pharma_update_order (SECURITY DEFINER,
// requiert token pharma, verifie que la commande appartient bien a la pharmacie).
export async function acceptOrder(orderId, _pharmacyId) {
  const token = getPharmaToken();
  if (!token) return { error: { message: 'Session pharma expirée' } };
  return supabase.rpc('pharma_update_order', {
    p_token: token, p_order_id: orderId, p_action: 'accept',
  });
}

export async function refuseOrder(orderId, reason) {
  const token = getPharmaToken();
  if (!token) return { error: { message: 'Session pharma expirée' } };
  return supabase.rpc('pharma_update_order', {
    p_token: token, p_order_id: orderId, p_action: 'refuse', p_reason: reason,
  });
}

export async function markOrderReady(orderId) {
  const token = getPharmaToken();
  if (!token) return { error: { message: 'Session pharma expirée' } };
  return supabase.rpc('pharma_update_order', {
    p_token: token, p_order_id: orderId, p_action: 'ready',
  });
}

export async function getPharmacyCommissions(_pharmacyId) {
  // Vague 9.5 : tout est aggrege cote serveur par pharma_get_commissions.
  // pharmacyId param ignore (la RPC connait deja le pharmacyId via le token).
  const token = getPharmaToken();
  if (!token) return {
    orders: [], totalRevenue: 0, totalCommission: 0, totalNet: 0,
    monthOrders: [], monthRevenue: 0, monthCommission: 0, monthNet: 0, payments: [],
  };
  const { data } = await supabase.rpc('pharma_get_commissions', { p_token: token });
  if (!data) return {
    orders: [], totalRevenue: 0, totalCommission: 0, totalNet: 0,
    monthOrders: [], monthRevenue: 0, monthCommission: 0, monthNet: 0, payments: [],
  };

  const enrichedOrders = data.orders || [];
  const totalRevenue    = enrichedOrders.reduce((s, o) => s + (Number(o.pharmacy_revenue)    || 0), 0);
  const totalCommission = enrichedOrders.reduce((s, o) => s + (Number(o.pharmacy_commission) || 0), 0);
  const totalNet        = enrichedOrders.reduce((s, o) => s + (Number(o.pharmacy_net)        || 0), 0);

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthOrders = enrichedOrders.filter(o => new Date(o.created_at) >= firstDay);
  const monthRevenue    = monthOrders.reduce((s, o) => s + (Number(o.pharmacy_revenue)    || 0), 0);
  const monthCommission = monthOrders.reduce((s, o) => s + (Number(o.pharmacy_commission) || 0), 0);
  const monthNet        = monthOrders.reduce((s, o) => s + (Number(o.pharmacy_net)        || 0), 0);

  return {
    orders: enrichedOrders, totalRevenue, totalCommission, totalNet,
    monthOrders, monthRevenue, monthCommission, monthNet,
    payments: data.payments || [],
  };
}

export async function getPharmacyStats(pharmacyId) {
  // Vague 9.5 : compteurs orders via RPC pharma_get_stats (SECURITY DEFINER).
  // Le count des produits actifs reste un SELECT direct (products SELECT public).
  const token = getPharmaToken();
  const statsRpc = token
    ? (await supabase.rpc('pharma_get_stats', { p_token: token })).data
    : null;

  const { data: products } = await supabase.from('products')
    .select('id').eq('submitted_by_pharmacy_id', pharmacyId).eq('status', 'approved');

  return {
    todayOrdersCount:    (statsRpc?.today_pending || 0) + (statsRpc?.today_preparing || 0) + (statsRpc?.today_delivered || 0),
    pendingCount:        statsRpc?.today_pending   || 0,
    preparingCount:      statsRpc?.today_preparing || 0,
    deliveredTodayCount: statsRpc?.today_delivered || 0,
    todayRevenue:        Number(statsRpc?.today_revenue || 0),
    activeProductsCount: products?.length || 0,
  };
}
