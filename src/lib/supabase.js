import { createClient } from '@supabase/supabase-js';
import { cachedFetch, invalidateCache } from './dataCache';

const SUPABASE_URL = 'https://qxhhnrnworwrnwmqekmb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'yaram-auth',
  },
});

// Re-export utility for admin sections
export { invalidateCache };

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
  return supabase.auth.signOut();
}

export async function getCurrentUser() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
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
  if (!session?.user) return null;
  // Invalide les caches liés à l'utilisateur
  invalidateCache(`my_loyalty_${session.user.id}`);
  return supabase.from('users_profile').update(updates).eq('id', session.user.id).select().single();
}

// ═══════════════════════════════════════════════
// PRODUITS & MARQUES — AVEC CACHE
// ═══════════════════════════════════════════════

export async function getAllProducts() {
  return cachedFetch('all_products', async () => {
    const { data } = await supabase.from('products').select('*').eq('active', true);
    return data || [];
  }, { ttl: 5 * 60 * 1000 }); // 5 min
}

export async function getAllBrands() {
  return cachedFetch('all_brands', async () => {
    const { data } = await supabase.from('brands').select('*');
    return data || [];
  }, { ttl: 10 * 60 * 1000 });
}

export async function getProductAvailability(productId) {
  const { data } = await supabase
    .from('inventory')
    .select('*, pharmacy:pharmacies(*)')
    .eq('product_id', productId)
    .gt('stock', 0)
    .eq('active', true);
  return data || [];
}

// ═══════════════════════════════════════════════
// PHARMACIES — AVEC CACHE
// ═══════════════════════════════════════════════

// Liste des colonnes safe a exposer cote client (PAS de PIN)
// pin_set_at est conserve : c'est juste un timestamp non sensible qui permet
// au flow de connexion pharmacie de savoir si la pharma doit creer son PIN.
// Doit rester aligne avec le GRANT SELECT cote DB (cf Supabase Studio).
const PHARMACY_PUBLIC_COLUMNS = 'id, name, tagline, owner_name, manager_name, city, neighborhood, address, lat, lng, phone, whatsapp, notification_email, notification_phone, hours, delivery_hours, logo, cover, description, commission, commission_rate, active, rating, review_count, pin_set_at, created_at, updated_at';

export async function getAllPharmacies() {
  return cachedFetch('all_pharmacies', async () => {
    const { data } = await supabase
      .from('pharmacies')
      .select(PHARMACY_PUBLIC_COLUMNS)
      .eq('active', true);
    return data || [];
  }, { ttl: 10 * 60 * 1000 });
}

// ═══════════════════════════════════════════════
// COMMANDES
// ═══════════════════════════════════════════════

function generateOrderId() {
  return 'DIA-' + Date.now().toString(36).toUpperCase();
}

export async function createOrder({ items, address, paymentMethod, subtotal, shipping, total, promoCode, promoDiscount }) {
  const { data: { session } } = await supabase.auth.getSession();
  const order = {
    id: generateOrderId(),
    user_id: session?.user?.id,
    status: 'pending_payment',
    items, address,
    payment_method: paymentMethod,
    subtotal, shipping, total,
    promo_code: promoCode,
    promo_discount: promoDiscount || 0,
    confirmation_token: 'CFM-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
  };
  const { data, error } = await supabase.from('orders').insert(order).select().single();
  if (error) console.error('createOrder error:', error);
  // Invalide le cache de mes commandes pour que la nouvelle apparaisse
  if (session?.user?.id) invalidateCache(`my_orders_${session.user.id}`);
  return error ? null : data;
}

export async function getMyOrders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];
  return cachedFetch(`my_orders_${session.user.id}`, async () => {
    const { data } = await supabase
      .from('orders').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
    return data || [];
  }, { ttl: 60 * 1000 }); // 1 min (les commandes changent souvent)
}

export async function updateOrderStatus(id, status) {
  // Invalide le cache global orders
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) invalidateCache(`my_orders_${session.user.id}`);
  } catch {}
  return supabase.from('orders').update({ status }).eq('id', id);
}

