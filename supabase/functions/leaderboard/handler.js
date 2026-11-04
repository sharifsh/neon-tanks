// Server side of the Neon Tanks leaderboards. Runs as a Supabase Edge Function (index.ts wires it to the database
// and Supabase Auth); the tests wire it to stand-ins.
//
// One endpoint, POST JSON { action, ... }:
//   top          public: one board (Classic or Survival, one difficulty) for this week or all time, plus the asking
//                player's own entry wherever it ranks. The top of each board is kept here for a few seconds.
//   submit       public: a finished solo Classic or Survival game. It is checked against the game's own pacing (a
//                stage can't be cleared before its enemies have even arrived) and kept if it beats the player's best
//                this week or of all time
//   forget       public: removes every entry of the given player ID (a random ID only that device knows)
//   admin_list, admin_hide, admin_block   admin only (Supabase Auth account whose app_metadata.support_admin is true)

export const MODES = { classic: 'Classic', survival: 'Survival' };
// Enemy count per difficulty, as in public/const.js (DIFFICULTIES[...].count). tests/leaderboard-server.spec.js
// checks these numbers against the game's own.
export const DIFFS = { easy: 0.7, normal: 1, hard: 1.25, insane: 1.6 };
export const CLASSES = ['striker', 'scout', 'heavy', 'engineer'];
export const SOURCES = ['web', 'ios', 'android'];
export const SIZES = ['S', 'M', 'L'];
export const LIMITS = { perPlayerHour: 30, perAddressHour: 120, allPerHour: 3000, top: 50, topSeconds: 20, keepWeeks: 13, maxLevel: 999, maxSeconds: 86400, adminPage: 100, body: 20000 };
// A result may come in up to a quarter quicker than the game's fastest possible pace, never quicker than that.
export const PACE = 0.75;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEK = /^[0-9]{4}-W[0-9]{2}$/;
const BOARD = /^(classic|survival):(easy|normal|hard|insane)$/;

const str = v => (typeof v === 'string' ? v : '');
const int = v => (Number.isInteger(v) ? v : NaN);
const isMode = m => typeof m === 'string' && Object.hasOwn(MODES, m);
const isDiff = d => typeof d === 'string' && Object.hasOwn(DIFFS, d);

// ---------- the game's pacing (solo, one player), from public/game.js ----------
// enemies in Classic stage n (the same every stage) or Survival wave n
export function stageEnemies(mode, diff, n) {
  const c = DIFFS[diff];
  return mode === 'survival' ? Math.max(4, Math.round((6 + n * 3 + 2) * c)) : Math.max(6, Math.round((16 + 4) * c));
}
// The soonest stage/wave n can be cleared after the one before it: enemies arrive one at a time, at most one per spawn
// interval, after a short opening delay, and a stage can't be clear before the last one has arrived. Between stages
// the game waits 4 s (Classic) or 5 s (Survival; the first wave starts 3 s in).
export function minClearGap(mode, diff, n) {
  const T = stageEnemies(mode, diff, n);
  if (mode === 'survival') return (n === 1 ? 3 : 5) + 1 + (T - 1) * 2.35;
  return (n === 1 ? 0 : 4) + 1.5 + (T - 1) * Math.max(0.8, 2.4 - 0.05 * n);
}

// Why a result can't be right, or '' if it could be. splits: game time (s) when each stage/wave was cleared.
export function checkRun(run) {
  const { mode, difficulty } = run;
  if (!isMode(mode) || !isDiff(difficulty)) return 'board';
  const level = int(run.level), score = int(run.score), kills = int(run.kills), seconds = run.seconds;
  if (!(level >= 1 && level <= LIMITS.maxLevel)) return 'level';
  if (!(score >= 0 && score <= 2e9) || !(kills >= 0 && kills <= 1e6)) return 'score';
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > LIMITS.maxSeconds) return 'time';
  const splits = run.splits;
  // the game can end during a stage (level - 1 cleared) or in the pause right after clearing it (level cleared)
  if (!Array.isArray(splits) || (splits.length !== level - 1 && splits.length !== level)) return 'pace';
  let prev = 0;
  for (let i = 0; i < splits.length; i++) {
    const t = splits[i];
    if (typeof t !== 'number' || !Number.isFinite(t) || t - prev < minClearGap(mode, difficulty, i + 1) * PACE) return 'pace';
    prev = t;
  }
  if (seconds + 1 < prev) return 'pace';
  // kills: every stage's enemies, plus Titan reinforcements (every 10 s) and random enemy flanks (every 18 s or more)
  const bosses = Math.floor(level / (mode === 'survival' ? 5 : 4));
  const events = Math.ceil(seconds / 18) + 1;
  let enemies = 0;
  for (let n = 1; n <= level; n++) enemies += stageEnemies(mode, difficulty, n) + (n % (mode === 'survival' ? 5 : 4) === 0 ? 1 : 0);
  if (kills > enemies + Math.ceil(seconds / 10) * 4 + events * 6) return 'kills';
  // score: at most 400 per enemy, 5000 per Titan, 500 per power-up, 1000 per cleared Classic stage
  const powerups = Math.ceil(kills / 5) + 2 * bosses + 2 * events + 2;
  const clears = splits.length;
  if (score > kills * 400 + bosses * 5000 + powerups * 500 + (mode === 'classic' ? clears * 1000 : 0)) return 'score';
  if (mode === 'classic' && score < clears * 1000) return 'score';
  return '';
}

