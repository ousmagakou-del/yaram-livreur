// ════════════════════════════════════════════════════════
// YARAM — Helpers admin pour envoyer des push notifications
// ════════════════════════════════════════════════════════
//
// 2 use cases :
//
// 1. AUTO push sur change de status commande
//    Appelé depuis OrdersSection / Pharma / Livreur quand le status
//    change (paid → preparing → shipped → delivered)
//
// 2. BROADCAST manuel depuis l'admin
//    Appelé depuis PushBroadcastSection
//
// Les 2 appellent l'edge function `send-push-notification` avec
// auth admin (admin_sessions.token).
// ════════════════════════════════════════════════════════

import { supabase } from './supabase';
import { getAdminToken } from './adminAuth';

const ORDER_STATUS_TEMPLATES = {
  awaiting_verification: {
    title: '⏱ Paiement reçu',
    message: () => `On vérifie ton virement, livraison déclenchée dès confirmation.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  paid: {
    title: '✅ Paiement reçu !',
    message: (order) => `Ta commande ${order.id?.slice(0, 12) || ''} est confirmée. On la prépare !`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  confirmed: {
    title: '✈️ Précommande confirmée',
    message: () => `Acompte reçu. Ton import est lancé chez le fournisseur.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  preparing: {
    title: '👩‍🍳 On prépare ta commande',
    message: (order) => `Ta commande ${order.id?.slice(0, 12) || ''} est en cours de préparation à la pharmacie.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  ready: {
    title: '📦 Commande prête',
    message: (order) => `Ta commande ${order.id?.slice(0, 12) || ''} est prête, le livreur va bientôt partir.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  shipped: {
    title: '🛵 En route !',
    message: () => `Ton livreur est en route. Tu peux le suivre en temps réel.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  awaiting_cash: {
    title: '💵 Prépare ton règlement',
    message: () => `Le livreur est là. Prépare la somme à régler.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  awaiting_confirm: {
    title: '✍️ Confirme la réception',
    message: () => `Valide la réception de ta commande pour clôturer.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  client_confirmed: {
    title: '🎉 Réception confirmée',
    message: () => `Merci pour ta confirmation !`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  delivered: {
    title: '🎉 Livré !',
    message: () => `Ta commande est livrée. Profite bien de tes produits ! 💚`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  cancelled: {
    title: '❌ Commande annulée',
    message: () => `Ta commande a été annulée. Si tu as une question, contacte-nous sur WhatsApp.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  refused: {
    title: '⚠️ Paiement refusé',
    message: () => `Recontacte-nous WhatsApp pour régler le souci.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  disputed: {
    title: '🆘 Commande contestée',
    message: () => `Notre équipe va te recontacter rapidement.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  awaiting_supplier: {
    title: '🌍 Commande chez le fournisseur',
    message: () => `On a passé la commande, on te tient au courant.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  in_transit_intl: {
    title: '✈️ Colis en transit',
    message: () => `Ton colis voyage vers le Sénégal.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  arrived_local: {
    title: '📍 Colis au Sénégal',
    message: () => `Bientôt entre tes mains !`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
  awaiting_balance: {
    title: '💰 Solde à régler',
    message: () => `Le solde de ta commande est à payer.`,
    url: (order) => `https://yaram.app/order/${order.id}`,
  },
};

/**
 * Envoie un push notif "status commande change" à l'user concerné.
 * Best effort : ne throw pas, log juste si erreur.
 *
 * @param {Object} order - { id, user_id, status, ... }
 * @returns {Promise<{ success, error?, recipients? }>}
 */
export async function pushOrderStatus(order) {
  if (!order?.user_id || !order?.status) {
    return { success: false, error: 'missing_user_or_status' };
  }

  const tpl = ORDER_STATUS_TEMPLATES[order.status];
  if (!tpl) {
    return { success: false, error: `no_template_for_status_${order.status}` };
  }

  const token = getAdminToken();
  if (!token) {
    return { success: false, error: 'no_admin_token' };
  }

  const tplTitle = tpl.title;
  const tplMessage = typeof tpl.message === 'function' ? tpl.message(order) : tpl.message;
  const tplUrl = typeof tpl.url === 'function' ? tpl.url(order) : tpl.url;
  const payloadNew = {
    type: 'order_status',
    user_id: order.user_id,
    title: tplTitle,
    body: tplMessage,
    data: { order_id: order.id, status: order.status, url: tplUrl },
  };
  const payloadLegacy = {
    token,
    type: 'order_status',
    user_id: order.user_id,
    title: tplTitle,
    message: tplMessage,
    url: tplUrl,
    data: { order_id: order.id, status: order.status },
  };

  // Try new send-push first
  try {
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: payloadNew,
      headers: { 'x-admin-token': token },
    });
    if (!error && data?.ok) {
      return { success: true, ...data };
    }
    console.warn('[pushOrderStatus] send-push failed, fallback OneSignal:', error?.message || data?.error);
  } catch (e) {
    console.warn('[pushOrderStatus] send-push exception, fallback OneSignal:', e?.message);
  }

  // Fallback OneSignal
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: payloadLegacy,
    });
    if (error) {
      console.warn('[pushOrderStatus] invoke error:', error.message);
      return { success: false, error: error.message };
    }
    return data || { success: true };
  } catch (e) {
    console.warn('[pushOrderStatus] exception:', e?.message);
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Push "🛵 Livreur assigné" envoyé à la cliente quand l'admin assigne un
 * livreur dans DeliveriesSection. Indépendant du status flow (la commande
 * reste en 'paid' ou 'preparing' jusqu'à ce que le livreur récupère le
 * colis et passe en 'shipped'). Best-effort, ne throw jamais.
 *
 * @param {Object} order - { id, user_id, ... }
 * @param {string} livreurName
 * @returns {Promise<{ success, error?, recipients? }>}
 */
export async function pushLivreurAssigned(order, livreurName) {
  if (!order?.user_id || !order?.id) {
    return { success: false, error: 'missing_user_or_order' };
  }
  const token = getAdminToken();
  if (!token) return { success: false, error: 'no_admin_token' };

  const shortId = String(order.id).slice(0, 12);
  const title = '🛵 Livreur assigné';
  const msg = `${livreurName || 'Un livreur'} a été assigné à ta commande ${shortId}. Il part bientôt !`;
  const url = `https://yaram.app/order/${order.id}`;

  // Try new send-push first
  try {
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: {
        type: 'order_status',
        user_id: order.user_id,
        title,
        body: msg,
        data: { order_id: order.id, source: 'livreur_assigned', url },
      },
      headers: { 'x-admin-token': token },
    });
    if (!error && data?.ok) return { success: true, ...data };
    console.warn('[pushLivreurAssigned] send-push failed, fallback OneSignal:', error?.message || data?.error);
  } catch (e) {
    console.warn('[pushLivreurAssigned] send-push exception, fallback OneSignal:', e?.message);
  }

  // Fallback OneSignal
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: {
        token,
        type: 'order_status',
        user_id: order.user_id,
        title,
        message: msg,
        url,
        data: { order_id: order.id, source: 'livreur_assigned' },
      },
    });
    if (error) {
      console.warn('[pushLivreurAssigned] invoke error:', error.message);
      return { success: false, error: error.message };
    }
    return data || { success: true };
  } catch (e) {
    console.warn('[pushLivreurAssigned] exception:', e?.message);
    return { success: false, error: e?.message || String(e) };
  }
}

