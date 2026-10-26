import { test, expect } from '@playwright/test';
import { open } from './fake-store.js';

// Phone-sized screens: zoomed view that follows your tank, slim HUD, touch controls.
// Solo games only; open() blocks the real database.
const PHONE = { viewport: { width: 874, height: 402 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

async function startSolo(page) {
  await page.fill('#nameInput', 'Tester'); await page.click('#btnSolo');
  await expect(page.locator('#lobby')).toHaveClass(/active/);
  await page.click('#btnStart');
  await expect(page.locator('#game')).toHaveClass(/active/);
  await page.waitForFunction(() => window.__nt.game && window.__nt.game.tanks.some(t => t.kind === 'player'));
  // the stage opens on the whole map, then the view zooms in on your tank
  await page.waitForFunction(() => Math.abs(window.__r.scs - window.__r.zoomScs) < 0.5, null, { timeout: 8000 });
}
const view = page => page.evaluate(() => {
  const r = window.__r, g = window.__nt.game, me = g && g.tanks.find(t => t.kind === 'player');
  const k = r.scale, at = me ? { x: (r.ox + (me.x + me.size / 2) * r.scs) / k, y: (r.oy + (me.y + me.size / 2) * r.scs) / k } : null;
  return { compact: r.compact, scs: r.scs, fit: r.fitScs, zoom: r.zoomScs, rect: { l: r.rect.l / k, t: r.rect.t / k, r: r.rect.r / k, b: r.rect.b / k }, tank: at, w: innerWidth, h: innerHeight };
});
// open a corridor around the player's tank and freeze the enemies, so the tank can drive freely
const clearAround = page => page.evaluate(() => {
  const g = window.__nt.game, me = g.tanks.find(t => t.kind === 'player');
  for (let y = 0; y < g.mapH; y++) for (let x = Math.floor(me.x) - 1; x <= Math.floor(me.x) + 3; x++) if (x >= 0 && x < g.mapW) g.grid[y * g.mapW + x] = 0;
  g.gridRev = (g.gridRev || 0) + 1; g.freezeUntil = g.time + 120;
  for (const t of g.tanks) if (t.kind !== 'player') t.hp = 0;
});
const touch = async page => {
  const cdp = await page.context().newCDPSession(page);
  const pt = (id, x, y) => ({ x, y, id, radiusX: 6, radiusY: 6, force: 1 });
  return {
    start: pts => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts.map(p => pt(...p)) }),
    move: pts => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts.map(p => pt(...p)) }),
    end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  };
};

