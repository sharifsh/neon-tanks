# Neon Tanks
Modern web remake of the 1990 tank classic. Static site — no build step.
- Online rooms up to 8 players: WebRTC P2P (host-authoritative), Supabase Realtime for signaling + relay fallback.
- Shared maps: Supabase table `tank_levels` (project Tank_Battles).
- Local offline test of multiplayer: open two tabs with `?fakenet=1`.
