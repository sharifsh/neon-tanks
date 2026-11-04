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
- Online pause: a pause stops the game for everyone and says who paused; the pauser or the host resumes. The host's room option Pause: Anyone (default) or Host only, remembered on that device; a game paused when the host leaves stays paused for the new host.

## Round 3 — visual styles
Per-player style picker (menu, lobby, pause): Neon, Modern Warfare (realistic MBTs), Miniature (tilt-shift diorama),
Pixel Remaster, Winter Front, Desert Storm, Blueprint. Styles are purely visual (themes.js); gameplay is identical.

## Leaderboards
- Solo Classic and Survival results, one board per mode and difficulty, for this week (ISO week, UTC; starts over Monday) and all time; each player's best counts (stage/wave, then score, then quicker). Two players on one device, online rooms, the editor's test play and own/community maps don't post.
- Posted automatically when a game ends or is left (Settings switch to turn it off; Settings → Remove my leaderboard results). Offline results wait on the device and go out later. `public/leaderboard.js` (client), `game.splits` (stage/wave clear times).
- Server function `leaderboard` (`supabase/functions/leaderboard/`): checks each result against the game's own pacing (no stage cleared quicker than its enemies can arrive), kill and score bounds, a callsign filter and posting limits; tables `tank_scores`, `tank_score_blocked`, `tank_score_throttle` (migration `*_leaderboard.sql`). Player IDs are random, made on the device, never shown.
- Moderation: the admin page's Leaderboards tab (hide an entry, or hide a player and everything they post).
- Tests: `tests/leaderboard-server.spec.js` (rules, limits, a simulated perfect player is always accepted), `tests/leaderboard-ui.spec.js` (the game and admin page), `tests/leaderboard-sql.spec.js` (the migration in an in-process Postgres, PGlite, gives the same answers as the in-memory stand-in). None of them touch the real database.

## App Store / Google Play (Capacitor 8)
Store name **Neon Tanks: Arena Battle** · bundle/app ID `com.sharifsh.neontanks` · SKU `neontanks001`.
- Web files live in `public/` (Netlify publishes `public/`). The website is the free version.
- `public/store.js`: `FREE` (what's free; online rooms hosted with the free version hold `FREE.players` = 4 players, full version 8), `Full` (store checks at launch and on return, product re-query when the unlock card opens, buy, restore). The check also acknowledges Google Play purchases the plugin didn't (promo codes, slow payments), since Google refunds unacknowledged ones. Product ID `com.sharifsh.neontanks.full` (non-consumable, @capgo/native-purchases). Online rooms follow the host's copy.
- `npm test`: Playwright tests with a stand-in store (fake `window.Capacitor`); the real database is blocked in tests.
- `npm run assets`: regenerate icons/splash from `assets/`. `npm run vendor`: rebuild the bundled supabase-js.
- CI: `testflight.yml` (secret check → unsigned archive on macOS/Xcode 26 → cloud-signed export with the ASC API key → TestFlight; build number = run number), `ios.yml` (simulator compile), `android.yml` (debug APK + unsigned bundle on every push), `play.yml` (by hand: bundle signed with the upload key, versionCode 100 + run number; sent to Google Play internal testing by `tools/play-upload.mjs` when the service account secret is set, otherwise download it from the run), `deploy.yml` (tests → Netlify build hook).
- Netlify deploys only when `public/` or `netlify.toml` changed (`ignore` in netlify.toml), since every production deploy spends credits.
- Repo secrets: `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `NETLIFY_BUILD_HOOK`; Google Play: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD` (upload key, alias `upload`, shared with Octo Blast), `PLAY_SERVICE_ACCOUNT_JSON` (service account with release rights for testing tracks).
