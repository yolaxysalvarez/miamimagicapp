/* ══════════════════════════════════════════════════════════
   MIAMI MAGIC — Service Worker
   v3 · caché a prueba de envenenamiento + push
   · Al activarse PURGA todo caché de versiones anteriores
     (auto-limpieza en el teléfono de cada visitante).
   · Navegación: network-first con shell offline.
   · Imágenes PROPIAS (/fotos/, iconos): cache-first,
     y SOLO se guardan descargas exitosas (res.ok).
   · TODO lo externo (Unsplash, tiles, CDN, YouTube):
     pasa DIRECTO a la red — el SW jamás lo guarda.
     Envenenar el caché es ahora imposible.
   · Clima (open-meteo): network-first con último dato.
   · Push Miami Pulse: intacto.
   ══════════════════════════════════════════════════════════ */

var VERSION = 'mm-v3';
var SHELL_CACHE = VERSION + '-shell';
var IMG_CACHE   = VERSION + '-img';
var API_CACHE   = VERSION + '-api';
var ALL_CACHES  = [SHELL_CACHE, IMG_CACHE, API_CACHE];

var IMG_MAX = 220;

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

function trimCache(name, max) {
  caches.open(name).then(function (c) {
    c.keys().then(function (keys) {
      if (keys.length > max) {
        c.delete(keys[0]).then(function () { trimCache(name, max); });
      }
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

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var mismo = (url.origin === self.location.origin);

  /* 1) Navegación → network-first, guarda shell */
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

  /* 2) Clima → network-first con fallback (CORS: res.ok verificable, seguro) */
  if (url.hostname.indexOf('open-meteo.com') !== -1) {
    e.respondWith(networkFirst(req, API_CACHE, 5000));
    return;
  }

  /* 3) TODO lo externo pasa directo a la red: el SW no lo toca ni guarda.
        (El caché HTTP del navegador ya lo maneja bien.) */
  if (!mismo) return;

  /* 4) Imágenes propias (/fotos/, iconos, png) → cache-first,
        guardando SOLO descargas exitosas */
  if (url.pathname.indexOf('/fotos/') === 0 || /\.(jpg|jpeg|png|webp)$/i.test(url.pathname)) {
    e.respondWith(
      caches.open(IMG_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok) {
              cache.put(req, res.clone());
              trimCache(IMG_CACHE, IMG_MAX);
            }
            return res;
          });
        });
      })
    );
    return;
  }

  /* 5) resto del mismo origen (manifest, sw, json) → red directa */
});

/* ── PUSH Miami Pulse ── */
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
