import { createClient } from '@supabase/supabase-js';
import { invalidateCache } from '../dataCache';

const SUPABASE_URL = 'https://qxhhnrnworwrnwmqekmb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';

// Exporte pour les modules qui font des fetch direct vers les edge functions
export { SUPABASE_URL, SUPABASE_ANON_KEY };

// ─── FETCH avec TIMEOUT — protège contre les fetches qui hang après reprise iOS ───
// Quand l'app reprend du background, certains fetches en cours sont "morts"
// (TCP socket fermé par iOS) et leur Promise ne resolve jamais → page stuck.
// On wrap le fetch global avec un timeout de 20s + AbortController.
const FETCH_TIMEOUT_MS = 20000; // 20s : large pour réseau africain mais ne hang pas indéfiniment

const customFetch = (input, init = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('fetch_timeout')), FETCH_TIMEOUT_MS);

  // Si l'appelant a déjà son propre signal (rare), on le respecte aussi
  const externalSignal = init.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
    }
  }

  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'yaram-auth',
  },
  global: {
    fetch: customFetch,
  },
});

// Re-export utility for admin sections
export { invalidateCache };

// ═══════════════════════════════════════════════
// SITE SETTINGS (admin) — table site_settings (key, value JSONB, updated_at)
// ═══════════════════════════════════════════════

// Cache module-level : settings charges au boot, exposes sync via getCachedSetting().
// Fallback hardcode garanti si DB indisponible ou cle non set.
const SETTINGS_FALLBACK = {
  siteName: 'YARAM',
  commission: 8,            // pourcentage
  deliveryFee: 1500,        // FCFA (Dakar)
  freeDeliveryFrom: 30000,  // FCFA (Dakar — au-dessus livraison gratuite)
  whatsapp: '+221 77 760 89 83',
  email: 'contact@yaram.sn',
  primaryColor: '#1F8B4C',
  accentColor: '#FFD700',
  // ─── Hero banner Home (éditable dans Admin → Settings → Hero) ───
  heroEnabled: true,
  heroLine1: 'Zéro',
  heroLine2: 'frais de',
  heroLine3: 'service',
  heroSubtext: 'Livraison à 1 500 FCFA',
  heroBackground: '#1F8B4C',
  heroLine1Color: '#FFF8E5',
  heroLineColor: '#FFFFFF',
  heroSubBg: '#F4B53A',
  heroSubColor: '#4A1B0C',
  heroCtaLabel: 'Découvrir les promos',
  heroCtaRoute: 'promos',
  // ─── Hero — cycles d'animation des 3 lignes (phrases séparées par |) ───
  // Si rempli, chaque ligne cycle entre ces phrases (2.6s par cycle).
  // Format : "Phrase 1|Phrase 2|Phrase 3"
  heroLine1Cycle: 'ZÉRO|100%|LIVRAISON',
  heroLine2Cycle: 'FRAIS DE|AUTHENTIQUE|EN 1H30',
  heroLine3Cycle: 'SERVICE|MARQUES|CHRONO',
  // ─── Boutique internationale — image de fond éditable (URL Supabase) ──
  intlBgImage: '',
};
let settingsCache = { ...SETTINGS_FALLBACK };
const settingsListeners = new Set();

export function getCachedSetting(key, fallback) {
  if (settingsCache && key in settingsCache && settingsCache[key] != null) {
    return settingsCache[key];
  }
  if (fallback !== undefined) return fallback;
  return SETTINGS_FALLBACK[key];
}

export function subscribeSettings(listener) {
  settingsListeners.add(listener);
  listener(settingsCache);
  return () => settingsListeners.delete(listener);
}

// Charge les settings depuis la DB et update le cache. A appeler au boot de l'app.
export async function loadSiteSettings() {
  const remote = await getSiteSettings();
  settingsCache = { ...SETTINGS_FALLBACK, ...remote };
  for (const l of settingsListeners) l(settingsCache);
  return settingsCache;
}

export async function getSiteSettings() {
  // Lit toutes les rows et merge en { key: value }
  const { data, error } = await supabase
    .from('site_settings')
    .select('key, value');
  if (error) {
    console.warn('[settings] read error:', error.message);
    return {};
  }
  const out = {};
  for (const row of (data || [])) {
    out[row.key] = row.value;
  }
  return out;
}

export async function updateSiteSettings(updates) {
  // Phase 2 RLS : on passe par la RPC admin_update_site_settings (SECURITY DEFINER,
  // requiert token admin). L'INSERT/UPDATE direct sur site_settings est bloque
  // pour anon depuis la vague 5.
  const keys = Object.keys(updates || {});
  if (keys.length === 0) return { success: true };

  // Recupere le token admin courant.
  // FIX juin 2026 : la session admin est dans localStorage (cf adminAuth.js),
  // PAS sessionStorage. On lit les 2 par sécurité (legacy + nouveau).
  let token = null;
  try {
    const raw = localStorage.getItem('yaram-admin-session')
             || sessionStorage.getItem('yaram-admin-session');
    if (raw) {
      const s = JSON.parse(raw);
      // Check expiry côté client : évite d'envoyer un token déjà expiré
      if (s?.token && (!s.expires_at || s.expires_at > Date.now())) {
        token = s.token;
      }
    }
  } catch { /* ignore */ }

  if (!token) {
    return { success: false, error: 'Session admin expirée — reconnecte-toi' };
  }

  const { data, error } = await supabase.rpc('admin_update_site_settings', {
    p_token:    token,
    p_settings: updates,
  });
  if (error) {
    console.error('[settings] write error:', error.message);
    return { success: false, error: error.message };
  }
  if (!data?.success) {
    return { success: false, error: data?.error || 'Echec mise a jour parametres' };
  }
  // Refresh le cache + notify les listeners (CSS variables, etc.)
  await loadSiteSettings();
  return { success: true };
}
