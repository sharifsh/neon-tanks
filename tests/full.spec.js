import { test, expect } from '@playwright/test';
import { open, PRODUCT_ID } from './fake-store.js';

// Play Solo opens the step-by-step setup: mode → style → tank → map & difficulty
const solo = async page => { await page.fill('#nameInput', 'Tester'); await page.click('#btnSolo'); await expect(page.locator('#setup')).toHaveClass(/active/); };
const step = (page, name) => page.click(`#setupSteps li[data-step="${name}"]`);
// Create Online Room: the same steps, then Open room
const openRoom = async (page, name) => {
  await page.fill('#nameInput', name); await page.click('#btnCreate');
  await expect(page.locator('#setup')).toHaveClass(/active/);
  for (let i = 0; i < 3; i++) await page.click('#setupNext');
  await expect(page.locator('#setupNext')).toHaveText(/Open room/i);
  await page.click('#setupNext');
  await expect(page.locator('#lobby')).toHaveClass(/active/);
};
const mode = (page, k) => page.locator(`#modePicker .mode[data-mode="${k}"]`);
const card = page => page.locator('#fullModal');
const fs = (page, f) => page.evaluate(f);

test.describe('website = free version', () => {
  test('locks full content and points to the store, no buy button', async ({ page }) => {
    const hits = await open(page, { native: false });
    expect(await page.evaluate(() => window.__full.native)).toBe(false);
    await expect(page.locator('#btnRestore')).toBeHidden();
    await solo(page); await step(page, 'style');
    await expect(page.locator('#stylePicker .sty[data-id="desert"] .sty-lock')).toBeVisible();
    await expect(page.locator('#stylePicker .sty[data-id="pixel"] .sty-lock')).toHaveCount(0);
    await page.click('#stylePicker .sty[data-id="desert"]');
    await expect(card(page)).toBeVisible();
    await expect(page.locator('#fullWhy')).toContainText('Desert');
    await expect(page.locator('#fullBuy')).toBeHidden();
    await expect(page.locator('#fullWeb')).toContainText('free version');
    await page.click('#fullModal [data-close]');
    expect(await page.evaluate(() => document.body.className.split(' ').filter(c => c.startsWith('theme-')))).toEqual(['theme-neon']);
    await step(page, 'mode');
    await expect(mode(page, 'classic')).not.toHaveClass(/locked-full/);
    await expect(mode(page, 'battle')).not.toHaveClass(/locked-full/);
    for (const k of ['survival', 'ctf', 'deathmatch', 'duel']) await expect(mode(page, k)).toHaveClass(/locked-full/);
    await mode(page, 'survival').click();
    await expect(card(page)).toBeVisible();
    expect(await page.evaluate(() => window.__nt.lobby.mode)).toBe('classic');
    expect(hits).toEqual([]);
  });
});

