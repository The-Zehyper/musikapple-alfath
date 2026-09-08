# ZaamMusic 🎧

Website streaming musik online bertema biru, dibuat oleh **Zaam**. Menampilkan Dashboard Home,
Cari, Koleksi Kamu, profil Artis, dan halaman Tentang — mirip layout Spotify tapi dengan identitas
visual sendiri.

## Fitur

- **Dashboard Home**: shelf lagu (Dibuat Untuk Kamu, Rilis Baru, Pop, dll) di-cache **1 jam**
  lewat `node-cache` di function `home.js`, jadi tidak memanggil ulang mesin YTMusic API
  setiap kali ada yang buka halaman Home.
- **Cari**: grid kategori (mirip layout "Cari" Spotify) + pencarian lagu / artis secara real-time.
- **Koleksi Kamu**: tab Playlist (Lagu yang Disukai + playlist buatanmu) dan tab Artis (riwayat
  artis dari lagu yang pernah kamu putar). Semua disimpan di `localStorage` browser.
- **Lihat artis dari lagu yang diputar**: tap nama artis di mini player untuk membuka profil
  artis beserta lagu populernya.
- **Audio-only player**: musik diputar lewat YouTube IFrame Player API, tapi elemen videonya
  disembunyikan total lewat CSS (`#hiddenPlayerHost`) — pengguna hanya mendengar audionya saja.
- **Tentang ZaamMusic & Zaam**: halaman info produk dan pencipta.

## Struktur Proyek

```
zaammusic/
├── netlify.toml                  # Konfigurasi build + redirect /api/* -> functions
├── package.json
├── netlify/functions/
│   ├── home.js                   # GET /api/home  (pakai cache node-cache 1 jam)
│   ├── search.js                 # GET /api/search?q=
│   ├── search-artist.js          # GET /api/search-artist?q=
│   └── lib/
│       ├── ytmusic.js            # Singleton engine ytmusic-api + formatter
│       └── cache.js              # Instance NodeCache (TTL 3600 detik)
└── public/
    ├── index.html                # SPA: Home, Search, Library, Artist, About
    ├── css/style.css             # Tema biru, mirip layout Spotify
    └── js/
        ├── player.js             # Pemutar audio-only (iframe YouTube tersembunyi)
        └── app.js                # Semua logic UI & pemanggilan API
```

## Menjalankan Secara Lokal

```bash
npm install
npm install -g netlify-cli   # sekali saja, kalau belum ada
netlify dev
```

Lalu buka `http://localhost:8888`.

## Deploy ke Netlify

**Cara termudah (drag & drop):**
1. Login ke [app.netlify.com](https://app.netlify.com).
2. Masuk menu **Sites** → tarik folder `zaammusic` (hasil unzip) ke area "Deploy manually".
3. Netlify otomatis membaca `netlify.toml` (publish dari folder `public`, functions dari
   `netlify/functions`) dan men-deploy keduanya.

**Cara via Git (disarankan untuk update berkelanjutan):**
```bash
git init
git add .
git commit -m "Initial commit ZaamMusic"
git remote add origin <url-repo-kamu>
git push -u origin main
```
Lalu di Netlify: **Add new site → Import an existing project**, pilih repo tersebut. Netlify
akan mendeteksi `netlify.toml` secara otomatis — tidak perlu ubah setting build apa pun.

**Cara via CLI:**
```bash
netlify deploy --prod
```

Tidak ada environment variable wajib — `ytmusic-api` berjalan tanpa API key.

## Catatan Teknis

- `node-cache` disimpan di memori function; pada Netlify Functions ini efektif selama instance
  function masih "warm" (biasanya beberapa menit–jam tergantung trafik). Untuk cache yang benar-benar
  bertahan 1 jam penuh lintas semua instance, pertimbangkan upgrade ke Netlify Blobs atau Upstash
  Redis di masa depan — arsitektur `lib/cache.js` sudah dipisah supaya gampang diganti nanti.
- Endpoint lama dari server Express (`/api/ytmusic/home`, `/api/ytmusic/search`,
  `/api/ytmusic/search/artist`) sudah diadaptasi jadi Netlify Functions serverless
  (`/api/home`, `/api/search`, `/api/search-artist`) supaya bisa jalan di Netlify tanpa server
  Node yang terus menyala.
- Video YouTube tetap "ada" secara teknis (dibutuhkan untuk streaming audio dari YouTube), tapi
  disembunyikan 100% lewat CSS (ukuran 1x1px, opacity 0, `pointer-events: none`), jadi yang
  terlihat pengguna hanya UI ZaamMusic — bukan video/iklan YouTube.

---

Dibuat dengan ♥ oleh **Zaam**.
