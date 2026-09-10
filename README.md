# StreamHub

Watch **Twitch, YouTube and IPTV** in your Tesla browser (tested logic for 2023 Model 3).
Black background, blue accent, touch-friendly, installable. Static site — deploy free via GitHub Pages.

## How the "Teslurk bypass" works (and what StreamHub copies)

`twitch.tv` itself is a heavy app that struggles in the Tesla browser (Chromium/QtWebEngine).
Teslurk sidesteps it by embedding **only** the official stream player + chat:

- Video: `https://player.twitch.tv/?channel=NAME&parent=YOUR_HOST&autoplay=true`
- Chat: `https://www.twitch.tv/embed/NAME/chat?parent=YOUR_HOST&darkpopout`

StreamHub does exactly this for Twitch (see `twitchEmbedUrl` / `twitchChatUrl` in `app.js`),
and applies the same idea to the other tabs:

- **YouTube** → `youtube-nocookie` embed (same player as Tesla's Theater app, no surrounding SPA).
- **IPTV** → direct HLS via `hls.js` (plain https segments, no DRM/WebRTC).

Note: video plays while parked, like Teslurk — Tesla pauses browser video in Drive.

## Deploy (GitHub Pages)

1. Create a repo named `streamhub`, upload everything in this folder to `main`.
2. Repo → **Settings → Pages** → Source: **GitHub Actions**.
3. Push — the included workflow (`.github/workflows/deploy.yml`) deploys automatically.
4. Open `https://YOUR_USERNAME.github.io/streamhub/` in the Tesla browser.

> The Twitch embed needs `?parent=<your host>`. The app adds the current hostname
> automatically, so any domain or GitHub Pages URL works with zero config.

## Use in the car (Model 3)

1. Park, open the Tesla browser, go to your StreamHub URL.
2. Twitch: type any channel name → **Watch**. 💬 toggles chat.
3. YouTube: paste any link/ID, or search.
4. IPTV: **Add Playlist** — name it (`MLB`, `NBA`, `ESPN`…) + paste its M3U link.
   Each playlist becomes a tile. Tap a tile → channel windows with logos →
   tap a channel → **▶ Play**. Tiles also have ↻ Reload and ✕ Remove.
   Xtream users: tap **Xtream login**, enter host + user + pass, then Add Playlist.
5. Browser menu (⋯) → **Add to Home Screen** for a full-screen app icon.
6. ⛶ hides header/footer for theater-style viewing.

## Optional: live Twitch directory + search

Twitch's API requires auth — there is no legal no-key directory API (that's why
Teslurk runs a backend). Without keys, StreamHub plays any channel by name plus a
featured list. For the full live directory, add free credentials in ⚙ Settings:

1. `dev.twitch.tv/console` → register an app (redirect URL `http://localhost`).
2. Copy the **Client ID**; get a token via the implicit grant flow.
3. Paste both into ⚙ Settings (stored only in that browser's localStorage).

## Files

| File | What |
|---|---|
| `index.html` | UI (black + blue theme), player overlay, settings |
| `app.js` | Embed logic, Piped search, M3U/Xtream, hls.js playback |
| `manifest.json` | PWA manifest (relative paths → works under `/streamhub/`) |
| `.github/workflows/deploy.yml` | GitHub Pages deploy |
| `.nojekyll` | Serve as-is on Pages |

## License

MIT.
