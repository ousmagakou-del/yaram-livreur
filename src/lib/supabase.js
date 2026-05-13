import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qxhhnrnworwrnwmqekmb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';

// Configuration Supabase avec gestion robuste de la session
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'diaara-auth',
  },
  global: {
    fetch: (url, options = {}) => {
      // Timeout 10s sur toutes les requêtes Supabase
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
    },
  },
});

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
    // Timeout 2s pour auth.getUser()
    const userPromise = supabase.auth.getUser();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Auth timeout')), 2000)
    );
    const { data: { user } } = await Promise.race([userPromise, timeoutPromise]);
    if (!user) return null;

    const { data: profile } = await supabase
      .from('users_profile').select('*').eq('id', user.id).single();
    return profile;
  } catch (e) {
    console.error('getCurrentUser error:', e.message);
    return null;
  }
}

export async function updateProfile(updates) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return supabase.from('users_profile').update(updates).eq('id', user.id).select().single();
}

// ═══════════════════════════════════════════════
// PRODUITS & MARQUES
// ═══════════════════════════════════════════════

export async function getAllProducts() {
  const { data } = await supabase.from('products').select('*').eq('active', true);
  return data || [];
}

export async function getAllBrands() {
  const { data } = await supabase.from('brands').select('*');
  return data || [];
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
// PHARMACIES
// ═══════════════════════════════════════════════

export async function getAllPharmacies() {
  const { data } = await supabase.from('pharmacies').select('*').eq('active', true);
  return data || [];
}

// ═══════════════════════════════════════════════
// COMMANDES
// ═══════════════════════════════════════════════

function generateOrderId() {
  return 'DIA-' + Date.now().toString(36).toUpperCase();
}

export async function createOrder({ items, address, paymentMethod, subtotal, shipping, total, promoCode }) {
  const { data: { user } } = await supabase.auth.getUser();
  const order = {
    id: generateOrderId(),
    user_id: user?.id,
    status: 'pending_payment',
    items, address,
    payment_method: paymentMethod,
    subtotal, shipping, total,
    promo_code: promoCode,
    confirmation_token: 'CFM-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
  };
  const { data, error } = await supabase.from('orders').insert(order).select().single();
  if (error) console.error('createOrder error:', error);
  return error ? null : data;
}

export async function getMyOrders() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  return data || [];
}

export async function updateOrderStatus(id, status) {
  return supabase.from('orders').update({ status }).eq('id', id);
}

// ═══════════════════════════════════════════════
// REALTIME
// ═══════════════════════════════════════════════

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('favorites')
    .select('product_id, products(*)')
    .eq('user_id', user.id);
  return (data || []).map(f => f.products).filter(Boolean);
}

export async function isFavorite(productId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', user.id)
    .eq('product_id', productId)
    .maybeSingle();
  return !!data;
}

export async function toggleFavorite(productId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const fav = await isFavorite(productId);
  if (fav) {
    await supabase.from('favorites').delete()
      .eq('user_id', user.id)
      .eq('product_id', productId);
    return false;
  } else {
    await supabase.from('favorites').insert({
      user_id: user.id,
      product_id: productId,
    });
    return true;
  }
}

export async function getFavoritesCount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from('favorites')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);
  return count || 0;
}

// ═══════════════════════════════════════════════
// ADRESSES
// ═══════════════════════════════════════════════

export async function getMyAddresses() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('addresses')
    .select('*')
    .eq('user_id', user.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) console.error('getMyAddresses error:', error);
  return data || [];
}

