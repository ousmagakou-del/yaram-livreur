// ════════════════════════════════════════════════
// YARAM Service Worker v6 — VANILLA PERFORMANT
// ════════════════════════════════════════════════
// Stratégies par bucket :
//   - precache : shells critiques (/, manifest, icônes) — installé au boot
//   - assets   : JS/CSS/fonts hashés (immutable) → cache-first long-lived
//   - images   : Supabase storage / images produits → stale-while-revalidate
//   - api      : Supabase REST GET → network-first avec timeout 3s + fallback cache
//
// Bypass strict :
//   - Toute méthode != GET (POST/PUT/PATCH/DELETE) → réseau direct
//   - /auth/* et /rest/v1/rpc/* mutatifs → réseau direct
//   - WebSocket / Realtime → réseau direct
//   - site_settings → réseau direct (admin-éditable)
//
// Compat : iOS Safari + Chrome Android. Skip-waiting + clients.claim().
// ════════════════════════════════════════════════

const SW_BUILD = 'yaram-v7-2026-06-21';
const C_PRECACHE = `${SW_BUILD}-precache`;
const C_ASSETS   = `${SW_BUILD}-assets`;
const C_IMAGES   = `${SW_BUILD}-images`;
const C_API      = `${SW_BUILD}-api`;
const KNOWN_CACHES = new Set([C_PRECACHE, C_ASSETS, C_IMAGES, C_API]);

// Shells critiques pré-cachés à l'install pour 2e visite instantanée
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.svg',
];

// Timeouts adaptés au réseau sénégalais (LTE flaky / 2G)
// FIX v7 (juin 2026) : 3s était trop court sur LTE Sénégal → trop souvent
// on tombait dans le fallback cache stale alors que la requête finissait à 3.5s.
// 7s laisse le temps au réseau mou de répondre tout en bornant l'attente.
const API_NETWORK_TIMEOUT_MS = 7000;   // GET Supabase REST : tente 7s puis cache
const NAVIGATION_TIMEOUT_MS = 5000;    // HTML shell : 5s puis fallback precache
const SWR_BG_TIMEOUT_MS = 10000;       // refresh BG d'une image SWR
const GENERIC_FETCH_TIMEOUT_MS = 12000;

// ─── INSTALL ───────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW v6] install', SW_BUILD);
  event.waitUntil(
    (async () => {
      const cache = await caches.open(C_PRECACHE);
      // addAll est atomique : si un asset 404, on retombe sur un add unitaire tolérant
      try {
        await cache.addAll(PRECACHE_URLS);
      } catch (e) {
        console.warn('[SW v6] precache addAll partial fail, retry unit', e);
        await Promise.all(
          PRECACHE_URLS.map(u => cache.add(u).catch(err => console.warn('[SW v6] skip', u, err)))
        );
      }
      await self.skipWaiting();
    })()
  );
});

// ─── ACTIVATE ──────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW v6] activate', SW_BUILD);
  event.waitUntil(
    (async () => {
      // Purge tous les caches qui ne correspondent pas à la version courante
      const names = await caches.keys();
      await Promise.all(
        names.filter(n => !KNOWN_CACHES.has(n)).map(n => {
          console.log('[SW v6] delete old cache', n);
          return caches.delete(n);
        })
      );
      await self.clients.claim();
    })()
  );
});

// ─── HELPERS ───────────────────────────────────────
function fetchWithTimeout(request, timeoutMs = GENERIC_FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const t = setTimeout(() => {
      controller.abort();
      reject(new Error('sw_timeout'));
    }, timeoutMs);
    fetch(request, { signal: controller.signal })
      .then(r => { clearTimeout(t); resolve(r); })
      .catch(e => { clearTimeout(t); reject(e); });
  });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetchWithTimeout(request);
    if (res && res.ok) {
      // clone avant put — body unique
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    // Pour un asset hashé, on n'a rien de mieux à offrir
    return new Response('', { status: 504, statusText: 'asset offline' });
  }
}

