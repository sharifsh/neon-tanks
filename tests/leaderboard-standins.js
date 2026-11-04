// Stand-ins for the leaderboard server function: an in-memory database that keeps the same rules as the SQL in
// supabase/migrations/*_leaderboard.sql, and a fake sign-in service. Used by the server tests and the page tests;
// nothing here touches the real database.
import { createHandler } from '../supabase/functions/leaderboard/handler.js';

export const USERS = {
  'admin-token': { id: 'a1', email: 'boss@example.com', app_metadata: { support_admin: true } },
  'player-token': { id: 'p1', email: 'someone@example.com', app_metadata: { provider: 'email' } },
};

// ranking: stage/wave, then score, then quicker, then whoever got there first
const rankCmp = (a, b) => (b.level - a.level) || (b.score - a.score) || (a.seconds - b.seconds) || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
const beats = (a, b) => a.level > b.level || (a.level === b.level && (a.score > b.score || (a.score === b.score && a.seconds < b.seconds)));
const shown = r => !r.hidden && !r.blocked;
const pub = (r, rank) => ({ rank, name: r.name, level: r.level, score: r.score, kills: r.kills, seconds: r.seconds, cls: r.cls, at: r.created_at });
// the table's CHECK constraints: a row that breaks one is refused, as the database would
function check(r) {
  const ok = /^(classic|survival):(easy|normal|hard|insane)$/.test(r.board) && (r.period === 'all' || /^[0-9]{4}-W[0-9]{2}$/.test(r.period))
    && [...r.name].length >= 1 && [...r.name].length <= 16 && Number.isInteger(r.level) && r.level >= 1 && r.level <= 999
    && Number.isInteger(r.score) && r.score >= 0 && r.score <= 2e9 && Number.isInteger(r.kills) && r.kills >= 0 && r.kills <= 1e6
    && Number.isInteger(r.seconds) && r.seconds >= 0 && r.seconds <= 86400 && ['striker', 'scout', 'heavy', 'engineer'].includes(r.cls)
    && r.map.length <= 60 && ['', 'S', 'M', 'L'].includes(r.size) && ['web', 'ios', 'android'].includes(r.source);
  if (!ok) throw new Error(`new row for relation "tank_scores" violates check constraint (${JSON.stringify(r)})`);
}

