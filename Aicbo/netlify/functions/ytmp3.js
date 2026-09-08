// Mengonversi video YouTube (lagu yang mau diputar) menjadi file mp3 asli,
// supaya bisa diputar lewat elemen <audio> HTML5 — ini yang bikin musik bisa
// tetap berjalan di latar belakang saat pindah aplikasi (browser hanya akan
// menjeda iframe YouTube di latar belakang, tapi TIDAK menjeda audio asli).
//
// Coba 2 sumber secara berurutan di sisi server (function ini):
//  1) Faa       - GET,  jadi sumber utama karena responnya jauh lebih cepat
//  2) PuruBoy   - POST, dipakai kalau Faa gagal/error
// Kalau function ini sendiri gagal total (network/deploy error), sisi client
// (app.js) akan mencoba lagi memanggil API PuruBoy LANGSUNG dari browser sebagai
// upaya terakhir.

const PRIMARY_ENDPOINT = 'https://api-faa.my.id/faa/ytmp3';
const FALLBACK_ENDPOINT = 'https://puruboy-api.vercel.app/api/downloader/ytmp3';
const FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryPrimary(youtubeUrl) {
  const res = await fetchWithTimeout(`${PRIMARY_ENDPOINT}?url=${encodeURIComponent(youtubeUrl)}`);
  if (!res.ok) throw new Error(`Faa status ${res.status}`);
  const json = await res.json();
  const url = json && json.result && json.result.mp3;
  if (!json || !json.status || !url) throw new Error('Faa tidak mengembalikan mp3');
  return {
    source: 'faa',
    url,
    title: json.result.title || null,
    thumbnail: json.result.thumbnail || null
  };
}

async function tryFallback(youtubeUrl) {
  const res = await fetchWithTimeout(FALLBACK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: youtubeUrl })
  });
  if (!res.ok) throw new Error(`PuruBoy status ${res.status}`);
  const json = await res.json();
  const url = json && json.result && json.result.downloadUrl;
  if (!json || !json.success || !url) throw new Error('PuruBoy tidak mengembalikan downloadUrl');
  return {
    source: 'puruboy',
    url,
    title: json.result.title || null,
    thumbnail: json.result.thumbnail || null
  };
}

exports.handler = async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  const videoId = event?.queryStringParameters?.videoId;
  const urlParam = event?.queryStringParameters?.url;

  if (!videoId && !urlParam) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'Wajib mengisi parameter "videoId" atau "url". Contoh: /api/ytmp3?videoId=dQw4w9WgXcQ'
      })
    };
  }

  const youtubeUrl = urlParam || `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const data = await tryPrimary(youtubeUrl);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...data }) };
  } catch (primaryErr) {
    console.error('[ZaamMusic] ytmp3 sumber utama (Faa) gagal:', primaryErr.message);
  }

  try {
    const data = await tryFallback(youtubeUrl);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...data }) };
  } catch (fallbackErr) {
    console.error('[ZaamMusic] ytmp3 sumber cadangan (PuruBoy) juga gagal:', fallbackErr.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'Kedua sumber konversi mp3 gagal di server. Klien akan mencoba sumber cadangan langsung dari browser.'
      })
    };
  }
};
