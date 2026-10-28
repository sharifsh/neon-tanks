import { test, expect } from '@playwright/test';
import { open } from './fake-store.js';

// Phone-sized screens: zoomed view that follows your tank, slim HUD, touch controls.
// Solo games only; open() blocks the real database.
const PHONE = { viewport: { width: 874, height: 402 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

// Play Solo walks through the setup (mode, style, tank, map & difficulty); the defaults are fine here
async function startSolo(page) {
  await page.fill('#nameInput', 'Tester'); await page.click('#btnSolo');
  await expect(page.locator('#setup')).toHaveClass(/active/);
  for (let i = 0; i < 3; i++) await page.click('#setupNext');
  await expect(page.locator('#setupNext')).toHaveText(/Start mission/i);
  await page.click('#setupNext');
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
// freeze the enemies (no new ones either), so a slow test machine can't lose the game midway and pull the view back
const calm = page => page.evaluate(() => { const g = window.__nt.game; g.freezeUntil = g.time + 600; });
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
    // a quick tap, stamped 80 ms long however slowly a busy test machine delivers it
    tap: async (id, x, y) => {
      const t0 = Date.now() / 1000;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(id, x, y)], timestamp: t0 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.08 });
    },
  };
};

test.describe('phone, landscape', () => {
  test.use(PHONE);

  test('the view zooms in on your tank, the HUD is slim and the zoom button cycles (and is remembered)', async ({ page }) => {
    const hits = await open(page, {});
    await startSolo(page);
    await calm(page);
    await expect(page.locator('body')).toHaveClass(/compact/);
    await expect(page.locator('#btnZoom')).toBeVisible();
    expect(await page.locator('#hudTop').evaluate(e => e.getBoundingClientRect().height)).toBeLessThanOrEqual(46);
    for (const id of ['#btnMap', '#btnZoom', '#btnPause']) { // the corner buttons are easy to hit with a thumb
      const r = await page.locator(id).boundingBox();
      expect(r.height, id).toBeGreaterThanOrEqual(40); expect(r.width, id).toBeGreaterThanOrEqual(44);
    }
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

  test('touch, joystick that follows the thumb: a thumb anywhere on the left half steers (the view follows), the right half fires, ABL is its own button', async ({ page }) => {
    await open(page, {});
    await page.evaluate(() => { localStorage.setItem('nt_zoom', 'close'); localStorage.setItem('nt_stick', 'float'); });
    await page.reload(); await page.waitForFunction(() => window.__full);
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

  test('touch, fixed joystick (the default): it stays put; a thumb on it steers, a thumb far from it does nothing', async ({ page }) => {
    await open(page, {});
    await page.evaluate(() => localStorage.setItem('nt_zoom', 'close'));
    await startSolo(page);
    expect(await page.evaluate(() => window.__input.stickMode)).toBe('fixed');
    await clearAround(page);
    const t = await touch(page);
    const home = await page.locator('#touch .stick').boundingBox();
    const cx = home.x + home.width / 2, cy = home.y + home.height / 2;
    // far from the stick (upper left): nothing happens
    await t.start([[1, 120, 120]]);
    expect(await page.evaluate(() => window.__input.touch.d)).toBe(-1);
    await expect(page.locator('#touch .stick')).not.toHaveClass(/active/);
    await t.end();
    // on the stick: slide up to drive up, and the stick does not move
    const y0 = await page.evaluate(() => window.__nt.game.tanks.find(t => t.kind === 'player').y);
    await t.start([[2, cx + 4, cy + 6]]);
    await t.move([[2, cx + 6, cy - 50]]);
    await expect(page.locator('#touch .stick')).toHaveClass(/active/);
    expect(await page.evaluate(() => window.__input.touch.d)).toBe(0);
    const moved = await page.locator('#touch .stick').boundingBox();
    expect(Math.abs(moved.x - home.x) + Math.abs(moved.y - home.y)).toBeLessThan(1);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__nt.game.tanks.find(t => t.kind === 'player').y)).toBeLessThan(y0 - 4);
    // sliding well past the edge keeps steering from the same spot
    await t.move([[2, cx + 160, cy - 10]]);
    expect(await page.evaluate(() => window.__input.touch.d)).toBe(1);
    expect(Math.abs((await page.locator('#touch .stick').boundingBox()).x - home.x)).toBeLessThan(1);
    await t.end();
    expect(await page.evaluate(() => window.__input.touch.d)).toBe(-1);
  });

  test('the round map button just above FIRE: a quick look at the whole map without firing; hold it to keep looking', async ({ page }) => {
    await open(page, {});
    await page.evaluate(() => localStorage.setItem('nt_zoom', 'close'));
    await startSolo(page);
    await clearAround(page);
    const peek = page.locator('#touch .tpeek');
    await expect(peek).toBeVisible();
    const fire = await page.locator('#touch .tfire').boundingBox(), pb = await peek.boundingBox();
    expect(pb.y + pb.height).toBeLessThanOrEqual(fire.y); // just above FIRE
    expect(fire.y - (pb.y + pb.height)).toBeLessThan(24);
    expect(pb.x + pb.width / 2).toBeGreaterThan(fire.x - 10); expect(pb.x + pb.width / 2).toBeLessThan(fire.x + fire.width);
    expect(pb.width).toBeGreaterThanOrEqual(44);
    const t = await touch(page), px = pb.x + pb.width / 2, py = pb.y + pb.height / 2;
    // tap: the whole map for a moment, then back to the tank by itself; both map buttons light up
    await t.tap(5, px, py);
    await page.waitForFunction(() => window.__r.peek, null, { timeout: 2000 });
    await expect(peek).toHaveClass(/on/); await expect(page.locator('#btnMap')).toHaveClass(/on/);
    await page.waitForFunction(() => window.__r.scs < (window.__r.zoomScs + window.__r.fitScs) / 2, null, { timeout: 4000 });
    await page.waitForFunction(() => !window.__r.peek && Math.abs(window.__r.scs - window.__r.zoomScs) < 0.5, null, { timeout: 8000 });
    await expect(peek).not.toHaveClass(/on/);
    // hold it while steering with the other thumb: the whole map until you let go, and no shots
    const st = await page.locator('#touch .stick').boundingBox(), sx = st.x + st.width / 2, sy = st.y + st.height / 2;
    await t.start([[5, px, py]]);
    await t.start([[5, px, py], [1, sx, sy + 4]]);
    await t.move([[5, px, py], [1, sx + 2, sy - 50]]);
    expect(await page.evaluate(() => window.__input.touch)).toMatchObject({ d: 0, f: false });
    await expect(page.locator('#touch .tfire')).not.toHaveClass(/on/);
    await page.waitForFunction(() => window.__r.peek && Math.abs(window.__r.scs - window.__r.fitScs) < 0.5, null, { timeout: 8000 });
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => window.__r.peek)).toBe(true);
    await t.end();
    await page.waitForFunction(() => !window.__r.peek, null, { timeout: 6000 });
    // showing the whole map anyway (zoom button): no map buttons
    await page.evaluate(() => { document.querySelector('#btnZoom').click(); document.querySelector('#btnZoom').click(); });
    expect(await page.evaluate(() => window.__r.zoom)).toBe('fit');
    await expect(peek).toBeHidden(); await expect(page.locator('#btnMap')).toBeHidden();
  });

  test('settings: the joystick choice is remembered', async ({ page }) => {
    await open(page, {});
    await page.click('#btnSettings');
    await expect(page.locator('#settingsModal .stick-seg [data-stick="fixed"]')).toHaveClass(/sel/);
    await page.click('#settingsModal .stick-seg [data-stick="float"]');
    await expect(page.locator('#settingsModal .stick-note')).toContainText('follows');
    expect(await page.evaluate(() => [window.__input.stickMode, localStorage.getItem('nt_stick')])).toEqual(['float', 'float']);
    await page.reload(); await page.waitForFunction(() => window.__full);
    expect(await page.evaluate(() => window.__input.stickMode)).toBe('float');
    // the pause menu has the same switch
    await startSolo(page);
    await page.click('#btnPause');
    await page.click('#pauseMenu .stick-seg [data-stick="fixed"]');
    expect(await page.evaluate(() => window.__input.stickMode)).toBe('fixed');
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
  test('upright: a zoomed view above the controls deck; the map button shows the whole map for a moment', async ({ page }) => {
    await open(page, { native: false });
    await page.evaluate(() => localStorage.setItem('nt_zoom', 'close'));
    await startSolo(page);
    await calm(page);
    await expect(page.locator('#touch .tdeck')).toBeVisible();
    const deckTop = await page.locator('#touch .tdeck').evaluate(e => e.getBoundingClientRect().top);
    const v = await view(page);
    expect(v.rect.b).toBeLessThanOrEqual(deckTop + 1);
    expect(v.tank.y).toBeLessThan(deckTop);
    expect(v.tank.x).toBeGreaterThan(0); expect(v.tank.x).toBeLessThan(v.w);
    expect(await page.evaluate(() => [window.__nt.game.mapW, window.__nt.game.mapH])).toEqual([26, 26]); // solo plays the small square field
    expect(v.scs).toBeGreaterThan(v.fit * 1.4); // zoomed in: about 16 cells across the width
    expect(v.scs / 2).toBeGreaterThanOrEqual(22);
    // the round map button sits on the deck, just above FIRE
    const pb = await page.locator('#touch .tpeek').boundingBox(), fb = await page.locator('#touch .tfire').boundingBox();
    expect(pb.y).toBeGreaterThanOrEqual(deckTop + 6); expect(pb.y + pb.height).toBeLessThanOrEqual(fb.y);
    // tap the map button: the whole map, then back to the tank by itself
    await expect(page.locator('#btnMap')).toBeVisible();
    const box = await page.locator('#btnMap').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => window.__r.peek, null, { timeout: 2000 });
    await expect(page.locator('#btnMap')).toHaveClass(/on/);
    await page.waitForFunction(() => window.__r.scs < (window.__r.zoomScs + window.__r.fitScs) / 2, null, { timeout: 4000 }); // gliding out
    await page.waitForFunction(() => !window.__r.peek && Math.abs(window.__r.scs - window.__r.zoomScs) < 0.5, null, { timeout: 8000 });
    // hold it: the whole map until you let go
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => window.__r.peek && Math.abs(window.__r.scs - window.__r.fitScs) < 0.5, null, { timeout: 8000 });
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => window.__r.peek)).toBe(true);
    await page.mouse.up();
    await page.waitForFunction(() => !window.__r.peek, null, { timeout: 6000 });
    // the zoom button's whole-map setting hides the map button
    await page.evaluate(() => { document.querySelector('#btnZoom').click(); document.querySelector('#btnZoom').click(); });
    expect(await page.evaluate(() => window.__r.zoom)).toBe('fit');
    await expect(page.locator('#btnMap')).toBeHidden();
    await expect(page.locator('#touch .tpeek')).toBeHidden();
  });
  test('upright, versus modes: the score board and the bigger corner buttons never overlap', async ({ page }) => {
    const hits = await open(page, { owned: true });
    for (const mode of ['deathmatch', 'duel', 'battle']) {
      await page.fill('#nameInput', 'Tester'); await page.click('#btnSolo');
      await page.locator(`#modePicker .mode[data-mode="${mode}"]`).click();
      for (let i = 0; i < 3; i++) await page.click('#setupNext');
      await page.click('#setupNext');
      await expect(page.locator('#game')).toHaveClass(/active/);
      await page.waitForFunction(() => document.querySelector('#hudCenter .team-score'));
      const box = s => page.locator(s).evaluate(e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, sw: e.scrollWidth }; });
      const left = await box('#hudLeft'), center = await box('#hudCenter'), right = await box('#hudTop .hud-right');
      expect(center.r, mode).toBeLessThanOrEqual(right.l);
      expect(center.sw, mode).toBeLessThanOrEqual(center.w + 1); // nothing spills out of the board
      if (left.w > 0) { expect(left.r, mode).toBeLessThanOrEqual(center.l); expect(left.sw, mode).toBeLessThanOrEqual(left.w + 1); } // the mode label is dropped or fits
      await page.click('#btnPause'); await page.click('#btnQuit');
      await expect(page.locator('#menu')).toHaveClass(/active/);
    }
    expect(hits).toEqual([]);
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
  test('new game setup: a card in the middle, as tall as its tallest step, so Next never moves', async ({ page }) => {
    const hits = await open(page, {});
    await page.click('#btnSolo');
    const vp = page.viewportSize(), seen = [];
    for (const st of ['mode', 'style', 'tank', 'battle']) {
      await page.click(`#setupSteps li[data-step="${st}"]`);
      await expect(page.locator(`#setup .setup-step[data-step="${st}"]`)).toBeVisible();
      seen.push({
        card: await page.locator('#setup .setup-wrap').boundingBox(),
        next: await page.locator('#setupNext').boundingBox(),
        overflow: await page.evaluate(() => { const b = document.querySelector('.setup-body'); return b.scrollHeight - b.clientHeight; }),
      });
    }
    for (const s of seen) {
      expect(s.card).toEqual(seen[0].card);
      expect(s.next.y).toBe(seen[0].next.y); // "Start mission" is wider; its right edge stays put
      expect(s.next.x + s.next.width).toBe(seen[0].next.x + seen[0].next.width);
      expect(s.overflow, 'every step fits without scrolling').toBeLessThanOrEqual(1);
    }
    const { card } = seen[0];
    expect(card.height).toBeLessThan(vp.height - 40);
    expect(Math.abs(card.y - (vp.height - card.y - card.height)), 'centred').toBeLessThanOrEqual(2);
    await expect(page.locator('#setup .setup-step[data-step="mode"]')).toBeHidden(); // steps not showing can't be clicked
    expect(hits).toEqual([]);
  });
});