export function subscribeToNewOrders(callback) {
  return supabase
    .channel('orders-changes')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      (payload) => callback(payload.new))
    .subscribe();
}

// ═══════════════════════════════════════════════
// FAVORIS
// ═══════════════════════════════════════════════

export async function getMyFavorites() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];
  return cachedFetch(`my_favs_${session.user.id}`, async () => {
    const { data } = await supabase
      .from('favorites')
      .select('product_id, products(*)')
      .eq('user_id', session.user.id);
    return (data || []).map(f => f.products).filter(Boolean);
  }, { ttl: 2 * 60 * 1000 }); // 2 min
}

export async function isFavorite(productId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  const { data } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', session.user.id)
    .eq('product_id', productId)
    .maybeSingle();
  return !!data;
}

export async function toggleFavorite(productId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  // Invalide les caches favoris a chaque toggle
  invalidateCache(`my_favs_${session.user.id}`);
  invalidateCache(`my_favs_count_${session.user.id}`);
  const fav = await isFavorite(productId);
  if (fav) {
    await supabase.from('favorites').delete()
      .eq('user_id', session.user.id)
      .eq('product_id', productId);
    return false;
  } else {
    await supabase.from('favorites').insert({
      user_id: session.user.id,
      product_id: productId,
    });
    return true;
  }
}

export async function getFavoritesCount() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return 0;
  return cachedFetch(`my_favs_count_${session.user.id}`, async () => {
    const { count } = await supabase
      .from('favorites')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', session.user.id);
    return count || 0;
  }, { ttl: 2 * 60 * 1000 });
}

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
    alert('Tu dois être connectée');
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
      if (error) { alert('Erreur update : ' + error.message); return null; }
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
      if (error) { alert('Erreur insert : ' + error.message); return null; }
      return data;
    }
  } catch (e) {
    alert('Erreur technique : ' + e.message);
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
  await supabase.from('addresses').update({ is_default: false }).eq('user_id', session.user.id);
  return supabase.from('addresses').update({ is_default: true }).eq('id', id);
}

// ═══════════════════════════════════════════════
// WHATSAPP & CONFIRMATION
// ═══════════════════════════════════════════════

export function generateConfirmToken() {
  return 'CFM-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

export async function getOrderByConfirmToken(token) {
  const { data, error } = await supabase
    .from('orders').select('*').eq('confirmation_token', token).single();
  if (error) return null;
  return data;
}

export async function clientConfirmDelivery(orderId) {
  return supabase.from('orders').update({
    status: 'delivered',
    client_confirmed: true,
    client_confirmed_at: new Date().toISOString(),
  }).eq('id', orderId);
}

export async function clientReportDispute(orderId, reason) {
  return supabase.from('orders').update({
    status: 'disputed',
    client_dispute_reason: reason,
    client_confirmed: false,
  }).eq('id', orderId);
}

export async function sendWhatsApp(to, text) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, text }),
    });
    return await response.json();
  } catch (e) {
    console.error('sendWhatsApp exception:', e);
    return { success: false, error: e.message };
  }
}

