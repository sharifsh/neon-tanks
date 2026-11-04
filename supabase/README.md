# Supabase (project "Tank_Battles")

- `migrations/` — database changes, named by the version recorded in the project.
- `functions/support/` — the support form and admin page's server (Edge Function `support`, deployed with
  JWT verification off; admin actions check the Supabase Auth token and `app_metadata.support_admin`).
  Email goes out over SMTP on port 465 (SSL/TLS); Edge Functions can't use ports 25 or 587.
  `handler.js` and `smtp.js` run unchanged in the tests (`tests/support-*.spec.js`) with stand-ins.
- `functions/leaderboard/` — the leaderboards' server (Edge Function `leaderboard`, deployed with JWT verification off):
  boards (`top`), posting a finished solo game (`submit`, checked against the game's pacing), `forget` (a player
  removes their results) and admin moderation (`admin_list`, `admin_hide`, `admin_block`, same admin accounts as the
  support inbox). `handler.js` runs unchanged in the tests (`tests/leaderboard-*.spec.js`) with an in-memory stand-in.

Making an account an admin (run once in the SQL editor, after creating the user under Authentication → Users):

```sql
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"support_admin": true}'
where email = '<the admin email>';
```
