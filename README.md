# FACEIT Overlays

OBS overlays that pull CS2 stats from FACEIT: a player-stats card (ELO, level,
K/D, win rate) and a best-effort live-match scoreboard. One deployment can
serve overlays for **any** FACEIT nickname via `?nickname=` — a single hosted
instance works for multiple streamers, each using their own nickname; only
the person running the server needs a FACEIT API key.

## Setup

1. Get a FACEIT **server-side** API key:
   - Go to https://developers.faceit.com and log in
   - Studio → Create App
   - App → API Keys → Create API Key → type **Server-side**
2. Copy `.env.example` to `.env` and fill in:
   ```
   FACEIT_API_KEY=your-key-here
   DEFAULT_NICKNAME=your-faceit-nickname
   ```
3. Install dependencies and start the server:
   ```bash
   npm install
   npm start
   ```
4. Open http://localhost:4173 — it generates the exact URLs to paste into OBS.

## Adding to OBS

Add a **Browser Source** for each overlay, pointing at the URL from the setup
page (e.g. `http://localhost:4173/stats.html?nickname=yourname`). All pages
have transparent backgrounds, so no chroma key is needed.

- `mini.html` — level ring + ELO only, suggested size 200×60
- `compact.html` — level, nickname, ELO(+delta), today's wins/losses, suggested size 320×70
- `stats.html` — everything above plus K/D and win rate, suggested size 460×90
- `live.html` — live match scoreboard, suggested size 380×70
- `alerts.html` — match-started / match-ended toast, suggested size 320×90 (stays invisible otherwise)

If you only stream one FACEIT account, set `DEFAULT_NICKNAME` in `.env` and
drop the `?nickname=` query param entirely.

## Notes & limitations

- **Player stats** use FACEIT's official Data API and are reliable, refreshed
  every ~20-30s (cached server-side to stay well under rate limits).
- **Live match** detection uses an *undocumented* endpoint that powers the
  "LIVE" badge on faceit.com profiles — FACEIT does not officially expose a
  "current match" endpoint. It can stop working without notice; if it does,
  `live.html` will just stay hidden instead of erroring.
- **Match-end results** come from FACEIT's official match history, so they
  only appear once the match is fully finished and processed — `alerts.html`
  retries for about 15s after detecting a match ended before giving up.
- The server (`src/server.js`) is what keeps your API key off the page — the
  browser only ever talks to the server, never to FACEIT directly.
- `/api/*` routes are rate-limited per IP (`src/rateLimit.js`) since every
  visitor's requests draw from the same shared FACEIT API key/quota.