export const WhatsAppTemplates = {
  driverAssigned: (driverName, order, trackingUrl) =>
    `Salut ${driverName}! 🛵\n\nNouvelle livraison YARAM :\n\n📦 N° ${order.id}\n👤 ${order.address?.name}\n📍 ${order.address?.line}, ${order.address?.city}\n💰 ${order.total?.toLocaleString('fr-FR')} FCFA${order.payment_method === 'cod' ? ' (à ENCAISSER cash 💵)' : ' (déjà payé en ligne ✅)'}\n\n🔗 Lien tracking GPS :\n${trackingUrl}\n\nOuvre ce lien sur ton téléphone, partage ta position et suis les étapes.\n\nYARAM 💚`,
  orderCreatedDigital: (clientName, orderId, total, method) =>
    `Salut ${clientName} 💚\n\nTa commande YARAM ${orderId} est reçue !\n\n💳 Paiement ${method} : ${total.toLocaleString('fr-FR')} FCFA\n\nDès validation, on prépare ton colis 📦\n\nYARAM`,
  orderCreatedCash: (clientName, orderId, total) =>
    `Salut ${clientName} 💚\n\nTa commande YARAM ${orderId} est reçue !\n\n💵 Prépare ${total.toLocaleString('fr-FR')} FCFA cash pour la livraison\n\nOn te notifie dès que le livreur arrive 🛵\n\nYARAM`,
  orderPaid: (clientName, orderId) =>
    `Salut ${clientName} 💚\n\nTon paiement pour la commande ${orderId} est confirmé ✅\n\nOn prépare ta commande, tu seras notifiée quand le livreur arrive 🛵\n\nYARAM`,
  orderShipped: (clientName, orderId, driverName, driverPhone) =>
    `Hey ${clientName} 🛵\n\nTa commande ${orderId} est en route !\n\n👤 Livreur : ${driverName}\n📞 WhatsApp : ${driverPhone || '—'}\n\nSuis sa progression en temps réel dans l'app YARAM.\n\nYARAM 💚`,
  orderAwaitingConfirm: (clientName, orderId, confirmUrl) =>
    `Bonjour ${clientName} 💚\n\nLe livreur indique avoir livré ta commande ${orderId}.\n\n👉 Confirme ta réception ici :\n${confirmUrl}\n\nDis-nous si tout va bien ou si tu as un souci.\n\nYARAM 💚`,
  orderAwaitingConfirmCash: (clientName, orderId, total, confirmUrl) =>
    `Bonjour ${clientName} 💚\n\nLe livreur indique avoir livré ta commande ${orderId} et reçu ${total.toLocaleString('fr-FR')} FCFA cash.\n\n👉 Confirme ta réception ici :\n${confirmUrl}\n\nDis-nous si tout va bien ou si tu as un souci.\n\nYARAM 💚`,
  orderDelivered: (clientName, orderId) =>
    `🎉 Bonjour ${clientName} !\n\nTa commande ${orderId} est officiellement livrée !\n\nMerci pour ta confiance 💚\n\nN'hésite pas à noter ton expérience dans l'app.\n\nYARAM`,
  newOrderToPharmacy: (pharmacyName, order) =>
    `🏥 Hello ${pharmacyName}\n\nNouvelle commande YARAM à préparer :\n\n📦 N° ${order.id}\n👤 ${order.address?.name}\n📍 ${order.address?.city}\n\nVoir tes commandes : ${window.location.origin}/?pharma\n\nYARAM 💚`,
  disputeToAdmin: (orderId, clientName, reason) =>
    `⚠️ LITIGE YARAM\n\nCommande : ${orderId}\nCliente : ${clientName}\nMotif : ${reason}\n\nVérifie les preuves dans l'admin et contacte la cliente.\n\nYARAM`,
};

// ═══════════════════════════════════════════════
// SCAN IA
// ═══════════════════════════════════════════════

export async function analyzeSkinPhotos({ frontBase64, leftBase64, rightBase64 }) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/analyze-skin`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        photos: { front: frontBase64, left: leftBase64, right: rightBase64 },
      }),
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function uploadScanPhoto(file, scanId, type) {
  const fileName = `${scanId}/${type}_${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('skin-scans').upload(fileName, file, {
    contentType: 'image/jpeg', upsert: true
  });
  if (error) return null;
  const { data } = supabase.storage.from('skin-scans').getPublicUrl(fileName);
  return data.publicUrl;
}

export async function saveSkinScan({ userId, photoFrontUrl, photoLeftUrl, photoRightUrl, analysis }) {
  const { data, error } = await supabase.from('skin_scans').insert({
    user_id: userId,
    photo_front_url: photoFrontUrl, photo_left_url: photoLeftUrl, photo_right_url: photoRightUrl,
    skin_type: analysis.skin_type, skin_score: analysis.skin_score, diagnosis: analysis,
  }).select().single();
  if (error) return null;
  return data;
}

export async function getMySkinScans() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];
  const { data } = await supabase.from('skin_scans').select('*')
    .eq('user_id', session.user.id).order('created_at', { ascending: false });
  return data || [];
}

