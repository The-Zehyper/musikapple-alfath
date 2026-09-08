/**
 * ZaamMusic Player
 * Dua sumber audio yang saling menyambung:
 *  1) IFRAME YOUTUBE TERSEMBUNYI (#hiddenPlayerHost) — dipakai untuk pratinjau
 *     INSTAN begitu lagu dipencet, supaya musik langsung bunyi walau API
 *     mp3 di server masih lemot/sedang mendownload. Hanya suaranya yang
 *     kedengaran; videonya disembunyikan total lewat CSS (1x1px, opacity 0).
 *  2) ELEMEN <audio> HTML5 ASLI — begitu file mp3 hasil konversi selesai
 *     didownload (lihat resolveTrackUrl di app.js), pemutaran langsung
 *     dialihkan ke sini. Audio asli ini yang dipakai untuk pemutaran
 *     seterusnya karena bisa terus berjalan di latar belakang / saat pindah
 *     aplikasi lain (iframe YouTube akan dijeda browser kalau di background).
 * Media Session API dipasang di elemen <audio> supaya notifikasi pemutar
 * musik di HP menampilkan judul, artis, DAN thumbnail lagu yang sedang
 * diputar, lengkap dengan tombol play/pause/next/prev di layar kunci.
 */
const ZaamPlayer = (() => {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.playsInline = true;

  const listeners = {
    stateChange: [],
    progress: [],
    ended: [],
    requestPrev: [],
    requestNext: [],
    error: []
  };

  function on(event, cb) {
    if (listeners[event]) listeners[event].push(cb);
  }

  function emit(event, payload) {
    (listeners[event] || []).forEach((cb) => cb(payload));
  }

  // 'preview' = sedang bunyi lewat iframe YouTube tersembunyi (instan, sementara)
  // 'audio'   = sedang bunyi lewat elemen <audio> asli (mp3 sudah siap)
  let activeSource = 'audio';

  // ---------------- AUDIO ASLI (mp3 hasil konversi) ----------------
  // 1 = playing, 2 = paused (menyamai konvensi YT.PlayerState lama supaya
  // kode app.js yang sudah ada tidak perlu diubah).
  audio.addEventListener('playing', () => {
    if (activeSource !== 'audio') return;
    emit('stateChange', 1);
    setMediaSessionState('playing');
  });
  audio.addEventListener('pause', () => {
    if (activeSource !== 'audio') return;
    emit('stateChange', 2);
    setMediaSessionState('paused');
  });
  audio.addEventListener('waiting', () => { if (activeSource === 'audio') setMediaSessionState('none'); });
  audio.addEventListener('timeupdate', () => {
    if (activeSource !== 'audio') return;
    emit('progress', { current: audio.currentTime || 0, duration: audio.duration || 0 });
  });
  audio.addEventListener('ended', () => { if (activeSource === 'audio') emit('ended'); });
  audio.addEventListener('error', () => { if (activeSource === 'audio') emit('error', audio.error); });

  // ---------------- PRATINJAU INSTAN (iframe YouTube tersembunyi, audio-only) ----------------
  let yt = null; // instance YT.Player
  let ytReady = false;
  let ytPendingVideoId = null;
  let previewProgressTimer = null;

  function ensureYouTubeApi() {
    if (window.YT && window.YT.Player) { setupYtPlayer(); return; }
    if (!document.getElementById('yt-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevReady === 'function') prevReady();
      setupYtPlayer();
    };
  }

  function setupYtPlayer() {
    if (yt) return;
    yt = new YT.Player('hiddenPlayerHost', {
      height: '1',
      width: '1',
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, modestbranding: 1, rel: 0 },
      events: {
        onReady: () => {
          ytReady = true;
          if (ytPendingVideoId) {
            const id = ytPendingVideoId;
            ytPendingVideoId = null;
            startPreview(id);
          }
        },
        onStateChange: onYtStateChange,
        onError: () => { if (activeSource === 'preview') emit('error', 'preview_error'); }
      }
    });
  }

  function onYtStateChange(e) {
    if (activeSource !== 'preview') return;
    // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    if (e.data === 1) {
      emit('stateChange', 1);
      setMediaSessionState('playing');
      startPreviewProgressLoop();
    } else if (e.data === 2) {
      emit('stateChange', 2);
      setMediaSessionState('paused');
    } else if (e.data === 0) {
      stopPreviewProgressLoop();
      emit('ended');
    }
  }

  function startPreviewProgressLoop() {
    clearInterval(previewProgressTimer);
    previewProgressTimer = setInterval(() => {
      if (activeSource !== 'preview' || !yt || !yt.getDuration) return;
      const duration = yt.getDuration() || 0;
      const current = yt.getCurrentTime() || 0;
      emit('progress', { current, duration });
    }, 500);
  }

  function stopPreviewProgressLoop() {
    clearInterval(previewProgressTimer);
    previewProgressTimer = null;
  }

  function startPreview(videoId) {
    activeSource = 'preview';
    try {
      yt.loadVideoById(videoId);
      yt.playVideo();
    } catch (_) { /* diabaikan, akan tetap tergantikan begitu mp3 siap */ }
  }

  // Mulai pratinjau instan (video disembunyikan, hanya suaranya) sambil
  // menunggu mp3 hasil konversi selesai didownload di background.
  function playPreview(videoId) {
    if (!videoId) return;
    audio.pause();
    stopPreviewProgressLoop(); // pastikan tidak ada sisa timer dari lagu sebelumnya yang masih jalan
    ensureYouTubeApi();
    if (yt && ytReady) {
      startPreview(videoId);
    } else {
      ytPendingVideoId = videoId;
    }
  }

  function stopPreview() {
    stopPreviewProgressLoop();
    if (yt && yt.pauseVideo) {
      try { yt.pauseVideo(); } catch (_) { /* no-op */ }
    }
    ytPendingVideoId = null;
  }

  // Dipanggil begitu mp3 hasil konversi sudah siap: pindahkan pemutaran dari
  // pratinjau YouTube ke audio asli, supaya bisa lanjut di latar belakang.
  function playUrl(url) {
    if (!url) return;
    stopPreview();
    activeSource = 'audio';
    if (audio.src !== url) {
      audio.src = url;
      audio.currentTime = 0;
    }
    const p = audio.play();
    if (p && p.catch) p.catch(() => { /* diabaikan: browser kadang menahan autoplay */ });
  }

  function togglePlay() {
    if (activeSource === 'preview') {
      if (!yt || !yt.getPlayerState) return;
      if (yt.getPlayerState() === 1) yt.pauseVideo(); else yt.playVideo();
      return;
    }
    if (!audio.src) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  function pause() {
    if (activeSource === 'preview') { if (yt && yt.pauseVideo) yt.pauseVideo(); return; }
    audio.pause();
  }
  function resume() {
    if (activeSource === 'preview') { if (yt && yt.playVideo) yt.playVideo(); return; }
    if (audio.src) audio.play().catch(() => {});
  }
  function isPlaying() {
    if (activeSource === 'preview') return !!(yt && yt.getPlayerState && yt.getPlayerState() === 1);
    return !!audio.src && !audio.paused;
  }
  function seekTo(seconds) {
    if (activeSource === 'preview') { if (yt && yt.seekTo) yt.seekTo(seconds, true); return; }
    if (audio.src) audio.currentTime = seconds;
  }
  function getDuration() {
    if (activeSource === 'preview') return (yt && yt.getDuration && yt.getDuration()) || 0;
    return audio.duration || 0;
  }
  function getCurrentTime() {
    if (activeSource === 'preview') return (yt && yt.getCurrentTime && yt.getCurrentTime()) || 0;
    return audio.currentTime || 0;
  }

  // ---------------- MEDIA SESSION (notifikasi/lockscreen pakai thumbnail lagu) ----------------
  function setMediaSessionMetadata({ title, artist, artwork } = {}) {
    if (!('mediaSession' in navigator)) return;
    const art = artwork
      ? [96, 192, 256, 384, 512].map((size) => ({ src: artwork, sizes: `${size}x${size}`, type: 'image/jpeg' }))
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'ZaamMusic',
      artist: artist || 'ZaamMusic',
      album: 'ZaamMusic',
      artwork: art
    });
  }

  function setMediaSessionState(state) {
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = state; } catch (_) { /* no-op */ }
    }
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => resume());
    navigator.mediaSession.setActionHandler('pause', () => pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => emit('requestPrev'));
    navigator.mediaSession.setActionHandler('nexttrack', () => emit('requestNext'));
    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details && typeof details.seekTime === 'number') seekTo(details.seekTime);
      });
    } catch (_) { /* tidak semua browser dukung seekto */ }
  }

  return {
    on, playUrl, playPreview, togglePlay, pause, resume, isPlaying, seekTo,
    getDuration, getCurrentTime, setMediaSessionMetadata
  };
})();
