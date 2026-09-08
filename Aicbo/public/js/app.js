(() => {
  'use strict';

  const API = { home: '/api/home', search: '/api/search', artist: '/api/search-artist', ytmp3: '/api/ytmp3', lyrics: '/api/lyrics' };
  const LS_KEYS = {
    liked: 'zaam_liked_songs',
    playlists: 'zaam_playlists',
    recentArtists: 'zaam_recent_artists',
    playHistory: 'zaam_play_history',
    downloads: 'zaam_downloaded_songs',
    followedArtists: 'zaam_followed_artists'
  };

  const BROWSE_CATEGORIES = [
    { title: 'Dibuat Untuk Kamu', query: 'Hits Indonesia Populer', c1: '#6b4a2e', c2: '#17171a' },
    { title: 'Rilis Mendatang', query: 'Lagu Terbaru 2026', c1: '#1f5c52', c2: '#121316' },
    { title: 'Rilis Baru', query: 'New Music Friday', c1: '#4a5320', c2: '#17171a' },
    { title: 'Pop', query: 'Top Pop Hits', c1: '#8a4a2e', c2: '#1a1520' },
    { title: 'Indie', query: 'Indie Indonesia', c1: '#6b2340', c2: '#1a1015' },
    { title: 'Musik Indonesia', query: 'Musik Indonesia Terpopuler', c1: '#8a2020', c2: '#1c1520' },
    { title: 'K-pop', query: 'K-Pop Hits', c1: '#7a2b4a', c2: '#1c1520' },
    { title: 'Tangga Lagu Global', query: 'Top Global Songs', c1: '#4a3a6b', c2: '#17151f' },
    { title: 'Santai & Chill', query: 'Lagu Santai Chill', c1: '#2a4a4a', c2: '#121618' },
    { title: 'Mode Belajar', query: 'Lofi Belajar Fokus', c1: '#2e2e35', c2: '#0d0d0f' }
  ];

  const MAX_HISTORY = 50;

  // Saat tidak null, halaman Cari sedang dipakai untuk menambahkan lagu ke
  // playlist tertentu (bukan untuk memutar langsung).
  let addingToPlaylist = null;

  // ---------------- Storage helpers ----------------
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  };

  function isLiked(song) {
    const liked = store.get(LS_KEYS.liked, []);
    return liked.some((s) => s.metadataId === song.metadataId);
  }

  function toggleLiked(song) {
    let liked = store.get(LS_KEYS.liked, []);
    if (liked.some((s) => s.metadataId === song.metadataId)) {
      liked = liked.filter((s) => s.metadataId !== song.metadataId);
    } else {
      liked = [song, ...liked];
    }
    store.set(LS_KEYS.liked, liked);
    return liked.some((s) => s.metadataId === song.metadataId);
  }

  function pushRecentArtist(artist, thumbnail) {
    const name = artist && artist.name;
    if (!name || name === 'Unknown Artist') return;
    let recents = store.get(LS_KEYS.recentArtists, []);
    recents = recents.filter((a) => a.name !== name);
    recents.unshift({ id: (artist && artist.id) || null, name, thumbnail: thumbnail || '', playedAt: Date.now() });
    store.set(LS_KEYS.recentArtists, recents.slice(0, 30));
  }

  function matchesFollowedArtist(a, artist) {
    if (a.id && artist.id) return a.id === artist.id;
    return a.name === artist.name;
  }
  function isFollowingArtist(artist) {
    if (!artist || !artist.name) return false;
    const list = store.get(LS_KEYS.followedArtists, []);
    return list.some((a) => matchesFollowedArtist(a, artist));
  }
  function toggleFollowArtist(artist) {
    if (!artist || !artist.name) return false;
    let list = store.get(LS_KEYS.followedArtists, []);
    const exists = list.some((a) => matchesFollowedArtist(a, artist));
    if (exists) {
      list = list.filter((a) => !matchesFollowedArtist(a, artist));
    } else {
      list = [{ id: artist.id || null, name: artist.name, thumbnail: artist.thumbnail || '', followedAt: Date.now() }, ...list];
    }
    store.set(LS_KEYS.followedArtists, list);
    return !exists;
  }

  function pushPlayHistory(song) {
    if (!song || !song.metadataId) return;
    let history = store.get(LS_KEYS.playHistory, []);
    history = history.filter((s) => s.metadataId !== song.metadataId);
    history.unshift(song);
    store.set(LS_KEYS.playHistory, history.slice(0, MAX_HISTORY));
  }

  function fmtDuration(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function artistNames(song) {
    const names = (song.artists || [])
      .map((a) => a.name)
      .filter((n) => n && n !== 'Unknown Artist');
    return names.join(', ');
  }

  // Sama seperti artistNames(), tapi memberi fallback nama brand ketika artis
  // memang tidak diketahui, dipakai di tempat yang butuh teks (mini player, now playing, share).
  function displayArtist(song) {
    return artistNames(song) || 'ZaamMusic';
  }

  // ---------------- Toast ----------------
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // ---------------- Navigation ----------------
  const views = document.querySelectorAll('.view');
  const menuItems = document.querySelectorAll('.menu-item');
  const topbar = document.getElementById('topbar');
  let viewStack = ['home'];

  function showView(name, { push = true } = {}) {
    views.forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    menuItems.forEach((n) => n.classList.toggle('active', n.dataset.view === name));
    topbar.style.display = (name === 'artist' || name === 'about' || name === 'collection' || name === 'lyrics') ? 'none' : 'flex';
    if (name !== 'lyrics') stopLyricsSync();
    if (push) viewStack.push(name);
    if (name !== 'search' && addingToPlaylist) {
      addingToPlaylist = null;
      const banner = document.getElementById('addModeBanner');
      if (banner) banner.hidden = true;
    }
    window.scrollTo({ top: 0 });
  }

  document.getElementById('goSearchBtn').addEventListener('click', () => showView('search'));
  document.getElementById('goAboutBtn').addEventListener('click', () => showView('about'));
  document.getElementById('brandHome').addEventListener('click', () => showView('home', { push: false }));
  function goBack() {
    viewStack.pop();
    const prev = viewStack[viewStack.length - 1] || 'home';
    showView(prev, { push: false });
  }
  document.addEventListener('contextmenu', (e) => {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  });

  document.querySelectorAll('[data-back="true"]').forEach((btn) => {
    btn.addEventListener('click', goBack);
  });

  // ---------------- ASSISTIVETOUCH FLOATING DASHBOARD ----------------
  // Tombol bulat mengambang (mirip AssistiveTouch iOS): bisa digeser bebas
  // ke mana saja di layar, dan saat diketuk (bukan digeser) membuka menu
  // pop-up 4-arah untuk pindah Home / Cari / Koleksi / Tentang. Tombol bulat
  // itu sendiri disembunyikan selama menu terbuka, dan muncul kembali begitu
  // menu ditutup ataupun sebuah tujuan dipilih.
  (function setupAssistiveTouch() {
    const touchBtn = document.getElementById('touchButton');
    const touchOverlay = document.getElementById('touchOverlay');
    const appEl = document.getElementById('app');
    if (!touchBtn || !touchOverlay || !appEl) return;

    let isDragging = false;
    let hasDragged = false;
    let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

    function clampToApp(x, y) {
      const rect = appEl.getBoundingClientRect();
      const w = touchBtn.offsetWidth;
      const h = touchBtn.offsetHeight;
      const minX = rect.left;
      const maxX = rect.right - w;
      const minY = 8;
      const maxY = window.innerHeight - h - 8;
      return {
        x: Math.max(minX, Math.min(x, maxX)),
        y: Math.max(minY, Math.min(y, maxY))
      };
    }

    function startDrag(e) {
      isDragging = true;
      hasDragged = false;
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX;
      startY = p.clientY;
      const rect = touchBtn.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
    }

    function doDrag(e) {
      if (!isDragging) return;
      const p = e.touches ? e.touches[0] : e;
      const deltaX = p.clientX - startX;
      const deltaY = p.clientY - startY;
      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) hasDragged = true;
      if (!hasDragged) return;
      if (e.touches) e.preventDefault();
      const pos = clampToApp(initialLeft + deltaX, initialTop + deltaY);
      touchBtn.style.left = `${pos.x}px`;
      touchBtn.style.top = `${pos.y}px`;
      touchBtn.style.right = 'auto';
      touchBtn.style.bottom = 'auto';
    }

    function stopDrag() { isDragging = false; }

    touchBtn.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', stopDrag);
    touchBtn.addEventListener('touchstart', startDrag, { passive: true });
    window.addEventListener('touchmove', doDrag, { passive: false });
    window.addEventListener('touchend', stopDrag);

    function openTouchMenu() {
      touchOverlay.classList.add('active');
      touchBtn.classList.add('hidden');
    }
    function closeTouchMenu() {
      touchOverlay.classList.remove('active');
      touchBtn.classList.remove('hidden');
    }

    touchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!hasDragged) openTouchMenu();
    });

    // Ketuk di luar item menu (area gelap sekitar lingkaran menu) -> tutup.
    touchOverlay.addEventListener('click', (e) => {
      if (e.target === touchOverlay) closeTouchMenu();
    });

    menuItems.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTouchMenu();
        const name = btn.dataset.view;
        viewStack = [name];
        showView(name, { push: false });
      });
    });
  })();

  // ---------------- HOME ----------------
  async function buildForYouShelf() {
    const followed = store.get(LS_KEYS.followedArtists, []);
    if (!followed.length) return null;
    const picks = followed.slice(0, 6);
    const results = await Promise.all(picks.map(async (artist) => {
      try {
        const params = new URLSearchParams();
        if (artist.id) params.set('id', artist.id); else params.set('q', artist.name);
        const res = await fetch(`${API.artist}?${params.toString()}`);
        const json = await res.json();
        return (json.topSongs || []).slice(0, 4);
      } catch {
        return [];
      }
    }));
    const seen = new Set();
    const items = [];
    results.flat().forEach((song) => {
      if (!song || !song.metadataId || seen.has(song.metadataId)) return;
      seen.add(song.metadataId);
      items.push(song);
    });
    if (!items.length) return null;
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return { title: 'Untuk Kamu', items: items.slice(0, 20) };
  }

  let baseHomeShelves = null;

  async function loadHome() {
    const homeContent = document.getElementById('homeContent');
    try {
      const res = await fetch(API.home);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Gagal memuat Home');
      baseHomeShelves = [...(json.data.shelves || [])];
      const forYou = await buildForYouShelf();
      renderHome({ shelves: forYou ? [forYou, ...baseHomeShelves] : baseHomeShelves });
    } catch (err) {
      homeContent.innerHTML = `<div class="empty-state"><p>Gagal memuat dashboard: ${err.message}</p></div>`;
    }
  }

  // Dipanggil setiap kali ikut/berhenti ikuti artis, supaya shelf "Untuk Kamu"
  // di Home langsung berubah tanpa perlu reload halaman.
  async function refreshForYouShelf() {
    if (baseHomeShelves === null) return; // Home belum pernah dimuat, biarkan loadHome() awal yang urus
    const forYou = await buildForYouShelf();
    renderHome({ shelves: forYou ? [forYou, ...baseHomeShelves] : baseHomeShelves });
  }

  function renderHome(data) {
    const homeContent = document.getElementById('homeContent');
    homeContent.innerHTML = '';
    (data.shelves || []).forEach((shelf) => {
      if (!shelf.items || !shelf.items.length) return;
      const section = document.createElement('div');
      section.className = 'shelf';
      section.innerHTML = `
        <div class="shelf-head"><h2>${shelf.title}</h2></div>
        <div class="shelf-row"></div>
      `;
      const row = section.querySelector('.shelf-row');
      shelf.items.forEach((song) => row.appendChild(buildTrackCard(song, shelf.items)));
      homeContent.appendChild(section);
    });
    if (!homeContent.children.length) {
      homeContent.innerHTML = '<div class="empty-state"><p>Belum ada rekomendasi saat ini.</p></div>';
    }
  }

  function buildTrackCard(song, list) {
    const card = document.createElement('div');
    card.className = 'track-card';
    card.innerHTML = `
      <div class="cover-wrap">
        <img src="${song.thumbnailHd || ''}" alt="${song.title}" loading="lazy" onerror="this.style.opacity=0" />
        <div class="play-overlay">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="#14110a"><circle cx="12" cy="12" r="12" fill="#c9a24a"/><path d="M9.5 8l7 4-7 4V8z" fill="#14110a"/></svg>
        </div>
      </div>
      <div class="t-title">${song.title}</div>
      <div class="t-artist">${displayArtist(song)}</div>
    `;
    card.addEventListener('click', () => playSong(song, list));
    return card;
  }

  document.querySelectorAll('#homePills .pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#homePills .pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  // ---------------- SEARCH ----------------
  const searchInput = document.getElementById('searchInput');
  const searchBrowse = document.getElementById('searchBrowse');
  const searchResults = document.getElementById('searchResults');
  const searchTabs = document.getElementById('searchTabs');
  let searchMode = 'all';
  let lastSongResults = [];

  function renderBrowseGrid() {
    searchBrowse.innerHTML = '';
    BROWSE_CATEGORIES.forEach((cat) => {
      const card = document.createElement('div');
      card.className = 'quick-card';
      card.style.setProperty('--c1', cat.c1);
      card.style.setProperty('--c2', cat.c2);
      card.innerHTML = `<span>${cat.title}</span>`;
      card.addEventListener('click', () => {
        searchInput.value = cat.title;
        runSearch(cat.query);
      });
      searchBrowse.appendChild(card);
    });
  }
  renderBrowseGrid();

  const searchGoBtn = document.getElementById('searchGoBtn');
  searchGoBtn.style.cursor = 'pointer';

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    if (!q) {
      searchBrowse.style.display = 'grid';
      searchResults.innerHTML = '';
      searchTabs.hidden = true;
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = searchInput.value.trim();
    if (q) runSearch(q);
    searchInput.blur();
  });

  searchGoBtn.addEventListener('click', () => {
    const q = searchInput.value.trim();
    if (q) runSearch(q);
    searchInput.blur();
  });

  searchTabs.querySelectorAll('.pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      searchTabs.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      searchMode = pill.dataset.mode;
      const q = searchInput.value.trim();
      if (q) runSearch(q);
    });
  });

  async function runSearch(query) {
    searchBrowse.style.display = 'none';
    searchTabs.hidden = false;
    searchResults.innerHTML = '<div class="empty-state"><p>Mencari...</p></div>';
    try {
      if (searchMode === 'all') {
        // "Semua" -> gabungkan hasil lagu + artis dalam satu tampilan
        const [songsJson, artistsJson] = await Promise.all([
          fetch(`${API.search}?q=${encodeURIComponent(query)}`).then((r) => r.json()).catch(() => ({ data: [] })),
          fetch(`${API.artist}?q=${encodeURIComponent(query)}`).then((r) => r.json()).catch(() => ({ data: [] }))
        ]);
        renderCombinedResults(songsJson.data || [], artistsJson.data || []);
      } else if (searchMode === 'songs') {
        const res = await fetch(`${API.search}?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        renderSongResults(json.data || []);
      } else {
        const res = await fetch(`${API.artist}?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        renderArtistResults(json.data || []);
      }
    } catch (err) {
      searchResults.innerHTML = `<div class="empty-state"><p>Terjadi kesalahan: ${err.message}</p></div>`;
    }
  }

  function buildSongRow(song, songs) {
    const row = document.createElement('div');
    row.className = 'result-row';
    const subParts = [];
    const artistLabel = artistNames(song);
    if (artistLabel) subParts.push(artistLabel);
    if (song.durationSeconds) subParts.push(fmtDuration(song.durationSeconds));
    row.innerHTML = `
      <img class="cover" src="${song.thumbnailHd || ''}" alt="" onerror="this.style.opacity=0" />
      <div class="result-meta">
        <div class="result-title">${song.title}</div>
        ${subParts.length ? `<div class="result-sub">${subParts.join(' · ')}</div>` : ''}
      </div>
    `;
    row.addEventListener('click', () => {
      if (addingToPlaylist) {
        addSongToActivePlaylist(song);
      } else {
        playSong(song, songs);
      }
    });
    return row;
  }

  function buildArtistRow(artist) {
    const row = document.createElement('div');
    row.className = 'result-row artist-row';
    row.innerHTML = `
      <img class="cover" src="${artist.thumbnailHd || ''}" alt="" onerror="this.style.opacity=0" />
      <div class="result-meta">
        <div class="result-title">${artist.name}</div>
        <div class="result-sub">Artis</div>
      </div>
    `;
    row.addEventListener('click', () => openArtist({ id: artist.artistId, name: artist.name, thumbnail: artist.thumbnailHd }));
    return row;
  }

  function renderSongResults(songs) {
    lastSongResults = songs;
    if (!songs.length) {
      searchResults.innerHTML = '<div class="empty-state"><p>Lagu tidak ditemukan.</p></div>';
      return;
    }
    searchResults.innerHTML = '';
    songs.forEach((song) => searchResults.appendChild(buildSongRow(song, songs)));
  }

  function renderArtistResults(artists) {
    if (!artists.length) {
      searchResults.innerHTML = '<div class="empty-state"><p>Artis tidak ditemukan.</p></div>';
      return;
    }
    searchResults.innerHTML = '';
    artists.forEach((artist) => searchResults.appendChild(buildArtistRow(artist)));
  }

  function renderCombinedResults(songs, artists) {
    lastSongResults = songs;
    if (!songs.length && !artists.length) {
      searchResults.innerHTML = '<div class="empty-state"><p>Tidak ada hasil ditemukan.</p></div>';
      return;
    }
    searchResults.innerHTML = '';
    if (artists.length) {
      const head = document.createElement('div');
      head.className = 'shelf-head';
      head.innerHTML = '<h2>Artis</h2>';
      searchResults.appendChild(head);
      artists.slice(0, 5).forEach((artist) => searchResults.appendChild(buildArtistRow(artist)));
    }
    if (songs.length) {
      const head = document.createElement('div');
      head.className = 'shelf-head';
      head.innerHTML = '<h2>Lagu</h2>';
      searchResults.appendChild(head);
      songs.forEach((song) => searchResults.appendChild(buildSongRow(song, songs)));
    }
  }

  // ---------------- ADD SONG TO PLAYLIST (lewat halaman Cari) ----------------
  const addModeBanner = document.getElementById('addModeBanner');
  const addModeText = document.getElementById('addModeText');
  const addModeDoneBtn = document.getElementById('addModeDoneBtn');

  function enterAddSongMode(target) {
    if (!target) return;
    const type = target.type || 'playlist';
    if (type === 'playlist' && !target.id) return;
    addingToPlaylist = type === 'downloads'
      ? { type: 'downloads', name: target.name }
      : { type: 'playlist', id: target.id, name: target.name };
    showView('search');
    addModeText.textContent = type === 'downloads'
      ? `Menambahkan ke "${target.name}" — cari lagu untuk diunduh`
      : `Menambahkan ke "${target.name}" — cari lagunya`;
    addModeBanner.hidden = false;
    searchTabs.hidden = true;
    searchMode = 'songs';
    searchInput.value = '';
    searchBrowse.style.display = 'grid';
    searchResults.innerHTML = '';
    searchInput.focus();
  }

  function exitAddSongMode(returnToTarget) {
    const target = addingToPlaylist;
    addingToPlaylist = null;
    addModeBanner.hidden = true;
    searchMode = 'all';
    searchTabs.querySelectorAll('.pill').forEach((p) => p.classList.toggle('active', p.dataset.mode === 'all'));
    if (!returnToTarget || !target) return;
    if (target.type === 'downloads') {
      openDownloads();
    } else {
      const fresh = store.get(LS_KEYS.playlists, []).find((p) => p.id === target.id);
      if (fresh) openPlaylist(fresh);
    }
  }

  function addSongToActivePlaylist(song) {
    if (!addingToPlaylist) return;
    if (addingToPlaylist.type === 'downloads') {
      if (isDownloaded(song)) { showToast('Lagu sudah ada di unduhan'); return; }
      downloadSong(song);
      return;
    }
    const playlists = store.get(LS_KEYS.playlists, []);
    const target = playlists.find((p) => p.id === addingToPlaylist.id);
    if (!target) { showToast('Playlist tidak ditemukan'); return; }
    const already = target.songs.some((s) => s.metadataId === song.metadataId);
    if (already) {
      showToast('Lagu sudah ada di playlist ini');
      return;
    }
    target.songs.unshift(song);
    store.set(LS_KEYS.playlists, playlists);
    if (libTab === 'playlist') renderLibrary();
    showToast(`Ditambahkan ke "${addingToPlaylist.name}"`);
  }

  addModeDoneBtn.addEventListener('click', () => exitAddSongMode(true));

  // ---------------- LIBRARY ----------------
  const libraryContent = document.getElementById('libraryContent');
  let libTab = 'playlist';

  document.querySelectorAll('#view-library .pill-row .pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#view-library .pill-row .pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      libTab = pill.dataset.lib;
      renderLibrary();
    });
  });

  document.getElementById('newPlaylistBtn').addEventListener('click', () => openPlaylistModal(null));

  function renderLibrary() {
    libraryContent.innerHTML = '';
    if (libTab === 'playlist') {
      const liked = store.get(LS_KEYS.liked, []);
      const playlists = store.get(LS_KEYS.playlists, []);

      const likedRow = document.createElement('div');
      likedRow.className = 'lib-row';
      likedRow.innerHTML = `
        <div class="cover is-heart"><svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M12 21s-7.5-4.6-10-9.3C.6 8.4 2 5 5.4 4.2 7.7 3.7 10 4.8 12 7c2-2.2 4.3-3.3 6.6-2.8C22 5 23.4 8.4 22 11.7 19.5 16.4 12 21 12 21z"/></svg></div>
        <div>
          <div class="lib-title">Lagu yang Disukai</div>
          <div class="lib-sub">Playlist · ${liked.length} lagu</div>
        </div>
      `;
      likedRow.addEventListener('click', () => openLikedSongs());
      libraryContent.appendChild(likedRow);

      const history = store.get(LS_KEYS.playHistory, []);
      const top50Row = document.createElement('div');
      top50Row.className = 'lib-row';
      top50Row.innerHTML = `
        <div class="cover is-heart" style="background:linear-gradient(135deg,#ffb020,#b0242f); font-weight:800; font-size:0.95rem; color:#fff;">50</div>
        <div>
          <div class="lib-title">50 Teratas</div>
          <div class="lib-sub">Riwayat Diputar · ${history.length} lagu</div>
        </div>
      `;
      top50Row.addEventListener('click', () => openTop50());
      libraryContent.appendChild(top50Row);

      const downloads = store.get(LS_KEYS.downloads, []);
      const downloadsRow = document.createElement('div');
      downloadsRow.className = 'lib-row';
      downloadsRow.innerHTML = `
        <div class="cover is-heart is-download">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 3v10.6l3.3-3.3 1.4 1.4L12 17l-4.7-5.3 1.4-1.4 3.3 3.3V3h0zM5 19h14v2H5v-2z"/></svg>
        </div>
        <div>
          <div class="lib-title">Diunduh</div>
          <div class="lib-sub">Musik offline · ${downloads.length} lagu</div>
        </div>
      `;
      downloadsRow.addEventListener('click', () => openDownloads());
      libraryContent.appendChild(downloadsRow);

      const importRow = document.createElement('div');
      importRow.className = 'lib-row is-import-link';
      importRow.innerHTML = `
        <div class="cover is-heart is-download">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M11 17h2v-3h3v-2h-3V9h-2v3H8v2h3v3zm1 5a10 10 0 1110-10 10 10 0 01-10 10z"/></svg>
        </div>
        <div>
          <div class="lib-title">Impor dari Link</div>
          <div class="lib-sub">Tempel link playlist/unduhan yang dibagikan orang lain</div>
        </div>
      `;
      importRow.addEventListener('click', () => importPlaylistFromLinkPrompt());
      libraryContent.appendChild(importRow);

      playlists.forEach((pl) => {
        const row = document.createElement('div');
        row.className = 'lib-row';
        const cover = pl.image || pl.songs[0]?.thumbnailHd || '';
        row.innerHTML = `
          <img class="cover" src="${cover}" alt="" onerror="this.style.opacity=0"/>
          <div>
            <div class="lib-title">${pl.name}</div>
            <div class="lib-sub">Playlist · ${pl.songs.length} lagu</div>
          </div>
          <div class="lib-row-actions">
            <button class="icon-btn lib-edit-btn" aria-label="Ubah playlist">
              <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>
            <button class="icon-btn lib-delete-btn" aria-label="Hapus playlist">
              <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2zM5 7h14"/></svg>
            </button>
          </div>
        `;
        row.addEventListener('click', (e) => {
          if (e.target.closest('.lib-row-actions')) return;
          openPlaylist(pl);
        });
        row.querySelector('.lib-edit-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          openPlaylistModal(pl);
        });
        row.querySelector('.lib-delete-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await customConfirm(`Hapus playlist "${pl.name}"?`, { title: 'Hapus Playlist', okText: 'Hapus' });
          if (ok) {
            const updated = store.get(LS_KEYS.playlists, []).filter((p) => p.id !== pl.id);
            store.set(LS_KEYS.playlists, updated);
            renderLibrary();
            showToast('Playlist dihapus');
          }
        });
        libraryContent.appendChild(row);
      });
    } else {
      const followed = store.get(LS_KEYS.followedArtists, []);
      const recents = store.get(LS_KEYS.recentArtists, []);
      const recentsOnly = recents.filter((r) => !followed.some((f) => matchesFollowedArtist(f, r)));

      if (!followed.length && !recentsOnly.length) {
        libraryContent.innerHTML = '<div class="empty-state"><p>Subscribe artis favoritmu dari halaman artis untuk melihatnya di sini.</p></div>';
        return;
      }

      if (followed.length) {
        const head = document.createElement('div');
        head.className = 'shelf-head';
        head.innerHTML = '<h2>Subscribe</h2>';
        libraryContent.appendChild(head);
        followed.forEach((artist) => {
          const row = document.createElement('div');
          row.className = 'lib-row is-artist';
          row.innerHTML = `
            <img class="cover" src="${artist.thumbnail || ''}" alt="" onerror="this.style.opacity=0"/>
            <div>
              <div class="lib-title">${artist.name}</div>
              <div class="lib-sub">Artis · Subscribe</div>
            </div>
            <div class="lib-row-actions">
              <button class="icon-btn lib-unfollow-btn" aria-label="Unsubscribe">
                <svg viewBox="0 0 24 24"><path d="M18.3 5.71L12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.29-6.3z"/></svg>
              </button>
            </div>
          `;
          row.addEventListener('click', (e) => {
            if (e.target.closest('.lib-row-actions')) return;
            openArtist({ id: artist.id, name: artist.name, thumbnail: artist.thumbnail });
          });
          row.querySelector('.lib-unfollow-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFollowArtist(artist);
            renderLibrary();
            showToast(`Berhenti mengikuti ${artist.name}`);
            refreshForYouShelf();
          });
          libraryContent.appendChild(row);
        });
      }

      if (recentsOnly.length) {
        const head = document.createElement('div');
        head.className = 'shelf-head';
        head.innerHTML = '<h2>Baru Diputar</h2>';
        libraryContent.appendChild(head);
        recentsOnly.forEach((artist) => {
          const row = document.createElement('div');
          row.className = 'lib-row is-artist';
          row.innerHTML = `
            <img class="cover" src="${artist.thumbnail || ''}" alt="" onerror="this.style.opacity=0"/>
            <div>
              <div class="lib-title">${artist.name}</div>
              <div class="lib-sub">Artis</div>
            </div>
          `;
          row.addEventListener('click', () => openArtist({ id: artist.id, name: artist.name, thumbnail: artist.thumbnail }));
          libraryContent.appendChild(row);
        });
      }
    }
  }

  function openLikedSongs() {
    const liked = store.get(LS_KEYS.liked, []);
    openCollection({
      title: 'Lagu yang Disukai',
      subtitle: `Playlist · ${liked.length} lagu`,
      image: liked[0]?.thumbnailHd || '',
      isHeart: true,
      songs: liked
    });
  }

  function openTop50() {
    const history = store.get(LS_KEYS.playHistory, []);
    openCollection({
      title: '50 Teratas',
      subtitle: `Riwayat Diputar · ${history.length} lagu`,
      image: history[0]?.thumbnailHd || '',
      songs: history
    });
    if (!history.length) {
      document.getElementById('collectionSongList').innerHTML =
        '<div class="empty-state"><p>Belum ada riwayat. Lagu yang kamu putar akan muncul di sini (maks. 50 lagu terakhir).</p></div>';
    }
  }

  function openDownloads() {
    const downloads = store.get(LS_KEYS.downloads, []);
    openCollection({
      title: 'Diunduh',
      subtitle: `Musik offline · ${downloads.length} lagu`,
      image: downloads[0]?.thumbnailHd || '',
      songs: downloads,
      isDownloads: true
    });
    if (!downloads.length) {
      document.getElementById('collectionSongList').innerHTML =
        '<div class="empty-state"><p>Belum ada lagu yang diunduh. Tekan ikon unduh di layar sedang diputar untuk menyimpannya offline.</p></div>';
    }
  }

  function openPlaylist(pl) {
    openCollection({
      title: pl.name,
      subtitle: `Playlist · ${pl.songs.length} lagu`,
      image: pl.image || pl.songs[0]?.thumbnailHd || '',
      songs: pl.songs,
      playlistId: pl.id,
      canAddSongs: true
    });
  }

  // ---------------- COLLECTION (generic: liked / top50 / playlist) ----------------
  const collectionContent = document.getElementById('collectionContent');
  let currentCollectionPlaylistId = null;

  function openCollection({ title, subtitle, image, isHeart, songs, loading, playlistId, canAddSongs, isDownloads }) {
    showView('collection');
    currentCollectionPlaylistId = playlistId || null;
    const showAddBtn = canAddSongs || isDownloads;
    collectionContent.innerHTML = `
      <div class="artist-hero" id="collectionHero">
        ${isHeart
          ? `<div class="cover is-heart" style="width:140px;height:140px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:14px;"><svg viewBox="0 0 24 24" width="56" height="56" fill="#fff"><path d="M12 21s-7.5-4.6-10-9.3C.6 8.4 2 5 5.4 4.2 7.7 3.7 10 4.8 12 7c2-2.2 4.3-3.3 6.6-2.8C22 5 23.4 8.4 22 11.7 19.5 16.4 12 21 12 21z"/></svg></div>`
          : `<img src="${image || ''}" alt="${title}" onerror="this.style.opacity=0"/>`}
        <h1 id="collectionTitle">${title}</h1>
        <div class="verified" id="collectionSubtitle">${subtitle || ''}</div>
      </div>
      <div class="collection-actions" id="collectionActions">
        <button class="coll-play-btn" id="collPlayBtn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          Putar
        </button>
        ${showAddBtn ? `
        <button class="coll-add-btn" id="collAddSongBtn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>
          Tambah Lagu
        </button>` : ''}
        ${(playlistId || isDownloads) ? `
        <button class="coll-add-btn" id="collShareBtn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.1c-.76 0-1.44.3-1.96.77L8.9 12.7a2.3 2.3 0 000-1.4l7.05-4.11c.54.5 1.24.81 2.05.81a3 3 0 10-3-3c0 .24.03.48.09.7L7.95 9.8A3 3 0 103 12a3 3 0 003 3c0-.01 0-.01 0 0l7.09 4.15c-.03.2-.06.4-.06.6a3 3 0 103-3.65z"/></svg>
          Bagikan
        </button>` : ''}
      </div>
      <div id="collectionSongList"></div>
    `;
    if (loading) {
      document.getElementById('collectionSongList').innerHTML = '<div class="empty-state"><p>Memuat...</p></div>';
      return;
    }
    renderCollectionSongs(songs || []);

    document.getElementById('collPlayBtn').addEventListener('click', () => {
      const list = songs || [];
      if (!list.length) { showToast('Koleksi ini masih kosong'); return; }
      playSong(list[0], list);
      openNowPlaying();
    });
    const addSongBtn = document.getElementById('collAddSongBtn');
    if (addSongBtn) {
      addSongBtn.addEventListener('click', () => {
        if (isDownloads) enterAddSongMode({ type: 'downloads', name: title });
        else enterAddSongMode({ id: playlistId, name: title });
      });
    }
    const shareBtn = document.getElementById('collShareBtn');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => sharePlaylistLink({ name: title, songs: songs || [] }, isDownloads));
    }
  }

  function updateCollectionHeader(title, subtitle, image) {
    const titleEl = document.getElementById('collectionTitle');
    const subEl = document.getElementById('collectionSubtitle');
    const hero = document.getElementById('collectionHero');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle;
    const img = hero && hero.querySelector('img');
    if (img && image) img.src = image;
  }

  function renderCollectionSongs(songs) {
    const list = document.getElementById('collectionSongList');
    if (!list) return;
    if (!songs.length) {
      list.innerHTML = '<div class="empty-state"><p>Belum ada lagu di sini.</p></div>';
      return;
    }
    list.innerHTML = '';
    songs.forEach((song) => {
      const row = document.createElement('div');
      row.className = 'result-row';
      const artistLabel = artistNames(song);
      row.innerHTML = `
        <img class="cover" src="${song.thumbnailHd || ''}" alt="" onerror="this.style.opacity=0"/>
        <div class="result-meta">
          <div class="result-title">${song.title}</div>
          ${artistLabel ? `<div class="result-sub">${artistLabel}</div>` : ''}
        </div>
        ${currentCollectionPlaylistId ? `
        <button class="icon-btn remove-from-pl-btn" aria-label="Hapus dari playlist">
          <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13a2 2 0 01-2 2H9a2 2 0 01-2-2L6 7zm3-3h6l1 2H8l1-2zM5 7V5h14v2H5z"/></svg>
        </button>` : ''}
      `;
      row.addEventListener('click', () => playSong(song, songs));
      const removeBtn = row.querySelector('.remove-from-pl-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeSongFromPlaylist(currentCollectionPlaylistId, song.metadataId);
        });
      }
      list.appendChild(row);
    });
  }

  function removeSongFromPlaylist(playlistId, metadataId) {
    if (!playlistId) return;
    const playlists = store.get(LS_KEYS.playlists, []);
    const target = playlists.find((p) => p.id === playlistId);
    if (!target) return;
    const idx = target.songs.findIndex((s) => s.metadataId === metadataId);
    if (idx < 0) return;
    target.songs.splice(idx, 1);
    store.set(LS_KEYS.playlists, playlists);
    showToast('Lagu dihapus dari playlist');
    if (libTab === 'playlist') renderLibrary();
    openPlaylist(target);
  }

  // ---------------- ARTIST ----------------
  const artistContent = document.getElementById('artistContent');

  async function openArtist({ id, name, thumbnail, videoId, albumId, title } = {}) {
    if (!id && !name && !videoId && !albumId) return;
    showView('artist');
    artistContent.innerHTML = '<div class="empty-state"><p>Memuat profil artis...</p></div>';
    try {
      const params = new URLSearchParams();
      if (id) params.set('id', id);
      if (name) params.set('q', name);
      if (videoId) params.set('videoId', videoId);
      if (albumId) params.set('albumId', albumId);
      if (title) params.set('title', title);
      const res = await fetch(`${API.artist}?${params.toString()}`);
      const json = await res.json();
      const artist = (json.data || [])[0];
      const topSongs = json.topSongs || [];
      renderArtist(artist || { name, thumbnailHd: thumbnail }, topSongs);
    } catch (err) {
      artistContent.innerHTML = `<div class="empty-state"><p>Gagal memuat artis: ${err.message}</p></div>`;
    }
  }

  function shareArtist(artist) {
    // Gambar artis TIDAK disertakan di link: saat link dibuka, halaman artis
    // selalu ambil ulang data (termasuk foto) lewat API pakai id/nama, jadi
    // menyertakan URL gambar di sini cuma bikin link jauh lebih panjang.
    const shareText = `${artist.name} · Dengarkan di ZaamMusic`;
    const params = new URLSearchParams();
    params.set('artist', '1');
    if (artist.artistId) params.set('id', artist.artistId);
    else if (artist.name) params.set('q', artist.name);
    const url = `${location.origin}${location.pathname}?${params.toString()}`;
    if (navigator.share) {
      navigator.share({ title: 'ZaamMusic', text: shareText, url }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(url)
      .then(() => showToast('Tautan disalin ke clipboard'))
      .catch(() => showToast('Tidak bisa membagikan saat ini'));
  }

  function renderArtist(artist, topSongs) {
    const bioText = (artist.description || '').trim();
    const fallbackBio = `Profil ${artist.name} di ZaamMusic menghimpun lagu-lagu yang tersedia untuk diputar langsung dari sini. YouTube Music belum menyediakan biografi resmi untuk artis ini, jadi halaman ini berfokus menampilkan katalog lagunya. Ketuk salah satu lagu di bawah untuk mulai memutar.`;
    const bio = bioText || fallbackBio;
    artistContent.innerHTML = `
      <div class="artist-banner-wrap">
        <div class="artist-banner">
          <img class="artist-banner-img" src="${artist.thumbnailHd || ''}" alt="${artist.name}" onerror="this.style.opacity=0"/>
          <div class="artist-banner-scrim"></div>
          <div class="artist-banner-top">
            <button class="artist-banner-icon-btn" id="artistBackBtn" aria-label="Kembali">
              <svg viewBox="0 0 24 24"><path d="M15.5 4.5L8 12l7.5 7.5 1.4-1.4L10.8 12l6.1-6.1z"/></svg>
            </button>
            <button class="artist-banner-icon-btn" id="artistShareBtn" aria-label="Bagikan artis">
              <svg viewBox="0 0 24 24"><path d="M18 16.1c-.76 0-1.44.3-1.96.77L8.9 12.7a2.3 2.3 0 000-1.4l7.05-4.11c.54.5 1.24.81 2.05.81a3 3 0 10-3-3c0 .24.03.48.09.7L7.95 9.8A3 3 0 103 12a3 3 0 003 3c0-.01 0-.01 0 0l7.09 4.15c-.03.2-.06.4-.06.6a3 3 0 103-3.65z"/></svg>
            </button>
          </div>
          <div class="artist-banner-caption"><h1>${artist.name}</h1></div>
        </div>
        <div class="artist-fab-row">
          <button class="artist-fab-follow" id="artistFollowBtn" aria-label="Ikuti artis">
            <span class="artist-fab-follow-icon"></span>
          </button>
          <button class="artist-fab-add" id="artistAddBtn" aria-label="Tambah lagu ke playlist">
            <svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>
          </button>
          <button class="artist-fab-play" id="artistPlayBtn" aria-label="Putar">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
        </div>
      </div>
      <div class="artist-about">
        <div class="section-eyebrow">Tentang</div>
        <div class="artist-about-sub">Artis • ${artist.name}</div>
        <p class="artist-about-text clamped" id="artistBioText">${bio}</p>
        <button class="artist-about-toggle" id="artistBioToggle" hidden>Tampilkan lebih banyak</button>
      </div>
      <div class="shelf-head"><h2>Lagu Populer</h2></div>
      <div id="artistSongList"></div>
    `;

    document.getElementById('artistBackBtn').addEventListener('click', goBack);
    document.getElementById('artistShareBtn').addEventListener('click', () => shareArtist(artist));

    // Ikon dibuat jelas beda bentuk (bukan cuma warna) supaya status ikut/tidak
    // langsung kebaca: "+" orang buat Ikuti, centang buat Mengikuti.
    const ICON_FOLLOW = '<svg viewBox="0 0 24 24"><path d="M10 11a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-9 1.7-9 5v3h13.09A6 6 0 0114 15.28c-1.16-.32-2.62-.28-4-.28zM19 12v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z"/></svg>';
    const ICON_FOLLOWING = '<svg viewBox="0 0 24 24"><path d="M10 11a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-9 1.7-9 5v3h9.5a6 6 0 01-1.34-6.9c-2.68-.15-6.4.32-8.16 1.9zM17 12.5l-3.3 3.29-1.2-1.19-1.4 1.4 2.6 2.6L18.4 13.9z"/></svg>';
    const followBtn = document.getElementById('artistFollowBtn');
    const followIconEl = followBtn.querySelector('.artist-fab-follow-icon');
    const followTarget = { id: artist.artistId || null, name: artist.name, thumbnail: artist.thumbnailHd || '' };
    function syncFollowBtn() {
      const following = isFollowingArtist(followTarget);
      followBtn.classList.toggle('active', following);
      followIconEl.innerHTML = following ? ICON_FOLLOWING : ICON_FOLLOW;
      followBtn.setAttribute('aria-label', following ? 'Berhenti mengikuti artis' : 'Ikuti artis');
    }
    syncFollowBtn();
    followBtn.addEventListener('click', () => {
      const nowFollowing = toggleFollowArtist(followTarget);
      syncFollowBtn();
      showToast(nowFollowing ? `Mengikuti ${artist.name}` : `Berhenti mengikuti ${artist.name}`);
      if (libTab === 'artis') renderLibrary();
      refreshForYouShelf();
    });

    const bioEl = document.getElementById('artistBioText');
    const bioToggle = document.getElementById('artistBioToggle');
    requestAnimationFrame(() => {
      if (bioEl.scrollHeight - 2 > bioEl.clientHeight) bioToggle.hidden = false;
    });
    let bioExpanded = false;
    bioToggle.addEventListener('click', () => {
      bioExpanded = !bioExpanded;
      bioEl.classList.toggle('clamped', !bioExpanded);
      bioToggle.textContent = bioExpanded ? 'Tampilkan lebih sedikit' : 'Tampilkan lebih banyak';
    });

    document.getElementById('artistPlayBtn').addEventListener('click', () => {
      if (!topSongs.length) { showToast('Belum ada lagu untuk artis ini.'); return; }
      playSong(topSongs[0], topSongs);
      openNowPlaying();
    });
    document.getElementById('artistAddBtn').addEventListener('click', () => {
      if (!topSongs.length) { showToast('Belum ada lagu untuk artis ini.'); return; }
      openAddToPlaylist(topSongs);
    });

    const list = document.getElementById('artistSongList');
    if (!topSongs.length) {
      list.innerHTML = '<div class="empty-state"><p>Belum ada lagu untuk artis ini.</p></div>';
      return;
    }
    topSongs.forEach((song) => {
      const row = document.createElement('div');
      row.className = 'result-row';
      // Sudah berada di halaman artis ini, jadi baris "Unknown Artist" dihapus
      // total (tidak perlu ditampilkan lagi / tidak diganti nama lain).
      const artistLabel = artistNames(song);
      row.innerHTML = `
        <img class="cover" src="${song.thumbnailHd || ''}" alt="" onerror="this.style.opacity=0"/>
        <div class="result-meta">
          <div class="result-title">${song.title}</div>
          ${artistLabel ? `<div class="result-sub">${artistLabel}</div>` : ''}
        </div>
      `;
      row.addEventListener('click', () => playSong(song, topSongs));
      list.appendChild(row);
    });
  }

  // ---------------- QUEUE / PLAYBACK ----------------
  let currentSong = null;
  // true hanya di antara event 'playing' asli dan event 'pause'/'ended'/ganti
  // lagu berikutnya dari ZaamPlayer — dipakai untuk memastikan highlight
  // lirik tidak pernah maju sebelum audio benar-benar terdengar.
  let audioActuallyPlaying = false;
  let queue = [];
  let queueIndex = -1;
  let shuffleOn = false;
  let playToken = 0; // mencegah race-condition kalau user cepat ganti lagu saat masih loading
  const mp3UrlCache = new Map(); // metadataId -> mp3 url (biar tidak convert ulang tiap kali)

  // ---------------- KONVERSI KE MP3 (biar bisa diputar via <audio>, termasuk di latar belakang) ----------------
  async function resolveTrackUrl(song) {
    if (!song || !song.metadataId) return null;
    if (mp3UrlCache.has(song.metadataId)) return mp3UrlCache.get(song.metadataId);

    const youtubeUrl = song.youtubeMusicUrl || `https://www.youtube.com/watch?v=${song.metadataId}`;

    // 1) Coba lewat function backend kita (di dalamnya sudah coba 2 sumber: Faa dulu, lalu PuruBoy)
    try {
      const res = await fetch(`${API.ytmp3}?videoId=${encodeURIComponent(song.metadataId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.url) {
          mp3UrlCache.set(song.metadataId, json.url);
          return json.url;
        }
      }
    } catch (err) {
      console.warn('[ZaamMusic] Backend /api/ytmp3 gagal/tidak terjangkau, coba fallback langsung dari browser:', err);
    }

    // 2) Backend error total (bukan cuma respons gagal, tapi request-nya sendiri error)
    //    -> coba langsung dari browser ke API cadangan (PuruBoy), karena Faa sudah dicoba di backend.
    try {
      const res2 = await fetch('https://puruboy-api.vercel.app/api/downloader/ytmp3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl })
      });
      const json2 = await res2.json();
      const url2 = json2 && json2.result && json2.result.downloadUrl;
      if (json2 && json2.success && url2) {
        mp3UrlCache.set(song.metadataId, url2);
        return url2;
      }
    } catch (err2) {
      console.error('[ZaamMusic] Fallback ytmp3 langsung dari browser juga gagal:', err2);
    }

    return null;
  }

  // ---------------- UNDUH UNTUK OFFLINE ----------------
  // Lagu yang diunduh disimpan lewat Cache Storage API di bawah URL sintetis
  // same-origin (/__offline__/<id>.mp3). Service worker (sw.js) yang akan
  // menjawab request ke URL ini langsung dari cache — jadi pemutarannya tetap
  // jalan walau benar-benar offline (tanpa perlu baca ulang byte-nya lewat JS,
  // yang penting buat respons cross-origin yang "opaque").
  const OFFLINE_CACHE = 'zaam-offline-v1';
  function offlineUrlFor(metadataId) {
    return `/__offline__/${metadataId}.mp3`;
  }
  function getDownloads() {
    return store.get(LS_KEYS.downloads, []);
  }
  function isDownloaded(song) {
    if (!song || !song.metadataId) return false;
    return getDownloads().some((s) => s.metadataId === song.metadataId);
  }
  async function downloadSong(song) {
    if (!song || !song.metadataId) return false;
    if (isDownloaded(song)) return true;
    if (!('caches' in window)) {
      showToast('Browser ini tidak mendukung penyimpanan offline.');
      return false;
    }

    showToast(`Mengunduh "${song.title}"...`);
    const mp3Url = await resolveTrackUrl(song);
    if (!mp3Url) {
      showToast('Gagal mengunduh: sumber audio tidak ditemukan.');
      return false;
    }

    try {
      let response;
      try {
        response = await fetch(mp3Url);
        if (!response.ok) throw new Error(`status ${response.status}`);
      } catch (corsErr) {
        // Kalau server sumbernya tidak kirim header CORS, fetch normal akan gagal.
        // Coba mode 'no-cors': hasilnya "opaque" (tidak bisa dibaca isinya lewat JS),
        // tapi tetap bisa disimpan di cache & diputar lewat <audio> nanti.
        response = await fetch(mp3Url, { mode: 'no-cors' });
      }

      const cache = await caches.open(OFFLINE_CACHE);
      await cache.put(offlineUrlFor(song.metadataId), response);

      const downloads = getDownloads();
      downloads.unshift({ ...song, downloadedAt: Date.now() });
      store.set(LS_KEYS.downloads, downloads);

      showToast(`"${song.title}" siap diputar offline.`);
      if (libTab === 'playlist') renderLibrary();
      if (currentSong && currentSong.metadataId === song.metadataId) syncNowPlayingUI();
      return true;
    } catch (err) {
      console.error('[ZaamMusic] Gagal mengunduh lagu untuk offline:', err);
      showToast('Gagal mengunduh lagu. Coba lagi nanti.');
      return false;
    }
  }
  async function removeDownload(song) {
    if (!song || !song.metadataId) return;
    try {
      if ('caches' in window) {
        const cache = await caches.open(OFFLINE_CACHE);
        await cache.delete(offlineUrlFor(song.metadataId));
      }
    } catch (err) {
      console.error('[ZaamMusic] Gagal menghapus file offline:', err);
    }
    const downloads = getDownloads().filter((s) => s.metadataId !== song.metadataId);
    store.set(LS_KEYS.downloads, downloads);
    showToast('Lagu offline dihapus');
    if (libTab === 'playlist') renderLibrary();
    if (currentSong && currentSong.metadataId === song.metadataId) syncNowPlayingUI();
  }

  async function playSong(song, list) {
    if (!song || !song.metadataId) return;
    const myToken = ++playToken;

    // Lagu baru dipilih -> anggap belum ada audio yang benar-benar berbunyi
    // sampai kita menerima event 'playing' asli untuk lagu ini. Ini juga
    // langsung menghentikan highlight lirik lagu sebelumnya.
    audioActuallyPlaying = false;
    lyricsActiveIndex = -1;

    currentSong = song;
    queue = (list && list.length) ? list.slice() : [song];
    queueIndex = queue.findIndex((s) => s.metadataId === song.metadataId);
    if (queueIndex < 0) queueIndex = 0;

    miniPlayer.hidden = false;
    miniCover.src = song.thumbnailHd || '';
    miniTitle.textContent = song.title;
    const miniArtistLabel = artistNames(song);
    miniArtist.textContent = miniArtistLabel;
    miniArtist.hidden = !miniArtistLabel;
    miniLikeBtn.classList.toggle('active', isLiked(song));
    syncNowPlayingUI();
    const lyricsViewEl = document.getElementById('view-lyrics');
    if (lyricsViewEl && lyricsViewEl.classList.contains('active')) loadLyricsForCurrentSong();

    (song.artists || []).forEach((a) => pushRecentArtist(a, song.thumbnailHd));
    pushPlayHistory(song);
    if (libTab === 'artis' || libTab === 'playlist') renderLibrary();

    ZaamPlayer.setMediaSessionMetadata({
      title: song.title,
      artist: displayArtist(song),
      artwork: song.thumbnailHd
    });

    const cachedUrl = mp3UrlCache.get(song.metadataId);
    if (cachedUrl) {
      ZaamPlayer.playUrl(cachedUrl);
      return;
    }

    // Lagu ini sudah diunduh untuk offline -> putar langsung dari cache lokal,
    // tidak perlu tunggu konversi mp3 ke server (dan tetap jalan tanpa internet).
    if (isDownloaded(song)) {
      ZaamPlayer.playUrl(offlineUrlFor(song.metadataId));
      return;
    }

    // Putar pratinjau instan lewat iframe YouTube tersembunyi (video disembunyikan,
    // hanya suaranya) supaya musik langsung bunyi walau API mp3 masih lemot.
    ZaamPlayer.playPreview(song.metadataId);

    const url = await resolveTrackUrl(song);

    if (myToken !== playToken) return; // user sudah pindah ke lagu lain sebelum ini selesai

    if (!url) {
      showToast('Audio kualitas penuh gagal dimuat, tetap diputar dari pratinjau.');
      return;
    }

    // mp3 sudah siap didownload -> langsung beralih dari pratinjau ke audio asli.
    ZaamPlayer.playUrl(url);
  }

  function openCurrentSongArtist() {
    if (!currentSong) return;
    closeNowPlaying();
    const artists = currentSong.artists || [];
    // Hasil pencarian lagu (searchSongs) sering mengembalikan "artists": [] yang
    // benar-benar kosong (bukan cuma id-nya null) — jadi tidak bisa diandalkan
    // sendirian. Karena itu kita kirim SEMUA petunjuk yang kita punya ke backend:
    // albumId (paling terbukti akurat), videoId, dan judul lagu — backend akan
    // coba resolve id artis yang sebenarnya dari salah satunya.
    const withId = artists.find((a) => a && a.id);
    const withName = artists.find((a) => a && a.name && a.name !== 'Unknown Artist');
    openArtist({
      id: withId ? withId.id : null,
      name: withName ? withName.name : null,
      videoId: currentSong.metadataId,
      albumId: currentSong.album?.id || null,
      title: currentSong.title,
      thumbnail: currentSong.thumbnailHd
    });
  }

  function nextSong() {
    if (!queue.length) return;
    let idx;
    if (shuffleOn && queue.length > 1) {
      do { idx = Math.floor(Math.random() * queue.length); } while (idx === queueIndex);
    } else {
      idx = (queueIndex + 1) % queue.length;
    }
    playSong(queue[idx], queue);
  }

  function prevSong() {
    if (!queue.length) return;
    let idx;
    if (shuffleOn && queue.length > 1) {
      do { idx = Math.floor(Math.random() * queue.length); } while (idx === queueIndex);
    } else {
      idx = (queueIndex - 1 + queue.length) % queue.length;
    }
    playSong(queue[idx], queue);
  }

  // Tombol next/prev di notifikasi / layar kunci HP juga harus ganti lagu
  // (bukan cuma play/pause), makanya di-hubungkan ke antrian yang sama.
  ZaamPlayer.on('requestPrev', prevSong);
  ZaamPlayer.on('requestNext', nextSong);
  ZaamPlayer.on('error', () => {
    showToast('Terjadi masalah saat memutar audio.');
  });

  // ---------------- MINI PLAYER ----------------
  const miniPlayer = document.getElementById('miniPlayer');
  const miniCover = document.getElementById('miniCover');
  const miniTitle = document.getElementById('miniTitle');
  const miniArtist = document.getElementById('miniArtist');
  const miniPlayBtn = document.getElementById('miniPlayBtn');
  const miniPlayIcon = document.getElementById('miniPlayIcon');
  const miniLikeBtn = document.getElementById('miniLikeBtn');
  const miniProgressFill = document.getElementById('miniProgressFill');
  const miniMeta = document.getElementById('miniMeta');
  const miniCoverEl = document.getElementById('miniCover');

  const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
  const ICON_PAUSE = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';

  miniPlayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ZaamPlayer.togglePlay();
  });

  miniArtist.addEventListener('click', (e) => {
    e.stopPropagation();
    openCurrentSongArtist();
  });

  miniLikeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentSong) return;
    const liked = toggleLiked(currentSong);
    miniLikeBtn.classList.toggle('active', liked);
    npLikeBtn.classList.toggle('active', liked);
    if (libTab === 'playlist') renderLibrary();
  });

  // Klik di mana saja pada mini player membuka layar penuh dengan transisi halus.
  // Tombol play/like/nama-artis sudah stopPropagation supaya tidak ikut membuka layar penuh.
  miniPlayer.addEventListener('click', () => openNowPlaying());

  ZaamPlayer.on('stateChange', (state) => {
    // 1 = playing, 2 = paused
    const icon = state === 1 ? ICON_PAUSE : ICON_PLAY;
    miniPlayIcon.innerHTML = icon;
    npPlayIcon.innerHTML = icon;
    // Lirik hanya boleh mulai bergerak begitu ada sinyal ASLI bahwa audio
    // (pratinjau ATAU mp3 penuh) benar-benar sudah berbunyi — bukan cuma
    // karena playSong() dipanggil. Ini mencegah lirik "lari duluan" saat
    // musik masih loading/buffering.
    audioActuallyPlaying = state === 1;
  });

  let latestDuration = 0;
  let isSeekingNp = false;

  ZaamPlayer.on('progress', ({ current, duration }) => {
    if (!duration) return;
    latestDuration = duration;
    const pct = Math.min(100, (current / duration) * 100);
    miniProgressFill.style.width = `${pct}%`;
    if (!isSeekingNp) {
      npSeek.value = Math.round(pct * 10);
      npSeek.style.backgroundSize = `${pct}% 100%`;
      npCurTime.textContent = fmtDuration(current);
      npDurTime.textContent = fmtDuration(duration);
    }
  });

  ZaamPlayer.on('ended', () => {
    audioActuallyPlaying = false;
    miniProgressFill.style.width = '0%';
    nextSong();
  });

  // ---------------- NOW PLAYING (FULL SCREEN) ----------------
  const nowPlaying = document.getElementById('nowPlaying');
  const npBg = document.getElementById('npBg');
  const npCover = document.getElementById('npCover');
  const npTitle = document.getElementById('npTitle');
  const npArtist = document.getElementById('npArtist');
  const npSource = document.getElementById('npSource');
  const npLikeBtn = document.getElementById('npLikeBtn');
  const npDownloadBtn = document.getElementById('npDownloadBtn');
  const npPlayBtn = document.getElementById('npPlayBtn');
  const npPlayIcon = document.getElementById('npPlayIcon');
  const npSeek = document.getElementById('npSeek');
  const npCurTime = document.getElementById('npCurTime');
  const npDurTime = document.getElementById('npDurTime');
  const npShuffleBtn = document.getElementById('npShuffleBtn');
  const npPrevBtn = document.getElementById('npPrevBtn');
  const npNextBtn = document.getElementById('npNextBtn');
  const npTimerBtn = document.getElementById('npTimerBtn');
  const npArtistBtn = document.getElementById('npArtistBtn');
  const npAddBtn = document.getElementById('npAddBtn');
  const npShareBtn = document.getElementById('npShareBtn');
  const npCollapseBtn = document.getElementById('npCollapseBtn');
  const timerPopover = document.getElementById('timerPopover');

  function syncNowPlayingUI() {
    if (!currentSong) return;
    npCover.src = currentSong.thumbnailHd || '';
    npBg.style.backgroundImage = currentSong.thumbnailHd ? `url("${currentSong.thumbnailHd}")` : 'none';
    npTitle.textContent = currentSong.title;
    const npArtistLabel = artistNames(currentSong);
    npArtist.textContent = npArtistLabel;
    npArtist.hidden = !npArtistLabel;
    npLikeBtn.classList.toggle('active', isLiked(currentSong));
    npDownloadBtn.classList.toggle('active', isDownloaded(currentSong));
    npDownloadBtn.classList.remove('is-downloading');
    npSource.textContent = currentSong.title;
  }

  function openNowPlaying() {
    if (!currentSong) return;
    syncNowPlayingUI();
    nowPlaying.classList.add('open');
    nowPlaying.setAttribute('aria-hidden', 'false');
  }

  function closeNowPlaying() {
    nowPlaying.classList.remove('open');
    nowPlaying.setAttribute('aria-hidden', 'true');
    timerPopover.hidden = true;
  }

  npCollapseBtn.addEventListener('click', closeNowPlaying);

  npPlayBtn.addEventListener('click', () => ZaamPlayer.togglePlay());
  npPrevBtn.addEventListener('click', prevSong);
  npNextBtn.addEventListener('click', nextSong);

  npShuffleBtn.addEventListener('click', () => {
    shuffleOn = !shuffleOn;
    npShuffleBtn.classList.toggle('on', shuffleOn);
    showToast(shuffleOn ? 'Acak diaktifkan' : 'Acak dimatikan');
  });

  npLikeBtn.addEventListener('click', () => {
    if (!currentSong) return;
    const liked = toggleLiked(currentSong);
    npLikeBtn.classList.toggle('active', liked);
    miniLikeBtn.classList.toggle('active', liked);
    if (libTab === 'playlist') renderLibrary();
  });

  npDownloadBtn.addEventListener('click', async () => {
    if (!currentSong) return;
    if (isDownloaded(currentSong)) {
      const ok = await customConfirm(`Hapus "${currentSong.title}" dari unduhan offline?`, { title: 'Hapus Unduhan', okText: 'Hapus' });
      if (ok) {
        await removeDownload(currentSong);
        npDownloadBtn.classList.remove('active');
      }
      return;
    }
    npDownloadBtn.classList.add('is-downloading');
    const ok = await downloadSong(currentSong);
    npDownloadBtn.classList.remove('is-downloading');
    npDownloadBtn.classList.toggle('active', ok);
  });

  npArtist.addEventListener('click', openCurrentSongArtist);
  npArtistBtn.addEventListener('click', openCurrentSongArtist);

  // ---------------- LIRIK: sumber-sumber yang dipanggil LANGSUNG DARI BROWSER ----------------
  // Urutan: 1) Zaam (ytmusiczaam.netlify.app) selalu dicoba PERTAMA.
  //         2) Kalau Zaam error/kosong, baru dicoba ikyyxd (api.ikyyxd.my.id).
  //         3) Kalau dua-duanya gagal, baru turun ke endpoint backend lama
  //            (/api/lyrics) sebagai jaring pengaman terakhir.
  // Kedua API #1 dan #2 hanya mengembalikan teks lirik polos (tanpa timestamp
  // per baris), jadi waktunya DIPERKIRAKAN berdasarkan durasi lagu + panjang
  // tiap baris supaya scroll-nya tetap terasa mengikuti irama musik, bukan
  // sekadar teks statis. Ini perkiraan, bukan sinkron presisi kata-per-kata.
  const IKYYXD_APIKEY = 'kyzz'; // sama dengan netlify/functions/lib/lyrics-ikyyxd-apikeys.txt

  function estimateLineTimings(textLines, durationSeconds) {
    const lines = textLines.map((t) => (t || '').trim()).filter((t) => t);
    const total = lines.length;
    const duration = Number(durationSeconds) > 0 ? Number(durationSeconds) : 0;
    if (!duration || !total) return lines.map((text) => ({ time: -1, text }));

    // Sisakan sedikit ruang di awal (intro) & akhir (outro instrumental)
    // supaya baris pertama tidak langsung aktif di detik 0.
    const introBuffer = Math.min(4, duration * 0.05);
    const outroBuffer = Math.min(4, duration * 0.05);
    const usable = Math.max(duration - introBuffer - outroBuffer, total * 1.2);

    // Baris yang lebih panjang diberi porsi waktu lebih lama daripada baris pendek.
    const weights = lines.map((t) => Math.max(t.length, 8));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let t = introBuffer;
    return lines.map((text, i) => {
      const time = Math.round(t * 100) / 100;
      t += (weights[i] / totalWeight) * usable;
      return { time, text };
    });
  }

  async function fetchZaamLyricsClientSide(videoId, durationSeconds) {
    if (!videoId) return null;
    try {
      const res = await fetch(`https://ytmusiczaam.netlify.app/api/ytmusic/lyrics/${encodeURIComponent(videoId)}`);
      if (!res.ok) return null;
      const json = await res.json();
      if (!json || json.success !== true || !Array.isArray(json.data) || !json.data.length) return null;
      const lines = estimateLineTimings(json.data, durationSeconds);
      if (!lines.length) return null;
      return { type: 'synced', lines, estimated: true, source: 'zaam' };
    } catch (err) {
      return null; // biarkan lanjut ke sumber berikutnya (ikyyxd)
    }
  }

  function parseSyncedLrcClient(s) {
    const lines = [];
    const pattern = /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)/;
    for (const raw of (s || '').split('\n')) {
      const line = raw.trim();
      const m = line.match(pattern);
      if (!m) continue;
      let ms = 0;
      if (m[3]) ms = m[3].length === 3 ? parseInt(m[3], 10) / 1000 : parseInt(m[3], 10) / 100;
      const time = Math.round((parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + ms) * 100) / 100;
      lines.push({ time, text: (m[4] || '').trim() || '• • •' });
    }
    return lines;
  }

  async function fetchIkyyxdLyricsClientSide(title, artist, durationSeconds) {
    const query = `${title || ''} ${artist || ''}`.trim();
    if (!query) return null;
    try {
      const res = await fetch(`https://api.ikyyxd.my.id/search/lyrics?apikey=${encodeURIComponent(IKYYXD_APIKEY)}&query=${encodeURIComponent(query)}`);
      if (!res.ok) return null;
      const json = await res.json();
      if (!json || json.status === false || !Array.isArray(json.result) || !json.result.length) return null;

      let candidates = json.result;
      if (durationSeconds > 0) {
        const closeEnough = candidates.filter((r) => typeof r.duration === 'number' && Math.abs(r.duration - durationSeconds) <= 3);
        if (closeEnough.length) candidates = closeEnough;
      }
      const best = candidates.find((r) => r.syncedLyrics) || json.result.find((r) => r.syncedLyrics) || candidates[0];
      if (!best) return null;

      if (best.syncedLyrics) {
        const lines = parseSyncedLrcClient(best.syncedLyrics);
        if (lines.length) return { type: 'synced', lines, estimated: false, source: 'ikyyxd' };
      }
      if (best.plainLyrics) {
        const plainLines = estimateLineTimings(best.plainLyrics.split('\n'), durationSeconds);
        if (plainLines.length) return { type: 'synced', lines: plainLines, estimated: true, source: 'ikyyxd' };
      }
      return null;
    } catch (err) {
      return null; // biarkan lanjut ke fallback backend
    }
  }

  // ---------------- LIRIK (halaman tersendiri, tersinkron dengan lagu yang diputar) ----------------
  const npLyricsBtn = document.getElementById('npLyricsBtn');
  const lyricsCover = document.getElementById('lyricsCover');
  const lyricsTitle = document.getElementById('lyricsTitle');
  const lyricsArtist = document.getElementById('lyricsArtist');
  const lyricsBody = document.getElementById('lyricsBody');

  const lyricsCache = new Map(); // metadataId -> { type, lines, estimated }
  let lyricsToken = 0;
  let lyricsLines = [];
  let lyricsActiveIndex = -1;
  let lyricsSongId = null;

  // Geseran manual (detik) untuk lirik yang terasa kecepetan/kelambatan
  // dibanding musiknya. Direset tiap ganti lagu — lihat loadLyricsForCurrentSong.
  const lyricsOffsetEl = document.getElementById('lyricsOffset');
  const lyricsOffsetValueEl = document.getElementById('lyricsOffsetValue');
  const lyricsOffsetEarlierBtn = document.getElementById('lyricsOffsetEarlier');
  const lyricsOffsetLaterBtn = document.getElementById('lyricsOffsetLater');
  let lyricsOffset = 0;

  function renderLyricsOffsetLabel() {
    if (!lyricsOffsetValueEl) return;
    if (lyricsOffset === 0) { lyricsOffsetValueEl.textContent = 'Sinkron'; return; }
    const sign = lyricsOffset > 0 ? '+' : '';
    lyricsOffsetValueEl.textContent = `${sign}${lyricsOffset.toFixed(1)}d`;
  }

  function adjustLyricsOffset(delta) {
    lyricsOffset = Math.round((lyricsOffset + delta) * 10) / 10;
    renderLyricsOffsetLabel();
    lyricsActiveIndex = -2; // paksa highlight dihitung ulang di update progress berikutnya
  }

  if (lyricsOffsetEarlierBtn) lyricsOffsetEarlierBtn.addEventListener('click', () => adjustLyricsOffset(0.5));
  if (lyricsOffsetLaterBtn) lyricsOffsetLaterBtn.addEventListener('click', () => adjustLyricsOffset(-0.5));

  function stopLyricsSync() {
    lyricsActiveIndex = -1;
  }

  function renderLyricsLines(type, lines, estimated) {
    if (!lines.length) {
      lyricsBody.innerHTML = '<div class="empty-state"><p>Lirik tidak ditemukan untuk lagu ini.</p></div>';
      return;
    }
    const synced = type === 'synced';
    if (lyricsOffsetEl) lyricsOffsetEl.hidden = !synced;
    let note = '';
    if (!synced) note = '<div class="lyrics-unsynced-note">Lirik belum tersinkron waktu</div>';
    else if (estimated) note = '<div class="lyrics-unsynced-note">Sinkron mengikuti perkiraan tempo lagu</div>';
    lyricsBody.innerHTML = note + lines.map((l, i) => (
      `<div class="lyrics-line${synced ? ' synced' : ''}" data-index="${i}" data-time="${l.time}">${escapeHtml(l.text)}</div>`
    )).join('');

    if (synced) {
      lyricsBody.querySelectorAll('.lyrics-line.synced').forEach((el) => {
        el.addEventListener('click', () => {
          const t = parseFloat(el.dataset.time);
          if (!isNaN(t) && t >= 0) {
            ZaamPlayer.seekTo(t);
            if (!ZaamPlayer.isPlaying()) ZaamPlayer.togglePlay();
          }
        });
      });
    }
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function loadLyricsForCurrentSong() {
    if (!currentSong) return;
    lyricsCover.src = currentSong.thumbnailHd || '';
    lyricsTitle.textContent = currentSong.title;
    lyricsArtist.textContent = displayArtist(currentSong);
    lyricsSongId = currentSong.metadataId;
    lyricsActiveIndex = -1;
    lyricsOffset = 0;
    renderLyricsOffsetLabel();

    const cached = lyricsCache.get(currentSong.metadataId);
    if (cached) {
      lyricsLines = cached.lines;
      renderLyricsLines(cached.type, cached.lines, cached.estimated);
      return;
    }

    const myToken = ++lyricsToken;
    lyricsBody.innerHTML = '<div class="empty-state"><p>Memuat lirik...</p></div>';
    try {
      const videoId = currentSong.metadataId;
      const title = currentSong.title || '';
      const artist = displayArtist(currentSong) || '';
      const durationSeconds = currentSong.durationSeconds || latestDuration || 0;

      let type = 'none';
      let lines = [];
      let estimated = false;

      // 1) Zaam (dipanggil langsung dari browser) — selalu dicoba dulu
      const fromZaam = await fetchZaamLyricsClientSide(videoId, durationSeconds);
      if (fromZaam) {
        type = fromZaam.type; lines = fromZaam.lines; estimated = fromZaam.estimated;
      } else {
        // 2) Zaam error/kosong -> ikyyxd (juga langsung dari browser)
        const fromIkyyxd = await fetchIkyyxdLyricsClientSide(title, artist, durationSeconds);
        if (fromIkyyxd) {
          type = fromIkyyxd.type; lines = fromIkyyxd.lines; estimated = fromIkyyxd.estimated;
        } else {
          // 3) Dua-duanya gagal -> fallback terakhir ke backend lama
          // (ytmusic-api -> ikyyxd -> lrclib), memakai metadataId lagu yang
          // sedang diputar sebagai bagian path, sesuai videoId yang dipakai
          // ZaamPlayer.playPreview(song.metadataId).
          const params = new URLSearchParams();
          params.set('title', title);
          params.set('artist', artist);
          if (durationSeconds) params.set('duration', durationSeconds);
          const res = await fetch(`${API.lyrics}/${encodeURIComponent(videoId)}?${params.toString()}`);
          const json = await res.json();
          type = json?.lyrics?.type || 'none';
          lines = json?.lyrics?.lines || [];
          estimated = false;
        }
      }

      if (myToken !== lyricsToken) return; // pindah lagu sebelum selesai memuat

      lyricsCache.set(currentSong.metadataId, { type, lines, estimated });
      lyricsLines = lines;
      renderLyricsLines(type, lines, estimated);
    } catch (err) {
      if (myToken !== lyricsToken) return;
      lyricsBody.innerHTML = '<div class="empty-state"><p>Gagal memuat lirik. Coba lagi nanti.</p></div>';
    }
  }

  function openLyrics() {
    if (!currentSong) return;
    closeNowPlaying();
    showView('lyrics');
    loadLyricsForCurrentSong();
  }

  npLyricsBtn.addEventListener('click', openLyrics);

  // Setiap kali posisi putar lagu maju, cari baris lirik terbaru yang harusnya
  // aktif dan geser scroll dengan halus supaya baris itu berada di tengah layar.
  // PENTING: hanya jalan kalau audio SUDAH benar-benar terkonfirmasi berbunyi
  // (audioActuallyPlaying) — kalau tidak, lirik dibiarkan diam di posisi awal
  // walau event 'progress' sempat lewat (misalnya sisa timer preview lagu
  // sebelumnya), supaya lirik tidak pernah terlihat "lari duluan" sebelum
  // musiknya sendiri kedengaran.
  ZaamPlayer.on('progress', ({ current }) => {
    if (!audioActuallyPlaying) return;
    if (!lyricsLines.length || !lyricsSongId || lyricsSongId !== (currentSong && currentSong.metadataId)) return;
    if (document.getElementById('view-lyrics') && !document.getElementById('view-lyrics').classList.contains('active')) return;
    if (lyricsLines[0] && lyricsLines[0].time < 0) return; // lirik tidak tersinkron waktu

    const effectiveTime = current + lyricsOffset;
    let idx = -1;
    for (let i = 0; i < lyricsLines.length; i++) {
      if (lyricsLines[i].time <= effectiveTime) idx = i; else break;
    }
    if (idx === lyricsActiveIndex) return;
    lyricsActiveIndex = idx;

    const allLines = lyricsBody.querySelectorAll('.lyrics-line');
    allLines.forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.classList.toggle('passed', i < idx);
    });
    const activeEl = idx >= 0 ? allLines[idx] : null;
    if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // seek bar
  npSeek.addEventListener('input', () => {
    isSeekingNp = true;
    const pct = npSeek.value / 10;
    npSeek.style.backgroundSize = `${pct}% 100%`;
    if (latestDuration) npCurTime.textContent = fmtDuration((pct / 100) * latestDuration);
  });
  npSeek.addEventListener('change', () => {
    const pct = npSeek.value / 10;
    if (latestDuration) ZaamPlayer.seekTo((pct / 100) * latestDuration);
    isSeekingNp = false;
  });

  // ---------------- SLEEP TIMER ----------------
  let sleepTimeoutId = null;
  npTimerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    timerPopover.hidden = !timerPopover.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!timerPopover.hidden && !timerPopover.contains(e.target) && e.target !== npTimerBtn) {
      timerPopover.hidden = true;
    }
  });
  timerPopover.querySelectorAll('.np-popover-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mins = parseInt(btn.dataset.timer, 10);
      clearTimeout(sleepTimeoutId);
      npTimerBtn.classList.remove('on');
      if (mins > 0) {
        sleepTimeoutId = setTimeout(() => {
          ZaamPlayer.pause();
          npTimerBtn.classList.remove('on');
          showToast('Timer tidur: musik dijeda');
        }, mins * 60 * 1000);
        npTimerBtn.classList.add('on');
        showToast(`Timer tidur diatur: ${mins} menit`);
      } else {
        showToast('Timer tidur dimatikan');
      }
      timerPopover.hidden = true;
    });
  });

  // ---------------- SHARE ----------------
  function encodeSongForShare(song) {
    const payload = {
      id: song.metadataId,
      t: song.title,
      a: (song.artists || []).map((x) => x.name).join(', '),
      img: song.thumbnailHd || '',
      d: song.durationSeconds || 0
    };
    return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
  }

  function decodeSongFromShare(encoded) {
    try {
      const json = decodeURIComponent(escape(atob(decodeURIComponent(encoded))));
      const payload = JSON.parse(json);
      return {
        metadataId: payload.id,
        title: payload.t,
        artists: payload.a ? [{ name: payload.a, id: null }] : [],
        thumbnailHd: payload.img,
        durationSeconds: payload.d || 0
      };
    } catch {
      return null;
    }
  }

  npShareBtn.addEventListener('click', async () => {
    if (!currentSong) return;
    // Link pendek: cuma id lagu + judul + artis + durasi lewat query params biasa
    // (bukan base64 berisi URL gambar) supaya tautan tidak panjang.
    const params = new URLSearchParams();
    params.set('s', currentSong.metadataId);
    params.set('t', currentSong.title);
    params.set('a', displayArtist(currentSong));
    if (currentSong.durationSeconds) params.set('d', currentSong.durationSeconds);
    const url = `${location.origin}${location.pathname}?${params.toString()}`;
    const shareText = `${currentSong.title} - ${displayArtist(currentSong)} · Dengarkan di ZaamMusic`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'ZaamMusic', text: shareText, url });
        return;
      } catch {
        // dibatalkan / gagal, lanjut ke fallback clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Tautan lagu disalin ke clipboard');
    } catch {
      customPrompt('Salin manual tautan di bawah ini:', { title: 'Bagikan Lagu', inputValue: url, okText: 'Tutup', showCancel: false });
    }
  });

  // ---------------- ADD TO PLAYLIST ----------------
  const addToPlaylistModal = document.getElementById('addToPlaylistModal');
  const addToPlaylistList = document.getElementById('addToPlaylistList');

  function openAddToPlaylist(target) {
    const songs = Array.isArray(target) ? target.filter(Boolean) : (target ? [target] : (currentSong ? [currentSong] : []));
    if (!songs.length) return;
    const playlists = store.get(LS_KEYS.playlists, []);
    addToPlaylistList.innerHTML = '';
    if (!playlists.length) {
      addToPlaylistList.innerHTML = '<div class="empty-state"><p>Belum ada playlist. Buat dulu, yuk!</p></div>';
    } else {
      playlists.forEach((pl) => {
        const has = songs.every((s) => pl.songs.some((x) => x.metadataId === s.metadataId));
        const row = document.createElement('div');
        row.className = 'add-pl-row';
        row.innerHTML = `
          <img class="cover" src="${pl.image || pl.songs[0]?.thumbnailHd || ''}" alt="" onerror="this.style.opacity=0"/>
          <div class="lib-title">${pl.name}</div>
          <div class="add-pl-check ${has ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="#fff"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 20.6 7.4 19.2 6z"/></svg></div>
        `;
        row.addEventListener('click', () => {
          const list = store.get(LS_KEYS.playlists, []);
          const plTarget = list.find((p) => p.id === pl.id);
          if (!plTarget) return;
          if (has) {
            const ids = new Set(songs.map((s) => s.metadataId));
            plTarget.songs = plTarget.songs.filter((s) => !ids.has(s.metadataId));
            showToast(`Dihapus dari "${pl.name}"`);
          } else {
            let added = 0;
            songs.forEach((s) => {
              if (!plTarget.songs.some((x) => x.metadataId === s.metadataId)) {
                plTarget.songs.unshift(s);
                added++;
              }
            });
            showToast(added > 1 ? `${added} lagu ditambahkan ke "${pl.name}"` : `Ditambahkan ke "${pl.name}"`);
          }
          store.set(LS_KEYS.playlists, list);
          renderLibrary();
          openAddToPlaylist(songs.length > 1 ? songs : songs[0]);
        });
        addToPlaylistList.appendChild(row);
      });
    }
    addToPlaylistModal.hidden = false;
  }

  npAddBtn.addEventListener('click', () => openAddToPlaylist(currentSong));
  document.getElementById('addToPlaylistCloseBtn').addEventListener('click', () => { addToPlaylistModal.hidden = true; });
  document.getElementById('createFromAddBtn').addEventListener('click', () => {
    addToPlaylistModal.hidden = true;
    openPlaylistModal(null, true);
  });
  addToPlaylistModal.addEventListener('click', (e) => {
    if (e.target === addToPlaylistModal) addToPlaylistModal.hidden = true;
  });

  // ---------------- CREATE / EDIT PLAYLIST MODAL ----------------
  const playlistModal = document.getElementById('playlistModal');
  const playlistModalTitle = document.getElementById('playlistModalTitle');
  const modalCoverPicker = document.getElementById('modalCoverPicker');
  const modalCoverPreview = document.getElementById('modalCoverPreview');
  const modalCoverPlaceholder = document.getElementById('modalCoverPlaceholder');
  const modalCoverFileInput = document.getElementById('modalCoverFileInput');
  const modalPlaylistName = document.getElementById('modalPlaylistName');
  let editingPlaylistId = null;
  let reopenAddSheetAfterCreate = false;
  let pendingCoverDataUrl = null;
  let existingCoverImage = '';

  function openPlaylistModal(pl, reopenAddSheet) {
    reopenAddSheetAfterCreate = !!reopenAddSheet;
    editingPlaylistId = pl ? pl.id : null;
    pendingCoverDataUrl = null;
    existingCoverImage = pl && pl.image ? pl.image : '';
    playlistModalTitle.textContent = pl ? 'Ubah Playlist' : 'Buat Playlist';
    modalPlaylistName.value = pl ? pl.name : '';
    modalCoverFileInput.value = '';
    if (existingCoverImage) {
      modalCoverPreview.src = existingCoverImage;
      modalCoverPreview.hidden = false;
      modalCoverPlaceholder.hidden = true;
    } else {
      modalCoverPreview.hidden = true;
      modalCoverPlaceholder.hidden = false;
    }
    playlistModal.hidden = false;
    modalPlaylistName.focus();
  }

  modalCoverPicker.addEventListener('click', () => modalCoverFileInput.click());

  modalCoverFileInput.addEventListener('change', () => {
    const file = modalCoverFileInput.files && modalCoverFileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('File harus berupa gambar');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingCoverDataUrl = reader.result;
      modalCoverPreview.src = pendingCoverDataUrl;
      modalCoverPreview.hidden = false;
      modalCoverPlaceholder.hidden = true;
    };
    reader.onerror = () => showToast('Gagal membaca foto');
    reader.readAsDataURL(file);
  });

  document.getElementById('modalCancelBtn').addEventListener('click', () => { playlistModal.hidden = true; });
  playlistModal.addEventListener('click', (e) => {
    if (e.target === playlistModal) playlistModal.hidden = true;
  });

  document.getElementById('modalSaveBtn').addEventListener('click', () => {
    const name = modalPlaylistName.value.trim();
    if (!name) { showToast('Nama playlist tidak boleh kosong'); return; }
    const image = pendingCoverDataUrl || existingCoverImage || '';
    const playlists = store.get(LS_KEYS.playlists, []);
    if (editingPlaylistId) {
      const target = playlists.find((p) => p.id === editingPlaylistId);
      if (target) { target.name = name; target.image = image; }
      showToast('Playlist diperbarui');
    } else {
      playlists.unshift({ id: `pl_${Date.now()}`, name, image, songs: [] });
      showToast('Playlist dibuat');
    }
    store.set(LS_KEYS.playlists, playlists);
    playlistModal.hidden = true;
    renderLibrary();
    if (reopenAddSheetAfterCreate) openAddToPlaylist();
  });

  // ---------------- DEEP LINK (share via URL) ----------------
  function handleIncomingShareLink() {
    const params = new URLSearchParams(location.search);
    if (params.get('artist')) {
      const id = params.get('id') || params.get('artistId') || null;
      const name = params.get('q') || params.get('artistName') || '';
      if (id || name) openArtist({ id, name });
      return;
    }
    if (params.get('pl')) {
      const encoded = params.get('data');
      const payload = decodePlaylistFromShare(encoded);
      if (payload) promptImportSharedPlaylist(payload);
      return;
    }
    const song = params.get('s')
      ? { metadataId: params.get('s'), title: params.get('t') || 'Lagu', artists: params.get('a') ? [{ name: params.get('a'), id: null }] : [], durationSeconds: Number(params.get('d')) || 0, thumbnailHd: '' }
      : decodeSongFromShare(params.get('play')); // format lama (base64), tetap didukung
    if (song && song.metadataId) {
      playSong(song, [song]);
      openNowPlaying();
      fillSongThumbnailFromSearch(song);
    }
  }

  // Link lagu baru tidak menyertakan gambar (biar pendek), jadi begitu lagu
  // mulai diputar kita cari ulang lewat search API supaya cover art tetap muncul.
  async function fillSongThumbnailFromSearch(song) {
    if (song.thumbnailHd) return;
    try {
      const q = `${song.title} ${displayArtist(song)}`.trim();
      const res = await fetch(`${API.search}?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      const match = (json.data || []).find((s) => s.metadataId === song.metadataId) || (json.data || [])[0];
      if (match && match.thumbnailHd) {
        song.thumbnailHd = match.thumbnailHd;
        if (currentSong && currentSong.metadataId === song.metadataId) {
          currentSong.thumbnailHd = match.thumbnailHd;
          miniCover.src = match.thumbnailHd;
          npCover.src = match.thumbnailHd;
          npBg.style.backgroundImage = `url("${match.thumbnailHd}")`;
        }
      }
    } catch {
      // Gagal ambil cover tidak masalah, lagu tetap bisa diputar.
    }
  }

  // ---------------- MODAL PROMPT/KONFIRMASI BERTEMA (ganti dialog bawaan browser) ----------------
  const genericModal = document.getElementById('genericModal');
  const genericModalTitle = document.getElementById('genericModalTitle');
  const genericModalMsg = document.getElementById('genericModalMsg');
  const genericModalInput = document.getElementById('genericModalInput');
  const genericModalCancelBtn = document.getElementById('genericModalCancelBtn');
  const genericModalOkBtn = document.getElementById('genericModalOkBtn');

  function openGenericModal({ title, message, showInput, placeholder, inputValue, okText, cancelText, showCancel }) {
    return new Promise((resolve) => {
      genericModalTitle.textContent = title || '';
      if (message) { genericModalMsg.textContent = message; genericModalMsg.hidden = false; }
      else { genericModalMsg.textContent = ''; genericModalMsg.hidden = true; }
      genericModalInput.hidden = !showInput;
      genericModalInput.value = inputValue || '';
      genericModalInput.placeholder = placeholder || '';
      genericModalOkBtn.textContent = okText || 'Oke';
      genericModalCancelBtn.hidden = showCancel === false;
      genericModalCancelBtn.textContent = cancelText || 'Batal';
      genericModal.hidden = false;
      if (showInput) requestAnimationFrame(() => genericModalInput.focus());
      else genericModalOkBtn.focus();

      function close(result) {
        genericModal.hidden = true;
        genericModalOkBtn.removeEventListener('click', onOk);
        genericModalCancelBtn.removeEventListener('click', onCancel);
        genericModal.removeEventListener('click', onBackdrop);
        genericModalInput.removeEventListener('keydown', onKeydown);
        resolve(result);
      }
      function onOk() { close(showInput ? (genericModalInput.value.trim() || null) : true); }
      function onCancel() { close(showInput ? null : false); }
      function onBackdrop(e) { if (e.target === genericModal) onCancel(); }
      function onKeydown(e) { if (e.key === 'Enter') { e.preventDefault(); onOk(); } }
      genericModalOkBtn.addEventListener('click', onOk);
      genericModalCancelBtn.addEventListener('click', onCancel);
      genericModal.addEventListener('click', onBackdrop);
      genericModalInput.addEventListener('keydown', onKeydown);
    });
  }

  function customConfirm(message, opts = {}) {
    return openGenericModal({ title: opts.title || 'Konfirmasi', message, okText: opts.okText, cancelText: opts.cancelText });
  }

  function customPrompt(message, opts = {}) {
    return openGenericModal({
      title: opts.title || 'Masukkan Teks',
      message,
      showInput: true,
      placeholder: opts.placeholder,
      inputValue: opts.inputValue,
      okText: opts.okText,
      cancelText: opts.cancelText,
      showCancel: opts.showCancel
    });
  }

  function customAlert(message, opts = {}) {
    return openGenericModal({ title: opts.title || 'Info', message, showCancel: false, okText: opts.okText || 'Tutup' });
  }

  // ---------------- BAGIKAN & IMPOR PLAYLIST/UNDUHAN LEWAT LINK ----------------
  // Playlist maupun daftar "Diunduh" tidak lagi dicadangkan lewat file .json.
  // Sebagai gantinya, keduanya bisa dibagikan sebagai link pendek (isi lagu
  // di-encode ringkas, tanpa gambar) dan orang lain tinggal tempel link itu
  // di fitur Impor. Untuk link "Diunduh", lagu yang belum ada di perangkat
  // penerima otomatis diunduh ulang supaya benar-benar bisa diputar offline.
  function encodePlaylistForShare(pl, isDownloads) {
    const payload = {
      n: pl.name,
      dl: isDownloads ? 1 : 0,
      s: (pl.songs || []).map((song) => ({
        i: song.metadataId,
        t: song.title,
        a: (song.artists || []).map((x) => x.name).join(', '),
        d: song.durationSeconds || 0
      }))
    };
    return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
  }

  function decodePlaylistFromShare(encoded) {
    if (!encoded) return null;
    try {
      const json = decodeURIComponent(escape(atob(decodeURIComponent(encoded))));
      const payload = JSON.parse(json);
      if (!payload || !Array.isArray(payload.s)) return null;
      return {
        name: payload.n || (payload.dl ? 'Lagu Diunduh' : 'Playlist dibagikan'),
        isDownloads: !!payload.dl,
        songs: payload.s.filter((s) => s && s.i).map((s) => ({
          metadataId: s.i,
          title: s.t || 'Lagu',
          artists: s.a ? [{ name: s.a, id: null }] : [],
          durationSeconds: s.d || 0,
          thumbnailHd: ''
        }))
      };
    } catch {
      return null;
    }
  }

  async function sharePlaylistLink(pl, isDownloads) {
    if (!pl.songs || !pl.songs.length) { showToast(isDownloads ? 'Belum ada lagu yang diunduh' : 'Playlist masih kosong, tambah lagu dulu sebelum dibagikan'); return; }
    const encoded = encodePlaylistForShare(pl, isDownloads);
    const url = `${location.origin}${location.pathname}?pl=1&data=${encoded}`;
    const shareText = isDownloads ? `Daftar lagu diunduh · Dengarkan di ZaamMusic` : `Playlist "${pl.name}" · Dengarkan di ZaamMusic`;
    if (navigator.share) {
      try { await navigator.share({ title: 'ZaamMusic', text: shareText, url }); return; } catch { /* dibatalkan, lanjut fallback */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Tautan disalin ke clipboard');
    } catch {
      customPrompt('Salin manual tautan di bawah ini:', { title: 'Bagikan Playlist', inputValue: url, okText: 'Tutup', showCancel: false });
    }
  }

  // Playlist biasa: cukup ditambahkan sebagai playlist baru di perangkat penerima.
  function addSharedPlaylistToLibrary(payload) {
    const playlists = store.get(LS_KEYS.playlists, []);
    const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    playlists.unshift({ id, name: payload.name, image: '', songs: payload.songs });
    store.set(LS_KEYS.playlists, playlists);
    if (libTab === 'playlist') renderLibrary();
    showToast(`Playlist "${payload.name}" (${payload.songs.length} lagu) ditambahkan ke koleksimu`);
    // Cover art tiap lagu diisi belakangan lewat pencarian, biar link impor tetap pendek.
    payload.songs.forEach((song) => fillSongThumbnailFromSearch(song));
  }

  // Link "Diunduh": lagu yang sudah ada di unduhan lokal langsung bisa diputar,
  // lagu yang belum ada WAJIB diunduh ulang dulu (file audionya tidak ikut
  // di link, cuma metadatanya) supaya benar-benar tersedia offline.
  async function importSharedDownloads(payload) {
    const already = getDownloads();
    const alreadyIds = new Set(already.map((s) => s.metadataId));
    const toDownload = payload.songs.filter((s) => !alreadyIds.has(s.metadataId));
    if (!toDownload.length) { showToast('Semua lagu di link ini sudah ada di unduhanmu'); return; }
    showToast(`Mengunduh ${toDownload.length} lagu supaya bisa diputar offline...`);
    let success = 0;
    for (const song of toDownload) {
      try {
        await fillSongThumbnailFromSearch(song);
        const ok = await downloadSong(song);
        if (ok) success++;
      } catch {
        // satu lagu gagal diunduh dilewati, lanjut ke lagu berikutnya
      }
    }
    if (libTab === 'playlist') renderLibrary();
    showToast(`${success} dari ${toDownload.length} lagu berhasil diunduh dan siap diputar offline`);
  }

  async function promptImportSharedPlaylist(payload) {
    const label = payload.isDownloads
      ? `Impor ${payload.songs.length} lagu diunduh ini? Yang belum ada di perangkatmu akan otomatis diunduh.`
      : `Impor playlist "${payload.name}" (${payload.songs.length} lagu) ke koleksimu?`;
    const ok = await customConfirm(label, { title: 'Impor Playlist', okText: 'Impor' });
    if (!ok) return;
    if (payload.isDownloads) importSharedDownloads(payload);
    else addSharedPlaylistToLibrary(payload);
  }

  async function importPlaylistFromLinkPrompt() {
    const input = await customPrompt('Tempel link playlist atau link Diunduh ZaamMusic yang dibagikan:', {
      title: 'Impor dari Link',
      placeholder: 'https://...',
      okText: 'Impor'
    });
    if (!input) return;
    let encoded = input.trim();
    try {
      const url = new URL(encoded);
      if (url.searchParams.get('pl')) encoded = url.searchParams.get('data') || '';
    } catch {
      // bukan URL utuh, anggap ini langsung kode datanya
    }
    const payload = decodePlaylistFromShare(encoded);
    if (!payload) { showToast('Link tidak valid. Pastikan ini link playlist/unduhan ZaamMusic.'); return; }
    if (payload.isDownloads) importSharedDownloads(payload);
    else addSharedPlaylistToLibrary(payload);
  }

  // ---------------- INSTALL PWA ----------------
  let deferredInstallPrompt = null;
  const installPwaBtn = document.getElementById('installPwaBtn');

  function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  if (!isRunningStandalone()) {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      installPwaBtn.hidden = false;
    });
  }

  if (installPwaBtn) {
    installPwaBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        showToast('Aplikasi sudah terpasang atau instalasi belum didukung browser ini.');
        return;
      }
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') showToast('ZaamMusic sedang dipasang...');
      deferredInstallPrompt = null;
      installPwaBtn.hidden = true;
    });
  }

  window.addEventListener('appinstalled', () => {
    installPwaBtn.hidden = true;
    deferredInstallPrompt = null;
    showToast('ZaamMusic berhasil dipasang!');
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* diabaikan: PWA tetap jalan tanpa SW */ });
    });
  }

  // ---------------- INIT ----------------
  renderLibrary();
  loadHome();
  handleIncomingShareLink();
})();
