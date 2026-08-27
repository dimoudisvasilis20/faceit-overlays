# FACEIT Overlays

OBS overlays that pull CS2 stats from FACEIT: a player-stats card (ELO, level,
K/D, win rate) and a match start/end alert toast. One deployment can
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
- `roster.html` — full-canvas live match overlay: your team pinned left, enemy
  team pinned right, map + average team ELO centered at the bottom. Size it
  to your whole stream canvas (e.g. 1920×1080)

Match start/end alerts (`alerts.html`) work differently — see below.

If you only stream one FACEIT account, set `DEFAULT_NICKNAME` in `.env` and
drop the `?nickname=` query param entirely.

## How live match data works

FACEIT has no *documented* API for "what match is this player in right now."
Two different workarounds cover different overlays:

**`roster.html`** calls an internal, undocumented FACEIT endpoint
(`getLiveMatchId` in `src/faceit.js`) to find the current match, then pulls
the full roster/score/map from the official Data API. That internal endpoint
sits behind Cloudflare bot-protection that blocks Node's built-in `fetch`
specifically by TLS fingerprint (confirmed by testing: identical requests
succeed via `curl` and get a 403 via `fetch`) - so this call shells out to
`curl` instead. It's inherently best-effort: FACEIT could block `curl`'s
fingerprint too, without notice, at any time, and every caller here treats
failures as "no live match" rather than an error. Requires `curl` to be on
the server's `PATH` (present by default on Render and most Linux hosts).

**`alerts.html`** instead reads live match state directly from the CS2
client via Valve's **Game State Integration** feature. This is what
match-start (map + opponents) and match-end (win/loss + score) are based on.
It's more reliable for match phase changes, but CS2 only sends full
`allplayers` data while spectating - never while actively playing - so it
can't power a persistent, always-on roster like `roster.html` does; that's
why the two overlays use different data sources. GSI only works for the CS2
client on your own PC, so it needs a one-time separate setup:

1. Open `/gsi-setup.html` on your deployment - it generates a private token
   and the exact `gamestate_integration_*.cfg` file content for you.
2. Save that file into CS2's `game/csgo/cfg/` folder and restart CS2.
3. Add the generated `alerts.html?token=...` URL as a Browser Source.

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
