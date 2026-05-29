// ════════════════════════════════════════════════════════
// YARAM — Helper Interstitial Promos
// ════════════════════════════════════════════════════════
// Fetch + tracking des promos plein écran affichées au boot.
// Gère :
//   - Sessions anonymes (sans user_id) via localStorage session_id
//   - Frequency 'once_per_session' côté client (autres côté DB)
//   - Cache impressions vues dans cette session (anti double-affichage)
// ════════════════════════════════════════════════════════

import { supabase } from './supabase';

const SESSION_KEY = 'yaram_promo_session_id';
const VIEWED_KEY = 'yaram_promo_viewed_session';
const LAST_SHOWN_KEY = 'yaram_promo_last_shown';

// Génère un session ID stable pour la session courante (réutilisé entre refresh)
export function getSessionId() {
  try {
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = 'sid_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return 'sid_fallback';
  }
}

// Retourne la liste des promo_id déjà vues dans cette session (pour "once_per_session")
function getViewedThisSession() {
  try {
    return JSON.parse(sessionStorage.getItem(VIEWED_KEY) || '[]');
  } catch {
    return [];
  }
}

function markViewedThisSession(promoId) {
  try {
    const list = getViewedThisSession();
    if (!list.includes(promoId)) {
      list.push(promoId);
      sessionStorage.setItem(VIEWED_KEY, JSON.stringify(list));
    }
  } catch { /* ignore */ }
}

// Anti-spam : ne montre pas 2 promos différentes la même journée
function getLastShownAt() {
  try {
    const raw = localStorage.getItem(LAST_SHOWN_KEY);
    return raw ? new Date(raw) : null;
  } catch {
    return null;
  }
}

function markShown() {
  try {
    localStorage.setItem(LAST_SHOWN_KEY, new Date().toISOString());
  } catch { /* ignore */ }
}

/**
 * Détermine l'audience hint selon le profil user.
 * @param {object} user - objet user Supabase (peut être null)
 * @param {object} stats - { hasOrders: bool, createdAtDays: number }
 */
function getAudienceHint(user, stats = {}) {
  if (!user) return 'all';
  if (stats.hasOrders) return 'with_orders';
  if (stats.createdAtDays !== undefined && stats.createdAtDays <= 7) return 'new_users';
  if (stats.createdAtDays !== undefined && stats.createdAtDays > 30) return 'returning_users';
  if (stats.hasOrders === false) return 'no_orders';
  return 'all';
}

/**
 * Récupère la prochaine promo à afficher pour l'user/session.
 *
 * @param {object} options
 * @param {string} [options.placement='home'] - 'home' | 'login' | 'all'
 * @param {object} [options.user] - user Supabase pour le ciblage
 * @param {object} [options.userStats] - { hasOrders, createdAtDays }
 * @param {number} [options.minDelayHours=4] - délai mini entre 2 promos quelconques
 * @returns {Promise<object|null>}
 */
export async function getNextPromo({
  placement = 'home',
  user = null,
  userStats = {},
  minDelayHours = 4,
} = {}) {
  // Anti-spam : si on a déjà montré une promo dans les X dernières heures, skip
  const lastShown = getLastShownAt();
  if (lastShown && (Date.now() - lastShown.getTime()) < minDelayHours * 3600 * 1000) {
    return null;
  }

  const sessionId = getSessionId();
  const audience = getAudienceHint(user, userStats);

  try {
    const { data, error } = await supabase.rpc('get_next_promo', {
      p_placement: placement,
      p_session_id: sessionId,
      p_audience_hint: audience,
    });

    if (error) {
      console.warn('[promos] get_next_promo error:', error.message);
      return null;
    }
    if (!data) return null;

    // Si frequency == 'once_per_session' → check côté client
    if (data.frequency === 'once_per_session') {
      const viewed = getViewedThisSession();
      if (viewed.includes(data.id)) return null;
    }

    return data;
  } catch (e) {
    console.warn('[promos] fetch error:', e?.message);
    return null;
  }
}

/**
 * Enregistre un événement (shown / click / dismiss).
 *
 * @param {string} promoId
 * @param {string} eventType - 'shown' | 'click_primary' | 'click_secondary' | 'dismissed'
 */
export async function recordPromoEvent(promoId, eventType) {
  if (!promoId || !eventType) return;
  const sessionId = getSessionId();

  // Marquage local (anti double-affichage immediat)
  if (eventType === 'shown') {
    markShown();
    markViewedThisSession(promoId);
  }

  try {
    await supabase.rpc('record_promo_event', {
      p_promo_id: promoId,
      p_event_type: eventType,
      p_session_id: sessionId,
    });
  } catch (e) {
    console.warn('[promos] record event failed:', e?.message);
  }
}

/**
 * Helper : calcule createdAtDays + hasOrders pour le ciblage.
 * À appeler après login pour fournir userStats à getNextPromo.
 */
export async function computeUserStats(user) {
  if (!user?.id) return {};
  const stats = {};

  // Jours depuis l'inscription
  try {
    const createdAt = user.created_at ? new Date(user.created_at) : null;
    if (createdAt) {
      stats.createdAtDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    }
  } catch { /* ignore */ }

  // A-t-il déjà commandé ?
  try {
    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    stats.hasOrders = (count || 0) > 0;
  } catch { /* ignore */ }

  return stats;
}

/**
 * Admin : récupère toutes les promos (actives + inactives).
 */
export async function listAllPromos() {
  const { data, error } = await supabase
    .from('app_promos')
    .select('*')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Admin : stats d'une promo (impressions, clicks, CTR).
 */
export async function getPromoStats(promoId) {
  const { data, error } = await supabase
    .from('promo_impressions')
    .select('id, clicked_at, dismissed_at, cta_clicked')
    .eq('promo_id', promoId);
  if (error) throw error;

  const impressions = (data || []).length;
  const clicks = (data || []).filter(d => d.clicked_at).length;
  const dismisses = (data || []).filter(d => d.dismissed_at).length;
  const clickPrimary = (data || []).filter(d => d.cta_clicked === 'primary').length;
  const clickSecondary = (data || []).filter(d => d.cta_clicked === 'secondary').length;

  return {
    impressions,
    clicks,
    dismisses,
    clickPrimary,
    clickSecondary,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,  // %
    dismissRate: impressions > 0 ? Math.round((dismisses / impressions) * 1000) / 10 : 0,
  };
}
