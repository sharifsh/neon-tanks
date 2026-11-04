import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../supabase/functions/leaderboard/handler.js';
import { lbBackend, paced } from './leaderboard-standins.js';

// The leaderboard's SQL (the migration), run in an in-process Postgres (PGlite) here, never the real database.
// The same scenario goes through the real server code twice, on the SQL functions and on the in-memory stand-in the
// other tests use: the answers must match, so the stand-in can be trusted. Also checks the public roles' access.

const MIGRATION = new URL(`../supabase/migrations/${readdirSync(new URL('../supabase/migrations/', import.meta.url)).find(f => f.endsWith('_leaderboard.sql'))}`, import.meta.url);
const PID = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const USERS = { 'admin-token': { app_metadata: { support_admin: true } } };

async function sqlBackend() {
  const pg = new PGlite();
  await pg.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;'); // as in Supabase
  await pg.exec(readFileSync(MIGRATION, 'utf8'));
  const val = async (sql, args) => Object.values((await pg.query(sql, args)).rows[0])[0];
  const count = async (sql, args) => (await pg.query(sql, args)).rows.length;
  // the same calls supabase/functions/leaderboard/index.ts makes, written as SQL
  const db = {
    top: ({ board, period, limit }) => val('select public.tank_score_top($1, $2, $3)', [board, period, limit]),
    mine: ({ board, period, player }) => val('select public.tank_score_mine($1, $2, $3::uuid)', [board, period, player]),
    submit: (r, periods) => val('select public.tank_score_submit($1, $2::text[], $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [r.board, periods, r.player_id, r.name, r.level, r.score, r.kills, r.seconds, r.cls, r.map, r.size, r.source]),
    forget: pid => count('delete from public.tank_scores where player_id = $1::uuid returning 1', [pid]),
    throttleHit: (keys, limits, since) => val('select public.tank_score_throttle_hit($1::text[], $2::int[], $3::timestamptz)', [keys, limits, since]),
    cleanup: async (weeksBefore, throttleBefore) => {
      await pg.query("delete from public.tank_scores where period <> 'all' and created_at < $1::timestamptz", [weeksBefore]);
      await pg.query('delete from public.tank_score_throttle where created_at < $1::timestamptz', [throttleBefore]);
    },
    adminList: async ({ board, period, hidden, before, limit }) => (await pg.query(
      `select board, period, player_id::text, name, level, score, kills, seconds, cls, map, size, source, hidden, blocked, created_at
         from public.tank_scores
        where ($1::text is null or board = $1) and ($2::text is null or period = $2)
          and ($3::boolean is null or ($3 and (hidden or blocked)) or (not $3 and not hidden and not blocked))
          and ($4::timestamptz is null or created_at <= $4)
        order by created_at desc, board, period, player_id limit $5`, [board, period, hidden, before, limit])).rows,
    setHidden: (k, hidden) => count('update public.tank_scores set hidden = $4 where board = $1 and period = $2 and player_id = $3::uuid returning 1', [k.board, k.period, k.player_id, hidden]),
    block: async (pid, on) => {
      if (on) await pg.query('insert into public.tank_score_blocked (player_id) values ($1::uuid) on conflict do nothing', [pid]);
      else await pg.query('delete from public.tank_score_blocked where player_id = $1::uuid', [pid]);
      return count('update public.tank_scores set blocked = $2 where player_id = $1::uuid returning 1', [pid, on]);
    },
  };
  const handle = createHandler({ db, auth: { getUser: async t => USERS[t] || null }, hash: async s => `h(${s})`, allowOrigin: () => true });
  return { pg, handle };
}

// a season in miniature: posts, ties, renames, a hidden entry, a hidden player who keeps posting, removal, limits
async function scenario(handle) {
  const out = [];
  const drop = (k, v) => (k === 'at' || k === 'created_at' || k === 'resets' ? undefined : v); // moments differ between the two
  const sorted = (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v);
  const call = async (body, { token, ip = '203.0.113.7' } = {}) => {
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip };
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await handle(new Request('https://x/functions/v1/leaderboard', { method: 'POST', headers, body: JSON.stringify(body) }));
    out.push(JSON.stringify(JSON.parse(JSON.stringify({ status: r.status, ...(await r.json()) }, drop)), sorted));
  };
  const post = (pid, name, run, ip) => call({ action: 'submit', pid, name, run, source: 'web' }, { ip });
  const top = (pid, period = 'week', mode = 'classic', difficulty = 'normal') => call({ action: 'top', mode, difficulty, period, pid });
  const admin = body => call(body, { token: 'admin-token' });
  await post(PID[0], 'Rex', paced({ level: 3 }));
  await post(PID[1], 'Mila', paced({ level: 5 }));
  await post(PID[0], 'Rex', paced({ level: 2 }));
  await post(PID[2], 'Zed', paced({ level: 5, kills: 90, score: 4000 + 90 * 300 }));
  await post(PID[0], 'Rex II', paced({ level: 9 }));
  await post(PID[1], 'Mila', paced({ level: 5 }));
  await top(PID[1]); await top(PID[0], 'all'); await top(null); await top(PID[2], 'week', 'survival');
  await post(PID[2], 'Zed', paced({ mode: 'survival', difficulty: 'hard', level: 6, gap: 140, kills: 120, score: 25000 }));
  await admin({ action: 'admin_hide', board: 'classic:normal', period: 'all', player_id: PID[0] });
  await admin({ action: 'admin_block', player_id: PID[2] });
  await post(PID[2], 'Zed', paced({ level: 12 }));
  await top(PID[2], 'all');
  await admin({ action: 'admin_list', hidden: true });
  await admin({ action: 'admin_block', player_id: PID[2], blocked: false });
  await top(PID[2], 'all'); await top(PID[0], 'all');
  await call({ action: 'forget', pid: PID[1] });
  await top(PID[1]);
  for (let i = 0; i < 30; i++) await post(PID[0], 'Rex II', paced({ level: 2 }), `198.51.100.${i % 2}`); // 33 in all: past the player's 30 an hour
  await admin({ action: 'admin_list', period: 'all' });
  return out;
}

