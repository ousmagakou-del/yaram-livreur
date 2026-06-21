import { supabase } from './client';

// ═══════════════════════════════════════════════
// PROMOS / PARRAINAGE
// ═══════════════════════════════════════════════

export async function validatePromoCode(code, userId, orderTotal = 0) {
  if (!code) return { valid: false, error: 'Code requis' };
  const { data: promo } = await supabase.from('promo_codes').select('*')
    .eq('code', code.toUpperCase()).eq('active', true).maybeSingle();
  if (!promo) return { valid: false, error: 'Code invalide' };
  const now = new Date();
  if (promo.expires_at && new Date(promo.expires_at) < now) return { valid: false, error: 'Code expiré' };
  if (promo.starts_at && new Date(promo.starts_at) > now) return { valid: false, error: 'Code pas encore actif' };
  if (promo.max_uses && promo.uses_count >= promo.max_uses) return { valid: false, error: 'Code épuisé' };
  if (promo.min_order && orderTotal < promo.min_order) {
    return { valid: false, error: `Minimum ${promo.min_order.toLocaleString('fr-FR')} FCFA requis` };
  }
  if (userId && promo.per_user_limit) {
    const { count } = await supabase.from('promo_uses')
      .select('id', { count: 'exact', head: true }).eq('promo_id', promo.id).eq('user_id', userId);
    if (count >= promo.per_user_limit) return { valid: false, error: 'Tu as déjà utilisé ce code' };
  }
  let discount = 0;
  if (promo.type === 'percent') discount = Math.floor((orderTotal * promo.value) / 100);
  else if (promo.type === 'fixed') discount = Math.min(promo.value, orderTotal);
  else if (promo.type === 'free_shipping') discount = 1000;
  return { valid: true, promo, discount };
}

export async function applyPromoCode(promoId, userId, orderId, discount) {
  const { error } = await supabase.from('promo_uses').insert({
    promo_id: promoId, user_id: userId, order_id: orderId, discount_amount: discount,
  });
  if (error) return false;
  // Vague 6 RLS : UPDATE direct sur promo_codes bloque pour anon.
  // On passe par la RPC dediee qui incremente le compteur en SECURITY DEFINER.
  await supabase.rpc('increment_promo_uses', { p_promo_id: promoId });
  return true;
}

export async function getOrCreateReferralCode(userId) {
  const { data } = await supabase.from('users_profile')
    .select('referral_code').eq('id', userId).single();
  if (data?.referral_code) return data.referral_code;
  const { data: result, error } = await supabase.rpc('generate_referral_code', { p_user_id: userId });
  if (error) return null;
  return result;
}

export async function applyReferralCode(referredUserId, referralCode) {
  // Phase 2 RLS : on passe par la RPC resolve_referral_code (SECURITY DEFINER)
  // au lieu de lire users_profile par code (anon n'aura plus ce droit).
  const { data: referrer } = await supabase.rpc('resolve_referral_code', {
    p_code: referralCode.toUpperCase(),
  });
  if (!referrer) return { success: false, error: 'Code parrainage invalide' };
  if (referrer.id === referredUserId) return { success: false, error: 'Tu ne peux pas te parrainer toi-même' };

  // Lecture du propre profil OK car policy "users see own profile" via auth.uid()
  const { data: me } = await supabase.from('users_profile')
    .select('referred_by').eq('id', referredUserId).single();
  if (me?.referred_by) return { success: false, error: 'Tu as déjà été parrainée' };

  // SECURITE (audit 2026-06-21) : on appelle le RPC SECURITY DEFINER
  // `apply_referral_bonus` qui :
  //   - verifie que auth.uid() = referredUserId
  //   - verifie que referredUserId n'a pas deja de referred_by
  //   - set referred_by + attribue 500 pts au referrer et au filleul
  // L'attribution directe via add_loyalty_points cote client n'est plus
  // possible (verrouillee is_admin()).
  const { data, error } = await supabase.rpc('apply_referral_bonus', {
    p_referrer_id: referrer.id,
  });
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error || 'echec_parrainage' };
  return { success: true, referrer };
}

export async function getReferralStats(userId) {
  // Phase 2 RLS : passe par la RPC my_referrals (SECURITY DEFINER)
  const { data } = await supabase.rpc('my_referrals', { p_user_id: userId });
  const count = data?.count || 0;
  const list  = Array.isArray(data?.list) ? data.list : [];
  return {
    count,
    list,
    bonusEarned: count * 500,
  };
}
