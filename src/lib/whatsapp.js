// ════════════════════════════════════════════════════════
// YARAM — WhatsApp bulk via WaSender (v1)
// ════════════════════════════════════════════════════════
//
// Helper qui appelle l'edge function `send-whatsapp-bulk` pour envoyer
// un message à un lot de destinataires depuis l'admin Marketing.
//
// L'edge function gère :
// - Auth (admin token)
// - Délai anti-ban entre 2 envois (2.5s par défaut)
// - Log dans la table marketing_campaigns
// ════════════════════════════════════════════════════════

import { supabase } from './supabase';
import { getAdminToken } from './adminAuth';

/**
 * Personnalise un template avec les variables d'un user.
 * Variables supportées : {name}, {skinType}
 */
export function personalizeMessage(template, user) {
  if (!template) return '';
  return template
    .replace(/\{name\}/g, user?.first_name || user?.name || 'toi')
    .replace(/\{skinType\}/g, user?.skin_type || '');
}

/**
 * Normalise un numéro pour WhatsApp : que des chiffres, indicatif compris.
 * '+221 77 438 87 66' → '221774388766'
 * '0774388766'         → '0774388766' (PAS converti, à toi de gérer l'indicatif !)
 */
export function normalizePhone(raw) {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Envoie un lot de messages WhatsApp via WaSender (edge function).
 *
 * @param {Object} opts
 * @param {string} opts.campaignName - Nom affiché dans l'historique
 * @param {Array}  opts.recipients   - [{ phone, text }, ...]
 * @returns {Promise<{ success, sent, failed, total, details, error? }>}
 */
export async function sendWhatsAppBulk({ campaignName, recipients }) {
  const token = getAdminToken();
  if (!token) {
    return { success: false, error: 'Session admin requise' };
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { success: false, error: 'Aucun destinataire' };
  }

  // Filtre les téléphones vides AVANT l'envoi (évite de gaspiller des appels API)
  const cleaned = recipients
    .map(r => ({ phone: normalizePhone(r.phone), text: r.text }))
    .filter(r => r.phone && r.text);

  if (cleaned.length === 0) {
    return { success: false, error: 'Aucun destinataire avec téléphone valide' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-whatsapp-bulk', {
      body: {
        token,
        campaign_name: campaignName || 'Campagne sans nom',
        recipients: cleaned,
      },
    });
    if (error) {
      console.warn('[whatsapp] invoke error:', error.message);
      return { success: false, error: error.message };
    }
    if (!data?.success) {
      return { success: false, error: data?.error || 'Envoi WhatsApp échoué' };
    }
    return data; // { success, sent, failed, total, details, campaign_id }
  } catch (e) {
    console.warn('[whatsapp] exception:', e?.message);
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * FALLBACK : Ouvre wa.me dans des onglets séquentiels (ancienne méthode).
 * À utiliser si WaSender n'est pas configuré.
 */
export function sendWhatsAppViaWaMe(recipients) {
  recipients.forEach((r, i) => {
    setTimeout(() => {
      const phone = normalizePhone(r.phone);
      if (!phone) return;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(r.text)}`, '_blank');
    }, i * 500);
  });
}