test('the SQL and the stand-in give the same answers, and the public roles can\'t reach anything', async () => {
  const sql = await sqlBackend();
  const a = await scenario(sql.handle);
  const b = await scenario(lbBackend({ start: Date.now() }).handle);
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i], `step ${i}`).toBe(b[i]);
  expect(a.filter(x => x.includes('"status":429'))).toHaveLength(3);
  // no table, sequence or function is open to the public roles; the server role can use the functions
  const grants = (await sql.pg.query("select grantee, table_name from information_schema.role_table_grants where table_name like 'tank_score%' and grantee in ('anon', 'authenticated', 'PUBLIC')")).rows;
  expect(grants).toEqual([]);
  const fns = (await sql.pg.query("select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authd, has_function_privilege('service_role', p.oid, 'execute') as server from pg_proc p where p.proname like 'tank_score%' order by 1")).rows;
  expect(fns.map(f => [f.proname, f.anon, f.authd, f.server])).toEqual([
    ['tank_score_mine', false, false, true], ['tank_score_submit', false, false, true], ['tank_score_throttle_hit', false, false, true], ['tank_score_top', false, false, true]]);
  const seq = (await sql.pg.query("select has_sequence_privilege('anon', 'public.tank_score_throttle_id_seq', 'usage') as a, has_sequence_privilege('authenticated', 'public.tank_score_throttle_id_seq', 'usage') as b")).rows[0];
  expect(seq).toEqual({ a: false, b: false });
  const rls = (await sql.pg.query("select relname, relrowsecurity from pg_class where relname in ('tank_scores', 'tank_score_blocked', 'tank_score_throttle') order by 1")).rows;
  expect(rls.every(r => r.relrowsecurity)).toBe(true);
});

test('a refused row never half-writes: a bad board breaks the CHECK and nothing is kept', async () => {
  const { pg } = await sqlBackend();
  await expect(pg.query("select public.tank_score_submit('valueOf:normal', array['all'], gen_random_uuid(), 'X', 1, 0, 0, 0, 'striker', '', '', 'web')")).rejects.toThrow(/check constraint/);
  expect((await pg.query('select count(*)::int as n from public.tank_scores')).rows[0].n).toBe(0);
});
