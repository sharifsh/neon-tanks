# Neon Tanks
Modern web remake of the 1990 tank classic. Static site — no build step.
- Online rooms up to 8 players: WebRTC P2P (host-authoritative), Supabase Realtime for signaling + relay fallback.
- Shared maps: Supabase table `tank_levels` (project Tank_Battles).
- Local offline test of multiplayer: open two tabs with `?fakenet=1`.

## Round 2
- Two players on one keyboard (or two gamepads) — add Player 2 in the lobby.
- Rebindable controls (⌨ Controls), saved per browser.
- Difficulty: Easy / Normal / Hard / Insane.
- Spectators: rooms hold 8 players + 7 spectators; spectators can take a slot when one frees up.
- Host migration: the host streams a full game checkpoint every 2s; if the host leaves, the earliest-joined peer takes over and everyone reconnects automatically.

## Round 3 — visual styles
Per-player style picker (menu, lobby, pause): Neon, Modern Warfare (realistic MBTs), Miniature (tilt-shift diorama),
Pixel Remaster, Winter Front, Desert Storm, Blueprint. Styles are purely visual (themes.js); gameplay is identical.

## App Store / Google Play (Capacitor 8)
Store name **Neon Tanks: Arena Battle** · bundle/app ID `com.sharifsh.neontanks` · SKU `neontanks001`.
- Web files live in `public/` (Netlify publishes `public/`). The website is the free version.
- `public/store.js`: `FREE` (what's free; online rooms hosted with the free version hold `FREE.players` = 4 players, full version 8), `Full` (store checks at launch and on return, product re-query when the unlock card opens, buy, restore). Product ID `com.sharifsh.neontanks.full` (non-consumable, @capgo/native-purchases). Online rooms follow the host's copy.
- `npm test`: Playwright tests with a stand-in store (fake `window.Capacitor`); the real database is blocked in tests.
- `npm run assets`: regenerate icons/splash from `assets/`. `npm run vendor`: rebuild the bundled supabase-js.
- CI: `testflight.yml` (secret check → unsigned archive on macOS/Xcode 26 → cloud-signed export with the ASC API key → TestFlight; build number = run number), `ios.yml` (simulator compile), `android.yml`, `deploy.yml` (tests → Netlify build hook).
- Repo secrets: `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `NETLIFY_BUILD_HOOK`.
