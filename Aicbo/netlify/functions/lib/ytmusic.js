const YTMusic = require('ytmusic-api');

const YTMusicClass = YTMusic.default || YTMusic;

// Singleton instance dijaga tetap hidup selama function "warm"
// (mengurangi initialize() berulang kali di setiap request)
let ytmusic = null;
let initPromise = null;

async function getYTMusic() {
  if (!ytmusic) {
    ytmusic = new YTMusicClass();
  }
  if (!initPromise) {
    initPromise = ytmusic.initialize().then(() => {
      console.log('[ZaamMusic] YTMusic API berhasil diinisialisasi.');
      return ytmusic;
    }).catch((err) => {
      // Reset supaya percobaan berikutnya bisa retry init dari awal
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
  return ytmusic;
}

function formatThumbnails(thumbnails) {
  const list = thumbnails || [];
  return list.map((thumb) => ({
    url: thumb?.url ? thumb.url.replace(/w\d+-h\d+/, 'w1080-h1080') : '',
    width: thumb?.width || 0,
    height: thumb?.height || 0
  }));
}

function formatSong(song) {
  const thumbnails = song?.thumbnails || [];
  const artists = song?.artists || [];
  const hdThumbnails = formatThumbnails(thumbnails);

  return {
    metadataId: song?.videoId || null,
    title: song?.name || 'Unknown Title',
    artists: artists.map((artist) => ({
      id: artist?.artistId || null,
      name: artist?.name || 'Unknown Artist'
    })),
    album: song?.album
      ? {
          id: song.album?.albumId || null,
          name: song.album?.name || null
        }
      : null,
    durationSeconds: song?.duration || 0,
    isExplicit: song?.isExplicit || false,
    thumbnailHd: hdThumbnails[hdThumbnails.length - 1]?.url || thumbnails[0]?.url || null,
    thumbnails: hdThumbnails,
    youtubeMusicUrl: song?.videoId ? `https://music.youtube.com/watch?v=${song.videoId}` : null
  };
}

function formatArtist(artist) {
  const thumbnails = artist?.thumbnails || [];
  const hdThumbnails = formatThumbnails(thumbnails);

  return {
    artistId: artist?.artistId || null,
    name: artist?.name || 'Unknown Artist',
    description: artist?.description || artist?.about || artist?.shortBioText || null,
    thumbnailHd: hdThumbnails[hdThumbnails.length - 1]?.url || thumbnails[0]?.url || null,
    thumbnails: hdThumbnails,
    youtubeMusicUrl: artist?.artistId ? `https://music.youtube.com/channel/${artist.artistId}` : null
  };
}

function formatSongs(songs) {
  if (!songs || !Array.isArray(songs)) return [];
  return songs.map(formatSong);
}

function formatArtists(artists) {
  if (!artists || !Array.isArray(artists)) return [];
  return artists.map(formatArtist);
}

// getArtist(id) mengembalikan bentuk objek "detail" yang sedikit berbeda dari
// hasil searchArtists(), jadi helper ini dibuat toleran terhadap beberapa
// kemungkinan nama field (artistId/channelId/id, name/title, thumbnails/thumbnail).
function formatArtistDetail(artist) {
  if (!artist) return null;
  const rawThumbs = artist.thumbnails || artist.thumbnail || [];
  const thumbnailsArr = Array.isArray(rawThumbs) ? rawThumbs : [rawThumbs];
  const hdThumbnails = formatThumbnails(thumbnailsArr);
  const artistId = artist.artistId || artist.channelId || artist.id || null;
  const description = artist.description || artist.about || artist.shortBioText || artist.bio || null;

  return {
    artistId,
    name: artist.name || artist.title || 'Unknown Artist',
    description,
    thumbnailHd: hdThumbnails[hdThumbnails.length - 1]?.url || thumbnailsArr[0]?.url || null,
    thumbnails: hdThumbnails,
    youtubeMusicUrl: artistId ? `https://music.youtube.com/channel/${artistId}` : null
  };
}

module.exports = {
  getYTMusic,
  formatSong,
  formatSongs,
  formatArtist,
  formatArtists,
  formatArtistDetail
};