export async function getLatestSkinScan() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data } = await supabase.from('skin_scans').select('*')
    .eq('user_id', session.user.id).order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  return data;
}

export async function getProductsForSkinDiagnosis(diagnosis) {
  const allProducts = await getAllProducts();
  const recommendedIngredients = (diagnosis.ingredients_recommandes || []).map(i => i.toLowerCase());
  const avoidIngredients = (diagnosis.ingredients_a_eviter || []).map(i => i.toLowerCase());
  const compatibles = [], avoid = [];
  for (const product of allProducts) {
    const productText = `${product.name || ''} ${product.description || ''} ${product.ingredients || ''}`.toLowerCase();
    if (avoidIngredients.some(ing => productText.includes(ing))) {
      avoid.push(product); continue;
    }
    if (recommendedIngredients.some(ing => productText.includes(ing))) {
      compatibles.push(product);
    }
  }
  return { compatibles, avoid };
}

// ═══════════════════════════════════════════════
// UPLOAD IMAGES
// ═══════════════════════════════════════════════

export async function uploadProductImage(file) {
  const fileName = `product_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
  const compressed = await compressImage(file, 800, 0.85);
  const { error } = await supabase.storage.from('product-images').upload(fileName, compressed, {
    contentType: 'image/jpeg', upsert: true,
  });
  if (error) return null;
  const { data } = supabase.storage.from('product-images').getPublicUrl(fileName);
  return data.publicUrl;
}

export async function uploadBannerImage(file) {
  const fileName = `banner_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
  const compressed = await compressImage(file, 1200, 0.85);
  const { error } = await supabase.storage.from('banner-images').upload(fileName, compressed, {
    contentType: 'image/jpeg', upsert: true,
  });
  if (error) return null;
  const { data } = supabase.storage.from('banner-images').getPublicUrl(fileName);
  return data.publicUrl;
}

