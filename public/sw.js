// ════════════════════════════════════════════════
// YARAM Service Worker v5 — PERFORMANT
// ════════════════════════════════════════════════
// - Network-first pour HTML/JS (fraîcheur)
// - Cache-first pour images/fonts (rapidité)
// - Stale-while-revalidate pour Supabase GET (snappy)
// - Ignore mutations Supabase (POST/PUT/DELETE)
// ════════════════════════════════════════════════

const SW_VERSION = 'v17-2026-05-25-skip-settings-cache';
const CACHE_STATIC = 'yaram-static-v17';
const CACHE_SUPABASE = 'yaram-supabase-v17';

const ESSENTIAL = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ─── INSTALL : pre-cache + clean old caches ───
self.addEventListener('install', (event) => {
  console.log('[SW v5] Install');
  event.waitUntil(
    Promise.all([
      caches.keys().then(names =>
        Promise.all(
          names
            .filter(name => name !== CACHE_STATIC && name !== CACHE_SUPABASE)
            .map(name => {
              console.log('[SW v5] Delete old cache:', name);
              return caches.delete(name);
            })
        )
      ),
      caches.open(CACHE_STATIC).then(cache =>
        cache.addAll(ESSENTIAL).catch(e => console.warn('[SW v5] Cache install warn:', e))
      ),
    ]).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE : prend le contrôle ───
self.addEventListener('activate', (event) => {
  console.log('[SW v5] Activate');
  event.waitUntil(self.clients.claim());
});

// ─── FETCH ───
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (!url.protocol.startsWith('http')) return;
  if (request.method !== 'GET') return;

  if (url.hostname.includes('google-analytics') ||
      url.hostname.includes('googletagmanager')) return;

  // ─── 1. Supabase GET → stale-while-revalidate (LITE) ───
  if (url.hostname.includes('supabase.co')) {
    // Auth endpoint → JAMAIS cacher (sensible)
    if (url.pathname.includes('/auth/')) return;
    // Realtime → laisser passer
    if (url.pathname.includes('/realtime')) return;
    // Storage (images) → cache-first long
    if (url.pathname.includes('/storage/')) {
      event.respondWith(cacheFirstLong(request));
      return;
    }
    // ─── EXCLUSIONS du cache REST : tables admin-modifiables ───
    // site_settings change quand admin modifie WhatsApp/commission/shipping/colors
    // → JAMAIS cacher sinon l'app reste sur les vieilles valeurs après update admin
    if (url.pathname.includes('/rest/v1/site_settings')) {
      return; // network direct, pas de cache
    }
    // REST API (products, brands, categories, etc.) → stale-while-revalidate
    if (url.pathname.includes('/rest/v1/')) {
      event.respondWith(staleWhileRevalidate(request));
      return;
    }
    return;
  }

  // ─── 2. Images & fonts → cache-first ───
  if (request.destination === 'image' ||
      request.destination === 'font' ||
      url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico|mp3|mp4)$/i)) {
    event.respondWith(cacheFirstLong(request));
    return;
  }

  // ─── 3. Reste (HTML/JS/CSS) → network-first ───
  event.respondWith(networkFirst(request));
});

// ─── STRATÉGIES ───

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && request.url.startsWith('http')) {
      try {
        const cache = await caches.open(CACHE_STATIC);
        await cache.put(request, response.clone());
      } catch {}
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.destination === 'document') {
      return caches.match('/index.html');
    }
    return new Response('Network error', { status: 503 });
  }
}

async function cacheFirstLong(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Refresh BG si > 7 jours
    const dateHeader = cached.headers.get('date');
    if (dateHeader) {
      const age = Date.now() - new Date(dateHeader).getTime();
      if (age > 7 * 24 * 60 * 60 * 1000) {
        fetch(request).then(r => {
          if (r.ok) caches.open(CACHE_STATIC).then(c => c.put(request, r).catch(() => {}));
        }).catch(() => {});
      }
    }
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok && request.url.startsWith('http')) {
      try {
        const cache = await caches.open(CACHE_STATIC);
        await cache.put(request, response.clone());
      } catch {}
    }
    return response;
  } catch {
    return new Response('', { status: 404 });
  }
}

// Stale-while-revalidate : pour Supabase REST
// - Renvoie la cache tout de suite (RAPIDE)
// - Fetch en BG pour la prochaine fois
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_SUPABASE);
  const cached = await cache.match(request);

  // Fetch en BG, met à jour le cache
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      try {
        cache.put(request, response.clone()).catch(() => {});
      } catch {}
    }
    return response;
  }).catch(() => null);

  // Si on a un cache : renvoie tout de suite (snappy)
  if (cached) {
    return cached;
  }

  // Sinon : attend le fetch (premier load)
  const response = await fetchPromise;
  if (response) return response;
  return new Response('Network error', { status: 503 });
}

// ─── PUSH NOTIFICATIONS ───
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(self.registration.showNotification(data.title || 'YARAM', {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/icon-96.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
    }));
  } catch (e) {
    console.error('[SW v5] Push error:', e);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// ─── MESSAGES (force update) ───
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

console.log('[SW YARAM v5] Loaded — perf-mode ON');