export async function saveAddress(address) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    alert('Tu dois être connectée');
    return null;
  }

  try {
    if (address.is_default) {
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', user.id);
    }

    if (address.id) {
      const { data, error } = await supabase
        .from('addresses')
        .update({
          label: address.label,
          icon: address.icon,
          name: address.name,
          phone: address.phone,
          city: address.city,
          neighborhood: address.neighborhood,
          line: address.line,
          is_default: address.is_default,
        })
        .eq('id', address.id)
        .select()
        .single();
      if (error) {
        alert('Erreur update : ' + error.message);
        return null;
      }
      return data;
    } else {
      const newAddr = {
        user_id: user.id,
        label: address.label || 'Domicile',
        icon: address.icon || '🏠',
        name: address.name || '',
        phone: address.phone || '',
        city: address.city,
        neighborhood: address.neighborhood || '',
        line: address.line,
        is_default: address.is_default || false,
      };
      const { data, error } = await supabase
        .from('addresses')
        .insert(newAddr)
        .select()
        .single();
      if (error) {
        alert('Erreur insert : ' + error.message);
        return null;
      }
      return data;
    }
  } catch (e) {
    alert('Erreur technique : ' + e.message);
    return null;
  }
}

export async function deleteAddress(id) {
  return supabase.from('addresses').delete().eq('id', id);
}

export async function setDefaultAddress(id) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('addresses')
    .update({ is_default: false })
    .eq('user_id', user.id);
  return supabase
    .from('addresses')
    .update({ is_default: true })
    .eq('id', id);
}

// ═══════════════════════════════════════════════
// WHATSAPP & CONFIRMATION CLIENTE
// ═══════════════════════════════════════════════

export function generateConfirmToken() {
  return 'CFM-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

export async function getOrderByConfirmToken(token) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('confirmation_token', token)
    .single();
  if (error) {
    console.error('getOrderByConfirmToken error:', error);
    return null;
  }
  return data;
}

export async function clientConfirmDelivery(orderId) {
  return supabase
    .from('orders')
    .update({
      status: 'delivered',
      client_confirmed: true,
      client_confirmed_at: new Date().toISOString(),
    })
    .eq('id', orderId);
}

export async function clientReportDispute(orderId, reason) {
  return supabase
    .from('orders')
    .update({
      status: 'disputed',
      client_dispute_reason: reason,
      client_confirmed: false,
    })
    .eq('id', orderId);
}

