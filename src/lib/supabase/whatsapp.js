import { SUPABASE_URL, SUPABASE_ANON_KEY } from './client';

// ═══════════════════════════════════════════════
// WHATSAPP
// ═══════════════════════════════════════════════

export async function sendWhatsApp(to, text) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, text }),
    });
    return await response.json();
  } catch (e) {
    console.error('sendWhatsApp exception:', e);
    return { success: false, error: e.message };
  }
}

export const WhatsAppTemplates = {
  driverAssigned: (driverName, order, trackingUrl) =>
    `Salut ${driverName}! 🛵\n\nNouvelle livraison YARAM :\n\n📦 N° ${order.id}\n👤 ${order.address?.name}\n📍 ${order.address?.line}, ${order.address?.city}\n💰 ${order.total?.toLocaleString('fr-FR')} FCFA${order.payment_method === 'cod' ? ' (à ENCAISSER cash 💵)' : ' (déjà payé en ligne ✅)'}\n\n🔗 Lien tracking GPS :\n${trackingUrl}\n\nOuvre ce lien sur ton téléphone, partage ta position et suis les étapes.\n\nYARAM 💚`,
  orderCreatedDigital: (clientName, orderId, total, method) =>
    `Salut ${clientName} 💚\n\nTa commande YARAM ${orderId} est reçue !\n\n💳 Paiement ${method} : ${total.toLocaleString('fr-FR')} FCFA\n\nDès validation, on prépare ton colis 📦\n\nYARAM`,
  orderCreatedCash: (clientName, orderId, total) =>
    `Salut ${clientName} 💚\n\nTa commande YARAM ${orderId} est reçue !\n\n💵 Prépare ${total.toLocaleString('fr-FR')} FCFA cash pour la livraison\n\nOn te notifie dès que le livreur arrive 🛵\n\nYARAM`,
  orderPaid: (clientName, orderId) =>
    `Salut ${clientName} 💚\n\nTon paiement pour la commande ${orderId} est confirmé ✅\n\nOn prépare ta commande, tu seras notifiée quand le livreur arrive 🛵\n\nYARAM`,
  orderShipped: (clientName, orderId, driverName, driverPhone) =>
    `Hey ${clientName} 🛵\n\nTa commande ${orderId} est en route !\n\n👤 Livreur : ${driverName}\n📞 WhatsApp : ${driverPhone || '—'}\n\nSuis sa progression en temps réel dans l'app YARAM.\n\nYARAM 💚`,
  orderAwaitingConfirm: (clientName, orderId, confirmUrl) =>
    `Bonjour ${clientName} 💚\n\nLe livreur indique avoir livré ta commande ${orderId}.\n\n👉 Confirme ta réception ici :\n${confirmUrl}\n\nDis-nous si tout va bien ou si tu as un souci.\n\nYARAM 💚`,
  orderAwaitingConfirmCash: (clientName, orderId, total, confirmUrl) =>
    `Bonjour ${clientName} 💚\n\nLe livreur indique avoir livré ta commande ${orderId} et reçu ${total.toLocaleString('fr-FR')} FCFA cash.\n\n👉 Confirme ta réception ici :\n${confirmUrl}\n\nDis-nous si tout va bien ou si tu as un souci.\n\nYARAM 💚`,
  orderDelivered: (clientName, orderId) =>
    `🎉 Bonjour ${clientName} !\n\nTa commande ${orderId} est officiellement livrée !\n\nMerci pour ta confiance 💚\n\nN'hésite pas à noter ton expérience dans l'app.\n\nYARAM`,
  newOrderToPharmacy: (pharmacyName, order) =>
    `🏥 Hello ${pharmacyName}\n\nNouvelle commande YARAM à préparer :\n\n📦 N° ${order.id}\n👤 ${order.address?.name}\n📍 ${order.address?.city}\n\nVoir tes commandes : ${window.location.origin}/?pharma\n\nYARAM 💚`,
  disputeToAdmin: (orderId, clientName, reason) =>
    `⚠️ LITIGE YARAM\n\nCommande : ${orderId}\nCliente : ${clientName}\nMotif : ${reason}\n\nVérifie les preuves dans l'admin et contacte la cliente.\n\nYARAM`,
};