export async function compressImage(file, maxDim = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════
// BANNIÈRES — AVEC CACHE
// ═══════════════════════════════════════════════

export async function getActiveBanners() {
  return cachedFetch('active_banners', async () => {
    const now = new Date().toISOString();
    const { data } = await supabase.from('banners').select('*').eq('active', true)
      .or(`end_date.is.null,end_date.gt.${now}`)
      .lte('start_date', now).order('display_order', { ascending: true });
    return data || [];
  }, { ttl: 3 * 60 * 1000 }); // 3 min, banners changent rarement
}

export async function getAllBanners() {
  return cachedFetch('all_banners', async () => {
    const { data } = await supabase.from('banners').select('*').order('display_order', { ascending: true });
    return data || [];
  }, { ttl: 2 * 60 * 1000 });
}

export async function createBanner(banner) {
  const { data, error } = await supabase.from('banners').insert(banner).select().single();
  invalidateCache('all_banners');
  invalidateCache('active_banners');
  return error ? null : data;
}

export async function updateBanner(id, updates) {
  invalidateCache('all_banners');
  invalidateCache('active_banners');
  return supabase.from('banners').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function deleteBanner(id) {
  invalidateCache('all_banners');
  invalidateCache('active_banners');
  return supabase.from('banners').delete().eq('id', id);
}

export async function incrementBannerClick(id) {
  const { data: current } = await supabase.from('banners').select('click_count').eq('id', id).single();
  if (current) {
    await supabase.from('banners').update({ click_count: (current.click_count || 0) + 1 }).eq('id', id);
  }
}

// ═══════════════════════════════════════════════
// PHARMACIE
// ═══════════════════════════════════════════════

export async function pharmacyLogin(pharmacyId, pin) {
  // On lit le PIN pour comparaison, puis on le STRIP avant de retourner.
  // (Idealement : RPC verify_pharmacy_pin cote DB pour que le PIN ne transite jamais.
  //  En attendant, le PIN ne fuit que pendant CE login, plus a chaque visite.)
  const { data, error } = await supabase.from('pharmacies').select('*').eq('id', pharmacyId).single();
  if (error || !data) return { success: false, error: 'Pharmacie introuvable' };
  if (data.pin !== pin) return { success: false, error: 'PIN incorrect' };
  // eslint-disable-next-line no-unused-vars
  const { pin: _pin, ...safe } = data;
  return { success: true, pharmacy: safe };
}

export async function setPharmacyPin(pharmacyId, pin) {
  return supabase.from('pharmacies').update({ pin, pin_set_at: new Date().toISOString() }).eq('id', pharmacyId);
}

export async function getPharmacyOrders(pharmacyId, status = null) {
  let query = supabase.from('orders').select('*').order('created_at', { ascending: false });
  if (status) {
    if (Array.isArray(status)) query = query.in('status', status);
    else query = query.eq('status', status);
  }
  const { data } = await query;
  return (data || []).filter(o => {
    if (o.assigned_pharmacy_id === pharmacyId) return true;
    if (Array.isArray(o.items)) return o.items.some(it => it.pharmacyId === pharmacyId);
    return false;
  });
}

export async function acceptOrder(orderId, pharmacyId) {
  return supabase.from('orders').update({
    status: 'preparing', assigned_pharmacy_id: pharmacyId, accepted_at: new Date().toISOString(),
  }).eq('id', orderId);
}

export async function refuseOrder(orderId, reason) {
  return supabase.from('orders').update({
    status: 'refused', refused_at: new Date().toISOString(), refusal_reason: reason,
  }).eq('id', orderId);
}

export async function markOrderReady(orderId) {
  return supabase.from('orders').update({ status: 'ready', prepared_at: new Date().toISOString() }).eq('id', orderId);
}

export async function getPharmacyCommissions(pharmacyId) {
  const { data: orders } = await supabase.from('orders')
    .select('id, total, items, status, created_at, delivered_at')
    .in('status', ['delivered']).order('created_at', { ascending: false });
  const pharmacyOrders = (orders || []).filter(o =>
    Array.isArray(o.items) && o.items.some(it => it.pharmacyId === pharmacyId)
  );
  // ⚠️ Taux unique 8% : doit rester aligne avec PharmaOrders.jsx et le label de PharmaCommission.jsx
  const COMMISSION_RATE = 0.08;
  const enrichedOrders = pharmacyOrders.map(o => {
    const items = o.items.filter(it => it.pharmacyId === pharmacyId);
    const revenue = items.reduce((sum, it) => sum + (it.price || 0) * (it.qty || 1), 0);
    const commission = Math.round(revenue * COMMISSION_RATE);
    const net = revenue - commission;
    return { ...o, pharmacy_revenue: revenue, pharmacy_commission: commission, pharmacy_net: net };
  });
  const totalRevenue = enrichedOrders.reduce((sum, o) => sum + o.pharmacy_revenue, 0);
  const totalCommission = enrichedOrders.reduce((sum, o) => sum + o.pharmacy_commission, 0);
  const totalNet = enrichedOrders.reduce((sum, o) => sum + o.pharmacy_net, 0);
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthOrders = enrichedOrders.filter(o => new Date(o.created_at) >= firstDay);
  const monthRevenue = monthOrders.reduce((sum, o) => sum + o.pharmacy_revenue, 0);
  const monthCommission = monthOrders.reduce((sum, o) => sum + o.pharmacy_commission, 0);
  const monthNet = monthOrders.reduce((sum, o) => sum + o.pharmacy_net, 0);
  const { data: payments } = await supabase.from('commission_payments').select('*')
    .eq('pharmacy_id', pharmacyId).order('period_end', { ascending: false });
  return {
    orders: enrichedOrders, totalRevenue, totalCommission, totalNet,
    monthOrders, monthRevenue, monthCommission, monthNet, payments: payments || [],
  };
}

export async function getPharmacyStats(pharmacyId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();
  const { data: todayOrders } = await supabase.from('orders')
    .select('id, total, items, status, created_at').gte('created_at', todayISO);
  const myTodayOrders = (todayOrders || []).filter(o =>
    Array.isArray(o.items) && o.items.some(it => it.pharmacyId === pharmacyId)
  );
  const pendingCount = myTodayOrders.filter(o => o.status === 'paid').length;
  const preparingCount = myTodayOrders.filter(o => o.status === 'preparing').length;
  const deliveredToday = myTodayOrders.filter(o => o.status === 'delivered');
  const todayRevenue = deliveredToday.reduce((sum, o) => {
    const items = (o.items || []).filter(it => it.pharmacyId === pharmacyId);
    return sum + items.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  }, 0);
  const { data: products } = await supabase.from('products')
    .select('id').eq('submitted_by_pharmacy_id', pharmacyId).eq('status', 'approved');
  return {
    todayOrdersCount: myTodayOrders.length, pendingCount, preparingCount,
    deliveredTodayCount: deliveredToday.length, todayRevenue,
    activeProductsCount: products?.length || 0,
  };
}

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
  const { data: promo } = await supabase.from('promo_codes').select('uses_count').eq('id', promoId).single();
  if (promo) {
    await supabase.from('promo_codes').update({ uses_count: (promo.uses_count || 0) + 1 }).eq('id', promoId);
  }
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
  const { data: referrer } = await supabase.from('users_profile')
    .select('id, first_name').eq('referral_code', referralCode.toUpperCase()).maybeSingle();
  if (!referrer) return { success: false, error: 'Code parrainage invalide' };
  if (referrer.id === referredUserId) return { success: false, error: 'Tu ne peux pas te parrainer toi-même' };
  const { data: me } = await supabase.from('users_profile')
    .select('referred_by').eq('id', referredUserId).single();
  if (me?.referred_by) return { success: false, error: 'Tu as déjà été parrainée' };
  await supabase.from('users_profile').update({ referred_by: referrer.id }).eq('id', referredUserId);
  await supabase.rpc('add_loyalty_points', {
    p_user_id: referredUserId, p_points: 500, p_type: 'bonus',
    p_reason: `Bonus inscription via ${referrer.first_name}`,
  });
  await supabase.rpc('add_loyalty_points', {
    p_user_id: referrer.id, p_points: 500, p_type: 'bonus', p_reason: `Bonus parrainage`,
  });
  return { success: true, referrer };
}

export async function getReferralStats(userId) {
  const { data: referrals } = await supabase.from('users_profile')
    .select('id, first_name, created_at').eq('referred_by', userId);
  return {
    count: referrals?.length || 0,
    list: referrals || [],
    bonusEarned: (referrals?.length || 0) * 500,
  };
}

// ═══════════════════════════════════════════════
// PUSH NOTIFICATIONS (existant, conserve)
// ═══════════════════════════════════════════════

const VAPID_PUBLIC_KEY = 'BNxe7DjGiK8jp_LdEKgZbI3oFG9p_X0wmKHHfsXOlVHwBE3FB_pIRgFb_VxkN1xnzPxRzz0w8hYqYnFw7yWEpQk';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function getNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function subscribeToPush(userId) {
  if (!isPushSupported()) return { success: false, error: 'Pas supporté' };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { success: false, error: 'Permission refusée' };
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const sub = subscription.toJSON();
    await supabase.from('push_subscriptions').upsert({
      user_id: userId, endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh, auth: sub.keys.auth,
      user_agent: navigator.userAgent, enabled: true,
    }, { onConflict: 'endpoint' });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function unsubscribeFromPush(userId) {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    }
    return true;
  } catch { return false; }
}

