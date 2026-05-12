// ═══════════════════════════════════════════════════════════════
// DIAARA — Service Worker
// Mode hors-ligne + cache intelligent
// ═══════════════════════════════════════════════════════════════

const CACHE_VERSION = 'diaara-v1';
const RUNTIME_CACHE = 'diaara-runtime-v1';

// Resources à précacher au moment de l'installation
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ─── INSTALL ───
self.addEventListener('install', (event) => {
  console.log('[SW Diaara] Installing...');
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW Diaara] Precache partial fail:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ───
self.addEventListener('activate', (event) => {
  console.log('[SW Diaara] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_VERSION && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// ─── FETCH ───
// Stratégie : 
// - HTML/JS/CSS : Network-first (toujours frais)
// - Images : Cache-first (rapide)
// - API Supabase : Network-only (jamais cache)

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Ignore les requêtes non-GET
  if (request.method !== 'GET') return;
  
  // Ignore les API Supabase (jamais en cache)
  if (url.hostname.includes('supabase.co') || 
      url.hostname.includes('generativelanguage.googleapis.com') ||
      url.hostname.includes('wasenderapi.com')) {
    return; // Laisse passer la requête normalement
  }
  
  // Images, polices, fonts : Cache-first
  if (request.destination === 'image' || 
      request.destination === 'font' ||
      url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2?|ttf)$/i)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  
  // HTML, JS, CSS : Network-first avec fallback cache
  if (request.destination === 'document' ||
      request.destination === 'script' ||
      request.destination === 'style' ||
      url.pathname.endsWith('/') ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css')) {
    event.respondWith(networkFirst(request));
    return;
  }
});

// ─── HELPERS ───
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline + pas en cache → image placeholder
    return new Response('', { status: 408 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline → essaye le cache
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Cache vide → page offline minimale
    if (request.destination === 'document') {
      return new Response(
        `<!DOCTYPE html>
        <html lang="fr">
        <head>
          <meta charset="UTF-8">
          <title>Diaara - Hors ligne</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { margin: 0; font-family: system-ui, sans-serif;
                   background: #1F8B4C; color: white;
                   display: flex; align-items: center; justify-content: center;
                   min-height: 100vh; text-align: center; padding: 20px; }
            .box { max-width: 320px; }
            .logo { width: 80px; height: 80px; border-radius: 50%;
                    background: white; color: #1F8B4C; font-weight: 800;
                    font-size: 48px; display: flex; align-items: center;
                    justify-content: center; margin: 0 auto 20px; }
            h1 { font-size: 24px; margin: 0 0 10px; }
            p { opacity: 0.9; line-height: 1.5; }
            button { margin-top: 24px; padding: 12px 24px; background: white;
                     color: #1F8B4C; border: none; border-radius: 10px;
                     font-weight: 700; cursor: pointer; }
          </style>
        </head>
        <body>
          <div class="box">
            <div class="logo">D</div>
            <h1>Pas de connexion</h1>
            <p>Tu es hors ligne. Vérifie ta connexion internet pour utiliser Diaara.</p>
            <button onclick="location.reload()">🔄 Réessayer</button>
          </div>
        </body>
        </html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    
    return new Response('Offline', { status: 408 });
  }
}

// ─── PUSH NOTIFICATIONS ───
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Diaara', body: event.data.text() };
  }
  
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-96.png',
    vibrate: [200, 100, 200],
    data: data.url || '/',
    actions: data.actions || [],
    tag: data.tag || 'diaara-notif',
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Diaara', options)
  );
});

// Click sur notification → ouvre l'app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

console.log('[SW Diaara] Loaded ✓');
