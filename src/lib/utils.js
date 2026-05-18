// ─── Numero WhatsApp YARAM (centralise) ───
// Pour la suite : ces constantes doivent etre la SEULE source de verite du numero.
// Format wa.me : 221XXXXXXXXX (sans + ni espaces)
// Format display : '+221 77 XXX XX XX'
// Format sendWhatsApp(): '+221XXXXXXXXX'
export const YARAM_WHATSAPP = '221774388766';
export const YARAM_WHATSAPP_INTL = '+221774388766';
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