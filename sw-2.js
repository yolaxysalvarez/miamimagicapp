/* ══════════════════════════════════════════════════════════
   MIAMI MAGIC — Service Worker
   v1 · offline shell + runtime caches + push base
   Estrategias:
   · Navegación (index.html): network-first con fallback al
     shell cacheado → siempre ves la última versión publicada,
     pero el app abre igual sin internet.
   · Imágenes y tiles del mapa: cache-first con revalidación
     y tope de entradas (no infla el storage).
   · CDN (Leaflet js/css, fuentes): stale-while-revalidate.
   · APIs (clima): network-first con fallback al último dato.
   · Push: handlers listos (dormidos hasta tener backend VAPID).
   ══════════════════════════════════════════════════════════ */

var VERSION = 'mm-v1';
var SHELL_CACHE = VERSION + '-shell';
var IMG_CACHE   = VERSION + '-img';
var CDN_CACHE   = VERSION + '-cdn';
var API_CACHE   = VERSION + '-api';
var ALL_CACHES  = [SHELL_CACHE, IMG_CACHE, CDN_CACHE, API_CACHE];

var IMG_MAX = 140;   // tope de imágenes/tiles cacheados
var CDN_MAX = 40;

/* ── install / activate ─────────────────────────────────── */
self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (ALL_CACHES.indexOf(k) === -1) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* ── helpers ────────────────────────────────────────────── */
function trimCache(name, max) {
  caches.open(name).then(function (c) {
    c.keys().then(function (keys) {
      if (keys.length > max) {
        c.delete(keys[0]).then(function () { trimCache(name, max); });
      }
    });
  });
}

function networkFirst(req, cacheName, timeoutMs) {
  return caches.open(cacheName).then(function (cache) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        cache.match(req).then(function (hit) {
          if (hit && !done) { done = true; resolve(hit); }
        });
      }, timeoutMs || 6000);
      fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        if (!done) { done = true; clearTimeout(timer); resolve(res); }
      }).catch(function () {
        clearTimeout(timer);
        cache.match(req).then(function (hit) {
          if (!done) { done = true; resolve(hit || offlineFallback(req)); }
        });
      });
    });
  });
}

function offlineFallback(req) {
  if (req.mode === 'navigate') {
    return caches.open(SHELL_CACHE).then(function (c) {
      return c.match('/').then(function (hit) {
        return hit || new Response(
          '<!doctype html><meta charset="utf-8"><title>Miami Magic</title>' +
          '<body style="font-family:sans-serif;background:#F5F0EB;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;color:#0E1B30">' +
          '<div><h2 style="margin:0 0 8px">Miami Magic 🌴</h2>' +
          '<p style="margin:0;color:#666">Sin conexión · Offline<br>Abre el app una vez con internet para activar el modo offline.</p></div>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      });
    });
  }
  return new Response('', { status: 504 });
}

function cacheFirstRevalidate(req, cacheName, max) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          cache.put(req, res.clone());
          trimCache(cacheName, max);
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  });
}

/* ── fetch router ───────────────────────────────────────── */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                 // POST (AI /api/chat) pasa directo
  var url = new URL(req.url);

  // 1) Navegaciones → network-first, guarda shell como '/'
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.open(SHELL_CACHE).then(function (cache) {
        return fetch(req).then(function (res) {
          if (res && res.ok) cache.put('/', res.clone());
          return res;
        }).catch(function () {
          return cache.match('/').then(function (hit) {
            return hit || offlineFallback(req);
          });
        });
      })
    );
    return;
  }

  // 2) APIs de datos frescos (clima) → network-first con fallback
  if (url.hostname.indexOf('open-meteo.com') !== -1) {
    e.respondWith(networkFirst(req, API_CACHE, 5000));
    return;
  }

  // 3) Imágenes y tiles → cache-first con revalidación + tope
  if (req.destination === 'image' ||
      url.hostname.indexOf('tile.openstreetmap') !== -1 ||
      url.hostname.indexOf('images.unsplash.com') !== -1) {
    e.respondWith(cacheFirstRevalidate(req, IMG_CACHE, IMG_MAX));
    return;
  }

  // 4) CDN (Leaflet, fuentes, estilos) → stale-while-revalidate
  if (url.origin !== self.location.origin) {
    e.respondWith(cacheFirstRevalidate(req, CDN_CACHE, CDN_MAX));
    return;
  }

  // 5) Estáticos propios (ej. /fotos/*.jpg futuras) → cache-first
  e.respondWith(cacheFirstRevalidate(req, IMG_CACHE, IMG_MAX));
});

/* ── PUSH (base lista; se activa cuando haya backend VAPID) ─ */
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data && e.data.text() }; }
  var title = data.title || 'Miami Magic 🌴';
  var opts = {
    body: data.body || 'Hay algo nuevo en Miami…',
    icon: '/miami-magic-icon-192.png',
    badge: '/miami-magic-icon-192.png',
    data: { url: data.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) { list[i].navigate(target); return list[i].focus(); }
      }
      return clients.openWindow(target);
    })
  );
});
