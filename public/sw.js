// ════════════════════════════════════════════════
// Diaara Service Worker v2 — Update-friendly
// ════════════════════════════════════════════════

const CACHE_VERSION = 'diaara-v2-' + Date.now();
const STATIC_CACHE = 'diaara-static-v2';

// Fichiers essentiels (cache au install)
const ESSENTIAL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/icon-192.png',
  '/icon-512.png',
];

// ─── INSTALL ─────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW Diaara v2] Install');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => 
      cache.addAll(ESSENTIAL_FILES).catch(e => console.warn('[SW] Cache install warn:', e))
    ).then(() => self.skipWaiting()) // Active immédiatement
  );
});

// ─── ACTIVATE ─────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW Diaara v2] Activate');
  event.waitUntil(
    Promise.all([
      // Supprime les anciens caches
      caches.keys().then(names => 
        Promise.all(
          names
            .filter(name => name !== STATIC_CACHE)
            .map(name => {
              console.log('[SW] Delete old cache:', name);
              return caches.delete(name);
            })
        )
      ),
      // Prend le contrôle immédiat de tous les clients
      self.clients.claim(),
    ])
  );
});

// ─── FETCH ─────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ❌ NE PAS toucher aux schemes spéciaux (chrome-extension, etc.)
  if (!url.protocol.startsWith('http')) return;

  // ❌ NE PAS cacher les requêtes POST/PUT/DELETE
  if (request.method !== 'GET') return;

  // ❌ NE PAS cacher Supabase API (toujours frais)
  if (url.hostname.includes('supabase.co')) return;

  // ❌ NE PAS cacher les analytics / extensions
  if (url.hostname.includes('google-analytics') || 
      url.hostname.includes('googletagmanager')) return;

  // ✅ NETWORK FIRST pour l'app (HTML, JS, CSS)
  if (request.destination === 'document' || 
      request.destination === 'script' || 
      request.destination === 'style') {
    event.respondWith(networkFirst(request));
    return;
  }

  // ✅ CACHE FIRST pour images & assets statiques
  if (request.destination === 'image' || 
      request.destination === 'font' || 
      url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico)$/)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Par défaut : NETWORK FIRST
  event.respondWith(networkFirst(request));
});

// ─── STRATÉGIES CACHE ─────────────────────────

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    
    // Cache seulement si succès ET schéma compatible
    if (response.ok && request.url.startsWith('http')) {
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.put(request, response.clone());
      } catch (e) {
        // Ignore les erreurs de cache (chrome-extension, etc.)
      }
    }
    return response;
  } catch (error) {
    // Si réseau down → essai cache
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Si c'est une page HTML → fallback offline
    if (request.destination === 'document') {
      return caches.match('/offline.html');
    }
    
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && request.url.startsWith('http')) {
      try {
        const cache = await caches.open(STATIC_CACHE);
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

// ─── PUSH NOTIFICATIONS ─────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    const options = {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/icon-96.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
      actions: data.actions || [],
    };
    event.waitUntil(self.registration.showNotification(data.title || 'Diaara', options));
  } catch (e) {
    console.error('[SW] Push error:', e);
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

console.log('[SW Diaara v2] Loaded');