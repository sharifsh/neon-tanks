import { test, expect } from '@playwright/test';
import { open } from './fake-store.js';

// Pausing an online game. Pages of one browser play together over ?fakenet=1; open() blocks the real database.
// The room's Pause option says who can pause: any player (the default) or only the host. A pause stops the
// host's game for everyone and says who paused it; the pauser or the host resumes.
const FAKENET = '/?fakenet=1';
async function openRoom(page, name, pause) {
  await page.fill('#nameInput', name); await page.click('#btnCreate');
  await expect(page.locator('#setup')).toHaveClass(/active/);
  for (let i = 0; i < 3; i++) await page.click('#setupNext');
  await expect(page.locator('#pauseRow')).toBeVisible(); // a room option, next to the map options
  if (pause) await page.selectOption('#pauseSel', pause);
  await page.click('#setupNext');
  await expect(page.locator('#lobby')).toHaveClass(/active/);
  return (await page.textContent('#roomCode')).trim();
}
async function join(page, code, name) {
  await page.fill('#nameInput', name); await page.fill('#joinCode', code); await page.click('#btnJoin');
  await expect(page.locator('#lobby')).toHaveClass(/active/);
}
// Hank hosts; the guests join in order (the first one takes over if Hank leaves)
async function room(browser, { pause, guests = ['Sam', 'Gina'], owned = true } = {}) {
  const ctx = await browser.newContext(), hits = [];
  const host = await ctx.newPage(); hits.push(await open(host, { owned }, FAKENET));
  const code = await openRoom(host, 'Hank', pause);
  const pages = [];
  for (const name of guests) {
    const g = await ctx.newPage(); hits.push(await open(g, { owned: false }, FAKENET));
    await join(g, code, name);
    await expect.poll(() => host.evaluate(() => window.__nt.peers.size), { timeout: 15000 }).toBe(pages.length + 1);
    pages.push(g);
  }
  return { ctx, host, guests: pages, code, hits };
}
async function start(host, guests) {
  await host.click('#btnStart');
  await expect(host.locator('#game')).toHaveClass(/active/);
  // freeze the enemies, so nobody loses the game while the test pauses and resumes
  await host.evaluate(() => { const g = window.__nt.game; g.freezeUntil = g.time + 600; });
  for (const g of guests) {
    await expect(g.locator('#game')).toHaveClass(/active/);
    await g.waitForFunction(() => window.__nt.snaps.length > 0, null, { timeout: 15000 });
  }
}
const gameTime = p => p.evaluate(() => window.__nt.game.time);
const frameTime = p => p.evaluate(() => { const s = window.__nt.snaps; return s.length ? s[s.length - 1].tm : -1; });
// the host's game: stopped while paused, running otherwise
async function expectStopped(host, stopped) {
  await expect.poll(() => host.evaluate(() => window.__nt.paused)).toBe(stopped);
  const t = await gameTime(host); await host.waitForTimeout(400);
  if (stopped) expect(await gameTime(host)).toBe(t); else expect(await gameTime(host)).toBeGreaterThan(t);
}
// a guest's view: the host's frames stop coming while paused
async function expectFrozen(guest, frozen) {
  const t = await frameTime(guest); await guest.waitForTimeout(500);
  if (frozen) expect(await frameTime(guest)).toBe(t); else expect(await frameTime(guest)).toBeGreaterThan(t);
}
const card = p => ({ menu: p.locator('#pauseMenu'), title: p.locator('#pauseTitle'), note: p.locator('#pauseNote'), resume: p.locator('#btnResume'), leave: p.locator('#btnQuit') });
const pauseRow = p => p.locator('#gameSummary .gs-row', { hasText: 'Pause' });
// what a guest could send by hand: the host must still follow the room's rule
const ask = (p, on) => p.evaluate(on => window.__nt.net.sendToHost({ y: 'pause', on }, true), on);

