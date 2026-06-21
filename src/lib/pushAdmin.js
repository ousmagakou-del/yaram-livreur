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
  paid: {
    title: '✅ Paiement reçu !',
    message: (order) => `Ta commande ${order.id?.slice(0, 12) || ''} est confirmée. On la prépare !`,
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
    message: (order) => `Ton livreur Moussa est en route. Tu peux le suivre en temps réel.`,
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

  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: {
        token,
        type: 'order_status',
        user_id: order.user_id,
        title: tpl.title,
        message: typeof tpl.message === 'function' ? tpl.message(order) : tpl.message,
        url: typeof tpl.url === 'function' ? tpl.url(order) : tpl.url,
        data: {
          order_id: order.id,
          status: order.status,
        },
      },
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
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: {
        token,
        type: 'order_status',
        user_id: order.user_id,
        title: '🛵 Livreur assigné',
        message: `${livreurName || 'Un livreur'} a été assigné à ta commande ${shortId}. Il part bientôt !`,
        url: `https://yaram.app/order/${order.id}`,
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
