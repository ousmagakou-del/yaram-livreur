// ════════════════════════════════════════════════════════
// YARAM — Notifications auto pour les commandes Preorder (Import)
// ════════════════════════════════════════════════════════
//
// Quand l'admin avance le statut d'une commande preorder dans ImportsSection,
// on déclenche automatiquement :
//   • Push notification (OneSignal) via send-push-notification
//   • WhatsApp (WaSender) via send-whatsapp-bulk
//
// Templates personnalisés par statut, avec variables {name}, {amount}, {date}.
//
// ════════════════════════════════════════════════════════

import { supabase } from './supabase';
import { formatArrivalDate } from './preorder';
import { getAdminToken } from './adminAuth';

// ─── Templates de notifs par statut ───
function getTemplates({ orderId, customerName, deposit, balance, expectedDate, total }) {
  const firstName = (customerName || 'toi').split(' ')[0];
  const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
  const arrivalStr = expectedDate ? formatArrivalDate(expectedDate) : '15 jours';

  return {
    // Acompte reçu — on confirme + on commande chez fournisseur
    paid: {
      push: {
        title: '✅ Acompte reçu !',
        message: `Merci ${firstName}, on commande ton produit chez le fournisseur.`,
      },
      whatsapp: `Bonjour ${firstName} 💖

✅ *Acompte bien reçu* (${fmt(deposit)} FCFA)

Bonne nouvelle : on lance la commande de ton produit chez le fournisseur dès maintenant. Arrivée prévue à Dakar : *${arrivalStr}*.

Tu seras notifié(e) à chaque étape :
✈️ Expédition vers Dakar
🇸🇳 Arrivée à Dakar
🚚 Livraison

Référence commande : ${orderId}

YARAM 🌍`,
    },

    // Commande lancée chez fournisseur
    awaiting_supplier: {
      push: {
        title: '🛍️ Commande lancée',
        message: `On a commandé ton produit ${firstName}, expédition en cours.`,
      },
      whatsapp: `${firstName}, 🛍️ on a passé ta commande chez notre fournisseur aujourd'hui !

Prochaine étape : expédition vers Dakar. On te tient au courant dès que c'est en route ✈️

Réf : ${orderId}
YARAM 🌍`,
    },

    // En transit international
    in_transit_intl: {
      push: {
        title: '✈️ En route vers Dakar !',
        message: `Ton produit est parti, arrivée prévue ${arrivalStr}`,
      },
      whatsapp: `${firstName}, ton produit YARAM est en route 🌍✈️

📍 Statut : *En transit vers Dakar*
📅 Arrivée prévue : *${arrivalStr}*

On te prévient dès qu'il arrive 💖

Réf : ${orderId}
YARAM`,
    },

    // Arrivé à Dakar — demander solde
    arrived_local: {
      push: {
        title: '🇸🇳 Ton produit est à Dakar !',
        message: `Solde à régler : ${fmt(balance)} FCFA pour qu'on te livre`,
      },
      whatsapp: `🎉 *EXCELLENTE NOUVELLE ${firstName} !*

Ton produit est arrivé à Dakar 🇸🇳

Pour qu'on te livre, il reste à régler le *solde de ${fmt(balance)} FCFA*.

💳 Paie via Wave : 77 438 87 66
💬 Ou réponds "Solde" et on t'envoie le lien

Une fois reçu, on te livre dans 24h ! 🚚

Réf : ${orderId}
YARAM 🌍`,
    },

    // Relance solde
    awaiting_balance: {
      push: {
        title: '💰 Solde en attente',
        message: `Plus que ${fmt(balance)} FCFA pour recevoir ton produit ✨`,
      },
      whatsapp: `Coucou ${firstName} 💖

Petit rappel : ton produit YARAM t'attend à Dakar !
Il reste juste le *solde de ${fmt(balance)} FCFA* à régler pour qu'on te livre.

💳 Wave : 77 438 87 66
💬 Réponds-nous et on s'occupe de toi

Réf : ${orderId}
YARAM 🌍`,
    },

    // En livraison
    shipped: {
      push: {
        title: '🛵 Livraison en cours',
        message: `Ton livreur YARAM est en route !`,
      },
      whatsapp: `🛵 ${firstName}, ton livreur YARAM est en route avec ton produit !

Reste joignable, on t'appelle dans peu 📞

Réf : ${orderId}
YARAM 💖`,
    },

    // Livré ! 🎉
    delivered: {
      push: {
        title: '🎉 Profite bien !',
        message: `Ton produit YARAM est livré ${firstName}, merci !`,
      },
      whatsapp: `🎉 *Bienvenue dans la famille YARAM ${firstName} !*

Ton produit est livré. On espère qu'il te plaira autant qu'on a aimé te l'apporter 💖

🌟 *Aide-nous à grandir* : laisse un avis sur l'app, ça compte énormément.
📸 Partage ta routine sur Insta @yaram.app, on adore voir nos clientes brillantes ✨

Réf : ${orderId}
YARAM 🌍`,
    },
  };
}

