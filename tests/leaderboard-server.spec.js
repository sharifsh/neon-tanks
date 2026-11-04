import { test, expect } from '@playwright/test';
import { checkRun, minClearGap, stageEnemies, DIFFS, PACE, LIMITS, weekKey, weekEnds, cleanName, badName, addressKey } from '../supabase/functions/leaderboard/handler.js';
import { DIFFICULTIES } from '../public/const.js';
import { Game } from '../public/game.js';
import { lbBackend, paced } from './leaderboard-standins.js';

// The leaderboard server function, run in Node with stand-ins (an in-memory database and a fake sign-in service).
// Nothing here touches the real database.

const PID = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const SITE = 'https://tanksarenabattle.com';

async function call(be, body, { origin = SITE, token, ip = '203.0.113.7' } = {}) {
  const headers = { 'content-type': 'application/json', origin, 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await be.handle(new Request('https://x.supabase.co/functions/v1/leaderboard', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: r.status, headers: r.headers, ...(await r.json()) };
}
const post = (be, pid, name, run, opts) => call(be, { action: 'submit', pid, name, run, source: 'web' }, opts);
const board = (be, pid, period = 'week', mode = 'classic', difficulty = 'normal') => call(be, { action: 'top', mode, difficulty, period, pid });

// A solo game with a perfect player: every enemy is destroyed the moment it arrives, the player can't be hit.
// This is the quickest anyone can possibly clear stages, so the server must accept it.
function perfectRun(mode, difficulty, level) {
  const g = new Game({ mode, difficulty, seed: 12345, players: [{ id: 'me', name: 'Ace', cls: 'striker' }], size: 'M' });
  const me = g.players.get('me');
  let guard = 0;
  while ((mode === 'survival' ? g.wave : g.stage) < level || g.status === 'clear') {
    g.step();
    for (const t of g.tanks) {
      if (t.kind === 'player') t.shieldUntil = g.time + 5;
      else if (t.kind === 'enemy' && !t.dead) g.killTank(t, me);
    }
    if (++guard > 60 * 60 * 60) throw new Error('perfect run did not finish');
  }
  return { mode, difficulty, level: mode === 'survival' ? g.wave : g.stage, score: me.score, kills: me.kills, seconds: g.time, splits: [...g.splits] };
}

test('the pacing rules use the game\'s own numbers', () => {
  for (const [k, d] of Object.entries(DIFFICULTIES)) expect(DIFFS[k]).toBe(d.count);
  for (const difficulty of Object.keys(DIFFS)) {
    const c = new Game({ mode: 'classic', difficulty, seed: 1, players: [{ id: 'me', name: 'A' }] });
    expect(c.stageTotal).toBe(stageEnemies('classic', difficulty, 1));
    const s = new Game({ mode: 'survival', difficulty, seed: 1, players: [{ id: 'me', name: 'A' }] });
    for (let w = 1; w <= 6; w++) { s.startWave(); expect(s.stageTotal).toBe(stageEnemies('survival', difficulty, w)); }
  }
});

test('a perfect player (every enemy gone the moment it arrives) is always accepted, and real games are never quicker than the rules', () => {
  for (const mode of ['classic', 'survival']) {
    for (const difficulty of Object.keys(DIFFS)) {
      const run = perfectRun(mode, difficulty, 13);
      expect(checkRun(run), `${mode} ${difficulty}`).toBe('');
      let prev = 0;
      run.splits.forEach((t, i) => { expect(t - prev + 0.1, `${mode} ${difficulty} stage ${i + 1}`).toBeGreaterThanOrEqual(minClearGap(mode, difficulty, i + 1)); prev = t; });
    }
  }
});

test('impossible results are refused: too quick, too many kills, too many points, or out of range', () => {
  const ok = paced({ level: 6, gap: 70 });
  expect(checkRun(ok)).toBe('');
  expect(checkRun({ ...ok, splits: ok.splits.map(t => t / 3), seconds: ok.seconds / 3 })).toBe('pace'); // three times too quick
  expect(checkRun(paced({ level: 30, gap: 10 }))).toBe('pace'); // stage 30 in five minutes
  expect(checkRun({ ...ok, splits: ok.splits.slice(1) })).toBe('pace'); // a stage missing
  expect(checkRun({ ...ok, splits: [...ok.splits].reverse() })).toBe('pace');
  expect(checkRun({ ...ok, seconds: 10 })).toBe('pace'); // ended before its last stage was cleared
  expect(checkRun({ ...ok, kills: 5000 })).toBe('kills');
  expect(checkRun({ ...ok, score: 9e6 })).toBe('score');
  expect(checkRun({ ...ok, score: 1000 })).toBe('score'); // five stages cleared pay at least 5000
  expect(checkRun({ ...ok, mode: 'duel' })).toBe('board');
  expect(checkRun({ ...ok, difficulty: 'nightmare' })).toBe('board');
  expect(checkRun({ ...ok, level: 0 })).toBe('level');
  expect(checkRun({ ...ok, level: 2.5 })).toBe('level');
  expect(checkRun({ ...ok, score: -5 })).toBe('score');
  expect(checkRun({ ...ok, seconds: 'soon' })).toBe('time');
  // the game can end in the pause right after a stage is cleared: that stage counts as cleared
  expect(checkRun({ ...ok, splits: [...ok.splits, ok.splits.at(-1) + 70], seconds: ok.splits.at(-1) + 72, score: ok.score + 1000 })).toBe('');
  // Survival: stage pace by waves
  expect(checkRun(paced({ mode: 'survival', level: 8, gap: 120, score: 40000, kills: 200 }))).toBe('');
  expect(checkRun(paced({ mode: 'survival', level: 8, gap: 12, score: 40000, kills: 200 }))).toBe('pace');
  expect(PACE).toBeLessThan(1);
});

test('the best result per player is kept for this week and all time, with ranks; player IDs are never shown', async () => {
  const be = lbBackend();
  let r = await post(be, PID[0], 'Rex', paced({ level: 3 }));
  expect(r.status).toBe(200);
  expect(r).toMatchObject({ ok: true, board: 'classic:normal', week: '2026-W45', name: 'Rex' });
  expect(r.weekly).toMatchObject({ rank: 1, improved: true, level: 3 });
  expect(r.allTime).toMatchObject({ rank: 1, improved: true, level: 3 });
  r = await post(be, PID[1], 'Mila', paced({ level: 5 }));
  expect(r.weekly).toMatchObject({ rank: 1, improved: true, level: 5 });
  // Rex does worse: nothing changes, and he hears his standing
  r = await post(be, PID[0], 'Rex', paced({ level: 2 }));
  expect(r.weekly).toMatchObject({ rank: 2, improved: false, level: 3 });
  // a tie on stage goes to the higher score, then the quicker game
  r = await post(be, PID[2], 'Zed', paced({ level: 5, kills: 90, score: 4000 + 90 * 300 }));
  expect(r.weekly).toMatchObject({ rank: 1, improved: true });
  // Rex improves and renames: his entries follow the new callsign
  r = await post(be, PID[0], 'Rex II', paced({ level: 9 }));
  expect(r.weekly).toMatchObject({ rank: 1, improved: true, level: 9 });
  const top = await board(be, PID[1]);
  expect(top).toMatchObject({ ok: true, board: 'classic:normal', period: 'week', week: '2026-W45', total: 3, resets: '2026-11-09T00:00:00.000Z' });
  expect(top.entries.map(e => [e.rank, e.name, e.level, e.me])).toEqual([[1, 'Rex II', 9, false], [2, 'Zed', 5, false], [3, 'Mila', 5, true]]);
  expect(top.me).toMatchObject({ rank: 3, name: 'Mila', level: 5 });
  expect(JSON.stringify(top)).not.toContain(PID[0].slice(0, 8));
  // other boards are separate
  expect((await board(be, PID[1], 'week', 'classic', 'hard')).total).toBe(0);
  expect((await board(be, PID[1], 'week', 'survival', 'normal')).total).toBe(0);
  // without a player ID: the board, no "me"
  const anon = await call(be, { action: 'top', mode: 'classic', difficulty: 'normal', period: 'all' });
  expect(anon.me).toBeNull(); expect(anon.entries.every(e => e.me === false)).toBe(true);
  expect((await call(be, { action: 'top', mode: 'duel', difficulty: 'normal' })).status).toBe(400);
});

test('the weekly board starts over on Monday (UTC); all time keeps the records', async () => {
  const be = lbBackend({ start: Date.parse('2026-11-08T23:30:00Z') }); // Sunday night
  await post(be, PID[0], 'Rex', paced({ level: 7 }));
  expect((await board(be, PID[0])).week).toBe('2026-W45');
  be.tick(3600e3); // Monday 00:30
  const week = await board(be, PID[0]);
  expect(week).toMatchObject({ week: '2026-W46', total: 0, me: null, resets: '2026-11-16T00:00:00.000Z' });
  expect((await board(be, PID[0], 'all')).me).toMatchObject({ rank: 1, level: 7 });
  const r = await post(be, PID[0], 'Rex', paced({ level: 4 }));
  expect(r.weekly).toMatchObject({ rank: 1, improved: true, level: 4 });
  expect(r.allTime).toMatchObject({ rank: 1, improved: false, level: 7 });
});

test('weeks follow ISO 8601 in UTC', () => {
  const k = s => weekKey(new Date(s));
  expect(k('2026-11-02T00:00:00Z')).toBe('2026-W45'); // Monday
  expect(k('2026-11-08T23:59:59Z')).toBe('2026-W45'); // Sunday
  expect(k('2026-01-01T12:00:00Z')).toBe('2026-W01'); // a Thursday
  expect(k('2027-01-01T12:00:00Z')).toBe('2026-W53'); // a Friday: still the last week of 2026
  expect(k('2024-12-30T12:00:00Z')).toBe('2025-W01');
  expect(weekEnds(new Date('2026-11-02T00:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
  expect(weekEnds(new Date('2026-11-08T23:59:59Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
});

test('callsigns are tidied, and offensive ones are refused', async () => {
  expect(cleanName('  Big\u200b   Tank \n ')).toBe('Big Tank');
  expect(cleanName('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('ABCDEFGHIJKLMNOP');
  for (const n of ['Rex', 'Sharif', 'Tanker123', 'Grape Shot', 'Essex', 'Peacock', 'Dickens', 'Assassin', 'Ölçü', 'Ninja 🐱', 'Torpedo', 'Nazir', 'Nazim', 'Therapist',
    'Fukuoka', 'Matsushita', 'Wankel', 'Tit Mouse', 'Cocktail', 'Sextant', 'Classic']) expect(badName(cleanName(n)), n).toBe(false);
  for (const n of ['fuckface', 'F.U.C.K', 'sh1t', 'Shithead', 'b1tch', 'n1gger', 'ass', 'cum shot', 'x HITLER x', 'nazi', 'rapist1']) expect(badName(cleanName(n)), n).toBe(true);
  // names that would look blank on the board
  for (const cp of [0x3164, 0x2800, 0x115f, 0xffa0, 0xad, 0x200b]) expect(cleanName(String.fromCodePoint(cp).repeat(3))).toBe('');
  const be = lbBackend();
  const r = await post(be, PID[0], 'sh1thead', paced());
  expect(r.status).toBe(422); expect(r.reason).toBe('name');
  expect((await post(be, PID[0], '   ', paced())).reason).toBe('name');
  expect(be.rows).toHaveLength(0);
});

test('posting limits: per player and per network address; refused results store nothing', async () => {
  const be = lbBackend();
  for (let i = 0; i < LIMITS.perPlayerHour; i++) expect((await post(be, PID[0], 'Rex', paced({ level: 2 + (i % 3) }))).status).toBe(200);
  const r = await post(be, PID[0], 'Rex', paced({ level: 9 }));
  expect(r.status).toBe(429); expect(r.reason).toBe('busy');
  // someone else on another network is fine; the same network has its own, larger limit
  expect((await post(be, PID[1], 'Mila', paced(), { ip: '198.51.100.4' })).status).toBe(200);
  expect(be.throttle.some(t => t.key.includes('203.0.113.7'))).toBe(true); // stand-in hash; the real one is one-way and salted
  be.tick(3600e3 + 1000);
  expect((await post(be, PID[0], 'Rex', paced({ level: 9 }))).status).toBe(200);
  const before = be.rows.length;
  expect((await post(be, PID[2], 'Zed', { ...paced(), splits: [1, 2] })).status).toBe(422);
  expect((await call(be, { action: 'submit', pid: 'not-an-id', name: 'Zed', run: paced() })).status).toBe(400);
  expect(be.rows.length).toBe(before);
});

test('a player can remove all their results', async () => {
  const be = lbBackend();
  await post(be, PID[0], 'Rex', paced({ level: 4 }));
  await post(be, PID[0], 'Rex', paced({ mode: 'survival', level: 3, gap: 120, score: 9000, kills: 60 }));
  await post(be, PID[1], 'Mila', paced({ level: 3 }));
  const r = await call(be, { action: 'forget', pid: PID[0] });
  expect(r).toMatchObject({ ok: true, removed: 4 }); // two boards, this week and all time
  expect(be.rows.map(x => x.name)).toEqual(['Mila', 'Mila']);
  expect((await call(be, { action: 'forget', pid: 'nope' })).status).toBe(400);
});

test('admin: list entries, hide one, block a player (their new results stay hidden); others are refused', async () => {
  const be = lbBackend();
  await post(be, PID[0], 'Rex', paced({ level: 4 }));
  await post(be, PID[1], 'Cheater', paced({ level: 8 }));
  expect((await call(be, { action: 'admin_list' })).status).toBe(401);
  expect((await call(be, { action: 'admin_list' }, { token: 'player-token' })).status).toBe(403);
  expect((await call(be, { action: 'admin_list' }, { token: 'expired' })).status).toBe(401);
  const list = await call(be, { action: 'admin_list', period: 'week' }, { token: 'admin-token' });
  expect(list).toMatchObject({ ok: true, week: '2026-W45', more: false });
  expect(list.entries.map(e => e.name).sort()).toEqual(['Cheater', 'Rex']);
  const cheat = list.entries.find(e => e.name === 'Cheater');
  expect(cheat).toMatchObject({ board: 'classic:normal', player_id: PID[1], hidden: false, blocked: false });
  // hide one entry
  expect((await call(be, { action: 'admin_hide', board: cheat.board, period: cheat.period, player_id: cheat.player_id }, { token: 'admin-token' })).ok).toBe(true);
  expect((await board(be, PID[0])).entries.map(e => e.name)).toEqual(['Rex']);
  expect((await board(be, PID[0], 'all')).entries.map(e => e.name)).toEqual(['Cheater', 'Rex']);
  // block the player: everything hidden, and new results too
  expect(await call(be, { action: 'admin_block', player_id: PID[1] }, { token: 'admin-token' })).toMatchObject({ ok: true, entries: 2 });
  expect((await board(be, PID[0], 'all')).entries.map(e => e.name)).toEqual(['Rex']);
  const r = await post(be, PID[1], 'Cheater', paced({ level: 12 }));
  expect(r.status).toBe(200); expect(r.weekly.rank).toBeNull();
  expect((await board(be, PID[1])).me).toBeNull();
  expect((await call(be, { action: 'admin_list', hidden: true }, { token: 'admin-token' })).entries.every(e => e.name === 'Cheater' && e.blocked)).toBe(true);
  // show the player again: their entries come back, except the one hidden on its own
  await call(be, { action: 'admin_block', player_id: PID[1], blocked: false }, { token: 'admin-token' });
  expect((await board(be, PID[0], 'all')).entries.map(e => [e.name, e.level])).toEqual([['Cheater', 12], ['Rex', 4]]);
  expect((await board(be, PID[0])).entries.map(e => e.name)).toEqual(['Rex']);
  expect((await call(be, { action: 'admin_hide', board: 'classic:normal', period: 'all', player_id: PID[2] }, { token: 'admin-token' })).status).toBe(404);
  expect((await call(be, { action: 'admin_list', board: 'chess:easy' }, { token: 'admin-token' })).status).toBe(400);
});

test('cross-site calls: only the website and the apps get CORS headers; only POST JSON', async () => {
  const be = lbBackend();
  for (const origin of [SITE, 'capacitor://localhost', 'https://localhost']) {
    expect((await call(be, { action: 'top', mode: 'classic', difficulty: 'easy' }, { origin })).headers.get('access-control-allow-origin')).toBe(origin);
  }
  expect((await call(be, { action: 'top', mode: 'classic', difficulty: 'easy' }, { origin: 'https://evil.example' })).headers.get('access-control-allow-origin')).toBeNull();
  const pre = await be.handle(new Request('https://x/functions/v1/leaderboard', { method: 'OPTIONS', headers: { origin: SITE } }));
  expect(pre.status).toBe(204);
  expect((await be.handle(new Request('https://x/functions/v1/leaderboard', { method: 'GET' }))).status).toBe(405);
  expect((await be.handle(new Request('https://x/functions/v1/leaderboard', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' }))).status).toBe(415);
});

test('old weekly entries are removed after 13 weeks, and posting limits after a day', async () => {
  const be = lbBackend();
  await post(be, PID[0], 'Rex', paced());
  be.tick(14 * 7 * 86400e3);
  await post(be, PID[1], 'Mila', paced());
  await be.flush();
  const periods = be.rows.map(r => `${r.name} ${r.period}`).sort();
  expect(periods).toEqual(['Mila 2027-W06', 'Mila all', 'Rex all']);
  expect(be.throttle.every(t => t.key.includes('22222222') || t.key === 'all' || t.key.includes('203.0.113.7'))).toBe(true);
  expect(be.throttle.filter(t => t.key === 'p:' + PID[0])).toHaveLength(0);
});

test('posting limits hold when posts arrive all at once', async () => {
  const be = lbBackend();
  const res = await Promise.all(Array.from({ length: 40 }, () => post(be, PID[0], 'Rex', paced({ level: 3 }))));
  expect(res.filter(r => r.status === 200)).toHaveLength(LIMITS.perPlayerHour);
  expect(res.filter(r => r.status === 429)).toHaveLength(40 - LIMITS.perPlayerHour);
});

test('network addresses: IPv6 counts by its /64 network; IPv4 as is', () => {
  expect(addressKey('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64');
  expect(addressKey('2001:db8:abcd:12:ffff::9')).toBe('2001:db8:abcd:12::/64');
  expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
  expect(addressKey('::ffff:198.51.100.4')).toBe('198.51.100.4');
  expect(addressKey('198.51.100.4')).toBe('198.51.100.4');
});

test('only real modes and difficulties: built-in object names are refused before anything is stored', async () => {
  const be = lbBackend();
  for (const mode of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
    expect(checkRun({ ...paced(), mode }), mode).toBe('board');
    expect((await call(be, { action: 'top', mode, difficulty: 'easy' })).status, mode).toBe(400);
    expect((await post(be, PID[0], 'Rex', { ...paced(), mode })).status, mode).toBe(422);
  }
  expect(checkRun({ ...paced(), difficulty: 'constructor' })).toBe('board');
  expect(be.rows).toHaveLength(0);
  expect(be.throttle).toHaveLength(0); // refused before using up a posting slot
});

test('only exact JSON: other content types and oversized bodies are refused', async () => {
  const be = lbBackend();
  const send = (headers, body) => be.handle(new Request('https://x/functions/v1/leaderboard', { method: 'POST', headers: { origin: SITE, ...headers }, body }));
  const json = JSON.stringify({ action: 'top', mode: 'classic', difficulty: 'easy' });
  expect((await send({ 'content-type': 'text/plain; x=application/json' }, json)).status).toBe(415);
  expect((await send({ 'content-type': 'application/json; charset=utf-8' }, json)).status).toBe(200);
  expect((await send({ 'content-type': 'application/json', 'content-length': '999999' }, json)).status).toBe(413);
  expect((await send({ 'content-type': 'application/json' }, JSON.stringify({ action: 'top', pad: 'x'.repeat(30000) }))).status).toBe(413);
});

test('a result sent late (kept while offline) counts for all time, and for this week only if it was played this week', async () => {
  const be = lbBackend({ start: Date.parse('2026-11-09T10:00:00Z') }); // a Monday morning
  let r = await call(be, { action: 'submit', pid: PID[0], name: 'Rex', run: paced({ level: 6 }), ago: 3 * 86400 }); // played last Friday
  expect(r).toMatchObject({ ok: true, weekly: null, allTime: { rank: 1, improved: true, level: 6 } });
  expect(be.rows.map(x => x.period)).toEqual(['all']);
  r = await call(be, { action: 'submit', pid: PID[0], name: 'Rex', run: paced({ level: 4 }), ago: 3600 }); // played this morning
  expect(r.weekly).toMatchObject({ rank: 1, improved: true, level: 4 });
});

test('the top of each board is kept for a few seconds; your own entry is always fresh', async () => {
  const be = lbBackend();
  await post(be, PID[0], 'Rex', paced({ level: 6 }));
  await board(be, PID[0]); await board(be, PID[1]); await board(be, null);
  expect(be.calls.filter(c => c[0] === 'top')).toHaveLength(1);
  // a new post on this board shows at once
  await post(be, PID[1], 'Mila', paced({ level: 8 }));
  let b = await board(be, PID[1]);
  expect(b.entries.map(e => [e.name, e.me])).toEqual([['Mila', true], ['Rex', false]]);
  expect(be.calls.filter(c => c[0] === 'top')).toHaveLength(2);
  be.tick((LIMITS.topSeconds + 1) * 1000);
  b = await board(be, PID[0]);
  expect(be.calls.filter(c => c[0] === 'top')).toHaveLength(3);
  expect(b.me).toMatchObject({ rank: 2, name: 'Rex', me: true });
});

test('admin: older pages repeat the last moment rather than skip an entry', async () => {
  const be = lbBackend();
  for (let i = 0; i < 52; i++) await post(be, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `P${i}`, paced({ level: 2 }), { ip: `10.0.${i}.1` });
  const p1 = await call(be, { action: 'admin_list' }, { token: 'admin-token' });
  expect(p1.entries).toHaveLength(LIMITS.adminPage); expect(p1.more).toBe(true);
  const p2 = await call(be, { action: 'admin_list', before: p1.entries.at(-1).created_at }, { token: 'admin-token' });
  const key = e => `${e.board}|${e.period}|${e.player_id}`;
  const all = new Set([...p1.entries, ...p2.entries].map(key));
  expect(all.size).toBe(104);
});