export async function showLocalNotification(title, body, options = {}) {
  if (!isPushSupported() || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body, icon: '/icon-192.png', badge: '/icon-96.png',
    vibrate: [200, 100, 200], ...options,
  });
}

export async function getNotifications(userId, limit = 50) {
  const { data } = await supabase.from('notifications').select('*')
    .eq('user_id', userId).order('sent_at', { ascending: false }).limit(limit);
  return data || [];
}

export async function getUnreadCount(userId) {
  const { count } = await supabase.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('read', false);
  return count || 0;
}

export async function markNotificationRead(notifId) {
  return supabase.from('notifications').update({ read: true }).eq('id', notifId);
}

export async function markAllNotificationsRead(userId) {
  return supabase.from('notifications').update({ read: true })
    .eq('user_id', userId).eq('read', false);
}

export async function createNotification({ userId, title, body, url, type = 'info' }) {
  return supabase.from('notifications').insert({
    user_id: userId, title, body, url, type,
  });
}

export function scheduleSkinRoutineReminders(morningTime, eveningTime) {
  localStorage.setItem('yaram-routine-morning', morningTime || '');
  localStorage.setItem('yaram-routine-evening', eveningTime || '');
  startRoutineReminderCheck();
}

let reminderInterval = null;
function startRoutineReminderCheck() {
  if (reminderInterval) clearInterval(reminderInterval);
  reminderInterval = setInterval(() => {
    if (Notification.permission !== 'granted') return;
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const morning = localStorage.getItem('yaram-routine-morning');
    const evening = localStorage.getItem('yaram-routine-evening');
    const lastNotif = localStorage.getItem('yaram-last-reminder');
    const today = now.toDateString();
    if (morning && currentTime === morning && lastNotif !== `${today}-morning`) {
      showLocalNotification('☀️ Routine matin', 'C\'est l\'heure de ta routine matinale !');
      localStorage.setItem('yaram-last-reminder', `${today}-morning`);
    }
    if (evening && currentTime === evening && lastNotif !== `${today}-evening`) {
      showLocalNotification('🌙 Routine soir', 'C\'est l\'heure de ta routine du soir !');
      localStorage.setItem('yaram-last-reminder', `${today}-evening`);
    }
  }, 60000);
}

