import { supabase, invalidateCache } from './client';
import { invalidateFavoriteIdsCache } from './favorites';

// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════

export async function signUp(email, password, firstName) {
  return supabase.auth.signUp({
    email, password,
    options: { data: { first_name: firstName } },
  });
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

export async function signOut() {
  // PERF + SÉCURITÉ : vide TOUS les caches au logout pour éviter de servir des
  // données de l'ancien user au prochain login.
  invalidateFavoriteIdsCache();
  try {
    const dataCache = await import('../dataCache');
    dataCache.clearAllCache?.();
  } catch { /* ignore */ }
  try {
    sessionStorage.removeItem('yaram-home-cache-v1');
    localStorage.removeItem('yaram-home-cache-v1');
  } catch { /* ignore */ }
  return supabase.auth.signOut();
}

export async function getCurrentUser(prefetchedSession = null) {
  try {
    // Si on a deja la session (passee depuis App.jsx au boot), evite un 2e getSession()
    let session = prefetchedSession;
    if (!session) {
      const r = await supabase.auth.getSession();
      session = r.data?.session;
    }
    if (!session?.user) return null;
    const user = session.user;
    const { data: profile } = await supabase
      .from('users_profile').select('*').eq('id', user.id).single();
    return profile || { id: user.id, email: user.email };
  } catch (e) {
    console.error('getCurrentUser error:', e.message);
    return null;
  }
}

export async function updateProfile(updates) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { error: { message: 'Pas de session active' } };
  // Invalide les caches liés à l'utilisateur
  invalidateCache(`my_loyalty_${session.user.id}`);
  // UPSERT pour les cas où le users_profile n'existe pas encore (signup Google
  // sans trigger DB, ou signup email qui a saute l'etape upsert).
  // Bloque par les policies : seul l'utilisateur authentifie peut upsert sa propre ligne.
  return supabase
    .from('users_profile')
    .upsert(
      { id: session.user.id, email: session.user.email, ...updates },
      { onConflict: 'id' }
    )
    .select()
    .single();
}
