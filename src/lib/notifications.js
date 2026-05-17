// ═══════════════════════════════════════════════════
// YARAM — Notifications WhatsApp centralisees
// ═══════════════════════════════════════════════════
// Tous les envois passent par ces fonctions pour :
//   - Eviter les doublons (cooldown via has_received_whatsapp)
//   - Logger chaque envoi (whatsapp_log)
//   - Templates centralises et faciles a modifier
// ═══════════════════════════════════════════════════

import { supabase, sendWhatsApp } from './supabase';

const APP_URL = 'https://diaara-brg.pages.dev';

// ───────────────────── TEMPLATES NOTIFICATIONS PROACTIVES ─────────────────────

export const NotifTemplates = {
  // 1. Welcome (envoye apres signup, 1 fois)
  welcome: (firstName) =>
    `🎉 Bienvenue sur YARAM, ${firstName} !\n\n` +
    `Profite de *-10%* sur ta 1ère commande avec le code *BIENVENUE10* (dès 25 000 FCFA).\n\n` +
    `🌿 800+ produits beauté validés par dermato\n` +
    `🛵 Livraison en 24h chez toi à Dakar\n` +
    `🧴 Scan IA peau gratuit\n\n` +
    `👉 Ouvre l'app : ${APP_URL}\n\n` +
    `YARAM 💚`,

  // 2. Review reminder (1 jour apres delivered)
  reviewReminder: (firstName, orderId) =>
    `Salut ${firstName} 👋\n\n` +
    `Tu as reçu ta commande ${orderId} hier ✨\n\n` +
    `Tu nous aides à grandir ? Laisse un avis (avec photo si tu veux) sur tes produits et\n` +
    `*gagne +50 points fidélité* 🎁\n\n` +
    `👉 ${APP_URL}/orders\n\n` +
    `YARAM 💚`,

  // 3. Cart abandoned (24h apres ajout sans checkout)
  cartAbandoned: (firstName, itemCount) =>
    `Hey ${firstName} 🛒\n\n` +
    `Tu as oublié ${itemCount} produit${itemCount > 1 ? 's' : ''} dans ton panier !\n\n` +
    `Ils t'attendent toujours, et tu as ton code *BIENVENUE10* pour -10% 💚\n\n` +
    `👉 Finalise ta commande : ${APP_URL}/cart\n\n` +
    `YARAM`,

  // 4. Loyalty milestone (atteinte d'un palier important)
  loyaltyMilestone: (firstName, points, fcfaValue) =>
    `Bravo ${firstName} ⭐\n\n` +
    `Tu as atteint ${points} points fidélité !\n` +
    `Échange-les contre *${fcfaValue.toLocaleString('fr-FR')} FCFA* de réduction sur ta prochaine commande.\n\n` +
    `👉 ${APP_URL}/loyalty\n\n` +
    `YARAM 💚`,
};

// ───────────────────── SEND HELPERS ─────────────────────

/**
 * Envoie un WhatsApp avec :
 *   1. Verification anti-doublon (sauf force=true)
 *   2. Log automatique dans whatsapp_log
 *   3. Gestion d'erreur silencieuse (pas de crash si fail)
 */
export async function sendNotif({
  userId, phone, template, text, context = {}, cooldownHours = 24, force = false,
}) {
  if (!phone) {
    console.log('[notif] skip: no phone', template);
    return { skipped: true, reason: 'no_phone' };
  }

  // 1. Anti-doublon
  if (!force && userId) {
    try {
      const { data: alreadySent } = await supabase.rpc('has_received_whatsapp', {
        p_user_id: userId,
        p_template: template,
        p_within_hours: cooldownHours,
      });
      if (alreadySent) {
        console.log('[notif] skip cooldown', template, userId);
        return { skipped: true, reason: 'cooldown' };
      }
    } catch (e) {
      console.warn('[notif] cooldown check failed (continuing):', e.message);
    }
  }

  // 2. Envoi
  const result = await sendWhatsApp(phone, text);
  const success = result?.success !== false;

  // 3. Log
  try {
    await supabase.rpc('log_whatsapp', {
      p_user_id: userId,
      p_phone: phone,
      p_template: template,
      p_context: context,
      p_status: success ? 'sent' : 'failed',
      p_error: success ? null : (result?.error || 'unknown'),
    });
  } catch (e) {
    console.warn('[notif] log failed:', e.message);
  }

  return { sent: success, result };
}

