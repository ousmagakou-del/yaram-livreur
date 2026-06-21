import { supabase } from './client';

// ═══════════════════════════════════════════════════════════════════
//  YARAM — Newsletter API
// ═══════════════════════════════════════════════════════════════════
//  Wrapper minimal autour de la table `newsletter_subscribers`.
//  - subscribeNewsletter : upsert email + préférences. Lie user_id
//    si l'user est loggué. Idempotent (UNIQUE NULLS NOT DISTINCT
//    sur (email, user_id) → réinscrire un même email update les prefs).
//  - unsubscribeNewsletter : soft delete via unsubscribed_at.
//  - isSubscribed : check rapide pour pré-cocher le formulaire.
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_PREFS = {
  promos: true,
  articles: true,
  conseils_peau: true,
  nouveaux_produits: true,
};

export async function subscribeNewsletter({ email, preferences = {} } = {}) {
  if (!email || typeof email !== 'string') {
    return { data: null, error: new Error('email_required') };
  }
  const cleanEmail = email.toLowerCase().trim();
  // Validation email basique
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { data: null, error: new Error('email_invalid') };
  }

  const { data: { session } } = await supabase.auth.getSession();
  const payload = {
    email: cleanEmail,
    user_id: session?.user?.id || null,
    preferences: { ...DEFAULT_PREFS, ...preferences },
    source: 'app',
    unsubscribed_at: null, // re-subscribe reset le soft-delete
  };

  const { data, error } = await supabase
    .from('newsletter_subscribers')
    .upsert(payload, { onConflict: 'email,user_id' })
    .select()
    .single();

  return { data, error };
}

export async function unsubscribeNewsletter(userId) {
  if (!userId) return { error: new Error('user_id_required') };
  const { error } = await supabase
    .from('newsletter_subscribers')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('user_id', userId);
  return { error };
}

export async function isSubscribed(userId) {
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from('newsletter_subscribers')
      .select('id, unsubscribed_at')
      .eq('user_id', userId)
      .is('unsubscribed_at', null)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
