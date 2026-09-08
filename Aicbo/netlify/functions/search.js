const { getYTMusic, formatSongs } = require('./lib/ytmusic');

exports.handler = async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const query = event?.queryStringParameters?.q;

    if (!query) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: 'Parameter kueri "q" wajib diisi (contoh: /api/search?q=Baby)'
        })
      };
    }

    const ytmusic = await getYTMusic();
    const results = await ytmusic.searchSongs(query);

    if (!results || !Array.isArray(results) || results.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, message: 'Lagu tidak ditemukan', data: [] })
      };
    }

    const formattedData = formatSongs(results);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, totalResults: formattedData.length, data: formattedData })
    };
  } catch (error) {
    console.error('[ZaamMusic] Error saat pencarian lagu:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: 'Gagal mengambil data lagu', error: error.message })
    };
  }
};
