import { supabase } from './client';

// ═══════════════════════════════════════════════
// LOYALTY (programme fidélité)
// ═══════════════════════════════════════════════
//
// SECURITE (audit 2026-06-21) :
// L'attribution de points (earn/bonus) DOIT etre faite cote serveur :
//   - earn : par trigger Postgres `add_loyalty_on_delivery` quand status=delivered
//   - bonus : depuis le panneau admin uniquement (RPC `add_loyalty_points`
//             verrouille avec check `is_admin()`)
// Le client ne peut QUE consulter son solde et depenser ses propres points.
// ═══════════════════════════════════════════════

export async function getMyLoyalty(userId) {
  const { data } = await supabase.from('users_profile')
    .select('loyalty_points, loyalty_total_earned, loyalty_tier').eq('id', userId).single();
  return data || { loyalty_points: 0, loyalty_total_earned: 0, loyalty_tier: 'bronze' };
}

export async function getLoyaltyTransactions(userId, limit = 50) {
  const { data } = await supabase.from('loyalty_transactions').select('*')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

// DEPRECATED : ne plus appeler cote client. Les points sont ajoutes par le
// trigger `add_loyalty_on_delivery` (cote DB) au moment ou la commande passe
// en `delivered`. Conserve pour compat ascendante : retourne false silencieusement.
export async function earnLoyaltyPoints(/* userId, amount, orderId */) {
  if (import.meta?.env?.DEV) {
    console.warn('[loyalty] earnLoyaltyPoints() est deprecated cote client. Les points sont ajoutes par le trigger DB add_loyalty_on_delivery.');
  }
  return false;
}

// Depense de points : passe par le RPC `redeem_loyalty_points`, qui verifie
// que `auth.uid() = p_user_id` cote serveur.
export async function spendLoyaltyPoints(userId, points /*, reason */) {
  if (!Number.isInteger(points) || points <= 0 || points % 100 !== 0) {
    return { success: false, error: 'Multiples de 100 uniquement' };
  }
  const { data, error } = await supabase.rpc('redeem_loyalty_points', {
    p_user_id: userId,
    p_points: points,
  });
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error || 'echec' };
  return { success: true, ...data };
}

// DEPRECATED : un bonus arbitraire cote client = faille. Le bonus est attribue
// par l'admin uniquement (panneau /admin loyalty).
export async function bonusLoyaltyPoints(/* userId, points, reason */) {
  if (import.meta?.env?.DEV) {
    console.warn('[loyalty] bonusLoyaltyPoints() retire pour raisons de securite — passer par /admin loyalty.');
  }
  return false;
}

export function pointsToFcfa(points) { return Math.floor(points / 100) * 1000; }
export function fcfaToPoints(fcfa) { return Math.floor(fcfa / 1000) * 100; }
export function getTierInfo(tier) {
  if (tier === 'gold') return { label: 'Or 🥇', color: '#F4B53A', emoji: '🥇' };
  if (tier === 'silver') return { label: 'Argent 🥈', color: '#9B9B9B', emoji: '🥈' };
  return { label: 'Bronze 🥉', color: '#CD7F32', emoji: '🥉' };
}
