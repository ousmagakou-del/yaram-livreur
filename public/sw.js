// ════════════════════════════════════════════════
// YARAM Service Worker v4 — PROPRE & FIABLE
// ════════════════════════════════════════════════
// - Network-first pour l'app (toujours fraîche)
// - Cache-first pour assets statiques (rapide)
// - Ignore chrome-extension et autres schemes
// - Compatible PWA installable
// ════════════════════════════════════════════════

const SW_VERSION = 'v4-2026-05-13';
const CACHE_STATIC = 'yaram-static-v4';

// Fichiers essentiels à cacher au install
const ESSENTIAL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
];

// ─── INSTALL : nettoie les anciens caches ───
self.addEventListener('install', (event) => {
  console.log('[SW v4] Install');
  event.waitUntil(
    Promise.all([
      // Supprime TOUS les anciens caches (v1, v2, v3, etc.)
      caches.keys().then(names => 
        Promise.all(
          names
            .filter(name => name !== CACHE_STATIC)
            .map(name => {
              console.log('[SW v4] Delete old cache:', name);
              return caches.delete(name);
            })
        )
      ),
      // Cache les essentiels
      caches.open(CACHE_STATIC).then(cache => 
        cache.addAll(ESSENTIAL).catch(e => console.warn('[SW v4] Cache install warn:', e))
      ),
    ]).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE : prend le contrôle ───
self.addEventListener('activate', (event) => {
  console.log('[SW v4] Activate');
  event.waitUntil(self.clients.claim());
});

// ─── FETCH : gère les requêtes ───
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ❌ IGNORER : schemes non-HTTP (chrome-extension, etc.)
  if (!url.protocol.startsWith('http')) return;

  // ❌ IGNORER : POST/PUT/DELETE
  if (request.method !== 'GET') return;

  // ❌ IGNORER : Supabase API (toujours frais)
  if (url.hostname.includes('supabase.co')) return;

  // ❌ IGNORER : Google Analytics, Tag Manager
  if (url.hostname.includes('google-analytics') || 
      url.hostname.includes('googletagmanager')) return;

  // ✅ CACHE-FIRST pour images & assets statiques
  if (request.destination === 'image' || 
      request.destination === 'font' ||
      url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico|mp3|mp4)$/i)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ✅ NETWORK-FIRST pour l'app (HTML/JS/CSS)
  event.respondWith(networkFirst(request));
});

// ─── STRATÉGIES ───

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    
    // Cache la réponse si succès
    if (response.ok && request.url.startsWith('http')) {
      try {
        const cache = await caches.open(CACHE_STATIC);
        await cache.put(request, response.clone());
      } catch (e) {
        // Ignore les erreurs de cache (extensions, etc.)
      }
    }
    return response;
  } catch (error) {
    // Si réseau down → essai cache
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Si page HTML → offline fallback
    if (request.destination === 'document') {
      return caches.match('/offline.html');
    }
    
    return new Response('Network error', { status: 503 });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Pour les images : refresh en background
    fetch(request).then(response => {
      if (response.ok && request.url.startsWith('http')) {
        caches.open(CACHE_STATIC).then(cache => {
          cache.put(request, response).catch(() => {});
        });
      }
    }).catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok && request.url.startsWith('http')) {
      try {
        const cache = await caches.open(CACHE_STATIC);
        await cache.put(request, response.clone());
      } catch (e) {
        // Ignore
      }
    }
    return response;
  } catch (error) {
    return new Response('', { status: 404 });
  }
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
    console.error('[SW v4] Push error:', e);
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

console.log('[SW YARAM v4] Loaded');