// ════════════════════════════════════════════════════════
// SELF-PUSH : un user authentifié déclenche un push à lui-même
// ════════════════════════════════════════════════════════
//
// Use cases :
//  - "welcome" après signup (envoyé une fois)
//  - "order_created" au moment où l'user finalise sa commande (COD)
//
// Côté edge function send-push-notification, on vérifie :
//   - JWT user valide
//   - type ∈ { welcome, order_created }
//   - user_id == auth.uid()
//   - broadcast == false
// Donc impossible pour un client de spam les autres users.
//
// Best-effort : ne throw jamais. Si pas de device iOS enregistré (web ou
// permission refusée) → l'edge function répond no_active_devices silencieusement.

async function invokeSelfPush(body) {
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', { body });
    if (error) {
      console.warn('[selfPush] invoke error:', error.message);
      return { success: false, error: error.message };
    }
    return data || { success: true };
  } catch (e) {
    console.warn('[selfPush] exception:', e?.message);
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Push "Bienvenue chez YARAM" envoyé à l'user juste après signup.
 * No-op si pas de device iOS enregistré (web, permission refusée).
 */
export async function pushSelfWelcome({ userId, firstName }) {
  if (!userId) return { success: false, error: 'no_user_id' };
  return invokeSelfPush({
    type: 'welcome',
    user_id: userId,
    title: 'Bienvenue chez YARAM 💚',
    message: `Salut ${firstName || ''} ! Profite de -10% sur ta 1ère commande avec le code BIENVENUE10.`.trim(),
    url: 'https://yaram.app',
    data: { source: 'welcome' },
  });
}

/**
 * Push "Commande confirmée" envoyé à l'user juste après la création de sa commande.
 * Pour COD : déclenché en checkout. Pour PayTech : déclenché côté webhook serveur
 * via internal_secret, donc cette fonction n'est utilisée que pour COD côté client.
 */
export async function pushSelfOrderCreated({ userId, orderId, total }) {
  if (!userId || !orderId) return { success: false, error: 'missing_data' };
  const shortId = String(orderId).slice(0, 12);
  return invokeSelfPush({
    type: 'order_created',
    user_id: userId,
    title: '🛍️ Commande confirmée !',
    message: `Ta commande #${shortId} est bien reçue${total ? ` (${total.toLocaleString('fr-FR')} FCFA)` : ''}. On prépare !`,
    url: `https://yaram.app/order/${orderId}`,
    data: { order_id: orderId, source: 'order_created' },
  });
}

/**
 * Envoie un broadcast push à tous les users iOS (ou avec filtres).
 *
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} [opts.url]    - URL à ouvrir au tap
 * @param {Array}  [opts.filters] - Filtres OneSignal pour cibler (skin_type, ville, etc.)
 * @returns {Promise<{ success, recipients?, notification_id?, error? }>}
 */
export async function pushBroadcast({ title, message, url, filters }) {
  const token = getAdminToken();
  if (!token) {
    return { success: false, error: 'no_admin_token' };
  }
  if (!title || !message) {
    return { success: false, error: 'title_and_message_required' };
  }

  // Try new send-push first (broadcast mode)
  try {
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: {
        type: 'broadcast',
        broadcast: true,
        title,
        body: message,
        data: { url: url || null },
      },
      headers: { 'x-admin-token': token },
    });
    if (!error && data?.ok) {
      // Map back to old { recipients, notification_id } shape pour compat UI
      return {
        success: true,
        recipients: data?.totals?.devices ?? data?.totals?.success ?? undefined,
        notification_id: data?.actor || 'send-push',
        ...data,
      };
    }
    console.warn('[pushBroadcast] send-push failed, fallback OneSignal:', error?.message || data?.error);
  } catch (e) {
    console.warn('[pushBroadcast] send-push exception, fallback OneSignal:', e?.message);
  }

  // Fallback OneSignal
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: {
        token,
        type: 'manual',
        broadcast: true,
        title,
        message,
        url: url || null,
        filters: filters || [],
      },
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return data || { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}
