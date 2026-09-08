const { getYTMusic, formatArtists, formatArtistDetail, formatSongs } = require('./lib/ytmusic');

function normalize(str) {
  return (str || '').toLowerCase().trim();
}

// Ambil object "artis utama" dari berbagai bentuk data yang mungkin dikembalikan
// ytmusic-api (artist tunggal, array artists, atau nama field yang beda-beda).
function extractPrimaryArtist(source) {
  if (!source) return null;
  const fromArray = Array.isArray(source.artists) && source.artists.length ? source.artists[0] : null;
  const candidate = fromArray || source.artist || null;
  if (!candidate) return null;
  const id = candidate.artistId || candidate.channelId || candidate.id || null;
  const name = candidate.name || candidate.title || null;
  if (!id && !name) return null;
  return { id, name };
}

// PENTING (ditemukan lewat testing langsung oleh user): hasil ytmusic.searchSongs()
// SANGAT SERING mengembalikan "artists": [] (array kosong sama sekali, bukan cuma
// artistId yang null) — jadi song.artists TIDAK BISA diandalkan untuk resolve artis.
// Yang biasanya tetap terisi dari searchSongs adalah song.album.id (albumId format
// "MPREb_..."), dan halaman album di YouTube Music selalu menyertakan artis
// pemiliknya dengan channelId yang valid. Karena itu jalur PALING DIANDALKAN untuk
// auto-resolve artis dari sebuah lagu adalah: albumId -> getAlbum() -> artist asli.
async function resolveArtistFromAlbum(ytmusic, albumId) {
  if (!albumId || typeof ytmusic.getAlbum !== 'function') return null;
  try {
    const albumDetail = await ytmusic.getAlbum(albumId);
    return extractPrimaryArtist(albumDetail);
  } catch (err) {
    console.error('[ZaamMusic] Gagal resolve artis lewat albumId:', err.message || err);
    return null;
  }
}

// Jalur cadangan kedua: coba ambil detail lagu langsung lewat videoId, kalau-kalau
// versi ytmusic-api yang terpasang punya salah satu method ini (tidak semua versi
// punya endpoint detail lagu per-id, makanya dicoba beberapa nama method sekaligus
// dan dibungkus try/catch supaya tidak pernah menggagalkan request).
async function resolveArtistFromVideo(ytmusic, videoId) {
  if (!videoId) return null;
  const candidates = ['getSong', 'getSongInfo', 'getFullSong', 'song'];
  for (const method of candidates) {
    if (typeof ytmusic[method] === 'function') {
      try {
        const detail = await ytmusic[method](videoId);
        const artist = extractPrimaryArtist(detail);
        if (artist) return artist;
      } catch (err) {
        console.error(`[ZaamMusic] ytmusic.${method}(videoId) gagal:`, err.message || err);
      }
    }
  }
  return null;
}

// Jalur cadangan ketiga: cari ulang lagunya lewat judul persis (bukan lewat
// videoId), lalu ambil artis dari hasil pencarian itu KALAU kebetulan tidak kosong
// (searchSongs tidak selalu kosong artists-nya, tergantung lagunya).
async function resolveArtistFromTitleSearch(ytmusic, title, videoId) {
  if (!title) return null;
  try {
    const results = await ytmusic.searchSongs(title);
    if (!Array.isArray(results) || !results.length) return null;
    const matched = (videoId && results.find((s) => s.videoId === videoId)) || results[0];
    return extractPrimaryArtist(matched);
  } catch (err) {
    console.error('[ZaamMusic] Gagal resolve artis lewat pencarian judul:', err.message || err);
    return null;
  }
}

