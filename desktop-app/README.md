# FACEIT Overlay Relay (desktop app)

A tray app that replaces manually running `local-helper/live-match-relay.mjs`
in a terminal. Same underlying logic (finds your current FACEIT match every
10s via `curl`, since that lookup works from an ordinary home connection but
gets Cloudflare-challenged from cloud-hosted servers) and pushes it to your
overlay server for `roster.html` - just packaged as something you can
double-click instead of needing Node.js installed or a terminal open.

## Using it

1. Run the installer, launch the app - it lives in the system tray.
2. On first launch (or click the tray icon any time) a small window opens
   asking for your FACEIT nickname. Enter it and click Save.
3. Copy the generated overlay URL into OBS/Streamlabs as a Browser Source.
4. Leave the app running in the tray while you stream. The tray tooltip and
   settings window both show live status ("No live match" / "Live match
   found (...)").

Settings (nickname, a private token, which server to talk to) are stored in
`app.getPath('userData')` (`%APPDATA%\faceit-overlay-relay\config.json` on
Windows) - not in this repo.

## Developing

```bash
npm install
npm start        # run in dev mode
npm run dist      # build a Windows installer into dist/
```

`CSC_IDENTITY_AUTO_DISCOVERY=false` and `win.signAndEditExecutable: false`
(already set in `package.json`) skip electron-builder's code-signing-related
tooling, which otherwise tries to download a bundle that fails to extract on
Windows without Developer Mode enabled (unrelated to whether you actually
sign the build). The output is unsigned, so Windows SmartScreen will warn
first-time installers - "More info" → "Run anyway".