// ═══════════════════════════════════════════════
// REVIEWS
// ═══════════════════════════════════════════════

export async function getProductReviews(productId) {
  const { data } = await supabase.from('reviews').select('*')
    .eq('product_id', productId).eq('status', 'approved')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function createReview({ productId, userId, userName, rating, title, comment, photoUrls = [] }) {
  const { data: existing } = await supabase.from('reviews').select('id')
    .eq('product_id', productId).eq('user_id', userId).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('reviews').update({ rating, title, comment, photo_urls: photoUrls }).eq('id', existing.id);
    return !error;
  }
  const { error } = await supabase.from('reviews').insert({
    product_id: productId, user_id: userId, user_name: userName,
    rating, title, comment, photo_urls: photoUrls, verified_purchase: true,
  });
  return !error;
}

export async function uploadReviewPhoto(file) {
  const fileName = `review_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
  const compressed = await compressImage(file, 800, 0.85);
  const { error } = await supabase.storage.from('review-photos').upload(fileName, compressed, {
    contentType: 'image/jpeg', upsert: true,
  });
  if (error) { console.error('uploadReviewPhoto error:', error); return null; }
  const { data } = supabase.storage.from('review-photos').getPublicUrl(fileName);
  return data.publicUrl;
}

export async function markReviewHelpful(reviewId) {
  const { data } = await supabase.from('reviews').select('helpful_count').eq('id', reviewId).single();
  if (data) {
    await supabase.from('reviews').update({ helpful_count: (data.helpful_count || 0) + 1 }).eq('id', reviewId);
  }
}

export async function reportReview(reviewId) {
  await supabase.from('reviews').update({ reported: true }).eq('id', reviewId);
}

export async function getReviewStats(productId) {
  const reviews = await getProductReviews(productId);
  if (reviews.length === 0) return { avg: 0, total: 0, distribution: [0, 0, 0, 0, 0] };
  const sum = reviews.reduce((s, r) => s + r.rating, 0);
  const avg = sum / reviews.length;
  const distribution = [0, 0, 0, 0, 0];
  reviews.forEach(r => { if (r.rating >= 1 && r.rating <= 5) distribution[r.rating - 1]++; });
  return { avg, total: reviews.length, distribution };
}

export async function respondToReview(reviewId, response) {
  return supabase.from('reviews').update({
    pharmacy_response: response,
    pharmacy_responded_at: new Date().toISOString(),
  }).eq('id', reviewId);
}