test.describe('phone, landscape', () => {
  test.use(PHONE);

  test('the view zooms in on your tank, the HUD is slim and the zoom button cycles (and is remembered)', async ({ page }) => {
    const hits = await open(page, {});
    await startSolo(page);
    await expect(page.locator('body')).toHaveClass(/compact/);
    await expect(page.locator('#btnZoom')).toBeVisible();
    expect(await page.locator('#hudTop').evaluate(e => e.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
    const v = await view(page);
    expect(v.compact).toBe(true);
    expect(v.scs).toBeGreaterThan(v.fit * 1.3); // about 18 px per cell on a 402 px tall screen
    expect(v.scs / 2).toBeGreaterThanOrEqual(16);
    expect(v.tank.x).toBeGreaterThan(0); expect(v.tank.x).toBeLessThan(v.w);
    expect(v.tank.y).toBeGreaterThan(v.rect.t); expect(v.tank.y).toBeLessThan(v.rect.b);
    // the map stays clear of the HUD bar at its top edge and of the player chips at its bottom edge
    const chipTop = await page.locator('#hudBottom').evaluate(e => e.getBoundingClientRect().top);
    expect(v.rect.b).toBeLessThanOrEqual(chipTop + 1);
    await page.click('#btnZoom');
    await page.waitForFunction(s => window.__r.scs > s * 1.15, v.scs, { timeout: 8000 });
    await page.click('#btnZoom');
    await page.waitForFunction(() => Math.abs(window.__r.scs - window.__r.fitScs) < 0.5, null, { timeout: 8000 });
    expect(await page.evaluate(() => localStorage.getItem('nt_zoom'))).toBe('fit');
    await page.reload(); await page.waitForFunction(() => window.__r);
    expect(await page.evaluate(() => window.__r.zoom)).toBe('fit');
    expect(hits).toEqual([]);
  });

  test('touch: a thumb on the left half steers (the view follows), the right half fires, ABL is its own button', async ({ page }) => {
    await open(page, {});
    await page.evaluate(() => localStorage.setItem('nt_zoom', 'close'));
    await startSolo(page);
    await clearAround(page);
    const t = await touch(page);
    const before = await view(page), y0 = await page.evaluate(() => window.__nt.game.tanks.find(t => t.kind === 'player').y);
    await t.start([[1, 210, 300]]);
    await expect(page.locator('#touch .stick')).toHaveClass(/active/);
    const stick = await page.locator('#touch .stick').boundingBox();
    expect(Math.abs(stick.x + stick.width / 2 - 210)).toBeLessThan(40); // the stick appears under the thumb
    await t.move([[1, 213, 240]]);
    await page.waitForTimeout(1800);
    expect(await page.evaluate(() => window.__input.touch.d)).toBe(0);
    const y1 = await page.evaluate(() => window.__nt.game.tanks.find(t => t.kind === 'player').y);
    expect(y1).toBeLessThan(y0 - 4);
    const after = await view(page);
    expect(after.tank.y).toBeGreaterThan(after.rect.t); expect(after.tank.y).toBeLessThan(after.rect.b);
    expect(after.tank.y).toBeLessThan(before.rect.b);
    // near a diagonal the current direction holds (no flicker)
    await t.move([[1, 210 + 40, 300 - 36]]); // a bit more right than up, but close to the diagonal
    expect(await page.evaluate(() => window.__input.touch.d)).toBe(0);
    await t.move([[1, 210 + 50, 300 - 10]]); // clearly right
    expect(await page.evaluate(() => window.__input.touch.d)).toBe(1);
    // second thumb on the right half fires while steering
    await t.start([[1, 260, 290], [2, 640, 220]]);
    expect(await page.evaluate(() => window.__input.touch)).toMatchObject({ d: 1, f: true });
    await expect(page.locator('#touch .tfire')).toHaveClass(/on/);
    await t.end();
    expect(await page.evaluate(() => window.__input.touch)).toMatchObject({ d: -1, f: false, a: false });
    await expect(page.locator('#touch .stick')).not.toHaveClass(/active/);
    const abl = await page.locator('#touch .tabil').boundingBox();
    await t.start([[3, abl.x + abl.width / 2, abl.y + abl.height / 2]]);
    expect(await page.evaluate(() => window.__input.touch)).toMatchObject({ a: true, f: false });
    await t.end();
  });

  test('out of lives: the view pulls back to the whole map', async ({ page }) => {
    await open(page, {});
    await page.evaluate(() => localStorage.setItem('nt_zoom', 'close'));
    await startSolo(page);
    expect((await view(page)).scs).toBeGreaterThan((await view(page)).fit * 1.3);
    await page.evaluate(() => { const g = window.__nt.game; for (const p of g.players.values()) { p.lives = 0; p.tankId = 0; p.respawnAt = 0; } g.tanks = g.tanks.filter(t => t.kind !== 'player'); });
    await page.waitForFunction(() => Math.abs(window.__r.scs - window.__r.fitScs) < 0.5, null, { timeout: 8000 });
  });
});

test.describe('phone, portrait (website)', () => {
  test.use({ ...PHONE, viewport: { width: 402, height: 874 } });
  test('controls sit on a deck below the map', async ({ page }) => {
    await open(page, { native: false });
    await page.evaluate(() => localStorage.setItem('nt_zoom', 'close'));
    await startSolo(page);
    await expect(page.locator('#touch .tdeck')).toBeVisible();
    const deckTop = await page.locator('#touch .tdeck').evaluate(e => e.getBoundingClientRect().top);
    const v = await view(page);
    expect(v.rect.b).toBeLessThanOrEqual(deckTop + 1);
    expect(v.scs / 2).toBeGreaterThanOrEqual(16);
    expect(v.tank.y).toBeLessThan(deckTop);
  });
});

test.describe('desktop', () => {
  test('whole map, no zoom button', async ({ page }) => {
    await open(page, {});
    await startSolo(page);
    await expect(page.locator('body')).not.toHaveClass(/compact/);
    await expect(page.locator('#btnZoom')).toBeHidden();
    const v = await view(page);
    expect(v.compact).toBe(false);
    expect(v.scs).toBe(v.fit);
  });
});
