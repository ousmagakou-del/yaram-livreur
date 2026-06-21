import { supabase } from './client';

// ═══════════════════════════════════════════════
// LOYALTY (programme fidélité)
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

export async function earnLoyaltyPoints(userId, amount, orderId = null) {
  const points = Math.floor(amount);
  const { error } = await supabase.rpc('add_loyalty_points', {
    p_user_id: userId, p_points: points, p_type: 'earn',
    p_reason: `Achat ${orderId || ''}`, p_order_id: orderId,
  });
  return !error;
}

export async function spendLoyaltyPoints(userId, points, reason = 'Réduction') {
  const my = await getMyLoyalty(userId);
  if (my.loyalty_points < points) return { success: false, error: 'Solde insuffisant' };
  const { error } = await supabase.rpc('add_loyalty_points', {
    p_user_id: userId, p_points: -points, p_type: 'spend', p_reason: reason,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function bonusLoyaltyPoints(userId, points, reason) {
  const { error } = await supabase.rpc('add_loyalty_points', {
    p_user_id: userId, p_points: points, p_type: 'bonus', p_reason: reason,
  });
  return !error;
}

export function pointsToFcfa(points) { return Math.floor(points / 100) * 1000; }
export function fcfaToPoints(fcfa) { return Math.floor(fcfa / 1000) * 100; }
export function getTierInfo(tier) {
  if (tier === 'gold') return { label: 'Or 🥇', color: '#F4B53A', emoji: '🥇' };
  if (tier === 'silver') return { label: 'Argent 🥈', color: '#9B9B9B', emoji: '🥈' };
  return { label: 'Bronze 🥉', color: '#CD7F32', emoji: '🥉' };
}
