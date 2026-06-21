// ════════════════════════════════════════════════════════
// YARAM — Helpers admin pour la newsletter
// ════════════════════════════════════════════════════════
//
// Toutes les fonctions utilisent le token admin (admin_start_session)
// pour s'authentifier côté Supabase RPC + edge function.
// ════════════════════════════════════════════════════════

import { supabase } from './supabase';
import { getAdminToken } from './adminAuth';

/**
 * Liste les abonnés newsletter.
 * @param {Object} opts
 * @param {'active'|'all'|'unsubscribed'} [opts.status='active']
 * @param {number} [opts.limit=500]
 */
export async function listNewsletterSubscribers({ status = 'active', limit = 500 } = {}) {
  const token = getAdminToken();
  if (!token) return { data: [], error: 'no_admin_token' };

  const { data, error } = await supabase.rpc('admin_list_newsletter_subscribers', {
    p_token: token,
    p_status: status,
    p_limit: limit,
  });
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null };
}

/**
 * Stats newsletter : counts par préférence + 20 derniers envois.
 */
export async function getNewsletterStats() {
  const token = getAdminToken();
  if (!token) return { data: null, error: 'no_admin_token' };

  const { data, error } = await supabase.rpc('admin_newsletter_stats', {
    p_token: token,
  });
  if (error) return { data: null, error: error.message };
  return { data: data || {}, error: null };
}

/**
 * Envoie une newsletter via Resend (edge function send-newsletter).
 *
 * @param {Object} opts
 * @param {string} opts.subject
 * @param {string} opts.html      - corps HTML
 * @param {string} [opts.text]    - corps texte (fallback)
 * @param {'all'|'promos'|'nouveautes'|'conseils'|'evenements'} [opts.audience='all']
 * @param {string} [opts.testTo]  - si fourni, envoie 1 email seulement à cette adresse
 */
export async function sendNewsletter({ subject, html, text, audience = 'all', testTo = null }) {
  const token = getAdminToken();
  if (!token) return { ok: false, error: 'no_admin_token' };

  try {
    const { data, error } = await supabase.functions.invoke('send-newsletter', {
      body: { subject, html, text, audience, test_to: testTo || undefined },
      headers: { 'x-admin-token': token },
    });
    if (error) return { ok: false, error: error.message };
    return data || { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
