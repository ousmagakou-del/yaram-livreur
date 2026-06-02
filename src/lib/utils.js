// ─── Numero WhatsApp YARAM (DYNAMIQUE depuis site_settings) ───
// La valeur "source de vérité" est dans la table site_settings (clé 'whatsapp').
// Les composants doivent appeler getWhatsAppNumber() / getWhatsAppIntl() /
// getWhatsAppDisplay() pour récupérer la valeur courante depuis l'admin,
// au lieu d'utiliser des constantes hardcodées.
//
// Les anciennes constantes sont conservées EN FALLBACK uniquement (au cas où
// le cache n'est pas encore chargé au tout premier render).
//
// Pour CHANGER le numéro : admin → Paramètres → champ "WhatsApp" → Save.
// Aucun deploy nécessaire (les composants relisent à chaque render).

// ─── SAFE HELPERS — évitent les crashs sur null/undefined/invalid ───

/**
 * Parse une date safely. Retourne null si invalide (au lieu de "Invalid Date").
 */
export function safeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Formate une date pour affichage. Retourne fallback si invalide.
 */
export function safeFormatDate(value, opts = {}) {
  const d = safeDate(value);
  if (!d) return opts.fallback || '—';
  const locale = opts.locale || 'fr-FR';
  if (opts.type === 'datetime') return d.toLocaleString(locale);
  if (opts.type === 'time') return d.toLocaleTimeString(locale);
  return d.toLocaleDateString(locale);
}

/**
 * Convertit une valeur en nombre safe (jamais NaN).
 * Utile pour les calculs prix*qty où une des deux valeurs peut être null.
 */
export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  if (isNaN(n) || n === null || n === undefined) return fallback;
  return n;
}

/**
 * Multiplication safe. Si l'un des opérandes est null/undefined/NaN, retourne 0.
 */
export function safeMultiply(...values) {
  return values.reduce((acc, v) => acc * safeNumber(v, 0), 1);
}

const WHATSAPP_FALLBACK_INTL = '+221774388766';

/**
 * Helper : nettoie le numéro WhatsApp en gardant uniquement les chiffres
 * (sans + ni espaces). Format compatible https://wa.me/
 */
function cleanForWaMe(raw) {
  return (raw || '').replace(/[^\d]/g, '');
}

/**
 * Numéro WhatsApp au format wa.me : '221774388766'
 * (chiffres uniquement, indicatif compris, sans +)
 */
export function getWhatsAppNumber() {
  const stored = getCachedSetting('whatsapp', WHATSAPP_FALLBACK_INTL);
  return cleanForWaMe(stored);
}

/**
 * Numéro WhatsApp au format international : '+221774388766'
 */
export function getWhatsAppIntl() {
  const stored = getCachedSetting('whatsapp', WHATSAPP_FALLBACK_INTL);
  const cleaned = cleanForWaMe(stored);
  return cleaned ? '+' + cleaned : '';
}

/**
 * Numéro WhatsApp formaté pour affichage humain : '+221 77 438 87 66'
 * Si le numéro stocké contient déjà des espaces (format admin), on le retourne tel quel.
 * Sinon on essaye de le formater intelligemment.
 */
export function getWhatsAppDisplay() {
  const stored = getCachedSetting('whatsapp', WHATSAPP_FALLBACK_INTL);
  if (!stored) return WHATSAPP_FALLBACK_INTL;
  // Si l'admin a stocké un format affichable (+221 77 438 87 66) → on garde
  if (stored.includes(' ')) return stored.startsWith('+') ? stored : '+' + stored;
  // Sinon on formate à la sénégalaise : "+221 77 XXX XX XX"
  const digits = cleanForWaMe(stored);
  if (digits.length >= 12 && digits.startsWith('221')) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10, 12)}`.trim();
  }
  return stored;
}

// ─── Constantes legacy (DEPRECATED — utiliser les helpers ci-dessus) ───
// Conservées pour ne pas casser les vieux imports qui pourraient encore traîner.
// Toutes les utilisations dans le code ont été migrées vers les helpers.
export const YARAM_WHATSAPP = cleanForWaMe(WHATSAPP_FALLBACK_INTL);
export const YARAM_WHATSAPP_INTL = WHATSAPP_FALLBACK_INTL;
export const YARAM_WHATSAPP_DISPLAY = '+221 77 438 87 66';

export function scoreClass(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'medium';
  if (score >= 30) return 'poor';
  return 'bad';
}

export function formatPrice(price) {
  return (price || 0).toLocaleString('fr-FR');
}

// Import du cache settings — ESM gere le hoisting, pas de cycle a craindre
// (supabase.js n'importe pas utils.js).
import { getCachedSetting } from './supabase';

function readShippingSettings() {
  return {
    dakarPrice: Number(getCachedSetting('deliveryFee', 1500)),
    dakarFreeFrom: Number(getCachedSetting('freeDeliveryFrom', 30000)),
  };
}

export function getShippingZone(city = '', country = '') {
  const c = (city || '').toLowerCase();
  const co = (country || '').toLowerCase();
  if (co && !co.includes('sénégal') && !co.includes('senegal') && co !== '') {
    return { zone: 'Hors Sénégal', delay: 'Bientôt', price: 0, freeFrom: 0, available: false };
  }
  // Dakar : prix + seuil livraison gratuite branches sur site_settings
  if (c.includes('dakar')) {
    const { dakarPrice, dakarFreeFrom } = readShippingSettings();
    return { zone: 'Dakar', delay: '24h', price: dakarPrice, freeFrom: dakarFreeFrom };
  }
  if (c.includes('thiès') || c.includes('thies') || c.includes('mbour') || c.includes('saly')) return { zone: 'Thiès / Mbour', delay: '48h', price: 2500, freeFrom: 30000 };
  if (c.includes('saint-louis') || c.includes('kaolack')) return { zone: 'Saint-Louis / Kaolack', delay: '48-72h', price: 3000, freeFrom: 40000 };
  return { zone: 'Reste du Sénégal', delay: '72h', price: 3500, freeFrom: 50000 };
}