test.describe('phone menus (iPhone 13 size)', () => {
  for (const [label, vp] of [['upright', { width: 390, height: 844 }], ['on its side', { width: 844, height: 390 }]]) {
    test.describe(label, () => {
      test.use({ ...PHONE, viewport: vp });
      test('a short home screen, then one step at a time; keyboard-only options are hidden; Easy by default', async ({ page }) => {
        const hits = await open(page, {});
        await expect(page.locator('body')).toHaveClass(/compact/);
        await expect(page.locator('body')).toHaveClass(/touch-only/);
        for (const id of ['#btnSolo', '#btnCreate', '#btnJoin', '#nameInput', '#btnSettings']) {
          const r = await page.locator(id).boundingBox();
          expect(r.y + r.height, id).toBeLessThanOrEqual(vp.height);
        }
        // the home screen no longer carries the style and tank pickers
        await expect(page.locator('#stylePicker')).toBeHidden();
        await expect(page.locator('#classPicker')).toBeHidden();
        await page.click('#btnSettings');
        await expect(page.locator('#btnControls')).toBeHidden();
        await expect(page.locator('#settingsModal .stick-row')).toBeVisible();
        await page.click('#settingsModal [data-close]');
        await page.click('#btnSolo');
        await expect(page.locator('#setup')).toHaveClass(/active/);
        const steps = ['mode', 'style', 'tank', 'battle'];
        for (let i = 0; i < 4; i++) {
          await expect(page.locator(`#setup .setup-step[data-step="${steps[i]}"]`)).toBeVisible();
          await expect(page.locator(`#setupSteps li[data-step="${steps[i]}"]`)).toHaveClass(/cur/);
          const next = await page.locator('#setupNext').boundingBox();
          expect(next.y + next.height, 'Next stays in reach').toBeLessThanOrEqual(vp.height);
          expect(next.y, 'Next sits at the bottom').toBeGreaterThan(vp.height * 0.6);
          if (steps[i] === 'style' && label === 'on its side') { // all seven styles on one screen
            expect(await page.evaluate(() => { const b = document.querySelector('.setup-body'); return b.scrollHeight - b.clientHeight; })).toBeLessThanOrEqual(1);
            await expect(page.locator('#setup .setup-body')).not.toHaveClass(/more-below/);
          }
          if (steps[i] === 'mode' && label === 'on its side') { // the modes list scrolls here: its bottom edge fades until you reach the end
            const body = page.locator('#setup .setup-body');
            await expect(body).toHaveClass(/more-below/);
            await body.evaluate(b => { b.scrollTop = b.scrollHeight; });
            await expect(body).not.toHaveClass(/more-below/);
          }
          if (steps[i] === 'tank') {
            await expect(page.locator('#btnAddP2')).toBeHidden(); // keyboard two-player
            await page.keyboard.press('KeyW'); // a keyboard appears: its options come back
            await expect(page.locator('#btnAddP2')).toBeVisible();
          }
          if (i < 3) await page.click('#setupNext');
        }
        expect(await page.evaluate(() => window.__nt.lobby.difficulty)).toBe('easy');
        await expect(page.locator('#diffDesc')).toContainText('Easy');
        await expect(page.locator('#setupNext')).toHaveText(/Start mission/i);
        // back goes one step at a time, then home
        for (let i = 0; i < 4; i++) await page.click('#setupBack');
        await expect(page.locator('#menu')).toHaveClass(/active/);
        expect(hits).toEqual([]);
      });
    });
  }
});