// ---------- callsigns ----------
// Control characters, zero-width and other invisible characters (including "blank" letters such as the Hangul
// fillers) are removed; a callsign needs at least one visible letter or digit.
const chars = (...ranges) => `[${ranges.map(([a, b = a]) => String.fromCodePoint(a) + (b > a ? `-${String.fromCodePoint(b)}` : '')).join('')}]`; // a class written as code points
const INVISIBLE = new RegExp(chars([0x0, 0x1f], [0x7f, 0x9f], [0xad], [0x34f], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0x2800], [0x3164], [0xfe00, 0xfe0f], [0xffa0], [0xfeff]), 'gu');
const MARKS = new RegExp(chars([0x300, 0x36f]), 'g'); // accents, once letters are taken apart (NFKD)
export function cleanName(v) {
  const s = str(v).normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  const out = [...s].slice(0, 16).join('').trim();
  return /[\p{L}\p{N}]/u.test(out) ? out : '';
}
// A short list on purpose (the admin page can hide anything that gets past it), matched so ordinary names pass:
// ANYWHERE: found anywhere, even with dots or spaces in between; START: a word that starts with it; WORDS: whole words.
const ANYWHERE = ['fuck', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'bitch', 'slut', 'porn', 'dildo', 'jizz', 'asshole', 'motherf', 'hitler', 'retard', 'molest'];
const START = ['shit', 'pussy', 'penis', 'vagina', 'twat', 'wanker', 'pedo', 'paedo', 'nigg', 'rapist'];
const WORDS = ['ass', 'cum', 'sex', 'tits', 'dick', 'cock', 'anal', 'rape', 'kys', 'nsfw', 'xxx', 'fag', 'fags', 'nazi', 'nazis', 'kkk', 'fuk', 'fck', 'wank'];
const LEET = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '€': 'e' };
export function badName(name) {
  const plain = name.toLowerCase().normalize('NFKD').replace(MARKS, '').replace(/[0-9@$!|+€]/g, c => LEET[c] || c);
  const squashed = plain.replace(/[^a-z]/g, '');
  const words = plain.split(/[^a-z]+/).filter(Boolean);
  return ANYWHERE.some(w => squashed.includes(w))
    || START.some(w => squashed.startsWith(w) || words.some(t => t.startsWith(w)))
    || words.some(t => WORDS.includes(t));
}

// ---------- weeks (ISO 8601, UTC; a new week starts Monday 00:00 UTC) ----------
export function weekKey(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const y = t.getUTCFullYear();
  const wk = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}
export function weekEnds(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + (8 - (t.getUTCDay() || 7)));
  return t;
}

