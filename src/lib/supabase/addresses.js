import { supabase, invalidateCache } from './client';
import { cachedFetch } from '../dataCache';
import { toast } from '../toast';

// ═══════════════════════════════════════════════
// ADRESSES
// ═══════════════════════════════════════════════

export async function getMyAddresses() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];
  return cachedFetch(`my_addresses_${session.user.id}`, async () => {
    const { data } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', session.user.id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    return data || [];
  }, { ttl: 5 * 60 * 1000 });
}

export async function saveAddress(address) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    toast.error('Tu dois être connectée');
    return null;
  }
  // Invalide le cache adresses a la sauvegarde
  invalidateCache(`my_addresses_${session.user.id}`);
  try {
    if (address.is_default) {
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', session.user.id);
    }
    if (address.id) {
      const { data, error } = await supabase
        .from('addresses')
        .update({
          label: address.label, icon: address.icon, name: address.name,
          phone: address.phone, city: address.city, neighborhood: address.neighborhood,
          line: address.line, is_default: address.is_default,
        })
        .eq('id', address.id).select().single();
      if (error) { toast.error('Erreur update : ' + error.message); return null; }
      return data;
    } else {
      const newAddr = {
        user_id: session.user.id,
        label: address.label || 'Domicile', icon: address.icon || '🏠',
        name: address.name || '', phone: address.phone || '',
        city: address.city, neighborhood: address.neighborhood || '',
        line: address.line, is_default: address.is_default || false,
      };
      const { data, error } = await supabase.from('addresses').insert(newAddr).select().single();
      if (error) { toast.error('Erreur insert : ' + error.message); return null; }
      return data;
    }
  } catch (e) {
    toast.error('Erreur technique : ' + e.message);
    return null;
  }
}

export async function deleteAddress(id) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) invalidateCache(`my_addresses_${session.user.id}`);
  } catch {}
  return supabase.from('addresses').delete().eq('id', id);
}

export async function setDefaultAddress(id) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  invalidateCache(`my_addresses_${session.user.id}`);
  // PERF : 2 updates en parallèle au lieu de séquentiel
  // (sur réseau lent : 300-600ms d'écart visible)
  const [, result] = await Promise.all([
    supabase.from('addresses').update({ is_default: false }).eq('user_id', session.user.id).neq('id', id),
    supabase.from('addresses').update({ is_default: true }).eq('id', id),
  ]);
  return result;
}
