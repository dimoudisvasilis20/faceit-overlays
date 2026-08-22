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
- `stats.html` — everything above plus K/D, win rate, HS%, ADR, avg kills, suggested size 560×90

Live match + start/end alerts (`live.html`, `alerts.html`) work differently —
see below.

If you only stream one FACEIT account, set `DEFAULT_NICKNAME` in `.env` and
drop the `?nickname=` query param entirely.

## Live match + start/end alerts (CS2 GSI)

FACEIT has no official API for "what match is this player in right now" - the
only endpoint that exposes it is an internal, undocumented one used by
faceit.com's own website, and it's protected by Cloudflare bot-detection that
blocks non-browser HTTP clients (including this server) regardless of
headers. Rather than fight that, `live.html` and `alerts.html` read live
match state directly from the CS2 client itself via Valve's **Game State
Integration** feature - richer data, zero dependency on FACEIT, and it can't
be blocked by anti-bot tooling since it's an official first-party feature.

This only works for the CS2 client on your own PC (GSI is inherently local -
it's the game reporting on itself), so it's a one-time setup separate from
the FACEIT-nickname-based overlays above:

1. Open `/gsi-setup.html` on your deployment - it generates a private token
   and the exact `gamestate_integration_*.cfg` file content for you.
2. Save that file into CS2's `game/csgo/cfg/` folder and restart CS2.
3. Add the generated `live.html?token=...` and `alerts.html?token=...` URLs
   as Browser Sources.

`src/gsi.js` holds the latest state per token in memory (no database) and
treats it as stale/not-live after 45s without an update from the game.

## Notes & limitations

- **Player stats** use FACEIT's official Data API and are reliable, refreshed
  every ~20-30s (cached server-side to stay well under rate limits).
- The server (`src/server.js`) is what keeps your API key off the page — the
  browser only ever talks to the server, never to FACEIT directly.
- `/api/*` routes (except `/api/gsi/:token`, which never calls FACEIT) are
  rate-limited per IP (`src/rateLimit.js`) since every visitor's requests
  draw from the same shared FACEIT API key/quota.
