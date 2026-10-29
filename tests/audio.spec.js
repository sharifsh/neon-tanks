import { test, expect } from '@playwright/test';
import { open } from './fake-store.js';

// Minimizing the game (home screen, app switcher, another tab) and coming back: the music and the sound
// effects must carry on. Phones pause the audio engine in the background and iOS can hold on to it
// ('interrupted') until the next touch, so these tests play the system's part with small stand-ins.
// open() blocks the real database.

const state = page => page.evaluate(() => window.__audio.ctx && window.__audio.ctx.state);
const step = page => page.evaluate(() => window.__audio.step);
const setHidden = (page, hidden) => page.evaluate(h => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
// the first touch starts the sound, Play Solo starts the music; wait until the soundtrack is moving
async function startMusic(page) {
  await page.fill('#nameInput', 'Tester'); await page.click('#btnSolo');
  await expect(page.locator('#setup')).toHaveClass(/active/);
  await expect.poll(() => state(page)).toBe('running');
  const s = await step(page);
  await expect.poll(() => step(page)).toBeGreaterThan(s + 3);
}
const musicMoves = async page => { const s = await step(page); await expect.poll(() => step(page)).toBeGreaterThan(s + 3); };
// sound effects make oscillators; count them for one effect
const effectPlays = page => page.evaluate(() => {
  const c = window.__audio.ctx; let n = 0; const make = c.createOscillator.bind(c);
  c.createOscillator = () => (n++, make());
  window.__audio.sfx('pick');
  delete c.createOscillator;
  return n > 0;
});
// a harmless touch: the step the setup is already on
const touch = page => page.click('#setupSteps li[data-step="mode"]');

test('minimize and come back: the sound pauses, then music and effects carry on', async ({ page }) => {
  const hits = await open(page, { native: false });
  await startMusic(page);
  await setHidden(page, true);
  await expect.poll(() => state(page)).toBe('suspended');
  const s = await step(page);
  await page.waitForTimeout(500);
  expect(await step(page)).toBe(s); // nothing plays while the game is in the background
  expect(await effectPlays(page)).toBe(false);
  await setHidden(page, false);
  await expect.poll(() => state(page)).toBe('running');
  await musicMoves(page);
  expect(await effectPlays(page)).toBe(true);
  expect(hits).toEqual([]);
});

test('iOS holds the sound until the next touch: the touch brings it back', async ({ page }) => {
  const hits = await open(page, { native: false });
  await startMusic(page);
  const engine = await page.evaluateHandle(() => window.__audio.ctx);
  await setHidden(page, true);
  await expect.poll(() => state(page)).toBe('suspended');
  // the system's part: 'interrupted', and resume() only works inside a touch
  await page.evaluate(() => {
    const c = window.__audio.ctx, real = c.resume.bind(c), st = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state').get;
    window.__held = true; window.__resumes = [];
    Object.defineProperty(c, 'state', { configurable: true, get: () => (window.__held ? 'interrupted' : st.call(c)) });
    c.resume = () => {
      const e = window.event, inTouch = !!(e && e.isTrusted && /^(pointerdown|pointerup|touchend|keydown|click)$/.test(e.type));
      window.__resumes.push(inTouch);
      if (!inTouch) return Promise.resolve();
      window.__held = false; return real();
    };
  });
  await setHidden(page, false);
  await page.waitForTimeout(300);
  expect(await state(page)).toBe('interrupted');
  expect(await page.evaluate(() => window.__resumes)).toEqual([false]); // it tried as soon as the game came back
  await touch(page);
  await expect.poll(() => state(page)).toBe('running');
  expect(await page.evaluate(e => e === window.__audio.ctx, engine)).toBe(true); // same engine, no rebuild needed
  await musicMoves(page);
  expect(await effectPlays(page)).toBe(true);
  expect(hits).toEqual([]);
});

test('an engine the system never gives back is replaced, and the music carries on', async ({ page }) => {
  await open(page, { native: false });
  await startMusic(page);
  const engine = await page.evaluateHandle(() => window.__audio.ctx);
  await setHidden(page, true);
  await expect.poll(() => state(page)).toBe('suspended');
  await page.evaluate(() => { // stuck for good
    const c = window.__audio.ctx;
    Object.defineProperty(c, 'state', { configurable: true, get: () => 'interrupted' });
    c.resume = () => Promise.resolve();
  });
  await setHidden(page, false);
  await touch(page);
  await expect.poll(() => page.evaluate(e => e !== window.__audio.ctx, engine)).toBe(true);
  await expect.poll(() => state(page)).toBe('running');
  expect(await page.evaluate(e => BaseAudioContext.prototype.__lookupGetter__('state').call(e), engine)).toBe('closed'); // the old one is let go
  await musicMoves(page);
  expect(await page.evaluate(() => window.__audio.next - window.__audio.ctx.currentTime)).toBeLessThan(1); // on the new engine's clock
  expect(await effectPlays(page)).toBe(true);
});

test("an engine that says it's running but whose clock stopped is replaced", async ({ page }) => {
  await open(page, { native: false });
  await startMusic(page);
  const engine = await page.evaluateHandle(() => window.__audio.ctx);
  await page.evaluate(() => { const c = window.__audio.ctx, t = c.currentTime; Object.defineProperty(c, 'currentTime', { configurable: true, get: () => t }); });
  await expect.poll(() => page.evaluate(e => e !== window.__audio.ctx, engine), { timeout: 8000 }).toBe(true);
  await expect.poll(() => state(page)).toBe('running');
  await musicMoves(page);
  expect(await effectPlays(page)).toBe(true);
});

test('coming back mid-game: no engine hum until the tank drives again', async ({ page }) => {
  await open(page, { native: false });
  await page.fill('#nameInput', 'Tester'); await page.click('#btnSolo');
  for (let i = 0; i < 3; i++) await page.click('#setupNext');
  await page.click('#setupNext');
  await expect(page.locator('#game')).toHaveClass(/active/);
  await page.waitForFunction(() => window.__nt.game && window.__nt.game.tanks.some(t => t.kind === 'player'));
  await page.evaluate(() => { // freeze the enemies and open a corridor, so nothing stops the tank
    const g = window.__nt.game, me = g.tanks.find(t => t.kind === 'player');
    for (let y = 0; y < g.mapH; y++) for (let x = Math.floor(me.x) - 1; x <= Math.floor(me.x) + 3; x++) if (x >= 0 && x < g.mapW) g.grid[y * g.mapW + x] = 0;
    g.gridRev = (g.gridRev || 0) + 1; g.freezeUntil = g.time + 600;
  });
  await page.keyboard.down('KeyW'); // drive
  await expect.poll(() => page.evaluate(() => window.__audio.engineOn)).toBe(true);
  await setHidden(page, true); // minimized with the key still held
  await expect.poll(() => state(page)).toBe('suspended');
  expect(await page.evaluate(() => window.__audio.engineOn)).toBe(false);
  await page.keyboard.up('KeyW');
  await setHidden(page, false);
  await expect.poll(() => state(page)).toBe('running');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__audio.engineOn)).toBe(false);
  await musicMoves(page);
});
