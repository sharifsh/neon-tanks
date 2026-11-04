import { test, expect } from '@playwright/test';
import { open } from './fake-store.js';
import { lbBackend, routeLeaderboard, paced } from './leaderboard-standins.js';

// The leaderboards in the game, against the real server code wired to stand-ins (in-memory database).
// Nothing reaches the real backend: everything else aimed at it is blocked by the test helpers.

const ME = '99999999-9999-4999-8999-999999999999';

async function start(page, { name = 'Sharif', pid = ME, owned = true, lb = lbBackend({ start: Date.now() }), down = false, init = {} } = {}) {
  await page.addInitScript(({ name, pid, init }) => {
    try {
      if (name) localStorage.setItem('nt_name', name);
      if (pid) localStorage.setItem('nt_pid', pid);
      for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v);
    } catch (e) {}
  }, { name, pid, init });
  await open(page, { native: true, owned });
  const net = await routeLeaderboard(page, lb, { down });
  return { lb, net };
}
async function soloGame(page, { mode = 'classic', difficulty = 'normal', map = null } = {}) {
  await page.click('#btnSolo');
  await page.waitForSelector('#setup.active');
  await page.evaluate(({ mode, difficulty, map }) => { const S = window.__nt; S.lobby.mode = mode; S.lobby.difficulty = difficulty; S.lobby.map = map; }, { mode, difficulty, map });
  for (let k = 0; k < 4; k++) await page.click('#setupNext');
  await page.waitForSelector('#game.active');
  await page.waitForFunction(() => window.__nt.game && window.__nt.game.tanks.some(t => t.kind === 'player'));
}
// As if the player got to `level` at a believable pace (gap seconds per stage), then lost (unless lose: false).
async function reach(page, { level, gap = 75, kills, score, time, lose = true }) {
  await page.evaluate(({ level, gap, kills, score, time, lose }) => {
    const g = window.__nt.game, me = [...g.players.values()][0], clears = level - 1;
    if (g.mode === 'survival') { g.wave = level; g.nextWaveAt = 0; if (!g.queue.length) g.queue = [{ type: 'basic', bonus: false }]; } else g.loadStage(level);
    g.splits = Array.from({ length: clears }, (_, i) => (i + 1) * gap);
    g.time = time ?? clears * gap + 30;
    me.kills = kills ?? clears * 20 + 3;
    me.score = score ?? clears * 1000 + me.kills * 150;
    if (lose) g.bases[0].alive = false;
  }, { level, gap, kills, score, time, lose });
}
const endText = page => page.locator('#endBoardText');
const seed = async (lb, pid, name, run) => lb.handle(new Request('https://x/functions/v1/leaderboard', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.${name.length}.${name.charCodeAt(0)}` },
  body: JSON.stringify({ action: 'submit', pid, name, run, source: 'ios' }),
}));

test('a solo Classic game posts its result when it ends, and the end screen shows where it ranks', async ({ page }) => {
  const lb = lbBackend({ start: Date.now() });
  await seed(lb, '00000000-0000-4000-8000-000000000001', 'Rex', paced({ level: 9 }));
  const { net } = await start(page, { lb });
  await soloGame(page);
  await reach(page, { level: 6 });
  await expect(page.locator('#endMenu')).toBeVisible();
  await expect(endText(page)).toHaveText('New personal best! #2 of all time · #2 this week');
  const sent = net.calls.find(c => c.action === 'submit');
  expect(sent).toMatchObject({ pid: ME, name: 'Sharif', source: 'ios', run: { mode: 'classic', difficulty: 'normal', level: 6, map: 'random', cls: 'striker' } });
  expect(sent.run.splits).toEqual([75, 150, 225, 300, 375]);
  expect(lb.rows.filter(r => r.player_id === ME).map(r => [r.board, r.level, r.name, r.source])).toEqual([['classic:normal', 6, 'Sharif', 'ios'], ['classic:normal', 6, 'Sharif', 'ios']]);
  // the same again: not a new best
  await page.click('#btnAgain');
  await page.waitForFunction(() => window.__nt.game && window.__nt.game.tanks.some(t => t.kind === 'player'));
  await reach(page, { level: 4 });
  await expect(endText(page)).toHaveText('Your best this week: stage 6 (#2) · all time #2');
  // the button opens this board, with your row marked
  await page.click('#endBoardOpen');
  await expect(page.locator('#lbModal')).toBeVisible();
  await expect(page.locator('.lb-row.me')).toContainText('Sharif');
  await expect(page.locator('.lb-row.me .lv')).toHaveText('Stage 6');
});

test('the leaderboard window: Classic and Survival, each difficulty, this week and all time', async ({ page }) => {
  const lb = lbBackend({ start: Date.now() });
  await seed(lb, '00000000-0000-4000-8000-000000000001', 'Rex', paced({ level: 9 }));
  await seed(lb, '00000000-0000-4000-8000-000000000002', 'Mila', paced({ level: 12 }));
  await seed(lb, ME, 'Sharif', paced({ level: 4 }));
  await seed(lb, '00000000-0000-4000-8000-000000000003', 'Zed', paced({ mode: 'survival', difficulty: 'hard', level: 7, gap: 140, kills: 150, score: 30000 }));
  const { net } = await start(page, { lb, init: { nt_diff: 'normal' } });
  await page.click('#btnBoard');
  await expect(page.locator('#lbModal')).toBeVisible();
  await expect(page.locator('#lbModes .sel')).toHaveText('Classic');
  await expect(page.locator('#lbDiffs .sel')).toHaveText('Normal');
  await expect(page.locator('#lbPeriods .sel')).toHaveText('This week');
  await expect(page.locator('.lb-row:not(.lb-head) .nm')).toHaveText(['Mila', 'Rex', 'Sharifyou']);
  await expect(page.locator('.lb-row.top1 .lv')).toHaveText('Stage 12');
  await expect(page.locator('#lbFoot')).toContainText('3 players · starts over in');
  // Survival, Hard: Zed alone; the stage column says Wave
  await page.click('[data-lbmode="survival"]');
  await page.click('[data-lbdiff="hard"]');
  await expect(page.locator('.lb-row:not(.lb-head) .nm')).toHaveText(['Zed']);
  await expect(page.locator('.lb-head .lv')).toHaveText('Wave');
  // all time, Insane: nobody yet
  await page.click('[data-lbdiff="insane"]');
  await page.click('[data-lbperiod="all"]');
  await expect(page.locator('.lb-msg')).toContainText('No results yet. Finish a solo Survival game on Insane');
  const tops = net.calls.filter(c => c.action === 'top').map(c => `${c.mode}:${c.difficulty}:${c.period}`);
  expect(tops).toEqual(['classic:normal:week', 'survival:normal:week', 'survival:hard:week', 'survival:insane:week', 'survival:insane:all']);
  expect(net.calls.every(c => c.pid === ME)).toBe(true);
  // the choice is remembered
  await page.keyboard.press('Escape');
  await expect(page.locator('#lbModal')).toBeHidden();
  await page.click('#btnBoard');
  await expect(page.locator('#lbModes .sel')).toHaveText('Survival');
  await expect(page.locator('#lbPeriods .sel')).toHaveText('All time');
});

test('free version: every board can be viewed, and locked ones point to the full version', async ({ page }) => {
  await start(page, { owned: false });
  await page.click('#btnBoard');
  await page.click('[data-lbmode="survival"]');
  await expect(page.locator('#lbFull')).toHaveText('★ Play Survival with the full version');
  await page.click('#lbFull');
  await expect(page.locator('#fullModal')).toBeVisible();
  await expect(page.locator('#fullWhy')).toHaveText('Survival is part of the full version.');
});

test('posting can be turned off in Settings: nothing is sent and the end screen says so', async ({ page }) => {
  const { net, lb } = await start(page);
  await page.click('#btnSettings');
  await expect(page.locator('#lbPost')).toBeChecked();
  await page.click('#lbPost');
  await page.click('#settingsModal [data-close]');
  await soloGame(page);
  await reach(page, { level: 3 });
  await expect(endText(page)).toHaveText('Leaderboard posting is off. You can turn it on in Settings.');
  expect(net.calls.filter(c => c.action === 'submit')).toHaveLength(0);
  expect(lb.rows).toHaveLength(0);
  await page.click('#endBoardOpen');
  await expect(page.locator('#lbFoot')).toContainText('Posting your results is off (Settings).');
});

test('games that don\'t count: two players on one device, and your own or community maps (the end screen explains)', async ({ page }) => {
  const { net } = await start(page);
  // two players on one keyboard
  await page.evaluate(() => { window.__nt.p2.on = true; });
  await soloGame(page);
  expect(await page.evaluate(() => window.__nt.game.players.size)).toBe(2);
  await reach(page, { level: 3 });
  await expect(page.locator('#endMenu')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('#endBoard')).toBeHidden();
  await page.click('#btnToLobby'); // to the game setup, then back to the menu
  await page.click('#setupBack');
  await page.evaluate(() => { window.__nt.p2.on = false; });
  // a community map
  const custom = await page.evaluate(async () => { const { builtinMaps } = await import('./maps.js'); const m = builtinMaps().find(x => x.layout === 'C'); return { id: '5b6f0d3e-0000-4000-8000-00000000abcd', name: 'My fortress', data: m.data, builtin: false }; });
  await soloGame(page, { map: custom });
  await reach(page, { level: 3 });
  await expect(endText(page)).toHaveText("Games on your own or community maps don't count toward the leaderboard.");
  expect(net.calls.filter(c => c.action === 'submit')).toHaveLength(0);
});

test('offline: the result waits on the device and goes out later', async ({ page }) => {
  const { lb, net } = await start(page, { down: true });
  await soloGame(page);
  await reach(page, { level: 5 });
  await expect(endText(page)).toHaveText("You're offline. Your result will be posted when you're back online.");
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('nt_lb_pending')))).toHaveLength(1);
  expect(lb.rows).toHaveLength(0);
  net.setDown(false);
  await page.click('#btnToLobby'); // to the game setup, then back to the menu
  await page.click('#setupBack');
  await page.click('#btnBoard'); // opening the board sends what was kept
  await expect(page.locator('.lb-row.me .lv')).toHaveText('Stage 5');
  expect(lb.rows.filter(r => r.player_id === ME)).toHaveLength(2);
  expect(await page.evaluate(() => localStorage.getItem('nt_lb_pending'))).toBeNull();
});

test('leaving a game part-way posts how far you got; a game with no points posts nothing', async ({ page }) => {
  const { lb, net } = await start(page);
  await soloGame(page);
  await page.click('#btnPause'); await page.click('#btnQuit');
  await expect(page.locator('#menu')).toBeVisible();
  expect(net.calls.filter(c => c.action === 'submit')).toHaveLength(0); // no points yet
  await soloGame(page, { mode: 'survival', difficulty: 'hard' });
  await reach(page, { level: 4, gap: 110, kills: 60, score: 9000, lose: false });
  await page.click('#btnPause'); await page.click('#btnQuit');
  await expect(page.locator('#toast')).toHaveText('New personal best! #1 of all time · #1 this week');
  expect(lb.rows.map(r => [r.board, r.level])).toEqual([['survival:hard', 4], ['survival:hard', 4]]);
});

test('a callsign the board won\'t show: the result waits until the callsign is changed, then goes out', async ({ page }) => {
  const { lb } = await start(page, { name: 'sh1thead' });
  await soloGame(page);
  await reach(page, { level: 5 });
  await expect(endText(page)).toHaveText("This callsign can't be shown on the leaderboard. Change it on the home screen and your result will be posted.");
  expect(lb.rows).toHaveLength(0);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('nt_lb_pending')))).toHaveLength(1);
  await page.click('#btnToLobby'); await page.click('#setupBack');
  await page.fill('#nameInput', 'Sharif');
  await page.locator('#nameInput').blur();
  await expect.poll(() => lb.rows.map(r => `${r.name} ${r.level}`)).toEqual(['Sharif 5', 'Sharif 5']);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('nt_lb_pending'))).toBeNull();
});

test('an impossible result is refused, says so, and isn\'t kept to send again', async ({ page }) => {
  const { lb } = await start(page);
  await soloGame(page);
  await reach(page, { level: 30, gap: 8 }); // stage 30 in four minutes
  await expect(endText(page)).toHaveText("This result couldn't be posted to the leaderboard.");
  expect(lb.rows).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem('nt_lb_pending'))).toBeNull();
});

test('a result is kept on the device from the moment the game ends until the server answers', async ({ page }) => {
  const { lb, net } = await start(page);
  let release;
  const held = new Promise(r => { release = r; });
  await page.route(/supabase\.co\/functions\/v1\/leaderboard/, async route => { await held; return route.fallback(); }); // the answer is slow
  await soloGame(page);
  await reach(page, { level: 3 });
  await expect(endText(page)).toHaveText('Posting your result…');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('nt_lb_pending')))).toHaveLength(1); // closing the app now loses nothing
  release();
  await expect(endText(page)).toHaveText('New personal best! #1 of all time · #1 this week');
  expect(await page.evaluate(() => localStorage.getItem('nt_lb_pending'))).toBeNull();
  expect(net.calls.filter(c => c.action === 'submit')).toHaveLength(1);
  expect(lb.rows).toHaveLength(2);
});

test('Settings: remove my leaderboard results (asks twice), and the next result starts a new player', async ({ page }) => {
  const lb = lbBackend({ start: Date.now() });
  await seed(lb, ME, 'Sharif', paced({ level: 4 }));
  await seed(lb, '00000000-0000-4000-8000-000000000001', 'Rex', paced({ level: 3 }));
  await start(page, { lb });
  await page.click('#btnSettings');
  await page.click('#lbForget');
  await expect(page.locator('#lbForget')).toHaveText('Press again to remove them');
  expect(lb.rows.filter(r => r.player_id === ME)).toHaveLength(2);
  await page.click('#lbForget');
  await expect(page.locator('#toast')).toHaveText('Your leaderboard results were removed.');
  expect(lb.rows.map(r => r.name)).toEqual(['Rex', 'Rex']);
  expect(await page.evaluate(() => localStorage.getItem('nt_pid'))).toBeNull();
  await page.click('#settingsModal [data-close]');
  await soloGame(page);
  await reach(page, { level: 2 });
  await expect(endText(page)).toContainText('New personal best!');
  const pid = await page.evaluate(() => localStorage.getItem('nt_pid'));
  expect(pid).toMatch(/^[0-9a-f-]{36}$/); expect(pid).not.toBe(ME);
});

test('admin page: the Leaderboards tab lists entries, hides one, and hides a player (later results too)', async ({ page }) => {
  const { backend, routeBackend, fakeSmtp } = await import('./support-standins.js');
  const be = backend({ connect: fakeSmtp().connect });
  const lb = lbBackend({ start: Date.now() });
  const CHEAT = '00000000-0000-4000-8000-0000000000cc';
  await seed(lb, '00000000-0000-4000-8000-000000000001', 'Rex', paced({ level: 6 }));
  await seed(lb, CHEAT, '<b>Cheater</b>', paced({ level: 9 }));
  const net = await routeBackend(page, be, { functions: { leaderboard: lb.handle } });
  await page.goto('/admin.html');
  await page.fill('#siEmail', 'boss@example.com'); await page.fill('#siPass', 'admin-pass'); await page.click('#siBtn');
  await expect(page.locator('#app')).toBeVisible();
  expect(net.calls.some(c => c.action === 'admin_list')).toBe(false); // only when the tab is opened
  await page.click('#tabBoards');
  await expect(page.locator('#boards')).toBeVisible();
  await expect(page.locator('#inbox')).toBeHidden();
  const rows = page.locator('#lbRows tr');
  await expect(rows).toHaveCount(2); // this week
  await expect(rows.nth(0).locator('.nm')).toHaveText('<b>Cheater</b>'); // newest first, shown as text
  await expect(rows.nth(0)).toContainText('Classic · Normal · week');
  await expect(rows.nth(0)).toContainText('stage 9');
  // hide the entry: off the public board
  await rows.nth(0).getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(page.locator('#lbStatus')).toHaveText("<b>Cheater</b>'s entry is hidden.");
  expect(lb.rows.find(r => r.player_id === CHEAT && r.period !== 'all').hidden).toBe(true);
  // hide the player: everything, and what they post later
  await page.selectOption('#lbPeriod', '');
  await expect(rows).toHaveCount(4);
  await page.locator('#lbRows tr', { hasText: 'Cheater' }).first().getByRole('button', { name: 'Hide player' }).click();
  await expect(page.locator('#lbStatus')).toContainText('(2 entries)');
  expect(lb.rows.filter(r => r.player_id === CHEAT).every(r => r.blocked)).toBe(true);
  expect(lb.blocked.has(CHEAT)).toBe(true);
  await page.check('#lbHidden');
  await expect(rows).toHaveCount(2);
  for (const i of [0, 1]) await expect(rows.nth(i)).toContainText('player hidden');
  await expect(page.locator('#lbRows tr', { hasText: 'hidden player hidden' })).toHaveCount(1); // the entry hidden on its own stays marked
  await page.click('#tabInbox');
  await expect(page.locator('#inbox')).toBeVisible();
  await expect(page.locator('#boards')).toBeHidden();
});