export function memoryLb(start = Date.parse('2026-11-04T12:00:00Z')) {
  const rows = [], throttle = [], blocked = new Set(), calls = [];
  let clock = start, n = 0;
  const board = (b, p) => rows.filter(r => r.board === b && r.period === p && shown(r)).sort(rankCmp);
  const db = {
    async top({ board: b, period, limit }) {
      calls.push(['top', b, period]);
      const list = board(b, period);
      return { total: list.length, entries: list.slice(0, limit).map((r, i) => pub(r, i + 1)) };
    },
    async mine({ board: b, period, player }) {
      calls.push(['mine', b, period]);
      const list = board(b, period), i = list.findIndex(r => r.player_id === player);
      return i < 0 ? null : { ...pub(list[i], i + 1), me: true };
    },
    async submit(row, periods) {
      calls.push(['submit', row.board, periods]);
      for (const r of rows) if (r.player_id === row.player_id && r.name !== row.name) r.name = row.name;
      const blk = blocked.has(row.player_id);
      const at = new Date(clock + ++n).toISOString(); // one moment per post, like now() in a transaction
      const out = {};
      for (const period of periods) {
        let r = rows.find(x => x.board === row.board && x.period === period && x.player_id === row.player_id);
        let improved = false;
        if (!r) { r = { ...row, period, hidden: false, blocked: blk, created_at: at }; check(r); rows.push(r); improved = true; }
        else if (beats(row, r)) {
          const next = { ...r, level: row.level, score: row.score, kills: row.kills, seconds: row.seconds, cls: row.cls, map: row.map, size: row.size, source: row.source, blocked: r.blocked || blk, created_at: at };
          check(next); Object.assign(r, next); improved = true;
        }
        const rank = shown(r) ? 1 + rows.filter(s => s.board === row.board && s.period === period && shown(s) && rankCmp(s, r) < 0).length : null;
        out[period] = { rank, improved, level: r.level, score: r.score, seconds: r.seconds };
      }
      return out;
    },
    async forget(pid) { let k = 0; for (let i = rows.length - 1; i >= 0; i--) if (rows[i].player_id === pid) { rows.splice(i, 1); k++; } return k; },
    async throttleHit(keys, limits, since) { // atomic here: nothing else runs in between
      if (keys.some((key, i) => throttle.filter(t => t.key === key && t.at >= since).length >= limits[i])) return false;
      for (const key of keys) throttle.push({ key, at: new Date(clock).toISOString() });
      return true;
    },
    async cleanup(weeksBefore, throttleBefore) {
      calls.push(['cleanup', weeksBefore, throttleBefore]);
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].period !== 'all' && rows[i].created_at < weeksBefore) rows.splice(i, 1);
      for (let i = throttle.length - 1; i >= 0; i--) if (throttle[i].at < throttleBefore) throttle.splice(i, 1);
    },
    async adminList({ board: b, period, hidden, before, limit }) {
      const key = r => `${r.board}|${r.period}|${r.player_id}`;
      return rows.filter(r => (!b || r.board === b) && (!period || r.period === period) && (hidden === null || hidden === !shown(r)) && (!before || r.created_at <= before))
        .sort((x, y) => y.created_at.localeCompare(x.created_at) || key(x).localeCompare(key(y))).slice(0, limit)
        .map(r => ({ board: r.board, period: r.period, player_id: r.player_id, name: r.name, level: r.level, score: r.score, kills: r.kills, seconds: r.seconds, cls: r.cls, map: r.map, size: r.size, source: r.source, hidden: r.hidden, blocked: r.blocked, created_at: r.created_at }));
    },
    async setHidden(key, hidden) { const r = rows.find(x => x.board === key.board && x.period === key.period && x.player_id === key.player_id); if (!r) return 0; r.hidden = hidden; return 1; },
    async block(pid, on) { if (on) blocked.add(pid); else blocked.delete(pid); let k = 0; for (const r of rows) if (r.player_id === pid) { r.blocked = on; k++; } return k; },
  };
  return { db, rows, throttle, blocked, calls, tick: ms => { clock += ms; }, now: () => new Date(clock), setNow: t => { clock = t; } };
}

export function lbBackend({ origins = [/^http:\/\/(neon\.test|localhost|127\.0\.0\.1)(:\d+)?$/, /^https:\/\/tanksarenabattle\.com$/, /^capacitor:\/\/localhost$/, /^https:\/\/localhost$/], start } = {}) {
  const mem = memoryLb(start);
  const pending = [];
  const handle = createHandler({
    db: mem.db,
    auth: { getUser: async t => USERS[t] || null },
    hash: async s => `h(${s})`,
    now: mem.now,
    waitUntil: p => pending.push(p),
    allowOrigin: o => origins.some(r => r.test(o)),
  });
  return Object.assign(mem, { handle, flush: async () => { while (pending.length) await pending.shift(); } });
}

// Sends the game's leaderboard calls to the stand-in (registered after the test helpers' network block, so it wins).
// down: true makes the server unreachable, like being offline.
export async function routeLeaderboard(page, lb, { down = false } = {}) {
  const calls = [];
  await page.route(/supabase\.co\/functions\/v1\/leaderboard/, async route => {
    const req = route.request();
    let body = null;
    if (req.method() === 'POST') { body = req.postData(); try { calls.push(JSON.parse(body)); } catch { calls.push(body); } }
    if (down) return route.abort('internetdisconnected');
    const r = await lb.handle(new Request(req.url(), { method: req.method(), headers: req.headers(), body }));
    return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: r.status === 204 ? '' : await r.text() });
  });
  return { calls, setDown: v => { down = v; } };
}

// A result as the game sends it, paced like a real game: each stage cleared `gap` seconds after the one before.
export function paced({ mode = 'classic', difficulty = 'normal', level = 3, gap = 80, score, kills, cls = 'striker', map = 'random', size = 'M', extra = 30 } = {}) {
  const clears = level - 1;
  const splits = Array.from({ length: clears }, (_, i) => (i + 1) * gap);
  const k = kills ?? clears * 20 + 5;
  return { mode, difficulty, level, score: score ?? clears * 1000 + k * 150, kills: k, seconds: clears * gap + extra, splits, cls, map, size };
}