export async function sendWhatsApp(to, text) {
  try {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qxhhnrnworwrnwmqekmb.supabase.co';
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';
    
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
    `Salut ${driverName}! 🛵\n\nNouvelle livraison Diaara :\n\n📦 N° ${order.id}\n👤 ${order.address?.name}\n📍 ${order.address?.line}, ${order.address?.city}\n💰 ${order.total?.toLocaleString('fr-FR')} FCFA${order.payment_method === 'cod' ? ' (à ENCAISSER cash 💵)' : ' (déjà payé en ligne ✅)'}\n\n🔗 Lien tracking GPS :\n${trackingUrl}\n\nOuvre ce lien sur ton téléphone, partage ta position et suis les étapes.\n\nDiaara 💚`,

  orderCreatedDigital: (clientName, orderId, total, method) =>
    `Salut ${clientName} 💚\n\nTa commande Diaara ${orderId} est reçue !\n\n💳 Paiement ${method} : ${total.toLocaleString('fr-FR')} FCFA\n\nDès validation, on prépare ton colis 📦\n\nDiaara`,

  orderCreatedCash: (clientName, orderId, total) =>
    `Salut ${clientName} 💚\n\nTa commande Diaara ${orderId} est reçue !\n\n💵 Prépare ${total.toLocaleString('fr-FR')} FCFA cash pour la livraison\n\nOn te notifie dès que le livreur arrive 🛵\n\nDiaara`,

  orderPaid: (clientName, orderId) =>
    `Salut ${clientName} 💚\n\nTon paiement pour la commande ${orderId} est confirmé ✅\n\nOn prépare ta commande, tu seras notifiée quand le livreur arrive 🛵\n\nDiaara`,

  orderShipped: (clientName, orderId, driverName, driverPhone) =>
    `Hey ${clientName} 🛵\n\nTa commande ${orderId} est en route !\n\n👤 Livreur : ${driverName}\n📞 WhatsApp : ${driverPhone || '—'}\n\nSuis sa progression en temps réel dans l'app Diaara.\n\nDiaara 💚`,

  orderAwaitingConfirm: (clientName, orderId, confirmUrl) =>
    `Bonjour ${clientName} 💚\n\nLe livreur indique avoir livré ta commande ${orderId}.\n\n👉 Confirme ta réception ici :\n${confirmUrl}\n\nDis-nous si tout va bien ou si tu as un souci.\n\nDiaara 💚`,

  orderAwaitingConfirmCash: (clientName, orderId, total, confirmUrl) =>
    `Bonjour ${clientName} 💚\n\nLe livreur indique avoir livré ta commande ${orderId} et reçu ${total.toLocaleString('fr-FR')} FCFA cash.\n\n👉 Confirme ta réception ici :\n${confirmUrl}\n\nDis-nous si tout va bien ou si tu as un souci.\n\nDiaara 💚`,

  orderDelivered: (clientName, orderId) =>
    `🎉 Bonjour ${clientName} !\n\nTa commande ${orderId} est officiellement livrée !\n\nMerci pour ta confiance 💚\n\nN'hésite pas à noter ton expérience dans l'app.\n\nDiaara`,

  newOrderToPharmacy: (pharmacyName, order) =>
    `🏥 Hello ${pharmacyName}\n\nNouvelle commande Diaara à préparer :\n\n📦 N° ${order.id}\n👤 ${order.address?.name}\n📍 ${order.address?.city}\n\nVoir tes commandes : ${window.location.origin}/?pharma\n\nDiaara 💚`,

  disputeToAdmin: (orderId, clientName, reason) =>
    `⚠️ LITIGE Diaara\n\nCommande : ${orderId}\nCliente : ${clientName}\nMotif : ${reason}\n\nVérifie les preuves dans l'admin et contacte la cliente.\n\nDiaara`,
};
// ═══════════════════════════════════════════════
// AJOUTS À src/lib/supabase.js
// ═══════════════════════════════════════════════
// Ajoute ces fonctions à la fin de ton fichier supabase.js

// ─── Analyse IA d'une photo de peau via Gemini ───
export async function analyzeSkinPhotos({ frontBase64, leftBase64, rightBase64 }) {
  try {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qxhhnrnworwrnwmqekmb.supabase.co';
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/analyze-skin`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        photos: {
          front: frontBase64,
          left: leftBase64,
          right: rightBase64,
        },
      }),
    });
    
    const data = await response.json();
    console.log('analyzeSkinPhotos response:', data);
    return data;
  } catch (e) {
    console.error('analyzeSkinPhotos exception:', e);
    return { success: false, error: e.message };
  }
}

// ─── Upload une photo de scan vers Storage ───
export async function uploadScanPhoto(file, scanId, type) {
  const fileName = `${scanId}/${type}_${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from('skin-scans')
    .upload(fileName, file, { contentType: 'image/jpeg', upsert: true });
  if (error) {
    console.error('uploadScanPhoto error:', error);
    return null;
  }
  const { data } = supabase.storage.from('skin-scans').getPublicUrl(fileName);
  return data.publicUrl;
}

// ─── Sauvegarder un scan complet en base ───
export async function saveSkinScan({
  userId,
  photoFrontUrl,
  photoLeftUrl,
  photoRightUrl,
  analysis,
}) {
  const { data, error } = await supabase
    .from('skin_scans')
    .insert({
      user_id: userId,
      photo_front_url: photoFrontUrl,
      photo_left_url: photoLeftUrl,
      photo_right_url: photoRightUrl,
      skin_type: analysis.skin_type,
      skin_score: analysis.skin_score,
      diagnosis: analysis,
    })
    .select()
    .single();
  if (error) {
    console.error('saveSkinScan error:', error);
    return null;
  }
  return data;
}

// ─── Récupérer tous les scans d'une cliente ───
export async function getMySkinScans() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('skin_scans')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  return data || [];
}

// ─── Récupérer le dernier scan d'une cliente ───
export async function getLatestSkinScan() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('skin_scans')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// ─── Filtrer les produits selon le diagnostic IA ───
// Retourne { compatibles: [...], avoid: [...] }
export async function getProductsForSkinDiagnosis(diagnosis) {
  const allProducts = await getAllProducts();
  
  const recommendedIngredients = (diagnosis.ingredients_recommandes || [])
    .map(i => i.toLowerCase());
  const avoidIngredients = (diagnosis.ingredients_a_eviter || [])
    .map(i => i.toLowerCase());
  
  const compatibles = [];
  const avoid = [];
  
  for (const product of allProducts) {
    const productText = `${product.name || ''} ${product.description || ''} ${product.ingredients || ''}`.toLowerCase();
    
    // Vérifier si contient un ingrédient à éviter
    const hasAvoidIngredient = avoidIngredients.some(ing => productText.includes(ing));
    if (hasAvoidIngredient) {
      avoid.push(product);
      continue;
    }
    
    // Vérifier si contient un ingrédient recommandé
    const hasRecommendedIngredient = recommendedIngredients.some(ing => productText.includes(ing));
    if (hasRecommendedIngredient) {
      compatibles.push(product);
    }
  }
  
  return { compatibles, avoid };
}
// ─── UPLOAD IMAGE PRODUIT ───
export async function uploadProductImage(file) {
  const fileName = `product_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
  
  // Compression avant upload
  const compressed = await compressImage(file, 800, 0.85);
  
  const { error } = await supabase.storage
    .from('product-images')
    .upload(fileName, compressed, {
      contentType: 'image/jpeg',
      upsert: true,
    });
  if (error) {
    console.error('uploadProductImage error:', error);
    return null;
  }
  const { data } = supabase.storage.from('product-images').getPublicUrl(fileName);
  return data.publicUrl;
}

// ─── UPLOAD IMAGE BANNIÈRE ───
export async function uploadBannerImage(file) {
  const fileName = `banner_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
  const compressed = await compressImage(file, 1200, 0.85);
  const { error } = await supabase.storage
    .from('banner-images')
    .upload(fileName, compressed, {
      contentType: 'image/jpeg',
      upsert: true,
    });
  if (error) {
    console.error('uploadBannerImage error:', error);
    return null;
  }
  const { data } = supabase.storage.from('banner-images').getPublicUrl(fileName);
  return data.publicUrl;
}

// ─── Compression image côté client ───
export async function compressImage(file, maxDim = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
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

// ─── BANNIÈRES ───
export async function getActiveBanners() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('banners')
    .select('*')
    .eq('active', true)
    .or(`end_date.is.null,end_date.gt.${now}`)
    .lte('start_date', now)
    .order('display_order', { ascending: true });
  if (error) {
    console.error('getActiveBanners error:', error);
    return [];
  }
  return data || [];
}

export async function getAllBanners() {
  const { data } = await supabase
    .from('banners')
    .select('*')
    .order('display_order', { ascending: true });
  return data || [];
}

export async function createBanner(banner) {
  const { data, error } = await supabase
    .from('banners')
    .insert(banner)
    .select()
    .single();
  if (error) console.error('createBanner error:', error);
  return error ? null : data;
}

export async function updateBanner(id, updates) {
  return supabase.from('banners').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function deleteBanner(id) {
  return supabase.from('banners').delete().eq('id', id);
}

export async function incrementBannerClick(id) {
  // Increment atomique du compteur
  const { data: current } = await supabase
    .from('banners')
    .select('click_count')
    .eq('id', id)
    .single();
  if (current) {
    await supabase
      .from('banners')
      .update({ click_count: (current.click_count || 0) + 1 })
      .eq('id', id);
  }
}
// ─── PHARMACIE — Login PIN ───
export async function pharmacyLogin(pharmacyId, pin) {
  const { data, error } = await supabase
    .from('pharmacies')
    .select('*')
    .eq('id', pharmacyId)
    .single();
  if (error || !data) return { success: false, error: 'Pharmacie introuvable' };
  if (data.pin !== pin) return { success: false, error: 'PIN incorrect' };
  return { success: true, pharmacy: data };
}

export async function setPharmacyPin(pharmacyId, pin) {
  return supabase
    .from('pharmacies')
    .update({ pin, pin_set_at: new Date().toISOString() })
    .eq('id', pharmacyId);
}

// ─── COMMANDES PHARMACIE ───
export async function getPharmacyOrders(pharmacyId, status = null) {
  // Récupère les commandes qui contiennent au moins un produit de cette pharmacie
  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (status) {
    if (Array.isArray(status)) {
      query = query.in('status', status);
    } else {
      query = query.eq('status', status);
    }
  }
  
  const { data, error } = await query;
  if (error) {
    console.error('getPharmacyOrders error:', error);
    return [];
  }
  
  // Filtrer côté JS : items qui contiennent pharmacyId
  return (data || []).filter(o => {
    if (o.assigned_pharmacy_id === pharmacyId) return true;
    if (Array.isArray(o.items)) {
      return o.items.some(it => it.pharmacyId === pharmacyId);
    }
    return false;
  });
}

export async function acceptOrder(orderId, pharmacyId) {
  return supabase
    .from('orders')
    .update({
      status: 'preparing',
      assigned_pharmacy_id: pharmacyId,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', orderId);
}

export async function refuseOrder(orderId, reason) {
  return supabase
    .from('orders')
    .update({
      status: 'refused',
      refused_at: new Date().toISOString(),
      refusal_reason: reason,
    })
    .eq('id', orderId);
}

export async function markOrderReady(orderId) {
  return supabase
    .from('orders')
    .update({
      status: 'ready',
      prepared_at: new Date().toISOString(),
    })
    .eq('id', orderId);
}

// ─── COMMISSIONS PHARMACIE ───
export async function getPharmacyCommissions(pharmacyId) {
  // Calcule les commissions basées sur les commandes livrées
  const { data: orders } = await supabase
    .from('orders')
    .select('id, total, items, status, created_at, delivered_at')
    .in('status', ['delivered'])
    .order('created_at', { ascending: false });
  
  const pharmacyOrders = (orders || []).filter(o => 
    Array.isArray(o.items) && o.items.some(it => it.pharmacyId === pharmacyId)
  );
  
  // Calculer le revenu de cette pharmacie pour chaque commande
  const enrichedOrders = pharmacyOrders.map(o => {
    const items = o.items.filter(it => it.pharmacyId === pharmacyId);
    const revenue = items.reduce((sum, it) => sum + (it.price || 0) * (it.qty || 1), 0);
    const commission = Math.round(revenue * 0.175);
    const net = revenue - commission;
    return {
      ...o,
      pharmacy_revenue: revenue,
      pharmacy_commission: commission,
      pharmacy_net: net,
    };
  });
  
  // Statistiques globales
  const totalRevenue = enrichedOrders.reduce((sum, o) => sum + o.pharmacy_revenue, 0);
  const totalCommission = enrichedOrders.reduce((sum, o) => sum + o.pharmacy_commission, 0);
  const totalNet = enrichedOrders.reduce((sum, o) => sum + o.pharmacy_net, 0);
  
  // Stats du mois en cours
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthOrders = enrichedOrders.filter(o => new Date(o.created_at) >= firstDay);
  const monthRevenue = monthOrders.reduce((sum, o) => sum + o.pharmacy_revenue, 0);
  const monthCommission = monthOrders.reduce((sum, o) => sum + o.pharmacy_commission, 0);
  const monthNet = monthOrders.reduce((sum, o) => sum + o.pharmacy_net, 0);
  
  // Récupérer les paiements
  const { data: payments } = await supabase
    .from('commission_payments')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('period_end', { ascending: false });
  
  return {
    orders: enrichedOrders,
    totalRevenue,
    totalCommission,
    totalNet,
    monthOrders,
    monthRevenue,
    monthCommission,
    monthNet,
    payments: payments || [],
  };
}

// ─── STATS PHARMACIE ───
export async function getPharmacyStats(pharmacyId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();
  
  // Commandes du jour
  const { data: todayOrders } = await supabase
    .from('orders')
    .select('id, total, items, status, created_at')
    .gte('created_at', todayISO);
  
  const myTodayOrders = (todayOrders || []).filter(o =>
    Array.isArray(o.items) && o.items.some(it => it.pharmacyId === pharmacyId)
  );
  
  // En attente d'acceptation
  const pendingCount = myTodayOrders.filter(o => o.status === 'paid').length;
  // En préparation
  const preparingCount = myTodayOrders.filter(o => o.status === 'preparing').length;
  // Livrées aujourd'hui
  const deliveredToday = myTodayOrders.filter(o => o.status === 'delivered');
  
  // Revenu du jour pour cette pharmacie
  const todayRevenue = deliveredToday.reduce((sum, o) => {
    const items = (o.items || []).filter(it => it.pharmacyId === pharmacyId);
    return sum + items.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  }, 0);
  
  // Nombre de produits actifs de cette pharmacie
  const { data: products } = await supabase
    .from('products')
    .select('id')
    .eq('submitted_by_pharmacy_id', pharmacyId)
    .eq('status', 'approved');
  
  return {
    todayOrdersCount: myTodayOrders.length,
    pendingCount,
    preparingCount,
    deliveredTodayCount: deliveredToday.length,
    todayRevenue,
    activeProductsCount: products?.length || 0,
  };
}
// ─── PROGRAMME FIDÉLITÉ ───

export async function getMyLoyalty(userId) {
  const { data } = await supabase
    .from('users_profile')
    .select('loyalty_points, loyalty_total_earned, loyalty_tier')
    .eq('id', userId)
    .single();
  return data || { loyalty_points: 0, loyalty_total_earned: 0, loyalty_tier: 'bronze' };
}

export async function getLoyaltyTransactions(userId, limit = 50) {
  const { data } = await supabase
    .from('loyalty_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function earnLoyaltyPoints(userId, amount, orderId = null) {
  // 1 FCFA = 1 point. Achat de 8500 FCFA = 8500 points.
  // À la fin de la commande, appeler cette fonction.
  const points = Math.floor(amount);
  const { error } = await supabase.rpc('add_loyalty_points', {
    p_user_id: userId,
    p_points: points,
    p_type: 'earn',
    p_reason: `Achat ${orderId || ''}`,
    p_order_id: orderId,
  });
  if (error) console.error('earnLoyaltyPoints error:', error);
  return !error;
}

export async function spendLoyaltyPoints(userId, points, reason = 'Réduction') {
  const my = await getMyLoyalty(userId);
  if (my.loyalty_points < points) return { success: false, error: 'Solde insuffisant' };
  
  const { error } = await supabase.rpc('add_loyalty_points', {
    p_user_id: userId,
    p_points: -points,
    p_type: 'spend',
    p_reason: reason,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function bonusLoyaltyPoints(userId, points, reason) {
  const { error } = await supabase.rpc('add_loyalty_points', {
    p_user_id: userId,
    p_points: points,
    p_type: 'bonus',
    p_reason: reason,
  });
  return !error;
}

// Convertir des points en réduction FCFA
// 100 points = 500 FCFA (taux 5x)
export function pointsToFcfa(points) {
  return Math.floor(points / 100) * 500;
}

export function fcfaToPoints(fcfa) {
  return Math.floor(fcfa / 500) * 100;
}

// Tier label & color
export function getTierInfo(tier) {
  if (tier === 'gold') return { label: 'Or 🥇', color: '#F4B53A', emoji: '🥇' };
  if (tier === 'silver') return { label: 'Argent 🥈', color: '#9B9B9B', emoji: '🥈' };
  return { label: 'Bronze 🥉', color: '#CD7F32', emoji: '🥉' };
}
// ─── CODES PROMO ───

export async function validatePromoCode(code, userId, orderTotal = 0) {
  if (!code) return { valid: false, error: 'Code requis' };
  
  const { data: promo } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('active', true)
    .maybeSingle();
  
  if (!promo) return { valid: false, error: 'Code invalide' };
  
  // Vérifications
  const now = new Date();
  if (promo.expires_at && new Date(promo.expires_at) < now) {
    return { valid: false, error: 'Code expiré' };
  }
  if (promo.starts_at && new Date(promo.starts_at) > now) {
    return { valid: false, error: 'Code pas encore actif' };
  }
  if (promo.max_uses && promo.uses_count >= promo.max_uses) {
    return { valid: false, error: 'Code épuisé' };
  }
  if (promo.min_order && orderTotal < promo.min_order) {
    return { valid: false, error: `Minimum ${promo.min_order.toLocaleString('fr-FR')} FCFA requis` };
  }
  
  // Vérifie utilisations par user
  if (userId && promo.per_user_limit) {
    const { count } = await supabase
      .from('promo_uses')
      .select('id', { count: 'exact', head: true })
      .eq('promo_id', promo.id)
      .eq('user_id', userId);
    if (count >= promo.per_user_limit) {
      return { valid: false, error: 'Tu as déjà utilisé ce code' };
    }
  }
  
  // Calcule la réduction
  let discount = 0;
  if (promo.type === 'percent') {
    discount = Math.floor((orderTotal * promo.value) / 100);
  } else if (promo.type === 'fixed') {
    discount = Math.min(promo.value, orderTotal);
  } else if (promo.type === 'free_shipping') {
    discount = 1000; // Livraison standard 1000 FCFA
  }
  
  return { valid: true, promo, discount };
}

export async function applyPromoCode(promoId, userId, orderId, discount) {
  const { error } = await supabase
    .from('promo_uses')
    .insert({
      promo_id: promoId,
      user_id: userId,
      order_id: orderId,
      discount_amount: discount,
    });
  if (error) return false;
  
  // Increment uses_count
  const { data: promo } = await supabase
    .from('promo_codes')
    .select('uses_count')
    .eq('id', promoId)
    .single();
  if (promo) {
    await supabase
      .from('promo_codes')
      .update({ uses_count: (promo.uses_count || 0) + 1 })
      .eq('id', promoId);
  }
  return true;
}

// ─── PARRAINAGE ───

export async function getOrCreateReferralCode(userId) {
  // Récupère le code existant
  const { data } = await supabase
    .from('users_profile')
    .select('referral_code')
    .eq('id', userId)
    .single();
  
  if (data?.referral_code) return data.referral_code;
  
  // Génère un nouveau code
  const { data: result, error } = await supabase
    .rpc('generate_referral_code', { p_user_id: userId });
  
  if (error) {
    console.error('referral_code error:', error);
    return null;
  }
  return result;
}

export async function applyReferralCode(referredUserId, referralCode) {
  // Trouve le parrain
  const { data: referrer } = await supabase
    .from('users_profile')
    .select('id, first_name')
    .eq('referral_code', referralCode.toUpperCase())
    .maybeSingle();
  
  if (!referrer) return { success: false, error: 'Code parrainage invalide' };
  if (referrer.id === referredUserId) return { success: false, error: 'Tu ne peux pas te parrainer toi-même' };
  
  // Vérifie pas déjà parrainée
  const { data: me } = await supabase
    .from('users_profile')
    .select('referred_by')
    .eq('id', referredUserId)
    .single();
  
  if (me?.referred_by) return { success: false, error: 'Tu as déjà été parrainée' };
  
  // Applique le parrainage
  await supabase
    .from('users_profile')
    .update({ referred_by: referrer.id })
    .eq('id', referredUserId);
  
  // Donne bonus aux 2
  // 500 points à la nouvelle, 500 points au parrain
  await supabase.rpc('add_loyalty_points', {
    p_user_id: referredUserId,
    p_points: 500,
    p_type: 'bonus',
    p_reason: `Bonus inscription via ${referrer.first_name}`,
  });
  await supabase.rpc('add_loyalty_points', {
    p_user_id: referrer.id,
    p_points: 500,
    p_type: 'bonus',
    p_reason: `Bonus parrainage`,
  });
  
  return { success: true, referrer };
}

export async function getReferralStats(userId) {
  const { data: referrals } = await supabase
    .from('users_profile')
    .select('id, first_name, created_at')
    .eq('referred_by', userId);
  
  return {
    count: referrals?.length || 0,
    list: referrals || [],
    bonusEarned: (referrals?.length || 0) * 500,
  };
}