const https = require('https');
const fs = require('fs');
const path = require('path');
const { getYTMusic } = require('./lib/ytmusic');

// ---------------------------------------------------------------------
// Sumber #1 (UTAMA): ytmusic.getLyrics(videoId) dari paket "ytmusic-api",
// memakai videoId yang sama persis dengan metadataId lagu yang sedang
// diputar player (lihat app.js: currentSong.metadataId).
//
// Sumber #2 (CADANGAN BARU): api.ikyyxd.my.id/search/lyrics — dicoba kalau
// sumber #1 kosong ATAU tidak tersinkron waktu. Apikey-nya TIDAK di-hardcode
// di sini, melainkan dibaca dari file lib/lyrics-ikyyxd-apikeys.txt supaya
// gampang ganti/tambah key cadangan tanpa harus ubah kode ini.
//
// Sumber #3 (CADANGAN TERAKHIR): lrclib.net, dicoba kalau sumber #1 & #2
// masih kosong/tidak tersinkron. Hasil disaring pakai kecocokan durasi lagu
// supaya tidak salah ambil versi lain yang timing-nya beda.
// ---------------------------------------------------------------------

function httpsGetJson(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// Membaca daftar apikey dari file .txt di folder lib/ (satu key per baris).
// Baris kosong atau yang diawali '#' (komentar) diabaikan. Kalau file belum
// ada sama sekali, dikembalikan array kosong (fitur otomatis dilewati, tidak
// bikin function error).
function loadApiKeys(filename) {
  try {
    const filePath = path.join(__dirname, 'lib', filename);
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch (err) {
    console.error(`[ZaamMusic] Gagal membaca apikey dari ${filename}:`, err.message || err);
    return [];
  }
}

function cleanTitle(t) {
  return (t || '')
    .replace(/(\(.*(official|lyric|video|audio).*\)|\[.*(official|lyric|video|audio).*\]|-.*(official|lyric|video|audio).*)/gi, '')
    .trim();
}
function cleanArtist(a) {
  return (a || '').replace(/- Topic/gi, '').trim();
}

function parseSyncedLrc(s) {
  const lines = [];
  const pattern = /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)/;
  for (const raw of s.split('\n')) {
    const line = raw.trim();
    const m = line.match(pattern);
    if (!m) continue;
    let ms = 0;
    if (m[3]) ms = m[3].length === 3 ? parseInt(m[3], 10) / 1000 : parseInt(m[3], 10) / 100;
    const time = Math.round((parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + ms) * 100) / 100;
    lines.push({ time, text: m[4].trim() || '• • •' });
  }
  return lines;
}

function parsePlainText(plain) {
  return plain
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t)
    .map((t) => ({ time: -1, text: t }));
}

// Angka waktu dari ytmusic-api bisa dalam detik ATAU milidetik tergantung
// versi paket yang terpasang — dideteksi dari besar angkanya (lagu jarang
// lebih dari ~2 jam = 7200 detik, jadi angka di atas itu pasti milidetik).
function toSeconds(n) {
  const num = Number(n);
  if (isNaN(num)) return null;
  return num > 7200 ? Math.round((num / 1000) * 100) / 100 : Math.round(num * 100) / 100;
}

