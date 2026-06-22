// ════════════════════════════════════════════════════════
// YARAM — WhatsApp bulk via WaSender (v3 — blocks)
// ════════════════════════════════════════════════════════
//
// Système de "blocks" : tu construis une séquence de 1 à 4 messages
// (chaque block = 1 message WhatsApp) et l'edge function les envoie
// en cascade à chaque cliente.
//
// Block image : { type: 'image', image_url, caption }
// Block texte : { type: 'text',  text }    (URL dedans = preview auto)
// ════════════════════════════════════════════════════════

import { supabase } from './supabase';
import { getAdminToken } from './adminAuth';

/**
 * Personnalise un template avec les variables d'un user.
 */
export function personalizeMessage(template, user) {
  if (!template) return '';
  return template
    .replace(/\{name\}/g, user?.first_name || user?.name || 'toi')
    .replace(/\{skinType\}/g, user?.skin_type || '');
}

/**
 * Normalise un numéro pour WhatsApp.
 */
export function normalizePhone(raw) {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Upload une image vers le bucket marketing-assets.
 */
export async function uploadMarketingImage(file) {
  if (!file) return { url: null, error: 'no_file' };
  if (!file.type.startsWith('image/')) {
    return { url: null, error: 'not_an_image' };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { url: null, error: 'file_too_large_max_10mb' };
  }

  const ext = ((file?.name || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
  const filename = `campaign_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

  const { data, error } = await supabase.storage
    .from('marketing-assets')
    .upload(filename, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    console.warn('[whatsapp] upload error:', error.message);
    return { url: null, error: error.message };
  }

  const { data: pub } = supabase.storage.from('marketing-assets').getPublicUrl(data.path);
  return { url: pub.publicUrl, path: data.path };
}

/**
 * Envoie une séquence de blocks (1 à 4 messages) à un lot de destinataires.
 *
 * @param {Object} opts
 * @param {string} opts.campaignName
 * @param {Array}  opts.blocks      - [{ type: 'image'|'text', image_url?, caption?, text? }]
 * @param {Array}  opts.recipients  - [{ phone, name?, skin_type? }]
 * @returns {Promise<{ success, sent, failed, total, blocks_per_recipient, details, error? }>}
 */
export async function sendWhatsAppBulk({ campaignName, blocks, recipients }) {
  const token = getAdminToken();
  if (!token) {
    return { success: false, error: 'Session admin requise' };
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { success: false, error: 'Aucun block à envoyer' };
  }
  if (blocks.length > 4) {
    return { success: false, error: 'Maximum 4 blocks par campagne' };
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { success: false, error: 'Aucun destinataire' };
  }

  const cleaned = recipients
    .map(r => ({
      phone: normalizePhone(r.phone),
      name: r.first_name || r.name || null,
      skin_type: r.skin_type || null,
    }))
    .filter(r => r.phone);

  if (cleaned.length === 0) {
    return { success: false, error: 'Aucun destinataire avec téléphone valide' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-whatsapp-bulk', {
      body: {
        token,
        campaign_name: campaignName || 'Campagne sans nom',
        blocks,
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
    return data;
  } catch (e) {
    console.warn('[whatsapp] exception:', e?.message);
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * FALLBACK : Ouvre wa.me dans des onglets séquentiels.
 * Ne supporte qu'un seul block texte (pas d'image, pas de séquence).
 */
export function sendWhatsAppViaWaMe(recipients, text) {
  recipients.forEach((r, i) => {
    setTimeout(() => {
      const phone = normalizePhone(r.phone);
      if (!phone) return;
      const personalized = personalizeMessage(text, r);
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(personalized)}`, '_blank');
    }, i * 500);
  });
}