async function networkFirstWithTimeout(request, cacheName, timeoutMs = API_NETWORK_TIMEOUT_MS) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetchWithTimeout(request, timeoutMs);
    if (res && res.ok) {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    return new Response(JSON.stringify({ error: 'offline', sw: SW_BUILD }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetchWithTimeout(request, SWR_BG_TIMEOUT_MS)
    .then(res => {
      if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);

  if (cached) return cached;
  const res = await networkPromise;
  if (res) return res;
  return new Response('', { status: 504, statusText: 'image offline' });
}

// ─── ROUTER ────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) Schémas non-http : pass-through (chrome-extension://, blob:, data:, ws://)
  if (!url.protocol.startsWith('http')) return;

  // 2) WebSocket Realtime — Supabase utilise wss://, donc déjà filtré ci-dessus.
  //    Belt-and-suspenders : si pathname contient /realtime/, on ne touche pas.
  if (url.pathname.includes('/realtime/')) return;

  // 3) Mutations : jamais cacher, jamais retarder
  if (request.method !== 'GET') return;

  // 4) Analytics / tag managers : pass-through
  if (url.hostname.includes('google-analytics') ||
      url.hostname.includes('googletagmanager') ||
      url.hostname.includes('sentry.io')) return;

  // 5) Supabase
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
    // Auth : tokens, sensible → jamais cacher
    if (url.pathname.includes('/auth/')) return;
    // RPC : appels procéduraux (peuvent muter) → jamais cacher
    if (url.pathname.includes('/rest/v1/rpc/')) return;
    // site_settings : admin-éditable, doit toujours être frais
    if (url.pathname.includes('/rest/v1/site_settings')) return;
    // FIX v7 : tables user-specific qui changent à chaque mutation → JAMAIS cacher
    // Sans ça, l'user voyait son ancien panier / commandes / favoris après refresh
    // car le SW lui servait la version cache au lieu de re-fetch.
    const VOLATILE_TABLES = [
      '/rest/v1/orders',
      '/rest/v1/cart_items',
      '/rest/v1/favorites',
      '/rest/v1/notifications',
      '/rest/v1/addresses',
      '/rest/v1/skin_scans',
      '/rest/v1/users_profile',
      '/rest/v1/reviews',
    ];
    if (VOLATILE_TABLES.some(p => url.pathname.includes(p))) return;
    // Storage (images produits / pharmacies) → stale-while-revalidate
    if (url.pathname.includes('/storage/')) {
      event.respondWith(staleWhileRevalidate(request, C_IMAGES));
      return;
    }
    // REST GET (products, categories, pharmacies…) → network-first 7s + cache
    if (url.pathname.includes('/rest/v1/')) {
      event.respondWith(networkFirstWithTimeout(request, C_API, API_NETWORK_TIMEOUT_MS));
      return;
    }
    return;
  }

  // 6) Assets buildés (hashés et immutables : /assets/*.[hash].js|css)
  //    Vite émet dans dist/assets/. Cache-first long-lived OK.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, C_ASSETS));
    return;
  }

  // 7) Fonts & icons même-origine
  if (request.destination === 'font' ||
      url.pathname.match(/\.(woff2?|ttf|eot)$/i)) {
    event.respondWith(cacheFirst(request, C_ASSETS));
    return;
  }

  // 8) Images même-origine (icons PWA, splash, /Logos/*)
  if (request.destination === 'image' ||
      url.pathname.match(/\.(png|jpe?g|gif|webp|svg|ico)$/i)) {
    event.respondWith(staleWhileRevalidate(request, C_IMAGES));
    return;
  }

  // 9) Document (navigation HTML) → network-first court + fallback precache
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith((async () => {
      try {
        const res = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
        if (res && res.ok) {
          const cache = await caches.open(C_PRECACHE);
          cache.put('/', res.clone()).catch(() => {});
        }
        return res;
      } catch {
        const cache = await caches.open(C_PRECACHE);
        const hit = (await cache.match(request)) || (await cache.match('/')) || (await cache.match('/index.html'));
        if (hit) return hit;
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // 10) Tout le reste : laissez-faire (pas de event.respondWith → réseau natif)
});

// ─── PUSH NOTIFS (APNs ne passe pas ici — c'est natif iOS) ──────────
// Payload envoyé par notre edge function `send-push-web` :
//   { title, body, data: { url, order_id, status, ... } }
// On supporte aussi le legacy OneSignal qui sortait { title, body, url }
// à plat — fallback en lisant data.url || data top-level.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const inner = (data.data && typeof data.data === 'object') ? data.data : {};
    const url = inner.url || data.url || '/';
    event.waitUntil(self.registration.showNotification(data.title || 'YARAM', {
      body: data.body || inner.body || '',
      icon: data.icon || inner.icon || '/icon-192.png',
      badge: data.badge || inner.badge || '/icon-96.png',
      vibrate: [200, 100, 200],
      data: { ...inner, url },
    }));
  } catch (e) {
    console.error('[SW v6] push error', e);
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

// ─── MESSAGES (skipWaiting forcé depuis l'app) ─────
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data === 'skipWaiting' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_VERSION') {
    event.source?.postMessage?.({ type: 'VERSION', version: SW_BUILD });
  }
});

console.log('[SW YARAM v6] loaded', SW_BUILD);