test.describe('online pause', () => {
  test('anyone (default): a guest pauses the game for everyone and everyone sees who; the pauser or the host resumes', async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, host, guests: [sam, gina], hits } = await room(browser);
    await expect(pauseRow(host)).toContainText('Anyone');
    await expect(pauseRow(sam)).toContainText('Anyone'); // guests see the room's option; only the host can change it
    await expect(pauseRow(sam).locator('button')).toHaveCount(0);
    await expect(pauseRow(host).locator('button')).toHaveCount(1);
    await start(host, [sam, gina]);
    await expectStopped(host, false);

    // Sam pauses: the host's game stops, and everyone is told who paused
    await sam.click('#btnPause');
    await expectStopped(host, true);
    await expectFrozen(gina, true);
    await expect(card(sam).title).toHaveText('Paused');
    await expect(card(sam).note).toHaveText('You paused the game for everyone.');
    await expect(card(sam).resume).toBeVisible();
    await expect(card(host).note).toHaveText('Sam paused the game.');
    await expect(card(host).resume).toBeVisible(); // the host can always resume
    await expect(card(gina).title).toHaveText('Paused');
    await expect(card(gina).note).toHaveText('Sam paused the game. Sam or the host can resume.');
    await expect(card(gina).resume).toBeHidden();
    await expect(card(gina).leave).toBeVisible(); // a way out of the room

    // Gina can't resume Sam's pause or pause over it: not with Esc, nor by asking the host directly
    await gina.keyboard.press('Escape');
    await ask(gina, false); await ask(gina, true);
    await expectStopped(host, true);
    expect(await host.evaluate(() => window.__nt.pz.name)).toBe('Sam');
    await expect(card(gina).note).toHaveText('Sam paused the game. Sam or the host can resume.');

    // Sam resumes for everyone
    await sam.click('#btnResume');
    await expectStopped(host, false);
    for (const p of [host, sam, gina]) await expect(card(p).menu).toBeHidden();
    await expectFrozen(gina, false);

    // Gina pauses with Esc; the host resumes it
    await gina.keyboard.press('Escape');
    await expectStopped(host, true);
    await expect(card(gina).note).toHaveText('You paused the game for everyone.');
    await expect(card(sam).note).toHaveText('Gina paused the game. Gina or the host can resume.');
    await expect(card(host).note).toHaveText('Gina paused the game.');
    await host.click('#btnResume');
    await expectStopped(host, false);
    for (const p of [host, sam, gina]) await expect(card(p).menu).toBeHidden(); // Gina's menu closes too

    // the host pauses: only the host resumes
    await host.click('#btnPause');
    await expectStopped(host, true);
    await expect(card(host).note).toHaveText('You paused the game for everyone.');
    await expect(card(sam).note).toHaveText('The host paused the game.');
    await expect(card(sam).resume).toBeHidden();
    await ask(sam, false);
    await expectStopped(host, true);
    await host.keyboard.press('Escape');
    await expectStopped(host, false);
    for (const p of [host, sam, gina]) await expect(card(p).menu).toBeHidden();
    await expectFrozen(sam, false);
    expect(hits.flat()).toEqual([]);
    await ctx.close();
  });

  test('host only: a guest\'s menu leaves the game running; the host\'s pause stops it for everyone; the choice is remembered', async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, host, guests: [sam], hits } = await room(browser, { pause: 'host', guests: ['Sam'] });
    expect(await host.evaluate(() => localStorage.getItem('nt_pause'))).toBe('host');
    await expect(pauseRow(host)).toContainText('Host only');
    await expect(pauseRow(sam)).toContainText('Host only');
    await expect(pauseRow(sam).locator('button')).toHaveCount(0);
    await start(host, [sam]);

    // Sam's pause button opens the menu, but the game keeps running
    await sam.click('#btnPause');
    await expect(card(sam).menu).toBeVisible();
    await expect(card(sam).title).toHaveText('Menu');
    await expect(card(sam).note).toHaveText('Only the host can pause this room.');
    await expectStopped(host, false);
    await expect(card(host).menu).toBeHidden();
    await ask(sam, true); // the host keeps to the rule
    await expectStopped(host, false);
    await expectFrozen(sam, false);
    await sam.click('#btnResume');
    await expect(card(sam).menu).toBeHidden();

    // the host's pause stops the game for everyone
    await host.click('#btnPause');
    await expectStopped(host, true);
    await expectFrozen(sam, true);
    await expect(card(sam).title).toHaveText('Paused');
    await expect(card(sam).note).toHaveText('The host paused the game.');
    await expect(card(sam).resume).toBeHidden();
    await host.click('#btnResume');
    await expectStopped(host, false);
    await expect(card(sam).menu).toBeHidden();

    // the next room starts with the host's last choice; solo games don't show it
    await host.click('#btnPause'); await host.click('#btnQuit');
    await expect(host.locator('#menu')).toHaveClass(/active/);
    await host.click('#btnCreate');
    await host.click('#setupSteps li[data-step="battle"]');
    await expect(host.locator('#pauseSel')).toHaveValue('host');
    await host.click('#setupBack'); // the room settings go back step by step to the menu
    for (let i = 0; i < 3; i++) await host.click('#setupBack');
    await expect(host.locator('#menu')).toHaveClass(/active/);
    await host.click('#btnSolo');
    await host.click('#setupSteps li[data-step="battle"]');
    await expect(host.locator('#pauseRow')).toBeHidden();
    expect(hits.flat()).toEqual([]);
    await ctx.close();
  });

  test('spectators can\'t pause; they see who paused', async ({ browser }) => {
    test.setTimeout(120000);
    // a free room holds 4 players: Hank and Sam each bring a Player 2, so Vic watches
    const ctx = await browser.newContext(), hits = [];
    const host = await ctx.newPage(); hits.push(await open(host, { owned: false }, FAKENET));
    const code = await openRoom(host, 'Hank');
    await host.click('#btnAddP2');
    const sam = await ctx.newPage(); hits.push(await open(sam, { owned: false }, FAKENET));
    await join(sam, code, 'Sam');
    await sam.click('#btnAddP2');
    await expect(host.locator('#playerCount')).toHaveText('4/4', { timeout: 15000 });
    const vic = await ctx.newPage(); hits.push(await open(vic, { owned: false }, FAKENET));
    await join(vic, code, 'Vic');
    await expect.poll(() => vic.evaluate(() => window.__nt.role), { timeout: 15000 }).toBe('spectator');
    await start(host, [sam, vic]);

    await vic.click('#btnPause');
    await expect(card(vic).title).toHaveText('Menu');
    await expect(card(vic).note).toHaveText('Spectators cannot pause.');
    await ask(vic, true);
    await expectStopped(host, false);
    await vic.click('#btnResume');
    await expect(card(vic).menu).toBeHidden();

    await sam.click('#btnPause');
    await expectStopped(host, true);
    await expect(card(vic).title).toHaveText('Paused');
    await expect(card(vic).note).toHaveText('Sam paused the game. Sam or the host can resume.');
    await expect(card(vic).resume).toBeHidden();
    await expect(card(vic).leave).toBeVisible();
    await sam.click('#btnResume');
    await expectStopped(host, false);
    await expect(card(vic).menu).toBeHidden();
    expect(hits.flat()).toEqual([]);
    await ctx.close();
  });

  test('the host leaves while paused: the game stays paused where it stopped, and the new host resumes it', async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx, host, guests: [sam, gina], hits } = await room(browser);
    await start(host, [sam, gina]);
    await host.click('#btnPause');
    await expectStopped(host, true);
    const t = await gameTime(host);
    await expect.poll(() => sam.evaluate(() => window.__nt.checkpoint && JSON.parse(window.__nt.checkpoint).time)).toBe(t); // a checkpoint of the paused game
    await host.close({ runBeforeUnload: true });

    // Sam joined first, so Sam takes over: still paused, at the same moment
    await expect.poll(() => sam.evaluate(() => window.__nt.isHost && !!window.__nt.game), { timeout: 20000 }).toBe(true);
    expect(await gameTime(sam)).toBe(t);
    await expectStopped(sam, true);
    await expect(card(sam).note).toHaveText('Hank paused the game.');
    await expect(card(sam).resume).toBeVisible();
    await expect.poll(() => sam.evaluate(() => window.__nt.peers.size), { timeout: 20000 }).toBe(1); // Gina reconnects
    await expect(card(gina).note).toHaveText('Hank paused the game. The host can resume.');
    await expect(card(gina).resume).toBeHidden();
    await gina.waitForFunction(() => window.__nt.snaps.length > 0, null, { timeout: 15000 }); // a still frame of the paused game

    await sam.click('#btnResume');
    await expectStopped(sam, false);
    await expect(card(gina).menu).toBeHidden();
    await expectFrozen(gina, false);
    expect(hits.flat()).toEqual([]);
    await ctx.close();
  });

  test('solo games pause from the menu, as before', async ({ page }) => {
    const hits = await open(page, {});
    await page.fill('#nameInput', 'Tester'); await page.click('#btnSolo');
    await page.click('#setupSteps li[data-step="battle"]');
    await expect(page.locator('#pauseRow')).toBeHidden(); // a room option only
    await page.click('#setupNext');
    await expect(page.locator('#game')).toHaveClass(/active/);
    await page.click('#btnPause');
    await expect(card(page).title).toHaveText('Paused');
    await expect(card(page).note).toHaveText('');
    await expectStopped(page, true);
    await page.keyboard.press('Escape');
    await expect(card(page).menu).toBeHidden();
    await expectStopped(page, false);
    expect(hits).toEqual([]);
  });
});
