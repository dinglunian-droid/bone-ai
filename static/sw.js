// Service Worker for 骨折分类诊断工具 PWA
// Version: 1.1.0
// Changes from 1.0.0:
//  - cache name bumped to v2 so old cached pages are discarded
//  - the page itself (/, /index.html) is network-first, so new deploys show up at once
//  - pre-caching no longer fails if one file is missing
//  - function calls (/.netlify/functions/) always go to the network

const CACHE_NAME = 'fracture-dx-v2';
const OFFLINE_URL = '/';

// Resources to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// External fonts (cache on first fetch)
const FONT_CACHE = 'fracture-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ── Install: pre-cache shell assets ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        PRECACHE_ASSETS.map(asset => cache.add(asset).catch(() => null))
      )
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== FONT_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: strategy by resource type ─────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API calls — always go to network
  if (url.hostname === 'api.anthropic.com') return;
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  // Google Fonts — cache-first
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(event.request, FONT_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    // The page itself — network-first, so updates are visible immediately
    if (
      event.request.mode === 'navigate' ||
      url.pathname === '/' ||
      url.pathname === '/index.html'
    ) {
      event.respondWith(networkFirst(event.request));
      return;
    }

    // Other same-origin assets — stale-while-revalidate
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
});

// ── Strategies ───────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const fallback = await cache.match(OFFLINE_URL);
    if (fallback) return fallback;
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  // Return cached immediately, update in background
  if (cached) return cached;

  // Nothing cached — wait for network
  const fresh = await fetchPromise;
  if (fresh) return fresh;

  return new Response('Offline', { status: 503 });
}