test.describe('app with stand-in store', () => {
  test('free copy: locks, and asks the store for the product each time the card opens', async ({ page }) => {
    await open(page, {});
    await page.click('#btnSettings');
    await expect(page.locator('#btnRestore')).toBeVisible();
    await page.click('#settingsModal [data-close]');
    await expect(page.locator('#classPicker .cls[data-cls="heavy"]')).toHaveClass(/locked-full/);
    await page.click('#btnFull');
    await expect(page.locator('#fullBuy')).toHaveText('Unlock everything — $3.99');
    const n1 = await fs(page, () => window.__fs.calls.filter(c => c === 'getProducts').length);
    await page.click('#fullModal [data-close]');
    await solo(page); await step(page, 'tank');
    await page.click('#classPicker .cls[data-cls="heavy"]');
    await expect(card(page)).toBeVisible();
    await expect(page.locator('#fullWhy')).toContainText('Heavy');
    const n2 = await fs(page, () => window.__fs.calls.filter(c => c === 'getProducts').length);
    expect(n2).toBeGreaterThan(n1);
  });

  test('buy unlocks everything right away', async ({ page }) => {
    await open(page, {});
    await solo(page);
    await mode(page, 'survival').click();
    await page.click('#fullBuy');
    await expect(page.locator('#toast')).toContainText('unlocked');
    expect(await fs(page, () => window.__fs.calls)).toContain(`purchaseProduct:${PRODUCT_ID}`);
    await expect(mode(page, 'survival')).not.toHaveClass(/locked-full/);
    await mode(page, 'survival').click();
    await step(page, 'battle');
    await expect(page.locator('.diff.insane')).not.toHaveClass(/locked-full/);
    await page.locator('.diff.insane').click();
    await page.click('#setupNext');
    await expect(page.locator('#game')).toHaveClass(/active/);
    expect(await fs(page, () => [window.__nt.game.mode, window.__nt.game.difficulty])).toEqual(['survival', 'insane']);
    expect(await fs(page, () => localStorage.getItem('nt_full'))).toBe('1');
  });

  test('cancel keeps it locked with no error', async ({ page }) => {
    await open(page, { next: 'cancel' });
    await page.click('#btnFull');
    await page.click('#fullBuy');
    await expect(page.locator('#fullStatus')).toHaveText('Purchase cancelled.');
    expect(await fs(page, () => window.__full.owned)).toBe(false);
  });

  test('pending shows a message, then unlocks when the store approves it', async ({ page }) => {
    await open(page, { next: 'pending' });
    await page.click('#btnFull');
    await page.click('#fullBuy');
    await expect(page.locator('#fullStatus')).toContainText('pending');
    expect(await fs(page, () => window.__full.owned)).toBe(false);
    await fs(page, () => { window.__fs.owned = true; window.__fs.listeners.transactionUpdated({ productIdentifier: 'com.sharifsh.neontanks.full', transactionId: '9' }); });
    await expect.poll(() => fs(page, () => window.__full.owned)).toBe(true);
    await expect(page.locator('#classPicker .cls[data-cls="heavy"]')).not.toHaveClass(/locked-full/);
  });

  test('failure shows the reason and stays locked', async ({ page }) => {
    await open(page, { next: 'fail' });
    await page.click('#btnFull');
    await page.click('#fullBuy');
    await expect(page.locator('#fullStatus')).toContainText('Purchase failed: Payment declined');
    expect(await fs(page, () => window.__full.owned)).toBe(false);
  });

  test('restore from the card and from settings', async ({ page }) => {
    await open(page, { restoreOwned: false });
    await page.click('#btnFull');
    await page.click('#fullRestore');
    await expect(page.locator('#fullStatus')).toContainText('No previous purchase');
    await page.click('#fullModal [data-close]');
    await fs(page, () => { window.__fs.restoreOwned = true; });
    await page.click('#btnSettings');
    await page.click('#btnRestore');
    await expect(page.locator('#toast')).toContainText('restored');
    expect(await fs(page, () => window.__full.owned)).toBe(true);
    await page.click('#settingsModal [data-close]');
    await expect(page.locator('#btnFull')).toHaveText('★ Full version ✓');
  });

  test('owned at launch: nothing locked', async ({ page }) => {
    await open(page, { owned: true });
    await expect(page.locator('.sty-lock:visible')).toHaveCount(0);
    await solo(page);
    await expect(page.locator('#modePicker .locked-full')).toHaveCount(0);
  });

  test('refund: returning to the app re-checks and falls back to free choices', async ({ page }) => {
    await open(page, { owned: true });
    await solo(page); await step(page, 'style');
    await page.click('#stylePicker .sty[data-id="desert"]');
    await step(page, 'tank');
    await page.click('#classPicker .cls[data-cls="heavy"]');
    expect(await fs(page, () => [document.body.className.includes('theme-desert'), window.__nt.me.cls])).toEqual([true, 'heavy']);
    await fs(page, () => { window.__fs.revoked = true; document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => fs(page, () => window.__full.owned)).toBe(false);
    expect(await fs(page, () => [document.body.className.includes('theme-neon'), window.__nt.me.cls, localStorage.getItem('nt_full')])).toEqual([true, 'striker', null]);
    await step(page, 'style');
    await expect(page.locator('#stylePicker .sty[data-id="desert"] .sty-lock')).toBeVisible();
  });

  test('product not offered yet: retry picks it up once the store has it', async ({ page }) => {
    await open(page, { offered: false });
    await page.click('#btnFull');
    await expect(page.locator('#fullBuy')).toHaveText('Not available yet — tap to retry');
    await page.click('#fullBuy');
    expect(await fs(page, () => window.__fs.calls.includes(`purchaseProduct:${'com.sharifsh.neontanks.full'}`))).toBe(false);
    await fs(page, () => { window.__fs.offered = true; });
    await page.click('#fullBuy');
    await expect(page.locator('#fullBuy')).toHaveText('Unlock everything — $3.99');
  });

  test('editor: test play is free, publishing needs Full', async ({ page }) => {
    const hits = await open(page, {});
    await page.click('#btnEditor');
    await page.click('#edSave');
    await expect(card(page)).toBeVisible();
    await expect(page.locator('#fullWhy')).toContainText('Publishing maps');
    await expect(page.locator('#saveModal')).toBeHidden();
    expect(hits).toEqual([]);
  });

  test('locked built-in maps open the card; free ones can be used', async ({ page }) => {
    await open(page, {});
    await solo(page); await step(page, 'battle');
    await page.click('#mapStrip .mcard.more');
    const locked = page.locator('.map-card.locked-full');
    await expect(locked).toHaveCount(16);
    await locked.first().locator('[data-a=use]').click();
    await expect(card(page)).toBeVisible();
    await page.click('#fullModal [data-close]');
    await page.locator('.map-card:not(.locked-full)').first().locator('[data-a=use]').click();
    expect(await fs(page, () => window.__nt.lobby.map && window.__nt.lobby.map.id)).toBe('b:fortress-gate');
  });
});

test.describe('online rooms follow the host’s copy', () => {
  test('full host unlocks the room for a free guest; leaving drops it', async ({ browser }) => {
    const ctx = await browser.newContext();
    const host = await ctx.newPage(), guest = await ctx.newPage();
    await open(host, { owned: true }, '/?fakenet=1');
    await open(guest, { owned: false }, '/?fakenet=1');
    await openRoom(host, 'Host');
    await host.click('#gameSummary button[data-step="mode"]');
    await mode(host, 'survival').click();
    await host.click('#setupNext'); // Done: back to the room
    await expect(host.locator('#lobby')).toHaveClass(/active/);
    await expect(host.locator('#gameSummary')).toContainText('Survival');
    const code = (await host.textContent('#roomCode')).trim();
    await guest.fill('#nameInput', 'Guest'); await guest.fill('#joinCode', code); await guest.click('#btnJoin');
    await expect(guest.locator('#lobby')).toHaveClass(/active/);
    await expect.poll(() => guest.evaluate(() => !!window.__nt.lobby.full)).toBe(true);
    await expect(guest.locator('#gameSummary')).toContainText('Survival');
    await expect(guest.locator('#gameSummary button')).toHaveCount(0); // only the host changes the game
    await guest.locator('#classPicker2 .cls[data-cls="heavy"]').click();
    await expect(guest.locator('#fullModal')).toBeHidden();
    expect(await guest.evaluate(() => window.__nt.me.cls)).toBe('heavy');
    // leaving the room drops what was borrowed from the host
    await guest.click('#btnLeaveLobby');
    await expect(guest.locator('#menu')).toHaveClass(/active/);
    expect(await guest.evaluate(() => window.__nt.me.cls)).toBe('striker');
    await ctx.close();
  });

  for (const [owned, cap] of [[false, 4], [true, 8]]) {
    test(`room size: ${owned ? 'full' : 'free'} host allows ${cap} players`, async ({ browser }) => {
      test.setTimeout(120000); // five browser pages talking to each other
      const ctx = await browser.newContext();
      const host = await ctx.newPage();
      await open(host, { owned }, '/?fakenet=1');
      await openRoom(host, 'Host');
      // every spot is listed from the start; the empty ones fill in as people join
      await expect(host.locator('#slots .slot:not(.locked-slot)')).toHaveCount(cap);
      await expect(host.locator('#slots .slot.open')).toHaveCount(cap - 1);
      const code = (await host.textContent('#roomCode')).trim();
      const guests = [];
      for (let n = 1; n <= 4; n++) {
        const g = await ctx.newPage();
        await open(g, { owned: false }, '/?fakenet=1');
        await g.fill('#nameInput', 'Guest' + n); await g.fill('#joinCode', code); await g.click('#btnJoin');
        await expect(g.locator('#lobby')).toHaveClass(/active/);
        await expect.poll(() => host.evaluate(() => window.__nt.peers.size), { timeout: 15000 }).toBe(n);
        guests.push(g);
        if (n === 1) {
          await expect(host.locator('#slots .slot.open')).toHaveCount(cap - 2);
          await expect(g.locator('#slots .slot:not(.locked-slot)')).toHaveCount(cap); // the guest sees the same spots
          await expect(g.locator('#slots .slot.open')).toHaveCount(cap - 2);
        }
      }
      await expect.poll(() => guests[3].evaluate(() => window.__nt.role), { timeout: 15000 }).toBe(owned ? 'player' : 'spectator');
      await expect(host.locator('#playerCount')).toHaveText(owned ? '5/8' : '4/4');
      await expect(host.locator('#slots .slot.open')).toHaveCount(owned ? 3 : 0);
      await expect(host.locator('#slots .locked-slot')).toHaveCount(owned ? 0 : 1);
      if (!owned) {
        await expect(guests[3].locator('#specNote')).toBeVisible();
        await expect(guests[3].locator('#specNote')).toContainText('free room holds 4');
        // the locked row explains the limit and offers the unlock
        await expect(host.locator('#slots .locked-slot')).toContainText('Up to 8 players');
        await host.locator('#slots .locked-slot').click();
        await expect(host.locator('#fullWhy')).toContainText('Free rooms hold 4 players');
        // when a player leaves, the spectator can take the free slot
        await guests[0].close({ runBeforeUnload: true }); // lets the page say goodbye instead of waiting for a timeout
        await expect(guests[3].locator('#btnTakeSlot')).toBeEnabled({ timeout: 30000 });
        await guests[3].click('#btnTakeSlot');
        await expect.poll(() => guests[3].evaluate(() => window.__nt.role), { timeout: 15000 }).toBe('player');
      }
      await ctx.close();
    });
  }

  test('phones show every spot of the room too', async ({ browser }) => {
    for (const [owned, cap, cols] of [[false, 4, 1], [true, 8, 2]]) {
      const ctx = await browser.newContext({ viewport: { width: 874, height: 402 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const host = await ctx.newPage();
      await open(host, { owned }, '/?fakenet=1');
      await openRoom(host, 'Host');
      const spots = host.locator('#slots .slot:not(.locked-slot)');
      await expect(spots).toHaveCount(cap);
      for (let i = 0; i < cap; i++) await expect(spots.nth(i)).toBeVisible();
      await expect(host.locator('#slots .slot.open').first()).toContainText('Open spot');
      // 8-player rooms use two columns on a phone, so all the spots fit
      const xs = await spots.evaluateAll(els => [...new Set(els.map(e => Math.round(e.getBoundingClientRect().left)))]);
      expect(xs.length).toBe(cols);
      await ctx.close();
    }
  });
});
