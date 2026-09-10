/* ============================================================
 * StreamHub — Tesla-optimized Twitch / YouTube / IPTV viewer
 * Static-only (GitHub Pages friendly). No backend, no secrets.
 *
 * The "Teslurk bypass" explained:
 * twitch.tv itself is a heavy SPA that struggles in the Tesla
 * browser (QtWebEngine/Chromium). Teslurk sidesteps it by embedding
 * ONLY the stream player + chat via Twitch's official embed iframes
 * (player.twitch.tv / twitch.tv/embed/.../chat) with ?parent=<host>.
 * StreamHub does exactly the same for Twitch, and applies the same
 * idea to YouTube (youtube-nocookie embed, no surrounding SPA) and
 * to IPTV (direct HLS via hls.js, no native-app DRM/WebRTC needs).
 * ============================================================ */
'use strict';

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
/* Twitch embed requires every ancestor host in `parent`. Include the
 * current host plus common GitHub Pages / local hosts so the same
 * deployment works everywhere (Tesla browser included). */
function twitchParents() {
  const hosts = new Set([window.location.hostname || 'localhost', 'localhost', '127.0.0.1']);
  return [...hosts].filter(Boolean).map((h) => `parent=${encodeURIComponent(h)}`).join('&');
}

/* ---------- tabs ---------- */
const tabs = document.querySelectorAll('.tab');
const sections = document.querySelectorAll('.section');
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    sections.forEach((s) => s.classList.remove('active'));
    tab.classList.add('active');
    $(tab.dataset.tab).classList.add('active');
  });
});

/* ---------- player shell ---------- */
let hls = null;
let currentStream = null; // { type:'twitch'|'youtube'|'iptv', ... }
const playerContainer = $('player-container');
const playerWrapper = $('player-wrapper');
const playerChat = $('player-chat');
const playerTitle = $('player-title');
const sourceSelect = $('source-select');

function destroyHls() { if (hls) { try { hls.destroy(); } catch {} hls = null; } }

