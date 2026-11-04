// Supabase Edge Function "leaderboard": the game's leaderboards and the admin page's moderation of them.
// Deploy with JWT verification off: the boards are public, and admin actions check the Supabase Auth token
// themselves (handler.js).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createHandler } from './handler.js';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const url = Deno.env.get('SUPABASE_URL')!;
let secretKeys: Record<string, string> = {};
try { secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); } catch { /* use the legacy key */ }
const serverKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const must = <T>(r: { data: T; error: unknown }) => { if (r.error) throw r.error; return r.data; };
const counted = (r: { count: number | null; error: unknown }) => { if (r.error) throw r.error; return r.count || 0; };

type Row = Record<string, unknown>;
const db = {
  top: async ({ board, period, limit }: { board: string; period: string; limit: number }) =>
    must(await sb.rpc('tank_score_top', { p_board: board, p_period: period, p_limit: limit })),
  mine: async ({ board, period, player }: { board: string; period: string; player: string }) =>
    must(await sb.rpc('tank_score_mine', { p_board: board, p_period: period, p_player: player })),
  submit: async (row: Row, periods: string[]) => must(await sb.rpc('tank_score_submit', {
    p_board: row.board, p_periods: periods, p_player: row.player_id, p_name: row.name, p_level: row.level, p_score: row.score,
    p_kills: row.kills, p_seconds: row.seconds, p_cls: row.cls, p_map: row.map, p_size: row.size, p_source: row.source,
  })),
  forget: async (pid: string) => counted(await sb.from('tank_scores').delete({ count: 'exact' }).eq('player_id', pid)),
  throttleHit: async (keys: string[], limits: number[], since: string) =>
    must(await sb.rpc('tank_score_throttle_hit', { p_keys: keys, p_limits: limits, p_since: since })) === true,
  cleanup: async (weeksBefore: string, throttleBefore: string) => {
    must(await sb.from('tank_scores').delete().neq('period', 'all').lt('created_at', weeksBefore));
    must(await sb.from('tank_score_throttle').delete().lt('created_at', throttleBefore));
  },
  adminList: async ({ board, period, hidden, before, limit }: { board: string | null; period: string | null; hidden: boolean | null; before: string | null; limit: number }) => {
    let q = sb.from('tank_scores').select('board,period,player_id,name,level,score,kills,seconds,cls,map,size,source,hidden,blocked,created_at')
      .order('created_at', { ascending: false }).order('board').order('period').order('player_id').limit(limit);
    if (board) q = q.eq('board', board);
    if (period) q = q.eq('period', period);
    if (hidden === true) q = q.or('hidden.eq.true,blocked.eq.true');
    if (hidden === false) q = q.eq('hidden', false).eq('blocked', false);
    if (before) q = q.lte('created_at', before);
    return must(await q);
  },
  setHidden: async (key: { board: string; period: string; player_id: string }, hidden: boolean) =>
    counted(await sb.from('tank_scores').update({ hidden }, { count: 'exact' }).match(key)),
  block: async (pid: string, on: boolean) => {
    if (on) must(await sb.from('tank_score_blocked').upsert({ player_id: pid }));
    else must(await sb.from('tank_score_blocked').delete().eq('player_id', pid));
    return counted(await sb.from('tank_scores').update({ blocked: on }, { count: 'exact' }).eq('player_id', pid));
  },
};

const auth = {
  getUser: async (token: string) => {
    const { data, error } = await sb.auth.getUser(token);
    return error || !data?.user ? null : data.user;
  },
};

// one-way, salted: the posting limits never store a network address
async function hash(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${serverKey}|leaderboard|${s}`));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const ORIGINS = [
  /^https:\/\/(www\.)?tanksarenabattle\.com$/,
  /^https:\/\/([a-z0-9-]+--)?neon-tanks-sharif\.netlify\.app$/,
  /^capacitor:\/\/localhost$/, // iPhone/iPad app
  /^https?:\/\/localhost(:\d+)?$/, // Android app, local development
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

const handle = createHandler({
  db, auth, hash,
  waitUntil: (p: Promise<unknown>) => { const safe = p.catch(e => console.error('leaderboard background task failed:', e)); if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(safe); },
  allowOrigin: (o: string) => ORIGINS.some(r => r.test(o)),
  log: (...a: unknown[]) => console.error(...a),
});

Deno.serve(handle);