exports.handler = async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  let id = event?.queryStringParameters?.id || null;
  let query = event?.queryStringParameters?.q || null;
  const videoId = event?.queryStringParameters?.videoId || null;
  const albumId = event?.queryStringParameters?.albumId || null;
  const title = event?.queryStringParameters?.title || null;

  if (!id && !query && !videoId && !albumId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'Wajib mengisi salah satu: "id" (artistId), "q" (nama artis), "albumId", atau "videoId". Contoh: /api/search-artist?albumId=MPREb_xxxx&videoId=xxxx'
      })
    };
  }

  let ytmusic;
  try {
    ytmusic = await getYTMusic();
  } catch (initError) {
    console.error('[ZaamMusic] Gagal inisialisasi YTMusic API:', initError);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        totalResults: 1,
        data: [{ artistId: id || null, name: query || title || 'Artis', description: null, thumbnailHd: null }],
        topSongs: []
      })
    };
  }

  // ---------- Auto-resolve artis dari lagu yang sedang didengar ----------
  // Urutan dicoba dari yang paling terbukti akurat ke yang paling spekulatif:
  // albumId -> videoId (detail lagu) -> pencarian ulang judul.
  if (!id) {
    let resolved = await resolveArtistFromAlbum(ytmusic, albumId);
    if (!resolved) resolved = await resolveArtistFromVideo(ytmusic, videoId);
    if (!resolved) resolved = await resolveArtistFromTitleSearch(ytmusic, query || title, videoId);

    if (resolved?.id) id = resolved.id;
    if (!query && resolved?.name) query = resolved.name;
  }

  // ---------- Jalur utama: cari berdasarkan artistId (lebih akurat, tidak ambigu) ----------
  if (id) {
    try {
      const artistDetail = await ytmusic.getArtist(id);
      if (artistDetail) {
        const formattedArtist = formatArtistDetail(artistDetail);

        // Lagu populer milik artis ini, langsung dari profil artist (bukan hasil pencarian nama)
        let artistSongsRaw = [];
        if (typeof ytmusic.getArtistSongs === 'function') {
          artistSongsRaw = await ytmusic.getArtistSongs(id).catch(() => []);
        }
        let formattedSongs = formatSongs(artistSongsRaw).slice(0, 20);

        // Fallback kalau getArtistSongs kosong/tidak didukung: cari lewat nama artis
        if (!formattedSongs.length && (query || formattedArtist?.name)) {
          const fallbackQuery = query || formattedArtist.name;
          const fallbackSongs = await ytmusic.searchSongs(fallbackQuery).catch(() => []);
          formattedSongs = formatSongs(fallbackSongs).slice(0, 10);
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            totalResults: 1,
            data: [formattedArtist],
            topSongs: formattedSongs
          })
        };
      }
    } catch (idError) {
      // Umum terjadi kalau artistId tidak dikenali getArtist() (format id tidak cocok,
      // channel sudah tidak aktif, dsb). Jangan hentikan request — lanjut ke pencarian nama.
      console.error('[ZaamMusic] Gagal mengambil artis lewat id, fallback ke pencarian nama:', idError.message || idError);
    }
  }

  // ---------- Jalur fallback: cari berdasarkan nama (query) ----------
  if (!query) {
    // Tidak ada nama untuk fallback — tetap balas 200 dengan data minimal supaya
    // tampilan artis di frontend tidak mentok di layar error.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        totalResults: 1,
        data: [{ artistId: id || null, name: title || 'Artis', description: null, thumbnailHd: null }],
        topSongs: []
      })
    };
  }

  try {
    const [artistResults, topSongs] = await Promise.all([
      ytmusic.searchArtists(query).catch(() => []),
      ytmusic.searchSongs(query).catch(() => [])
    ]);

    const formattedArtists = formatArtists(artistResults || []);
    const formattedSongs = formatSongs(topSongs || []).slice(0, 10);

    if (!formattedArtists.length) {
      // Tidak ketemu di pencarian artis — tetap balas 200 dengan nama yang sudah kita
      // punya (dari lagu yang sedang diputar) supaya halaman artis tetap terisi.
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          totalResults: 1,
          data: [{ artistId: id || null, name: query, description: null, thumbnailHd: null }],
          topSongs: formattedSongs
        })
      };
    }

    // Utamakan hasil yang namanya persis sama dengan yang dicari (bukan sekadar hasil teratas)
    const exactMatch = formattedArtists.find((a) => normalize(a.name) === normalize(query));
    const bestMatch = exactMatch || formattedArtists[0];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        totalResults: formattedArtists.length,
        data: [bestMatch, ...formattedArtists.filter((a) => a !== bestMatch)],
        topSongs: formattedSongs
      })
    };
  } catch (searchError) {
    console.error('[ZaamMusic] Error saat pencarian artis lewat nama:', searchError);
    // Tetap balas 200 dengan data minimal, jangan lempar 500 ke frontend.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        totalResults: 1,
        data: [{ artistId: id || null, name: query, description: null, thumbnailHd: null }],
        topSongs: []
      })
    };
  }
};
