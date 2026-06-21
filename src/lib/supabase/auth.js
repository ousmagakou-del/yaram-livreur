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
  //
  // Robuste : chaque étape est en try/catch indépendant. Même si Supabase est
  // down ou si la session est déjà invalidée côté serveur, on nettoie quand même
  // tout l'état local pour que l'app redémarre proprement.
  try { invalidateFavoriteIdsCache(); } catch { /* ignore */ }

  try {
    const dataCache = await import('../dataCache');
    dataCache.clearAllCache?.();
  } catch { /* ignore */ }

  try {
    sessionStorage.removeItem('yaram-home-cache-v1');
    localStorage.removeItem('yaram-home-cache-v1');
    // Aussi le cache TanStack persisté en IndexedDB (sera re-hydraté au prochain login)
    sessionStorage.clear();
  } catch { /* ignore */ }

  // FIX iOS Capacitor : storage='local' peut hang sur un device déjà sans réseau
  // si Supabase essaye de notifier les autres tabs. On utilise scope='local'
  // qui ne fait QUE le logout local (pas de round-trip serveur). C'est OK
  // car si l'user est sur un device qu'il ne possède plus, il peut revoke
  // toutes les sessions depuis ses paramètres compte.
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      console.warn('[signOut] supabase error (non-fatal):', error.message);
    }
  } catch (e) {
    // Même si Supabase plante complètement, on continue : le state local
    // est déjà nettoyé, l'user verra l'écran de login.
    console.warn('[signOut] exception (non-fatal):', e?.message);
  }

  // Fire-and-forget : on tente aussi le global pour invalider côté serveur,
  // mais sans bloquer. Si le réseau coupe, on s'en moque, le local logout suffit.
  supabase.auth.signOut({ scope: 'global' }).catch(() => { /* silent */ });

  return { error: null };
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