test.describe('new game setup', () => {
  test('choices are remembered for the next game; the step tabs jump around', async ({ page }) => {
    const hits = await open(page, { owned: true });
    await page.fill('#nameInput', 'Tester'); await page.click('#btnSolo');
    await page.locator('#modePicker .mode[data-mode="battle"]').click();
    await page.click('#setupSteps li[data-step="tank"]'); // jump ahead
    await page.locator('#classPicker .cls[data-cls="scout"]').click();
    await page.click('#setupSteps li[data-step="style"]'); // and back
    await page.locator('#stylePicker .sty[data-id="pixel"]').click();
    await page.click('#setupSteps li[data-step="battle"]');
    await page.locator('#diffPicker .diff.normal').click();
    await page.locator('#mapStrip .mcard', { hasText: 'Crossfire' }).click();
    await expect(page.locator('#setupSummary')).toContainText('Team Battle');
    await page.click('#setupNext');
    await expect(page.locator('#game')).toHaveClass(/active/);
    expect(await page.evaluate(() => { const g = window.__nt.game; return [g.mode, g.difficulty, g.cfg.customName, document.body.className.includes('theme-pixel'), [...g.players.values()][0].cls]; }))
      .toEqual(['battle', 'normal', 'Crossfire', true, 'scout']);
    await page.click('#btnPause'); await page.click('#btnQuit');
    await expect(page.locator('#menu')).toHaveClass(/active/);
    await page.click('#btnSolo');
    await expect(page.locator('#modePicker .mode[data-mode="battle"]')).toHaveClass(/sel/);
    expect(await page.evaluate(() => [window.__nt.lobby.mode, window.__nt.lobby.difficulty, window.__nt.me.cls])).toEqual(['battle', 'normal', 'scout']);
    expect(hits).toEqual([]);
  });
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

  test('no clear shots at spawn: co-op cores are shielded from the top, rival spawn points are covered', async ({ page }) => {
    await open(page, {});
    const bad = await page.evaluate(async () => {
      const { builtinMaps } = await import('./maps.js');
      const L = await import('./levels.js');
      const C = await import('./const.js');
      const out = [];
      const check = (label, grid, lay) => {
        if (!L.coreShielded(grid, lay)) out.push(label + ': core in the open');
        const open = L.openSpawnLines(grid, lay);
        if (open.length) out.push(label + ': ' + open.map(([a, b]) => `(${a.x},${a.y})-(${b.x},${b.y})`).join(' '));
      };
      for (const m of builtinMaps()) { const d = L.decodeMap(m.data); C.setMapSize(d.w, d.h); check(m.name, d.grid, L.getLayout(d.layout)); }
      for (const size of ['S', 'M', 'L']) for (const lay of ['C', 'A', 'D', 'U']) for (let seed = 1; seed <= 6; seed++) {
        C.setMapSize(...C.SIZES[size]);
        const g = L.generateMap(lay, seed, 2), layout = L.getLayout(lay);
        if (!L.checkConnectivity(g.grid, layout)) out.push(`random ${lay}${size}#${seed}: not connected`);
        check(`random ${lay}${size}#${seed}`, g.grid, layout);
      }
      // the check itself: an empty co-op field and an empty arena are flagged
      C.setMapSize(26, 26);
      const empty = new Uint8Array(26 * 26);
      out.push(L.coreShielded(empty, L.getLayout('C')) ? 'check missed an open core' : 'ok');
      out.push(L.openSpawnLines(empty, L.getLayout('D')).length ? 'ok' : 'check missed open spawns');
      return out;
    });
    expect(bad).toEqual(['ok', 'ok']);
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
