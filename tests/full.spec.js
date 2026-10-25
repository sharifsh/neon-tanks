import { test, expect } from '@playwright/test';
import { open, PRODUCT_ID } from './fake-store.js';

const solo = async page => { await page.fill('#nameInput', 'Tester'); await page.click('#btnSolo'); await expect(page.locator('#lobby')).toHaveClass(/active/); };
const mode = (page, k) => page.locator(`#modePicker .mode[data-mode="${k}"]`);
const card = page => page.locator('#fullModal');
const fs = (page, f) => page.evaluate(f);

test.describe('website = free version', () => {
  test('locks full content and points to the store, no buy button', async ({ page }) => {
    const hits = await open(page, { native: false });
    expect(await page.evaluate(() => window.__full.native)).toBe(false);
    await expect(page.locator('#btnRestore')).toBeHidden();
    await expect(page.locator('#stylePicker .sty[data-id="desert"] .sty-lock')).toBeVisible();
    await expect(page.locator('#stylePicker .sty[data-id="pixel"] .sty-lock')).toHaveCount(0);
    await page.click('#stylePicker .sty[data-id="desert"]');
    await expect(card(page)).toBeVisible();
    await expect(page.locator('#fullWhy')).toContainText('Desert');
    await expect(page.locator('#fullBuy')).toBeHidden();
    await expect(page.locator('#fullWeb')).toContainText('free version');
    await page.click('#fullModal [data-close]');
    expect(await page.evaluate(() => document.body.className)).toBe('theme-neon');
    await solo(page);
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
    await expect(page.locator('#btnRestore')).toBeVisible();
    await expect(page.locator('#classPicker .cls[data-cls="heavy"]')).toHaveClass(/locked-full/);
    await page.click('#btnFull');
    await expect(page.locator('#fullBuy')).toHaveText('Unlock everything — $3.99');
    const n1 = await fs(page, () => window.__fs.calls.filter(c => c === 'getProducts').length);
    await page.click('#fullModal [data-close]');
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
    await expect(page.locator('.diff.insane')).not.toHaveClass(/locked-full/);
    await mode(page, 'survival').click();
    await page.locator('.diff.insane').click();
    await page.click('#btnStart');
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
    await page.click('#btnRestore');
    await expect(page.locator('#toast')).toContainText('restored');
    expect(await fs(page, () => window.__full.owned)).toBe(true);
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
    await page.click('#stylePicker .sty[data-id="desert"]');
    await page.click('#classPicker .cls[data-cls="heavy"]');
    expect(await fs(page, () => [document.body.className, window.__nt.me.cls])).toEqual(['theme-desert', 'heavy']);
    await fs(page, () => { window.__fs.revoked = true; document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => fs(page, () => window.__full.owned)).toBe(false);
    expect(await fs(page, () => [document.body.className, window.__nt.me.cls, localStorage.getItem('nt_full')])).toEqual(['theme-neon', 'striker', null]);
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
    await solo(page);
    await page.click('#btnPickMap');
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
    await host.fill('#nameInput', 'Host'); await host.click('#btnCreate');
    await expect(host.locator('#lobby')).toHaveClass(/active/);
    await mode(host, 'survival').click();
    const code = (await host.textContent('#roomCode')).trim();
    await guest.fill('#nameInput', 'Guest'); await guest.fill('#joinCode', code); await guest.click('#btnJoin');
    await expect(guest.locator('#lobby')).toHaveClass(/active/);
    await expect.poll(() => guest.evaluate(() => !!window.__nt.lobby.full)).toBe(true);
    await expect(mode(guest, 'survival')).toHaveClass(/sel/);
    await expect(guest.locator('#modePicker .locked-full')).toHaveCount(0);
    await guest.locator('#classPicker2 .cls[data-cls="heavy"]').click();
    await expect(guest.locator('#fullModal')).toBeHidden();
    expect(await guest.evaluate(() => window.__nt.me.cls)).toBe('heavy');
    // leaving the room drops what was borrowed from the host
    await guest.click('#btnLeaveLobby');
    await expect(guest.locator('#menu')).toHaveClass(/active/);
    expect(await guest.evaluate(() => window.__nt.me.cls)).toBe('striker');
    await ctx.close();
  });
});
