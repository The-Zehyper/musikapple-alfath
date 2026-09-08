// Service worker ZaamMusic.
// Dua tanggung jawab utama:
//   1) Precache "shell" aplikasi (HTML/CSS/JS/ikon) supaya PWA tetap bisa
//      dibuka walau tidak ada koneksi internet.
//   2) Menjawab lagu yang sudah diunduh user (disimpan lewat Cache Storage
//      oleh app.js di bawah URL sintetis /__offline__/<id>.mp3) langsung
//      dari cache — inilah yang membuat lagu unduhan bisa diputar offline.
//
// PENTING: versi cache di bawah ini SENGAJA dinaikkan (v1 -> v2) supaya
// device yang sudah pernah install PWA ini otomatis buang cache shell lama
// begitu update ini terpasang — kalau tidak, perubahan kode (mis. halaman
// lirik) bisa tidak pernah muncul di HP user walau server sudah di-deploy
// ulang. Setiap kali ada perubahan besar ke shell app, naikkan angka versi
// ini lagi (v3, v4, dst).

const SHELL_CACHE = 'zaam-shell-v2';
const OFFLINE_CACHE = 'zaam-offline-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/player.js',
  '/manifest.json',
  '/img/about-avatar.jpg',
  '/img/icons/icon-72.png',
  '/img/icons/icon-96.png',
  '/img/icons/icon-128.png',
  '/img/icons/icon-144.png',
  '/img/icons/icon-152.png',
  '/img/icons/icon-180.png',
  '/img/icons/icon-192.png',
  '/img/icons/icon-384.png',
  '/img/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // addAll akan gagal total kalau salah satu URL 404 — pasang satu-satu
      // supaya aset yang gagal tidak menggagalkan seluruh precache.
      Promise.all(
        SHELL_ASSETS.map((url) => cache.add(url).catch(() => null))
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Bersihkan SEMUA cache shell versi lama (nama cache apa pun selain
      // SHELL_CACHE/OFFLINE_CACHE yang berlaku sekarang), tapi JANGAN pernah
      // hapus cache offline downloads milik user.
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== OFFLINE_CACHE)
            .map((key) => caches.delete(key))
        )
      )
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // 1) Lagu yang sudah diunduh untuk offline: cache-only, langsung dari
  //    Cache Storage (termasuk respons "opaque" cross-origin yang disimpan
  //    app.js — itu tetap bisa diputar walau isinya tak terbaca lewat JS).
  if (url.pathname.startsWith('/__offline__/')) {
    event.respondWith(
      caches.match(req).then((cached) => cached || new Response(null, { status: 404 }))
    );
    return;
  }

  // 2) Panggilan API (data lagu/artis/home/lirik) harus selalu fresh dari
  //    network — jangan pernah disajikan dari cache basi.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // 3) Aset shell aplikasi sendiri (same-origin): NETWORK-FIRST. Selalu coba
  //    ambil versi terbaru dari server dulu (supaya update kode langsung
  //    kepakai begitu dibuka lagi), dan HANYA jatuh ke cache kalau memang
  //    lagi offline/network gagal. Cache tetap diperbarui tiap kali network
  //    berhasil, jadi mode offline berikutnya juga selalu pakai versi
  //    terakhir yang sempat online.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 4) Sumber eksternal lain (thumbnail, mp3 pihak ketiga yang belum
  //    diunduh, dsb) — teruskan apa adanya ke network.
  event.respondWith(fetch(req).catch(() => new Response(null, { status: 504 })));
});
