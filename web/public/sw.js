const CACHE_VERSION = '2026-06-18-marketplace-v1';
const APP_CACHE = `carup-app-shell-cache-${CACHE_VERSION}`;
const ASSET_CACHE = `carup-asset-cache-${CACHE_VERSION}`;
const CURRENT_CACHES = new Set([APP_CACHE, ASSET_CACHE]);
const APP_SHELL_URLS = ['/', '/index.html'];

function isCacheable(response) {
  return response && response.status === 200 && response.type !== 'opaque';
}

function isHtmlNavigation(request) {
  return request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');
}

function isBuildAsset(url) {
  return url.origin === self.location.origin && /^\/assets\/.+\.(?:js|css|png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(url.pathname);
}

function isServiceWorkerScript(url) {
  return url.origin === self.location.origin && url.pathname === '/sw.js';
}

function offlineResponse(request) {
  const accept = request.headers.get('accept') || '';
  if (accept.includes('application/json') || new URL(request.url).pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Network unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return new Response('Network unavailable', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

async function cacheAppShell() {
  const cache = await caches.open(APP_CACHE);
  await Promise.all(APP_SHELL_URLS.map(async (url) => {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (isCacheable(response)) {
        await cache.put(url, response.clone());
      }
    } catch {
      // Preserve install success even if the app shell is unavailable during local development.
    }
  }));
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (isCacheable(response)) {
      const cache = await caches.open(APP_CACHE);
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    return (
      await caches.match('/index.html') ||
      await caches.match('/') ||
      new Response('<!doctype html><title>CarUp offline</title><main>CarUp is offline.</main>', {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    );
  }
}

async function handleBuildAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(ASSET_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineResponse(request);
  }
}

async function handleNetworkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineResponse(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => (CURRENT_CACHES.has(key) ? false : caches.delete(key)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (isServiceWorkerScript(url)) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => offlineResponse(event.request)));
    return;
  }
  if (isHtmlNavigation(event.request)) {
    event.respondWith(handleNavigation(event.request));
    return;
  }
  if (isBuildAsset(url)) {
    event.respondWith(handleBuildAsset(event.request));
    return;
  }
  event.respondWith(handleNetworkFirst(event.request));
});