// Dibuat toleran terhadap beberapa kemungkinan bentuk hasil getLyrics(),
// karena ini bergantung pada versi paket "ytmusic-api" yang terpasang &
// paket ini men-scrape struktur internal YouTube Music yang tidak resmi.
function normalizeYtmusicLyrics(raw) {
  if (!raw) return null;

  if (typeof raw === 'string') {
    const lines = parsePlainText(raw);
    return lines.length ? { type: 'plain', lines, source: 'ytmusic-api' } : null;
  }

  if (Array.isArray(raw)) {
    if (!raw.length) return null;
    if (typeof raw[0] === 'string') {
      return { type: 'plain', lines: parsePlainText(raw.join('\n')), source: 'ytmusic-api' };
    }
    const lines = raw
      .map((item) => {
        const t = toSeconds(item?.time ?? item?.startTime ?? item?.start ?? item?.timestamp ?? item?.cueRange?.startTimeMilliseconds);
        const text = (item?.text ?? item?.line ?? item?.lyric ?? '').toString().trim();
        return t !== null ? { time: t, text: text || '• • •' } : null;
      })
      .filter(Boolean);
    if (lines.length) return { type: 'synced', lines: lines.sort((a, b) => a.time - b.time), source: 'ytmusic-api' };
    return null;
  }

  if (typeof raw === 'object') {
    const inner = raw.lyrics ?? raw.data ?? raw;

    if (typeof inner === 'string') {
      const lines = parsePlainText(inner);
      return lines.length ? { type: 'plain', lines, source: 'ytmusic-api' } : null;
    }
    if (Array.isArray(inner)) {
      return normalizeYtmusicLyrics(inner);
    }
  }

  return null;
}

async function fetchFromYtmusicApi(videoId) {
  try {
    const ytmusic = await getYTMusic();
    if (typeof ytmusic.getLyrics !== 'function') return null;
    const raw = await ytmusic.getLyrics(videoId);
    return normalizeYtmusicLyrics(raw);
  } catch (err) {
    console.error('[ZaamMusic] ytmusic.getLyrics gagal:', err.message || err);
    return null;
  }
}

async function fetchTrackInfoFallback(videoId) {
  try {
    const ytmusic = await getYTMusic();
    const candidates = ['getSong', 'getSongInfo', 'getFullSong', 'song'];
    for (const method of candidates) {
      if (typeof ytmusic[method] === 'function') {
        const detail = await ytmusic[method](videoId).catch(() => null);
        if (detail) {
          const title = detail.name || detail.title || '';
          const artist = Array.isArray(detail.artists) && detail.artists[0]?.name
            ? detail.artists[0].name
            : (detail.artist?.name || '');
          if (title) return { title, artist };
        }
      }
    }
  } catch (err) { /* diabaikan, biarkan title/artist kosong */ }
  return { title: '', artist: '' };
}

// Memilih hasil terbaik dari sebuah array "result" (dipakai bareng untuk
// ikyyxd), diprioritaskan yang durasinya mendekati lagu asli, lalu yang
// punya syncedLyrics.
function pickBestLyricsResult(results, durationSeconds) {
  let candidates = results;
  if (durationSeconds && durationSeconds > 0) {
    const closeEnough = results.filter((r) => typeof r.duration === 'number' && Math.abs(r.duration - durationSeconds) <= 3);
    if (closeEnough.length) candidates = closeEnough;
  }
  return candidates.find((x) => x.syncedLyrics) || results.find((x) => x.syncedLyrics) || candidates[0];
}

// Sumber #2: api.ikyyxd.my.id/search/lyrics?apikey=...&query=...
// Apikey dibaca dari lib/lyrics-ikyyxd-apikeys.txt (bisa lebih dari satu
// baris/key cadangan). Kalau satu key gagal (limit/error), otomatis coba
// key berikutnya di file sebelum menyerah.
async function searchIkyyxd(title, artist, durationSeconds) {
  const keys = loadApiKeys('lyrics-ikyyxd-apikeys.txt');
  if (!keys.length) return null;

  const query = `${cleanTitle(title)} ${cleanArtist(artist)}`.trim();
  if (!query) return null;

  for (const apikey of keys) {
    try {
      const json = await httpsGetJson({
        hostname: 'api.ikyyxd.my.id',
        path: `/search/lyrics?apikey=${encodeURIComponent(apikey)}&query=${encodeURIComponent(query)}`,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0' },
        timeout: 15000
      });

      if (!json || json.status === false || !Array.isArray(json.result) || !json.result.length) {
        continue; // key ini tidak menghasilkan apa-apa, coba key berikutnya
      }

      const best = pickBestLyricsResult(json.result, durationSeconds);
      if (!best) continue;

      if (best.syncedLyrics) return { type: 'synced', lines: parseSyncedLrc(best.syncedLyrics), source: 'ikyyxd' };
      if (best.plainLyrics) return { type: 'plain', lines: parsePlainText(best.plainLyrics), source: 'ikyyxd' };
    } catch (err) {
      console.error(`[ZaamMusic] ikyyxd gagal dengan apikey "${apikey}":`, err.message || err);
      // lanjut coba key berikutnya
    }
  }
  return null;
}