// ───────────────────── 1. WELCOME ─────────────────────

export async function notifyWelcome({ userId, phone, firstName }) {
  if (!userId || !phone) return { skipped: true, reason: 'missing_data' };
  return sendNotif({
    userId,
    phone,
    template: 'welcome',
    text: NotifTemplates.welcome(firstName || 'toi'),
    cooldownHours: 24 * 365, // 1 fois par an max (en pratique 1 seule fois)
  });
}

// ───────────────────── 2. REVIEW REMINDER ─────────────────────

export async function notifyReviewReminder({ userId, phone, firstName, orderId }) {
  if (!userId || !phone || !orderId) return;
  return sendNotif({
    userId,
    phone,
    template: 'review_reminder',
    text: NotifTemplates.reviewReminder(firstName || 'toi', orderId),
    context: { orderId },
    cooldownHours: 24 * 7, // pas plus d'1 par semaine
  });
}

// ───────────────────── 3. CART ABANDONED ─────────────────────

/**
 * Verifie le panier de l'utilisateur et envoie un WhatsApp si :
 *   - Panier > 0 items
 *   - Date du dernier ajout > 24h
 *   - Pas de WhatsApp cart_abandoned dans les 7 derniers jours
 *
 * A appeler au load de l'app.
 */
export async function checkAndNotifyCartAbandon({ userId, phone, firstName }) {
  if (!userId || !phone) return { skipped: true, reason: 'no_user' };

  try {
    // Lit le panier local (cle = yaram_cart)
    const cart = JSON.parse(localStorage.getItem('yaram_cart') || '[]');
    if (!Array.isArray(cart) || cart.length === 0) return { skipped: true, reason: 'empty_cart' };

    // Verifie le timestamp du dernier ajout
    const lastAddedAt = localStorage.getItem('yaram_cart_last_added_at');
    if (!lastAddedAt) {
      // Pas de timestamp = on en pose un et on attend 24h
      localStorage.setItem('yaram_cart_last_added_at', new Date().toISOString());
      return { skipped: true, reason: 'no_timestamp_yet' };
    }

    const hoursSinceLastAdd = (Date.now() - new Date(lastAddedAt).getTime()) / 36e5;
    if (hoursSinceLastAdd < 24) return { skipped: true, reason: 'too_recent', hours: hoursSinceLastAdd.toFixed(1) };
    if (hoursSinceLastAdd > 72) return { skipped: true, reason: 'too_old' };

    return sendNotif({
      userId,
      phone,
      template: 'cart_abandoned',
      text: NotifTemplates.cartAbandoned(firstName || 'toi', cart.length),
      context: { itemCount: cart.length, cartItems: cart.map(c => ({ id: c.productId, name: c.name })) },
      cooldownHours: 24 * 7,
    });
  } catch (e) {
    console.warn('[cart-abandon] check failed:', e.message);
    return { skipped: true, reason: 'error', error: e.message };
  }
}

// ───────────────────── 4. LOYALTY MILESTONE ─────────────────────

const MILESTONES = [500, 1000, 2000, 5000];

export async function maybeNotifyLoyaltyMilestone({ userId, phone, firstName, currentPoints, previousPoints }) {
  if (!userId || !phone) return;

  const crossed = MILESTONES.find(m => previousPoints < m && currentPoints >= m);
  if (!crossed) return;

  const fcfaValue = Math.floor(currentPoints / 100) * 1000;
  return sendNotif({
    userId,
    phone,
    template: `loyalty_milestone_${crossed}`,
    text: NotifTemplates.loyaltyMilestone(firstName || 'toi', currentPoints, fcfaValue),
    context: { milestone: crossed, points: currentPoints },
    cooldownHours: 24 * 365,
  });
}