function openPlayer(title) {
  playerTitle.textContent = title || 'StreamHub Player';
  playerChat.classList.remove('open');
  playerChat.innerHTML = '';
  $('chat-btn').style.display = 'none';
  document.querySelector('.player-footer').style.display = 'flex';
  document.querySelector('.player-header').style.display = 'flex';
  playerContainer.classList.add('active');
}
function closePlayer() {
  playerContainer.classList.remove('active');
  destroyHls();
  playerWrapper.innerHTML = '';
  playerChat.innerHTML = '';
  playerChat.classList.remove('open');
  currentStream = null;
}
$('close-player').addEventListener('click', closePlayer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && playerContainer.classList.contains('active')) closePlayer();
});
$('fullscreen-btn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    (playerContainer.requestFullscreen || playerWrapper.requestFullscreen || (() => Promise.reject())).call(playerContainer).catch(() => {});
  } else document.exitFullscreen().catch(() => {});
});
$('theater-btn').addEventListener('click', () => {
  const h = document.querySelector('.player-header');
  const f = document.querySelector('.player-footer');
  const hidden = h.style.display === 'none';
  h.style.display = hidden ? 'flex' : 'none';
  f.style.display = hidden ? 'flex' : 'none';
});
$('chat-btn').addEventListener('click', () => playerChat.classList.toggle('open'));
$('popout-btn').addEventListener('click', () => {
  if (!currentStream) return;
  const w = 1280, hgt = 720;
  const left = Math.max(0, (screen.width - w) / 2), top = Math.max(0, (screen.height - hgt) / 2);
  const pop = window.open('', 'StreamHubPopout', `width=${w},height=${hgt},left=${left},top=${top}`);
  if (!pop) return;
  pop.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(playerTitle.textContent)} — StreamHub</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe,video{width:100%;height:100%;border:0}</style></head><body>${playerWrapper.innerHTML}</body></html>`);
  pop.document.close();
});

/* Direct-HLS playback (IPTV). Same reason it works in the Tesla
 * browser: plain https progressive/HLS segments, no DRM, no WebRTC. */
function playHlsDirect(url) {
  destroyHls();
  playerWrapper.innerHTML = '<video id="sh-video" controls playsinline autoplay style="background:#000"></video>';
  const video = $('sh-video');
  video.muted = false;
  if (/\.mp4($|\?)/i.test(url) || /\.mov($|\?)/i.test(url)) {
    video.src = url;
    video.play().catch(() => {});
    return;
  }
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true, lowLatencyMode: true, capLevelToPlayerSize: true });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        const mixed = /^http:\/\//i.test(url) && window.location.protocol === 'https:';
        playerWrapper.innerHTML = `<div style="display:flex;height:100%;align-items:center;justify-content:center;text-align:center;padding:24px;color:#8b98ad">${mixed ? 'This stream is plain-http and browsers refuse to play it on a secure page.<br>Ask your provider for an https link.' : 'Stream blocked by CORS or offline.<br>Tip: Xtream logins and https hosts usually work.'}</div>`;
      }
      destroyHls();
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.addEventListener('loadedmetadata', () => video.play().catch(() => {}));
  } else {
    playerWrapper.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:#8b98ad">HLS not supported in this browser.</div>';
  }
}

/* ============================================================
 * TWITCH — official embed (the Teslurk bypass)
 * ============================================================ */
/* Same category lineup as Teslurk. Streamer logins are hand-verified
 * real channels; tapping one opens it (embed shows offline if not live).
 * No viewer numbers are ever faked — counts only appear with live data. */
const TOP_CURATED = [
  { login: 'xqc', game: 'Just Chatting' },
  { login: 'shroud', game: 'Counter-Strike' },
  { login: 'theburntpeanut', game: 'Grand Theft Auto V' },
  { login: 'ninja', game: 'Fortnite' },
  { login: 'tarik', game: 'VALORANT' },
  { login: 'asmongold', game: 'World of Warcraft' },
  { login: 'summit1g', game: 'Grand Theft Auto V' },
  { login: 'pokimane', game: 'Just Chatting' },
  { login: 'tyler1', game: 'League of Legends' },
  { login: 'sodapoppin', game: 'World of Warcraft' },
  { login: 'gorgc', game: 'Dota 2' },
  { login: 'trainwreckstv', game: 'Slots' },
  { login: 'rocketleague', game: 'Rocket League' },
];
const CATS = [
  { name: 'Just Chatting', streamers: ['xqc', 'hasanabi', 'pokimane', 'ludwig'] },
  { name: 'Grand Theft Auto V', streamers: ['xqc', 'summit1g', 'buddha', 'shroud', 'theburntpeanut'] },
  { name: 'Counter-Strike', streamers: ['shroud', 'fl0m', 'ESL_CSGO'] },
  { name: 'World of Warcraft', streamers: ['asmongold', 'sodapoppin', 'esfandtv'] },
  { name: 'League of Legends', streamers: ['tyler1', 'riotgames', 'doublelift'] },
  { name: 'Fortnite', streamers: ['ninja', 'tfue', 'sypherpk'] },
  { name: 'VALORANT', streamers: ['tarik', 'tenz', 'shroud'] },
  { name: 'Dota 2', streamers: ['gorgc', 'admiralbulldog', 'esl_dota2'] },
  { name: 'Slots', streamers: ['trainwreckstv', 'roshtein', 'xposed'] },
  { name: 'Rainbow Six Siege', streamers: ['maciejay', 'pengu', 'varsitygaming'] },
  { name: 'How to Fish', streamers: [] },
  { name: 'Rocket League', streamers: ['rocketleague', 'johnnyboi_i', 'lethamyr'] },
];
function twitchBoxArt(name) {
  return `https://static-cdn.jtvnw.net/ttv-boxart/${encodeURIComponent(name)}-144x192.jpg`;
}
function formatViews(n) {
  n = Number(n || 0);
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
const TWITCH_API = 'https://api.twitch.tv/helix';

function twitchEmbedUrl(channel) {
  return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&${twitchParents()}&autoplay=true&muted=false`;
}
function twitchChatUrl(channel) {
  return `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?${twitchParents()}&darkpopout`;
}
function twitchThumb(userLogin) {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(userLogin.toLowerCase())}-320x180.jpg`;
}

/* Keyless Twitch search, layered like the YouTube tab:
 * 1) Helix (only if the user added free keys in Settings),
 * 2) anonymous web search (same public endpoint twitch.tv itself uses),
 * 3) exact channel lookup via the public IVR.fi API (verified keyless),
 * 4) last resort: just open it as a channel name. */
const TWITCH_GQL = 'https://gql.twitch.tv/gql';
const TWITCH_WEB_ID = 'kimne78kx3ncx6brgo4vl6wkyfabb';

async function twitchGqlSearch(query) {
  const body = {
    query: 'query Search($q: String!) { searchFor(query: $q, first: 12) { channels { edges { item { __typename ... on User { login displayName description profileImageURL(width: 300) followers { totalCount } stream { title viewersCount game { displayName } } } } } } } }',
    variables: { q: query },
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(TWITCH_GQL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Client-ID': TWITCH_WEB_ID },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`search ${r.status}`);
    const j = await r.json();
    const edges = ((((j || {}).data || {}).searchFor || {}).channels || {}).edges || [];
    return edges.map((e) => e.item).filter((u) => u && u.login).map((u) => ({
      login: u.login,
      name: u.displayName || u.login,
      live: !!u.stream,
      thumb: u.stream ? twitchThumb(u.login) : (u.profileImageURL || twitchThumb(u.login)),
      meta: u.stream
        ? `${((u.stream || {}).game || {}).displayName || 'Live'} • ${Number(u.stream.viewersCount || 0).toLocaleString()} watching`
        : `${Number((u.followers || {}).totalCount || 0).toLocaleString()} followers • tap to open`,
    }));
  } finally { clearTimeout(t); }
}

async function twitchGqlGames(query) {
  const body = {
    query: 'query GameSearch($q: String!) { searchFor(query: $q, first: 8) { games { edges { item { __typename ... on Game { name boxArtURL(width: 144, height: 192) } } } } } }',
    variables: { q: query },
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(TWITCH_GQL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Client-ID': TWITCH_WEB_ID },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`game search ${r.status}`);
    const j = await r.json();
    const edges = ((((j || {}).data || {}).searchFor || {}).games || {}).edges || [];
    return edges.map((e) => e.item).filter((g) => g && g.name)
      .map((g) => ({ name: g.name, art: g.boxArtURL || twitchBoxArt(g.name) }));
  } finally { clearTimeout(t); }
}

/* Keyless live check (public DecAPI, CORS-open). Returns
 * { loginLower: true/false }; missing entries = unknown. */
async function twitchLiveCheck(logins) {
  const out = {};
  await Promise.all(logins.map(async (login) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`https://decapi.me/twitch/uptime/${encodeURIComponent(login)}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return;
      out[login.toLowerCase()] = !/offline/i.test(await r.text());
    } catch { clearTimeout(t); }
  }));
  return out;
}

async function twitchIvrLookup(login) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(login)}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error('lookup failed');
    const j = await r.json();
    const u = Array.isArray(j) ? j[0] : j;
    if (!u || !u.login) throw new Error('not found');
    return {
      login: u.login,
      name: u.displayName || u.login,
      live: false,
      thumb: u.logo || twitchThumb(u.login),
      meta: u.followers ? `${Number(u.followers).toLocaleString()} followers • tap to open` : 'Tap to open channel',
    };
  } finally { clearTimeout(t); }
}

function openTwitchPlayer(channel, title) {
  channel = String(channel || '').replace(/^@/, '').trim();
  if (!channel) return;
  currentStream = { type: 'twitch', channel };
  openPlayer(title || channel);
  sourceSelect.innerHTML = '<option value="embed">Twitch player (Tesla-safe)</option>';
  playerWrapper.innerHTML = `<iframe src="${twitchEmbedUrl(channel)}" allowfullscreen allow="autoplay; fullscreen" scrolling="no" title="${escapeHtml(channel)}"></iframe>`;
  playerChat.innerHTML = `<iframe src="${twitchChatUrl(channel)}" title="chat"></iframe>`;
  $('chat-btn').style.display = '';
  $('chat-btn').onclick = () => playerChat.classList.toggle('open');
  // Tesla = usually parked viewing; open chat only on wide screens by default
  if (window.innerWidth > 900) playerChat.classList.add('open');
}
sourceSelect.addEventListener('change', () => {
  if (!currentStream) return;
  if (currentStream.type === 'twitch') openTwitchPlayer(currentStream.channel);
  else if (currentStream.type === 'youtube') openYouTubePlayer(currentStream.videoId, currentStream.title, sourceSelect.value);
  else if (currentStream.type === 'iptv') playHlsDirect(currentStream.url);
});

/* Card item: { login, name, title, game, viewers (number|null), live, thumb } */
function streamCardHTML(c) {
  const initial = escapeHtml((c.name || c.login || '?').trim().charAt(0).toUpperCase());
  return `
    <div class="stream-card" tabindex="0" data-login="${escapeHtml(c.login)}" data-name="${escapeHtml(c.name || c.login)}" data-title="${escapeHtml(c.title || c.name || c.login)}">
      <div class="stream-thumb">
        <span class="fallback">${initial}</span>
        <img loading="lazy" src="${escapeHtml(c.thumb)}" alt="" onerror="this.remove()">
        ${c.live ? '<span class="live-badge">LIVE</span>' : ''}
        ${c.viewers != null ? `<span class="views-pill"><i>●</i>${escapeHtml(formatViews(c.viewers))}</span>` : ''}
      </div>
      <div class="stream-title">${escapeHtml(c.title || c.name || c.login)}</div>
      <div class="stream-name">${escapeHtml(c.name || c.login)}</div>
      ${c.game ? `<div class="stream-game">${escapeHtml(c.game)}</div>` : ''}
    </div>`;
}
function bindStreamCards(container) {
  container.querySelectorAll('.stream-card').forEach((card) => {
    const go = () => openTwitchPlayer(card.dataset.login, card.dataset.title);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}
function renderStreamCards(items, gridEl) {
  gridEl.innerHTML = items.map(streamCardHTML).join('');
  bindStreamCards(gridEl);
}
function catTileHTML(cat) {
  const art = cat.art || twitchBoxArt(cat.name);
  const initial = escapeHtml(cat.name.trim().charAt(0).toUpperCase());
  return `
    <div class="cat-card" tabindex="0" data-game="${escapeHtml(cat.name)}">
      <div class="cat-art"><span class="fallback">${initial}</span><img loading="lazy" src="${escapeHtml(art)}" alt="" onerror="this.remove()"></div>
      <div class="cat-name">${escapeHtml(cat.name)}</div>
    </div>`;
}
function bindCatTiles(container, onPick) {
  container.querySelectorAll('.cat-card').forEach((tile) => {
    const go = () => onPick(tile.dataset.game);
    tile.addEventListener('click', go);
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}
function renderHero(item) {
  const box = $('twitch-featured');
  const initial = escapeHtml((item.name || item.login).trim().charAt(0).toUpperCase());
  box.innerHTML = `
    <div class="hero-card" tabindex="0" data-login="${escapeHtml(item.login)}">
      <span class="hero-fallback">${initial}</span>
      <img src="${escapeHtml(item.hero || item.thumb)}" alt="" onerror="this.remove()">
      <div class="hero-grad"></div>
      <div class="hero-meta">
        ${item.live ? '<span class="live-badge">● LIVE</span>' : ''}<span class="feat-tag">FEATURED</span>
        <div class="hero-name">${escapeHtml(item.name || item.login)}</div>
        <div class="hero-sub"><span class="hero-game">${escapeHtml(item.game || 'Twitch')}</span>${item.viewers != null ? ` · ${escapeHtml(formatViews(item.viewers))} viewers` : ' · tap to watch'}</div>
      </div>
    </div>`;
  const go = () => openTwitchPlayer(item.login, item.title || item.name || item.login);
  const el = box.querySelector('.hero-card');
  el.addEventListener('click', go);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}
function showTwitchHome() {
  $('twitch-results').style.display = 'none';
  $('twitch-home').style.display = 'block';
}
function showTwitchResults(title) {
  $('twitch-home').style.display = 'none';
  $('twitch-results').style.display = 'block';
  $('twitch-res-title').textContent = title || 'Channels';
  $('twitch-res-cats-wrap').style.display = 'none';
  $('twitch-results-grid').innerHTML = '';
  $('twitch-empty').style.display = 'none';
}

/* Live directory via Helix — only when the user adds their own free
 * Client-ID + token in Settings (Twitch requires auth; there is no
 * legal no-key directory API, which is why Teslurk uses a backend). */
async function tryTwitchHelix(path) {
  const id = store.get('sh.twitch.id', '');
  const token = store.get('sh.twitch.token', '');
  if (!id || !token) return null;
  const r = await fetch(`${TWITCH_API}${path}`, {
    headers: { 'Client-ID': id, Authorization: `Bearer ${token.replace(/^oauth:/, '')}` },
  });
  if (!r.ok) throw new Error(`Twitch API ${r.status}`);
  return r.json();
}

async function loadTwitchDirectory() {
  showTwitchHome();
  const hint = $('twitch-browse-hint');
  // Categories row is always available (static lineup + real box art).
  const catsBox = $('twitch-cats');
  catsBox.innerHTML = CATS.map(catTileHTML).join('');
  bindCatTiles(catsBox, openCategory);

  try {
    const streams = await tryTwitchHelix('/streams?first=20');
    if (streams && streams.data && streams.data.length) {
      hint.style.display = 'none';
      const items = streams.data.map((s) => ({
        login: s.user_login, name: s.user_name, title: s.title || s.user_name,
        game: s.game_name || '', viewers: s.viewer_count, live: true,
        thumb: (s.thumbnail_url || '').replace('{width}', '640').replace('{height}', '360'),
        hero: (s.thumbnail_url || '').replace('{width}', '1280').replace('{height}', '720'),
      }));
      renderHero(items[0]);
      renderStreamCards(items, $('twitch-grid'));
      return;
    }
  } catch { /* fall through to curated */ }
  hint.style.display = 'block';
  hint.innerHTML = '<strong>Browse picks</strong> (no login needed — tap anything). Top streams shows channels that are live right now. Titles, viewer counts and full live search appear when you add a free Twitch Client-ID + token in ⚙ Settings.';
  const status = await twitchLiveCheck(TOP_CURATED.map((t) => t.login));
  const known = TOP_CURATED.filter((t) => status[t.login.toLowerCase()] === true);
  const pool = known.length ? known : TOP_CURATED;
  const items = pool.map((t) => ({
    login: t.login, name: t.login, title: `Watch ${t.login}`, game: t.game,
    viewers: null, live: status[t.login.toLowerCase()] === true, thumb: twitchThumb(t.login),
    hero: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(t.login.toLowerCase())}-1280x720.jpg`,
  }));
  renderHero(items[0]);
  renderStreamCards(items, $('twitch-grid'));
}

/* Search-by-game: tap a category tile (or a game from search results).
 * Live streams when keys exist; otherwise the verified featured channels
 * for that game. */
async function openCategory(gameName) {
  showTwitchResults(gameName);
  const grid = $('twitch-results-grid');
  grid.innerHTML = '<div class="hint">Loading streams…</div>';

  const id = store.get('sh.twitch.id', '');
  const token = store.get('sh.twitch.token', '');
  if (id && token) {
    try {
      const g = await (await fetch(`${TWITCH_API}/games?name=${encodeURIComponent(gameName)}`, {
        headers: { 'Client-ID': id, Authorization: `Bearer ${token.replace(/^oauth:/, '')}` },
      })).json();
      const gid = g.data && g.data[0] && g.data[0].id;
      if (gid) {
        const s = await (await fetch(`${TWITCH_API}/streams?game_id=${gid}&first=20`, {
          headers: { 'Client-ID': id, Authorization: `Bearer ${token.replace(/^oauth:/, '')}` },
        })).json();
        const items = (s.data || []).map((x) => ({
          login: x.user_login, name: x.user_name, title: x.title || x.user_name,
          game: x.game_name || gameName, viewers: x.viewer_count, live: true,
          thumb: (x.thumbnail_url || '').replace('{width}', '640').replace('{height}', '360'),
        }));
        if (items.length) { renderStreamCards(items, grid); return; }
      }
    } catch { /* fall through to curated */ }
  }

  const cat = CATS.find((c) => c.name.toLowerCase() === String(gameName).toLowerCase());
  const logins = cat ? cat.streamers : [];
  if (!logins.length) {
    grid.innerHTML = `<div class="hint">No offline picks for <strong>${escapeHtml(gameName)}</strong> — add a free Twitch Client-ID + token in ⚙ Settings for live streams in every game.</div>`;
    return;
  }
  const status = await twitchLiveCheck(logins);
  const ordered = [...logins].sort((a, b) =>
    (status[b.toLowerCase()] === true ? 1 : 0) - (status[a.toLowerCase()] === true ? 1 : 0));
  renderStreamCards(ordered.map((login) => ({
    login, name: login, title: `Watch ${login}`, game: gameName,
    viewers: null, live: status[login.toLowerCase()] === true, thumb: twitchThumb(login),
  })), grid);
}

async function handleTwitchSearch() {
  const q = $('twitch-search').value.trim().replace(/^@/, '');
  if (!q) { loadTwitchDirectory(); return; }
  showTwitchResults(`Results for “${q}”`);
  const grid = $('twitch-results-grid');
  grid.innerHTML = '<div class="hint">Searching…</div>';

  const id = store.get('sh.twitch.id', '');
  const token = store.get('sh.twitch.token', '');
  if (id && token) {
    try {
      const [ch, gm] = await Promise.all([
        (await fetch(`${TWITCH_API}/search/channels?query=${encodeURIComponent(q)}&first=12`, {
          headers: { 'Client-ID': id, Authorization: `Bearer ${token.replace(/^oauth:/, '')}` },
        })).json(),
        (await fetch(`${TWITCH_API}/search/categories?query=${encodeURIComponent(q)}&first=8`, {
          headers: { 'Client-ID': id, Authorization: `Bearer ${token.replace(/^oauth:/, '')}` },
        })).json(),
      ]);
      const games = (gm.data || []).map((g) => ({ name: g.name, art: g.boxart_url ? g.boxart_url.replace('{width}', '144').replace('{height}', '192') : twitchBoxArt(g.name) }));
      if (games.length) {
        $('twitch-res-cats-wrap').style.display = 'block';
        const box = $('twitch-res-cats');
        box.innerHTML = games.map(catTileHTML).join('');
        bindCatTiles(box, openCategory);
      }
      const items = (ch.data || []).map((c) => ({
        login: c.broadcaster_login, name: c.display_name, title: c.title || c.display_name,
        game: c.game_name || '', live: c.is_live, viewers: null,
        thumb: c.is_live ? twitchThumb(c.broadcaster_login) : (c.thumbnail_url || twitchThumb(c.broadcaster_login)),
      }));
      if (items.length) { renderStreamCards(items, grid); return; }
      if (games.length) { grid.innerHTML = ''; return; }
    } catch { /* fall through to keyless */ }
  }

  // Keyless: anonymous channel + game search, plus local category match
  // (so game names work even with zero network APIs).
  let channels = [];
  try { channels = await twitchGqlSearch(q); } catch { channels = []; }
  let games = [];
  try { games = await twitchGqlGames(q); } catch { games = []; }
  const local = CATS.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
    .filter((c) => !games.some((g) => g.name.toLowerCase() === c.name.toLowerCase()))
    .map((c) => ({ name: c.name }));
  games = games.concat(local);
  if (games.length) {
    $('twitch-res-cats-wrap').style.display = 'block';
    const box = $('twitch-res-cats');
    box.innerHTML = games.map(catTileHTML).join('');
    bindCatTiles(box, openCategory);
  }
  if (channels.length) { renderStreamCards(channels, grid); return; }
  if (games.length) { grid.innerHTML = ''; return; }

  if (/^[A-Za-z0-9_]{2,25}$/.test(q)) {
    try {
      const one = await twitchIvrLookup(q);
      renderStreamCards([{ ...one, title: `Watch ${one.login}`, game: '' }], grid);
      return;
    } catch { openTwitchPlayer(q, q); return; }
  }
  grid.innerHTML = '';
  $('twitch-empty').style.display = 'block';
}
$('twitch-go').addEventListener('click', handleTwitchSearch);
$('twitch-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleTwitchSearch(); });
$('twitch-search').addEventListener('input', debounce(() => {
  const v = $('twitch-search').value.trim();
  if (v.length >= 2) handleTwitchSearch();
  else if (!v) loadTwitchDirectory();
}, 600));
$('twitch-back').addEventListener('click', () => {
  $('twitch-search').value = '';
  loadTwitchDirectory();
});
$('twitch-seeall-top').addEventListener('click', () => $('twitch-grid').classList.toggle('expanded'));
$('twitch-seeall-cats').addEventListener('click', () => $('twitch-cats').classList.toggle('expanded'));

/* ============================================================
 * YOUTUBE — privacy embed (same bypass idea as Twitch)
 * Search via Piped API instances (no key needed); playback is
 * always the official youtube-nocookie embed, which the Tesla
 * browser handles (it's the same player as the Theater app).
 * ============================================================ */
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.reallyaweso.me',
  'https://api.piped.private.coffee',
];
const YT_SHORTS = [
  { id: 'aqz-KE-bpKQ', title: 'Big Buck Bunny (4K)', author: 'Blender Foundation' },
  { id: 'eRsGyueVLvQ', title: 'Sintel (4K)', author: 'Blender Foundation' },
  { id: 'jNQXAC9IVRw', title: 'Me at the zoo — first YouTube video', author: 'jawed' },
];

function extractYouTubeId(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function openYouTubePlayer(videoId, title, source) {
  videoId = String(videoId || '').trim();
  if (!videoId) return;
  currentStream = { type: 'youtube', videoId, title: title || videoId };
  openPlayer(title || 'YouTube');
  sourceSelect.innerHTML = `
    <option value="nocookie">YouTube embed (Tesla-safe)</option>
    <option value="invidious">Invidious mirror</option>`;
  if (source) sourceSelect.value = source;
  const src = (sourceSelect.value === 'invidious')
    ? `https://yewtu.be/embed/${encodeURIComponent(videoId)}?autoplay=1&local=true`
    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&controls=1&rel=0&playsinline=1`;
  playerWrapper.innerHTML = `<iframe src="${src}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen title="YouTube player"></iframe>`;
}

function renderYouTubeList(videos) {
  const grid = $('youtube-grid');
  const empty = $('youtube-empty');
  if (!videos.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = videos.map((v) => `
    <div class="card" tabindex="0" data-id="${escapeHtml(v.id)}" data-title="${escapeHtml(v.title)}">
      <div class="card-thumb">
        <img loading="lazy" src="https://i.ytimg.com/vi/${escapeHtml(v.id)}/hqdefault.jpg" alt="" onerror="this.style.display='none'">
      </div>
      <div class="card-info">
        <div class="card-title">${escapeHtml(v.title)}</div>
        <div class="card-meta">${escapeHtml(v.author || 'YouTube')}</div>
      </div>
    </div>`).join('');
  grid.querySelectorAll('.card').forEach((card) => {
    const go = () => openYouTubePlayer(card.dataset.id, card.dataset.title);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

async function pipedSearch(query) {
  let lastErr = null;
  for (const base of PIPED_INSTANCES) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(`${base}/search?q=${encodeURIComponent(query)}&filter=videos`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      const items = (j.items || j).filter((x) => x && (x.url || '').includes('/watch?v='));
      if (items.length) {
        return items.slice(0, 20).map((x) => ({
          id: String(x.url.split('v=')[1] || '').split('&')[0],
          title: x.title || 'Untitled',
          author: x.uploaderName || '',
        })).filter((x) => x.id);
      }
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('search failed');
}

async function handleYouTubeGo() {
  const q = $('youtube-search').value.trim();
  if (!q) { renderYouTubeList(YT_SHORTS); return; }
  const id = extractYouTubeId(q);
  if (id) return openYouTubePlayer(id, 'YouTube video');
  $('youtube-empty').style.display = 'none';
  $('youtube-grid').innerHTML = '<div class="hint">Searching…</div>';
  try {
    renderYouTubeList(await pipedSearch(q));
  } catch {
    $('youtube-grid').innerHTML = '';
    $('youtube-empty').style.display = 'block';
  }
}
$('youtube-go').addEventListener('click', handleYouTubeGo);
$('youtube-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleYouTubeGo(); });
$('youtube-chips').innerHTML = '';
renderYouTubeList(YT_SHORTS);

/* ============================================================
 * IPTV — M3U / Xtream, direct HLS via hls.js
 * ============================================================ */
const SAMPLE_M3U = `#EXTM3U
#EXTINF:-1 tvg-logo="" group-title="Demo",Red Bull TV
https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master_1660.m3u8
#EXTINF:-1 group-title="Demo",NASA TV (public)
https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8
#EXTINF:-1 group-title="Demo",Al Jazeera English
https://live-hls-web-aje.getaj.net/AJE/index.m3u8`;

/* StrymTV-style: many named playlists, each a tap-able tile.
 * Tapping a playlist tile shows its channels as logo tiles;
 * tapping a channel opens a sheet — hit Play. */
let iptvPlaylists = store.get('sh.iptv.playlists', []);
let openPlaylistId = store.get('sh.iptv.open', null);
let pendingChannel = null;

function savePlaylists() {
  // persist playlist defs + cached channels (capped so localStorage stays small)
  store.set('sh.iptv.playlists', iptvPlaylists.map((p) => ({
    ...p, channels: (p.channels || []).slice(0, 1500),
  })));
  store.set('sh.iptv.open', openPlaylistId);
}

function guessName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    return host ? host.toUpperCase().slice(0, 18) : 'Playlist';
  } catch { return 'Playlist'; }
}

function renderSaved() {
  const grid = $('iptv-saved');
  const empty = $('iptv-saved-empty');
  if (!iptvPlaylists.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = iptvPlaylists.map((p) => `
    <div class="plist-card ${p.id === openPlaylistId ? 'open' : ''}" tabindex="0" data-id="${p.id}">
      <div class="plist-name">${escapeHtml(p.name)}</div>
      <div class="plist-count">${p.channels ? `${p.channels.length} channels` : 'Tap to load'}</div>
      <div class="plist-actions">
        <button class="mini-btn" data-act="refresh" title="Re-fetch">↻ Reload</button>
        <button class="mini-btn danger" data-act="delete" title="Remove">✕ Remove</button>
      </div>
    </div>`).join('');
  grid.querySelectorAll('.plist-card').forEach((card) => {
    const id = card.dataset.id;
    const open = () => openPlaylist(id);
    card.addEventListener('click', (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'delete') { e.stopPropagation(); deletePlaylist(id); return; }
      if (act === 'refresh') { e.stopPropagation(); refreshPlaylist(id); return; }
      open();
    });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function currentPlaylist() {
  return iptvPlaylists.find((p) => p.id === openPlaylistId) || null;
}

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

/* Browsers (Tesla included) block two things native apps like StrymTV
 * don't care about: cross-origin (CORS) reads and plain-http requests
 * from a secure page. So: try direct first, then https proxies which
 * fix both problems for the playlist download. */
const CORS_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function loadM3UFromUrl(url) {
  try { return await fetchText(url); } catch { /* try proxies */ }
  for (const wrap of CORS_PROXIES) {
    try {
      const text = await fetchText(wrap(url));
      if (text && /#EXTM3U/i.test(text)) return text;
    } catch { /* next */ }
  }
  if (/^http:\/\//i.test(url) && window.location.protocol === 'https:') {
    throw new Error('That link is plain-http and every route to it failed. Ask your provider for an https playlist link, or an Xtream login on an https host.');
  }
  throw new Error('No route to that link worked (direct + 2 fallbacks failed). The host may be offline or blocking all web access.');
}

async function fetchPlaylistChannels(pl) {
  const text = await loadM3UFromUrl(pl.url);
  if (!/#EXTM3U/i.test(text)) {
    throw new Error('That address returned a web page, not a playlist. Paste the FULL M3U link from your provider — it usually ends with .m3u or contains "get.php?username=" — not just the homepage.');
  }
  const chans = parseM3U(text);
  if (!chans.length) throw new Error('That playlist contained no playable channels.');
  return chans;
}

async function openPlaylist(id) {
  const pl = iptvPlaylists.find((p) => p.id === id);
  if (!pl) return;
  openPlaylistId = id;
  renderSaved();
  const title = $('iptv-channels-title');
  title.style.display = 'block';
  title.innerHTML = `Channels — <em>${escapeHtml(pl.name)}</em>`;
  $('iptv-filter-row').style.display = 'flex';
  if (pl.channels) { renderIptvChannels(''); return; }
  $('iptv-playlist').innerHTML = '<div class="hint">Loading channels…</div>';
  $('iptv-empty').style.display = 'none';
  try {
    pl.channels = await fetchPlaylistChannels(pl);
    savePlaylists();
    renderSaved();
    renderIptvChannels('');
  } catch (e) {
    $('iptv-playlist').innerHTML = `<div class="hint"><strong>Could not load “${escapeHtml(pl.name)}”.</strong> ${escapeHtml(e.message)}<br>Common cause: the host blocks cross-origin (CORS) requests. Xtream logins and https hosts usually work; plain-http hosts often don't from an https page.</div>`;
  }
}

async function refreshPlaylist(id) {
  const pl = iptvPlaylists.find((p) => p.id === id);
  if (!pl) return;
  try {
    pl.channels = await fetchPlaylistChannels(pl);
    savePlaylists();
    renderSaved();
    if (id === openPlaylistId) renderIptvChannels($('iptv-filter').value);
  } catch (e) {
    alert(`Reload failed: ${e.message}`);
  }
}

function deletePlaylist(id) {
  iptvPlaylists = iptvPlaylists.filter((p) => p.id !== id);
  if (openPlaylistId === id) {
    openPlaylistId = null;
    $('iptv-playlist').innerHTML = '';
    $('iptv-channels-title').style.display = 'none';
    $('iptv-filter-row').style.display = 'none';
    $('iptv-empty').style.display = 'none';
  }
  savePlaylists();
  renderSaved();
}

async function handleAddPlaylist() {
  let url = $('iptv-url').value.trim();
  const user = $('xtream-user').value.trim();
  const pass = $('xtream-pass').value.trim();
  let name = $('iptv-name').value.trim();
  if (!url) { alert('Paste an .m3u/.m3u8 link (or Xtream host) first.'); return; }
  // bare "host:port" + Xtream creds → build playlist URL automatically
  if (user && pass && !/\.m3u8?($|\?)/i.test(url)) {
    url = `${url.replace(/\/$/, '')}/get.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus&output=mpegts`;
  }
  if (!name) name = guessName($('iptv-url').value.trim());
  const pl = { id: `pl-${Date.now()}`, name, url, channels: null };
  $('iptv-playlist').innerHTML = `<div class="hint">Loading “${escapeHtml(name)}”…</div>`;
  $('iptv-empty').style.display = 'none';
  try {
    pl.channels = await fetchPlaylistChannels(pl);
  } catch (e) {
    $('iptv-playlist').innerHTML = `<div class="hint"><strong>Could not load playlist.</strong> ${escapeHtml(e.message)}<br>Common cause: the host blocks cross-origin (CORS) requests. Xtream logins and https hosts usually work; plain-http hosts often don't from an https page.</div>`;
    return;
  }
  iptvPlaylists.push(pl);
  $('iptv-name').value = '';
  $('iptv-url').value = '';
  $('iptv-filter').value = '';
  savePlaylists();
  openPlaylist(pl.id);
}

function tileLogo(c) {
  const letter = escapeHtml((c.name || '?').trim().charAt(0).toUpperCase());
  if (c.logo) return `<span class="fallback">${letter}</span><img loading="lazy" src="${escapeHtml(c.logo)}" alt="" onerror="this.remove()">`;
  return `<span class="fallback">${letter}</span>`;
}

function renderIptvChannels(filter) {
  const pl = currentPlaylist();
  const box = $('iptv-playlist');
  const empty = $('iptv-empty');
  if (!pl || !pl.channels) { box.innerHTML = ''; return; }
  const q = String(filter || '').toLowerCase();
  const list = pl.channels.filter((c) =>
    !q || c.name.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q));
  if (!list.length) {
    box.innerHTML = '';
    empty.style.display = 'block';
    empty.innerHTML = `<p>${q ? 'No channels match that filter.' : 'No channels in this playlist.'}</p>`;
    return;
  }
  empty.style.display = 'none';
  box.innerHTML = list.slice(0, 500).map((c, i) => `
    <div class="tile" tabindex="0" data-idx="${i}">
      <div class="tile-logo">${tileLogo(c)}</div>
      <div class="tile-name">${escapeHtml(c.name)}</div>
      ${c.group ? `<div class="tile-group">${escapeHtml(c.group)}</div>` : ''}
    </div>`).join('');
  // keep a reference to the filtered list for tap → sheet
  box.querySelectorAll('.tile').forEach((el) => {
    const c = list[Number(el.dataset.idx)];
    const go = () => openChannelSheet(c);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

/* Tap a channel → sheet with big Play button */
function openChannelSheet(c) {
  pendingChannel = c;
  $('ch-name').textContent = c.name;
  $('ch-group').textContent = c.group || '';
  $('ch-logo-wrap').innerHTML = c.logo
    ? `<img src="${escapeHtml(c.logo)}" alt="" onerror="this.style.display='none'">` : '';
  $('channel-modal').classList.add('open');
}
function playPendingChannel() {
  if (!pendingChannel) return;
  const c = pendingChannel;
  $('channel-modal').classList.remove('open');
  currentStream = { type: 'iptv', url: c.url };
  openPlayer(c.name);
  sourceSelect.innerHTML = '<option value="hls">Direct HLS (Tesla-safe)</option>';
  playHlsDirect(c.url);
}
$('ch-play').addEventListener('click', playPendingChannel);
$('ch-close').addEventListener('click', () => $('channel-modal').classList.remove('open'));
$('channel-modal').addEventListener('click', (e) => {
  if (e.target === $('channel-modal')) $('channel-modal').classList.remove('open');
});

function parseM3U(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let meta = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const comma = line.lastIndexOf(',');
      const attrs = line.slice(8, comma > 8 ? comma : undefined);
      meta = {
        name: comma > 8 ? line.slice(comma + 1).trim() : 'Untitled',
        group: (/group-title="([^"]*)"/.exec(attrs) || [])[1] || '',
        logo: (/tvg-logo="([^"]*)"/.exec(attrs) || [])[1] || '',
      };
    } else if (!line.startsWith('#')) {
      if (meta && /^https?:\/\//i.test(line)) out.push({ ...meta, url: line });
      meta = null;
    }
  }
  return out;
}

$('iptv-add').addEventListener('click', handleAddPlaylist);
$('iptv-xtream').addEventListener('click', () => {
  const row = $('xtream-row');
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
});
$('iptv-sample').addEventListener('click', () => {
  const pl = { id: `pl-${Date.now()}`, name: 'Sample', url: 'built-in', channels: parseM3U(SAMPLE_M3U) };
  iptvPlaylists.push(pl);
  savePlaylists();
  openPlaylist(pl.id);
});
$('iptv-filter').addEventListener('input', debounce(() => renderIptvChannels($('iptv-filter').value), 200));

/* restore saved playlists; reopen the last-opened one */
renderSaved();
if (openPlaylistId && currentPlaylist()) {
  if (currentPlaylist().channels) openPlaylist(openPlaylistId);
  else { openPlaylistId = null; savePlaylists(); renderSaved(); }
}

/* ---------- settings ---------- */
$('settings-btn').addEventListener('click', () => {
  $('set-twitch-id').value = store.get('sh.twitch.id', '');
  $('set-twitch-token').value = store.get('sh.twitch.token', '');
  $('settings-modal').classList.add('open');
});
$('settings-close').addEventListener('click', () => $('settings-modal').classList.remove('open'));
$('settings-modal').addEventListener('click', (e) => {
  if (e.target === $('settings-modal')) $('settings-modal').classList.remove('open');
});
$('settings-save').addEventListener('click', () => {
  store.set('sh.twitch.id', $('set-twitch-id').value.trim());
  store.set('sh.twitch.token', $('set-twitch-token').value.trim());
  $('settings-modal').classList.remove('open');
  loadTwitchDirectory();
});

/* ---------- init ---------- */
loadTwitchDirectory();
