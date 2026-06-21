import { supabase, invalidateCache } from './client';
import { cachedFetch } from '../dataCache';

// ═══════════════════════════════════════════════
// COMMANDES
// ═══════════════════════════════════════════════

function generateOrderId() {
  return 'DIA-' + Date.now().toString(36).toUpperCase();
}

export async function createOrder({
  items, address, paymentMethod, subtotal, shipping, total,
  promoCode, promoDiscount,
  // ─── Preorder (Import) ───
  isPreorder = false,
  depositAmount = null,
  balanceAmount = null,
  expectedArrivalDate = null,
}) {
  const { data: { session } } = await supabase.auth.getSession();
  const order = {
    id: generateOrderId(),
    user_id: session?.user?.id,
    status: 'pending_payment',
    items, address,
    payment_method: paymentMethod,
    subtotal, shipping, total,
    promo_code: promoCode,
    promo_discount: promoDiscount || 0,
    confirmation_token: 'CFM-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
  };
  // ─── Champs preorder (Import) — uniquement si commande contient des items import ───
  if (isPreorder) {
    order.is_preorder = true;
    order.deposit_amount = depositAmount;
    order.balance_amount = balanceAmount;
    if (expectedArrivalDate) order.expected_arrival_date = expectedArrivalDate;
  }
  const { data, error } = await supabase.from('orders').insert(order).select().single();
  if (error) console.error('createOrder error:', error);
  // Invalide le cache de mes commandes pour que la nouvelle apparaisse
  if (session?.user?.id) invalidateCache(`my_orders_${session.user.id}`);
  return error ? null : data;
}

export async function getMyOrders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];
  // FIX juin 2026 : on désactive le cache localStorage (persistLS=false) parce
  // qu'un cache vide stale persisté hier était servi en boucle → la page
  // "Mes commandes" restait vide alors que la DB avait 30+ orders.
  // On garde le memory cache (rapide pour les retours rapides) mais avec un
  // TTL court (30s) et on évite que les '[]' soient gardés.
  return cachedFetch(`my_orders_${session.user.id}`, async () => {
    // PERF : SELECT explicite des colonnes utilisées par Orders.jsx
    const { data, error } = await supabase
      .from('orders')
      .select('id, status, total, subtotal, shipping, payment_method, items, address, created_at, is_preorder, deposit_amount, balance_amount, expected_arrival_date, lead_time_days')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      console.warn('[getMyOrders] supabase error:', error.message);
      // Sur erreur RLS/réseau on throw au lieu de retourner [] pour ne PAS
      // empoisonner le cache avec du vide.
      throw error;
    }
    return data || [];
  }, { ttl: 30 * 1000, persistLS: false });
}

export async function updateOrderStatus(id, status) {
  // Vague 13 RLS : UPDATE direct bloque pour anon. Cette fonction est
  // utilisee par Payment.jsx pour passer pending_payment vers paid (cash COD)
  // OU vers awaiting_verification (Wave/OM/Card — anti-fraude, admin valide).
  //
  // Dans les 2 cas on route vers la RPC SECURITY DEFINER `client_mark_order_paid`
  // qui decide cote SQL du status final selon order.payment_method :
  //   - cod              -> 'paid'              (livraison immediate)
  //   - wave / om / card -> 'awaiting_verification' (admin doit verifier)
  //
  // Cote client on accepte donc indifferemment 'paid' et 'awaiting_verification'
  // : la RPC pose le bon status, le client passe juste son intention "j'ai paye".
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) invalidateCache(`my_orders_${session.user.id}`);
  } catch {}
  if (status === 'paid' || status === 'awaiting_verification') {
    const { data, error } = await supabase.rpc('client_mark_order_paid', { p_order_id: id });
    if (error) return { error };
    if (!data?.success) return { error: { message: data?.error || 'paiement refuse' } };
    return { data };
  }
  // Autres statuts : il n'y en a pas en client. Si un futur cas apparait,
  // creer une RPC dediee plutot que d'autoriser l'UPDATE direct.
  return { error: { message: 'updateOrderStatus: status ' + status + ' non autorise cote client' } };
}

export function subscribeToNewOrders(callback) {
  // FIX memory leak : chaque appel utilisait le même channel name fixe ('orders-changes')
  // → si appelée 2+ fois sans unsubscribe, Supabase crée des channels orphelins.
  // Maintenant : channel name unique + retourne une fonction cleanup.
  const channelName = `orders-changes-${Math.random().toString(36).slice(2, 10)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      (payload) => callback(payload.new))
    .subscribe();

  // Cleanup : à appeler depuis le useEffect return
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}

// ═══════════════════════════════════════════════
// WHATSAPP & CONFIRMATION
// ═══════════════════════════════════════════════

export function generateConfirmToken() {
  return 'CFM-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

export async function getOrderByConfirmToken(token) {
  // Vague 11 RLS : SELECT direct par confirmation_token bloque pour anon
  // depuis le drop de "Anyone can read by confirmation token". On passe par
  // la RPC SECURITY DEFINER qui valide le token cote serveur.
  const { data, error } = await supabase.rpc('client_get_order_by_token', { p_token: token });
  if (error) return null;
  return data;
}

export async function clientConfirmDelivery(tokenOrOrderId) {
  // Vague 13 RLS : passe par RPC SECURITY DEFINER.
  // La RPC accepte le token (ClientConfirm.jsx l'utilise depuis l'URL).
  // Pour back-compat, si on recoit un orderId, on cherche d'abord par token.
  return supabase.rpc('client_confirm_delivery', { p_token: tokenOrOrderId });
}

export async function clientReportDispute(tokenOrOrderId, reason) {
  // eslint-disable-next-line no-unused-vars
  return supabase.rpc('client_dispute_delivery', { p_token: tokenOrOrderId, p_reason: reason });
}