// The network address for posting limits: IPv4 as is, IPv6 by its /64 network (one home or phone gets a whole /64).
export function addressKey(ip) {
  const a = str(ip).trim().toLowerCase();
  const v4 = /(\d{1,3}(\.\d{1,3}){3})$/.exec(a); // IPv4, also when written as IPv6 (::ffff:1.2.3.4)
  if (v4) return v4[1];
  if (!a.includes(':')) return a || 'unknown';
  const two = a.includes('::');
  const [head, tail = ''] = a.split('::');
  const h = head ? head.split(':') : [], t = two && tail ? tail.split(':') : [];
  const groups = two ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map(g => (g || '0').replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

export function createHandler(deps) {
  const {
    db, auth, hash,
    now = () => new Date(),
    waitUntil = p => { p.catch(() => {}); },
    allowOrigin = () => false,
    log = () => {},
  } = deps;

  const corsFor = origin => (origin && allowOrigin(origin) ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-max-age': '86400',
    vary: 'Origin',
  } : { vary: 'Origin' });

  const reply = (status, body, cors) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
  });

  function clientIp(req) {
    const h = req.headers;
    return h.get('cf-connecting-ip') || h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  }
  const boardOf = body => (isMode(body.mode) && isDiff(body.difficulty) ? `${body.mode}:${body.difficulty}` : '');

  // the top of each board, for a few seconds: reading a board then costs no database work
  const tops = new Map();
  async function topOf(board, period) {
    const key = `${board}|${period}`, t = now().getTime(), c = tops.get(key);
    if (c && t - c.at < LIMITS.topSeconds * 1000) return c.data;
    const data = await db.top({ board, period, limit: LIMITS.top });
    tops.set(key, { at: t, data });
    if (tops.size > 200) tops.delete(tops.keys().next().value);
    return data;
  }
  const forgetTops = board => { for (const k of [...tops.keys()]) if (!board || k.startsWith(`${board}|`)) tops.delete(k); };

  // ---------- public ----------
  async function top(body, cors) {
    const board = boardOf(body);
    if (!board) return reply(400, { ok: false, error: 'Unknown leaderboard.' }, cors);
    const t = now(), week = weekKey(t);
    const all = body.period === 'all', period = all ? 'all' : week;
    const pid = UUID.test(str(body.pid)) ? body.pid.toLowerCase() : null;
    const [data, mine] = await Promise.all([topOf(board, period), pid ? db.mine({ board, period, player: pid }) : null]);
    const isMine = e => !!mine && e.rank === mine.rank && e.name === mine.name && e.level === mine.level && e.score === mine.score;
    return reply(200, {
      ok: true, board, period: all ? 'all' : 'week', week, resets: weekEnds(t).toISOString(), total: data.total,
      entries: data.entries.map(e => ({ ...e, me: isMine(e) })), me: mine || null,
    }, cors);
  }

  async function submit(body, req, cors) {
    const pid = str(body.pid).toLowerCase();
    if (!UUID.test(pid)) return reply(400, { ok: false, reason: 'player', error: 'Bad request.' }, cors);
    const name = cleanName(body.name);
    if (!name) return reply(422, { ok: false, reason: 'name', error: 'Set a callsign to post your results.' }, cors);
    if (badName(name)) return reply(422, { ok: false, reason: 'name', error: "This callsign can't be shown on the leaderboard." }, cors);
    const run = body.run && typeof body.run === 'object' ? body.run : {};
    const why = checkRun(run);
    if (why) {
      log(`leaderboard: refused a result (${why})`);
      return reply(422, { ok: false, reason: why, error: "This result couldn't be posted." }, cors);
    }
    const t = now();
    const hourAgo = new Date(t.getTime() - 3600e3).toISOString();
    const who = `p:${pid}`, addr = `a:${await hash(addressKey(clientIp(req)))}`;
    if (!await db.throttleHit([who, addr, 'all'], [LIMITS.perPlayerHour, LIMITS.perAddressHour, LIMITS.allPerHour], hourAgo)) {
      return reply(429, { ok: false, reason: 'busy', error: 'Too many results at once. Please try again later.' }, cors);
    }
    // a result sent late (kept on the device while offline) counts for the week it was played in, if that's this week
    const ago = typeof body.ago === 'number' && Number.isFinite(body.ago) ? Math.min(Math.max(body.ago, 0), 400 * 86400) : 0;
    const board = `${run.mode}:${run.difficulty}`, week = weekKey(t);
    const periods = weekKey(new Date(t.getTime() - ago * 1000)) === week ? [week, 'all'] : ['all'];
    const res = await db.submit({
      board, player_id: pid, name,
      level: run.level, score: run.score, kills: run.kills, seconds: Math.round(run.seconds),
      cls: CLASSES.includes(run.cls) ? run.cls : 'striker',
      map: str(run.map).slice(0, 60), size: SIZES.includes(run.size) ? run.size : '',
      source: SOURCES.includes(body.source) ? body.source : 'web',
    }, periods);
    forgetTops(board);
    waitUntil(db.cleanup(
      new Date(t.getTime() - LIMITS.keepWeeks * 7 * 86400e3).toISOString(),
      new Date(t.getTime() - 86400e3).toISOString(),
    ));
    return reply(200, { ok: true, board, week, name, weekly: res[week] || null, allTime: res.all }, cors);
  }

  async function forget(body, cors) {
    const pid = str(body.pid).toLowerCase();
    if (!UUID.test(pid)) return reply(400, { ok: false, error: 'Bad request.' }, cors);
    const removed = await db.forget(pid);
    if (removed) forgetTops();
    return reply(200, { ok: true, removed }, cors);
  }

  // ---------- admin ----------
  async function admin(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
    if (!m) return { status: 401, error: 'Please sign in.' };
    const user = await auth.getUser(m[1].trim());
    if (!user) return { status: 401, error: 'Your sign-in has expired. Please sign in again.' };
    if (!user.app_metadata || user.app_metadata.support_admin !== true) return { status: 403, error: "This account doesn't have access to the leaderboards." };
    return { user };
  }

  async function adminAction(action, body, cors) {
    switch (action) {
      case 'admin_list': {
        const board = body.board ? str(body.board) : null;
        if (board && !BOARD.test(board)) return reply(400, { ok: false, error: 'Unknown leaderboard.' }, cors);
        const period = body.period === 'all' ? 'all' : body.period === 'week' ? weekKey(now()) : (WEEK.test(str(body.period)) ? body.period : null);
        const hidden = typeof body.hidden === 'boolean' ? body.hidden : null;
        // older entries: those up to and including this moment (a post writes its week and all-time entries at the
        // same moment, so the next page repeats them rather than skip one; the admin page drops the repeats)
        const before = str(body.before) && !Number.isNaN(Date.parse(body.before)) ? body.before : null;
        const rows = await db.adminList({ board, period, hidden, before, limit: LIMITS.adminPage });
        return reply(200, { ok: true, week: weekKey(now()), entries: rows, more: rows.length === LIMITS.adminPage }, cors);
      }
      case 'admin_hide': {
        const { board, period } = body;
        const pid = str(body.player_id).toLowerCase();
        if (!BOARD.test(str(board)) || !(period === 'all' || WEEK.test(str(period))) || !UUID.test(pid)) return reply(400, { ok: false, error: 'Bad request.' }, cors);
        const n = await db.setHidden({ board, period, player_id: pid }, body.hidden !== false);
        forgetTops(board);
        return n ? reply(200, { ok: true }, cors) : reply(404, { ok: false, error: 'That entry is gone.' }, cors);
      }
      case 'admin_block': {
        const pid = str(body.player_id).toLowerCase();
        if (!UUID.test(pid)) return reply(400, { ok: false, error: 'Bad request.' }, cors);
        const n = await db.block(pid, body.blocked !== false);
        forgetTops();
        return reply(200, { ok: true, entries: n }, cors);
      }
      default:
        return reply(400, { ok: false, error: 'Unknown action.' }, cors);
    }
  }

  return async function handle(req) {
    const cors = corsFor(req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, { ok: false, error: 'Use POST.' }, cors);
    // exactly JSON: a browser can't send that from another site without asking first (CORS preflight)
    if ((req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415, { ok: false, error: 'Send JSON.' }, cors);
    if (Number(req.headers.get('content-length')) > LIMITS.body) return reply(413, { ok: false, error: 'Too long.' }, cors);
    let body;
    try {
      const raw = await req.text();
      if (raw.length > LIMITS.body) return reply(413, { ok: false, error: 'Too long.' }, cors);
      body = JSON.parse(raw);
    } catch {
      return reply(400, { ok: false, error: 'Bad request.' }, cors);
    }
    if (!body || typeof body !== 'object') return reply(400, { ok: false, error: 'Bad request.' }, cors);
    try {
      if (body.action === 'top') return await top(body, cors);
      if (body.action === 'submit') return await submit(body, req, cors);
      if (body.action === 'forget') return await forget(body, cors);
      const a = await admin(req);
      if (a.error) return reply(a.status, { ok: false, error: a.error }, cors);
      return await adminAction(body.action, body, cors);
    } catch (e) {
      log('leaderboard function error:', e && (e.stack || e.message));
      return reply(500, { ok: false, error: 'Something went wrong on our side. Please try again.' }, cors);
    }
  };
}
