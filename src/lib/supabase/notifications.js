import { supabase } from './client';
import { compressImage } from './storage';

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

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS — list, mark as read, count unread (RPC-based)
// ═══════════════════════════════════════════════════════════════════

export async function getMyNotifications(limit = 50) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, icon, url, type, read, sent_at')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[notifs] getMy error:', error.message);
    return [];
  }
  return data || [];
}

export async function getUnreadNotificationsCount() {
  try {
    const { data, error } = await supabase.rpc('count_unread_notifications');
    if (error) return 0;
    return Number(data) || 0;
  } catch { return 0; }
}

export async function markAllNotificationsRead() {
  try {
    const { data, error } = await supabase.rpc('mark_all_notifications_read');
    if (error) return 0;
    return Number(data) || 0;
  } catch { return 0; }
}

export async function markNotificationRead(notificationId) {
  try {
    const { data, error } = await supabase.rpc('mark_notification_read', {
      p_notification_id: notificationId,
    });
    if (error) return false;
    return !!data;
  } catch { return false; }
}

// Real-time subscription : appelle onUpdate(count) à chaque INSERT/UPDATE
// sur la table notifications du user courant. Retourne unsubscribe.
export function subscribeNotificationsCount(userId, onUpdate) {
  if (!userId) return () => {};
  const channel = supabase
    .channel(`notif-count-${userId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, async () => {
      try {
        const c = await getUnreadNotificationsCount();
        onUpdate(c);
      } catch { /* ignore */ }
    })
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
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
  // PERF : RPC atomique (1 query au lieu de SELECT + UPDATE)
  // + race-safe si 2 users tapent "utile" en simultané.
  try {
    const { error } = await supabase.rpc('increment_review_helpful', { review_id: reviewId });
    if (!error) return;
  } catch { /* fallback */ }

  // Fallback si RPC pas encore déployée
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