async function searchLrclib(title, artist, durationSeconds) {
  const q = encodeURIComponent(`${cleanTitle(title)} ${cleanArtist(artist)}`.trim());
  const results = await httpsGetJson({
    hostname: 'lrclib.net',
    path: '/api/search?q=' + q,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0' },
    rejectUnauthorized: false,
    timeout: 15000
  });
  if (!Array.isArray(results) || !results.length) return null;

  const best = pickBestLyricsResult(results, durationSeconds);
  if (best.syncedLyrics) return { type: 'synced', lines: parseSyncedLrc(best.syncedLyrics), source: 'lrclib' };
  if (best.plainLyrics) return { type: 'plain', lines: parsePlainText(best.plainLyrics), source: 'lrclib' };
  return null;
}

// videoId boleh datang lewat path (/api/lyrics/<videoId>, sesuai contoh
// endpoint /api/ytmusic/lyrics/:videoId) ATAU lewat query string lama
// (?id=... / ?videoId=...) supaya kompatibel dengan pemanggilan sebelumnya.
function extractVideoIdFromPath(event) {
  const path = event?.path || '';
  const marker = '/lyrics/';
  const idx = path.indexOf(marker);
  if (idx === -1) return '';
  const segment = path.slice(idx + marker.length).split('/')[0];
  try { return decodeURIComponent(segment || '').trim(); } catch (e) { return (segment || '').trim(); }
}

exports.handler = async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const videoId = extractVideoIdFromPath(event) || (params.id || params.videoId || '').trim();
  let title = (params.title || '').trim();
  let artist = (params.artist || '').trim();
  const durationSeconds = Number(params.duration || params.d || 0) || 0;

  if (!videoId && !(title && artist)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, message: 'Wajib mengisi videoId (mis. /api/lyrics/GqWYJT-iMTw) atau title+artist' })
    };
  }

  try {
    let lyrics = null;

    // 1) Sumber utama: ytmusic-api, langsung dari metadataId lagu yang diputar
    if (videoId) {
      lyrics = await fetchFromYtmusicApi(videoId);
      if (!title) {
        const info = await fetchTrackInfoFallback(videoId);
        title = title || info.title;
        artist = artist || info.artist;
      }
    }

    // 2) Kalau sumber utama kosong/belum tersinkron, coba ikyyxd dulu
    if (!lyrics || lyrics.type !== 'synced') {
      if (title) {
        const fromIkyyxd = await searchIkyyxd(title, artist, durationSeconds).catch(() => null);
        if (fromIkyyxd && (fromIkyyxd.type === 'synced' || !lyrics)) {
          lyrics = fromIkyyxd;
        }
      }
    }

    // 3) Kalau masih kosong/belum tersinkron, coba lrclib sebagai cadangan terakhir
    if (!lyrics || lyrics.type !== 'synced') {
      if (title) {
        const fromLrclib = await searchLrclib(title, artist, durationSeconds).catch(() => null);
        if (fromLrclib && (fromLrclib.type === 'synced' || !lyrics)) {
          lyrics = fromLrclib;
        }
      }
    }

    if (!lyrics) lyrics = { type: 'none', lines: [] };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, videoId, title, artist, lyrics })
    };
  } catch (error) {
    console.error('[ZaamMusic] Error saat mengambil lirik:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, videoId, title, artist, lyrics: { type: 'none', lines: [] } })
    };
  }
};
