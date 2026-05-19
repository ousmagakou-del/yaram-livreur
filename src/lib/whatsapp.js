// ════════════════════════════════════════════════════════
// YARAM — WhatsApp bulk via WaSender (v2 — avec image)
// ════════════════════════════════════════════════════════
//
// Helpers pour la section Marketing :
// - sendWhatsAppBulk : appelle l'edge function send-whatsapp-bulk
// - uploadMarketingImage : upload une image vers Supabase Storage
//                          (bucket marketing-assets) et retourne l'URL publique
// - personalizeMessage : remplace {name} et {skinType} dans le template
// - sendWhatsAppViaWaMe : fallback (ouvre wa.me dans onglets)
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
 */
export function normalizePhone(raw) {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Upload une image vers le bucket marketing-assets et retourne l'URL publique.
 * Nom de fichier auto : campaign_<timestamp>_<random>.<ext>
 *
 * @param {File} file - Fichier image depuis un <input type="file">
 * @returns {Promise<{ url, path, error? }>}
 */
export async function uploadMarketingImage(file) {
  if (!file) return { url: null, error: 'no_file' };
  if (!file.type.startsWith('image/')) {
    return { url: null, error: 'not_an_image' };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { url: null, error: 'file_too_large_max_10mb' };
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
  const filename = `campaign_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const path = filename; // racine du bucket

  const { data, error } = await supabase.storage
    .from('marketing-assets')
    .upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    console.warn('[whatsapp] upload error:', error.message);
    return { url: null, error: error.message };
  }

  // URL publique (le bucket est public, pas besoin de signature)
  const { data: pub } = supabase.storage.from('marketing-assets').getPublicUrl(data.path);
  return { url: pub.publicUrl, path: data.path };
}

/**
 * Envoie un lot de messages WhatsApp via WaSender (edge function).
 *
 * @param {Object} opts
 * @param {string} opts.campaignName - Nom affiché dans l'historique
 * @param {string|null} opts.imageUrl - URL publique d'une image (optionnel)
 * @param {Array}  opts.recipients   - [{ phone, text }, ...]
 * @returns {Promise<{ success, sent, failed, total, details, image_used, error? }>}
 */
export async function sendWhatsAppBulk({ campaignName, imageUrl, recipients }) {
  const token = getAdminToken();
  if (!token) {
    return { success: false, error: 'Session admin requise' };
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { success: false, error: 'Aucun destinataire' };
  }

  const cleaned = recipients
    .map(r => ({ phone: normalizePhone(r.phone), text: r.text }))
    .filter(r => r.phone && (r.text || imageUrl));

  if (cleaned.length === 0) {
    return { success: false, error: 'Aucun destinataire avec téléphone valide' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-whatsapp-bulk', {
      body: {
        token,
        campaign_name: campaignName || 'Campagne sans nom',
        image_url: imageUrl || null,
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
 * FALLBACK : Ouvre wa.me dans des onglets séquentiels (ancienne méthode).
 * Ne supporte PAS l'image (wa.me ne le permet pas en URL).
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
