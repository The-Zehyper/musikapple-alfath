const { getYTMusic, formatSongs } = require('./lib/ytmusic');
const { homeCache } = require('./lib/cache');

const CACHE_KEY = 'zaammusic_home_v1';

const SHELVES = [
  { key: 'rekomendasi', title: 'Dibuat Untuk Kamu', query: 'Hits Indonesia Populer' },
  { key: 'rilisBaru', title: 'Rilis Baru', query: 'Lagu Terbaru 2026' },
  { key: 'pop', title: 'Pop', query: 'Top Pop Hits' },
  { key: 'indie', title: 'Indie', query: 'Indie Indonesia' },
  { key: 'musikIndonesia', title: 'Musik Indonesia', query: 'Musik Indonesia Terpopuler' },
  { key: 'kpop', title: 'K-Pop', query: 'K-Pop Hits' },
  { key: 'tanggaLagu', title: 'Tangga Lagu Global', query: 'Top Global Songs' },
  { key: 'diMobil', title: 'Santai & Chill', query: 'Lagu Santai Chill' }
];

exports.handler = async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const forceRefresh = event?.queryStringParameters?.refresh === '1';

    if (!forceRefresh) {
      const cached = homeCache.get(CACHE_KEY);
      if (cached) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, cached: true, data: cached })
        };
      }
    }

    const ytmusic = await getYTMusic();

    const results = await Promise.all(
      SHELVES.map((shelf) => ytmusic.searchSongs(shelf.query).catch(() => []))
    );

    const data = {
      shelves: SHELVES.map((shelf, i) => ({
        key: shelf.key,
        title: shelf.title,
        items: formatSongs(results[i]).slice(0, 10)
      })),
      generatedAt: new Date().toISOString()
    };

    homeCache.set(CACHE_KEY, data);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, cached: false, data })
    };
  } catch (error) {
    console.error('[ZaamMusic] Error saat mengambil data Home:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'Gagal mengambil data halaman utama',
        error: error.message
      })
    };
  }
};
