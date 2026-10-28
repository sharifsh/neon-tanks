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
  test('the whole small square map shows above a deck with the controls', async ({ page }) => {
    await open(page, { native: false });
    await page.evaluate(() => localStorage.setItem('nt_zoom', 'close'));
    await startSolo(page);
    await expect(page.locator('#touch .tdeck')).toBeVisible();
    const deckTop = await page.locator('#touch .tdeck').evaluate(e => e.getBoundingClientRect().top);
    const v = await view(page);
    expect(v.rect.b).toBeLessThanOrEqual(deckTop + 1);
    expect(v.tank.y).toBeLessThan(deckTop);
    const m = await page.evaluate(() => ({ W: window.__nt.game.mapW, H: window.__nt.game.mapH, ox: window.__r.ox / window.__r.scale, oy: window.__r.oy / window.__r.scale }));
    expect([m.W, m.H]).toEqual([26, 26]); // solo plays the small square field
    expect(v.scs).toBe(v.fit); // nothing scrolls: the whole map is on screen
    expect(v.scs / 2).toBeGreaterThanOrEqual(14);
    expect(m.ox).toBeGreaterThanOrEqual(-1); expect(m.ox + m.W * v.scs / 2).toBeLessThanOrEqual(v.w + 1);
    expect(m.oy).toBeGreaterThanOrEqual(v.rect.t - 1); expect(m.oy + m.H * v.scs / 2).toBeLessThanOrEqual(deckTop + 1);
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

test.describe('phone menus (iPhone 13 size)', () => {
  for (const [label, vp] of [['upright', { width: 390, height: 844 }], ['on its side', { width: 844, height: 390 }]]) {
    test.describe(label, () => {
      test.use({ ...PHONE, viewport: vp });
      test('Play Solo is on the first screen, keyboard-only options are hidden, the lobby starts on Easy', async ({ page }) => {
        const hits = await open(page, {});
        await expect(page.locator('body')).toHaveClass(/compact/);
        await expect(page.locator('body')).toHaveClass(/touch-only/);
        for (const id of ['#btnSolo', '#btnCreate', '#btnJoin', '#nameInput']) {
          const r = await page.locator(id).boundingBox();
          expect(r.y + r.height, id).toBeLessThanOrEqual(vp.height);
        }
        await expect(page.locator('#btnControls')).toBeHidden();
        await page.click('#btnSolo');
        await expect(page.locator('#lobby')).toHaveClass(/active/);
        expect(await page.evaluate(() => window.__nt.lobby.difficulty)).toBe('easy');
        await expect(page.locator('#diffDesc')).toContainText('Easy');
        await expect(page.locator('#btnAddP2')).toBeHidden();
        await expect(page.locator('#btnControls2')).toBeHidden();
        const start = await page.locator('#btnStart').boundingBox();
        expect(start.y + start.height).toBeLessThanOrEqual(vp.height); // Start stays in reach
        // a keyboard appears: its options come back
        await page.keyboard.press('KeyW');
        await expect(page.locator('#btnControls2')).toBeVisible();
        expect(hits).toEqual([]);
      });
    });
  }
});

test.describe('turning the phone', () => {
  test.use({ ...PHONE, viewport: { width: 390, height: 844 } });
  test('upright to sideways mid-game: the controls deck goes away and the view re-fits', async ({ page }) => {
    await open(page, {});
    await page.evaluate(() => localStorage.setItem('nt_zoom', 'close'));
    await startSolo(page);
    await expect(page.locator('body')).toHaveClass(/portrait/);
    await expect(page.locator('#touch .tdeck')).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('body')).not.toHaveClass(/portrait/);
    await expect(page.locator('#touch .tdeck')).toBeHidden();
    await page.waitForFunction(() => window.__r.canvas.width === Math.round(innerWidth * window.__r.scale));
    const v = await view(page);
    expect(v.w).toBe(844);
    expect(v.tank.y).toBeGreaterThan(0); expect(v.tank.y).toBeLessThan(390);
    expect(await page.evaluate(() => window.__nt.game.status)).toBe('play');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).toHaveClass(/portrait/);
  });
});

test.describe('maps', () => {
  test('every built-in map is square, phone sized, drawn on the block grid and playable', async ({ page }) => {
    await open(page, {});
    const maps = await page.evaluate(async () => {
      const { builtinMaps } = await import('./maps.js');
      const { decodeMap } = await import('./levels.js');
      return builtinMaps().map(m => { const d = decodeMap(m.data); return { id: m.id, w: d.w, h: d.h, valid: m.valid, layout: d.layout }; });
    });
    expect(maps.length).toBe(24);
    for (const m of maps) {
      expect(m.valid, m.id).toBe(true);
      expect(m.w, m.id).toBe(m.h);
      expect([26, 30, 38], m.id).toContain(m.w);
    }
    const free = await page.evaluate(async () => (await import('./store.js')).FREE.maps);
    for (const id of free) expect(maps.map(m => m.id)).toContain(id);
    // random maps too, at every size and layout
    const bad = await page.evaluate(async () => {
      const { generateMap, getLayout, checkConnectivity } = await import('./levels.js');
      const C = await import('./const.js');
      const out = [];
      for (const size of ['S', 'M', 'L']) for (const lay of ['C', 'A', 'D', 'U']) for (let seed = 1; seed <= 6; seed++) {
        C.setMapSize(...C.SIZES[size]);
        const g = generateMap(lay, seed, 2);
        if (!checkConnectivity(g.grid, getLayout(lay))) out.push(`${lay}${size}#${seed}`);
      }
      return out;
    });
    expect(bad).toEqual([]);
  });

  test('cornering: pushing into a wall one cell beside a gap slides the tank through', async ({ page }) => {
    await open(page, {});
    const r = await page.evaluate(async () => {
      const { Game } = await import('./game.js');
      const C = await import('./const.js');
      const g = new Game({ mode: 'classic', size: 'S', players: [{ id: 'p', name: 'A', cls: 'striker' }], difficulty: 'easy', seed: 3 });
      g.addPlayer({ id: 'p', name: 'A', cls: 'striker' });
      for (let i = 0; i < 400 && !g.tanks.some(t => t.kind === 'player' && g.time > t.spawnUntil); i++) g.step();
      const W = C.W, out = {};
      for (const [x0, key] of [[9, 'left'], [11, 'right'], [8, 'twoAway']]) {
        g.grid.fill(C.T.EMPTY); for (let x = 0; x < W; x++) if (x !== 10 && x !== 11) g.grid[10 * W + x] = g.grid[11 * W + x] = C.T.STEEL;
        g.tanks = g.tanks.filter(t => t.kind === 'player'); g.freezeUntil = g.time + 99;
        const me = g.tanks[0]; me.x = x0; me.y = 14; me.dir = 0;
        g.setInput('p', { d: 0 }); for (let i = 0; i < 90; i++) g.step();
        out[key] = me.y < 10;
      }
      return out;
    });
    expect(r).toEqual({ left: true, right: true, twoAway: false });
  });
});