/**
 * Envoie les notifs (push + whatsapp) pour un changement de statut preorder.
 *
 * @param {object} order - row de la table orders avec user_id, address, deposit/balance, expected_arrival_date
 * @param {string} newStatus - nouveau statut (paid, awaiting_supplier, etc.)
 * @param {object} [options]
 * @param {boolean} [options.sendPush=true]
 * @param {boolean} [options.sendWhatsApp=true]
 * @returns {Promise<{push: object, whatsapp: object}>}
 */
export async function notifyPreorderStatusChange(order, newStatus, options = {}) {
  const { sendPush = true, sendWhatsApp = true } = options;

  const customerName = order?.address?.name || '';
  const phone = order?.address?.phone || '';
  const templates = getTemplates({
    orderId: order.id,
    customerName,
    deposit: order.deposit_amount,
    balance: order.balance_amount,
    expectedDate: order.expected_arrival_date,
    total: order.total,
  });

  const tpl = templates[newStatus];
  if (!tpl) {
    console.warn('[preorderNotify] no template for status:', newStatus);
    return { push: null, whatsapp: null };
  }

  const results = { push: null, whatsapp: null };

  // ─── 1. Push OneSignal (vers le user_id) ───
  // L'edge function send-push-notification attend user_id (singulier), un type,
  // et soit un token admin (admin_sessions) soit un internal_secret pour
  // l'auth. notifyPreorderStatusChange est appelé depuis ImportsSection (admin)
  // donc on passe le token admin courant.
  if (sendPush && order.user_id) {
    try {
      const token = getAdminToken();
      if (!token) {
        results.push = { ok: false, error: 'no_admin_token' };
      } else {
        const { data, error } = await supabase.functions.invoke('send-push-notification', {
          body: {
            token,
            type: 'order_status',
            user_id: order.user_id,
            title: tpl.push.title,
            message: tpl.push.message,
            url: `/orders`, // deep link vers Mes commandes
            data: { order_id: order.id, status: newStatus },
          },
        });
        results.push = error ? { ok: false, error: error.message } : { ok: true, data };
      }
    } catch (e) {
      results.push = { ok: false, error: e?.message || String(e) };
    }
  }

  // ─── 2. WhatsApp via WaSender (vers le téléphone client) ───
  if (sendWhatsApp && phone) {
    try {
      const cleanPhone = String(phone).replace(/\D/g, '');
      const { data, error } = await supabase.functions.invoke('send-whatsapp-bulk', {
        body: {
          recipients: [{ phone: cleanPhone, name: customerName }],
          message: tpl.whatsapp,
          campaign_name: `preorder_${newStatus}_${order.id}`,
        },
      });
      results.whatsapp = error ? { ok: false, error: error.message } : { ok: true, data };
    } catch (e) {
      results.whatsapp = { ok: false, error: e?.message || String(e) };
    }
  }

  return results;
}
