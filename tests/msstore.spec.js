import { test, expect } from '@playwright/test';
import { blockNetwork } from './fake-store.js';

// The Windows app is this website installed from the Microsoft Store. There the unlock is the durable Store add-on
// full_game, bought through the Store's own checkout (Digital Goods API + Payment Request). This stand-in plays the
// Store's billing; store: false plays a browser tab that has the API but isn't the Store app (it can't reach the Store).
function installFakeMsStore(page, init = {}) {
  return page.addInitScript(init => {
    const ms = window.__ms = Object.assign({ owned: false, cancel: false, offline: false, store: true, offered: true, calls: [] }, init);
    window.getDigitalGoodsService = async url => {
      ms.calls.push('service');
      if (url !== 'https://store.microsoft.com/billing' || !ms.store) throw new DOMException('Unsupported context', 'NotSupportedError');
      return {
        async getDetails(ids) { ms.calls.push('getDetails'); return ms.offered && ids.includes('full_game') ? [{ itemId: 'full_game', title: 'Full version', description: '', price: { currency: 'USD', value: '3.99' } }] : []; },
        async listPurchases() { ms.calls.push('listPurchases'); if (ms.offline) throw new Error('offline'); return ms.owned ? [{ itemId: 'full_game', purchaseToken: 'tok' }] : []; },
        async listPurchaseHistory() { return []; },
        async consume(t) { ms.calls.push('consume'); },
      };
    };
    window.PaymentRequest = class {
      constructor(methods) { ms.calls.push('pay:' + JSON.stringify(methods)); }
      async show() {
        await new Promise(r => setTimeout(r, 50));
        if (ms.cancel) throw new DOMException('User closed the Payment Request UI.', 'AbortError');
        ms.owned = true; return { details: { token: 'tok' }, complete: async () => {} };
      }
    };
  }, init);
}
async function open(page, init, cached) {
  if (cached) await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('nt_full', '1'); } });
  await installFakeMsStore(page, init);
  const hits = await blockNetwork(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__full && document.querySelector('#stylePicker .sty'));
  return hits;
}
const ms = (page, f) => page.evaluate(f);

test.describe('Windows app from the Microsoft Store', () => {
  test('free copy: Store price, Restore offered, no links to other stores', async ({ page }) => {
    const hits = await open(page, {});
    expect(await ms(page, () => [window.__full.canBuy, window.__full.native])).toEqual([true, false]);
    await page.click('#btnFull');
    await expect(page.locator('#fullBuy')).toHaveText('Unlock everything — $3.99');
    await expect(page.locator('#fullRestore')).toBeVisible();
    await expect(page.locator('#fullStore')).toBeHidden();
    await expect(page.locator('#fullWeb')).toBeHidden();
    expect(hits).toEqual([]);
  });

  test('buying goes through the Store checkout and unlocks everything; the add-on is never consumed', async ({ page }) => {
    await open(page, {});
    await page.click('#btnFull');
    await expect(page.locator('#fullBuy')).toHaveText(/\$3\.99/);
    await page.click('#fullBuy');
    await expect.poll(() => ms(page, () => window.__full.owned)).toBe(true);
    await expect(page.locator('#btnFull')).toHaveText('★ Full version ✓');
    const calls = await ms(page, () => window.__ms.calls);
    expect(calls.filter(c => c.startsWith('pay:'))).toEqual(['pay:[{"supportedMethods":"https://store.microsoft.com/billing","data":{"sku":"full_game"}}]']);
    expect(calls).not.toContain('consume');
    expect(await ms(page, () => localStorage.getItem('nt_full'))).toBe('1');
  });

  test('cancelling the checkout keeps it locked', async ({ page }) => {
    await open(page, { cancel: true });
    await page.click('#btnFull');
    await expect(page.locator('#fullBuy')).toHaveText(/\$3\.99/);
    await page.click('#fullBuy');
    await expect(page.locator('#fullStatus')).toHaveText('Purchase cancelled.');
    expect(await ms(page, () => window.__full.owned)).toBe(false);
  });

  test('bought earlier: unlocked at launch; offline it keeps the saved unlock', async ({ browser }) => {
    const a = await browser.newPage();
    await open(a, { owned: true });
    await expect(a.locator('.sty-lock:visible')).toHaveCount(0);
    await a.close();
    const b = await browser.newPage();
    await open(b, { offline: true }, true);
    expect(await ms(b, () => window.__full.owned)).toBe(true);
    await b.close();
  });

  test('restore finds a purchase made on another PC; a refund is taken away on return', async ({ page }) => {
    await open(page, {});
    await ms(page, () => { window.__ms.owned = true; });
    await page.click('#btnFull');
    await page.click('#fullRestore');
    await expect(page.locator('#fullStatus')).toHaveText('Purchase restored. Everything is unlocked.');
    await ms(page, () => { window.__ms.owned = false; document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => ms(page, () => window.__full.owned)).toBe(false);
  });

  test('before Microsoft publishes the add-on (it can only follow the app): "Coming soon", nothing to click', async ({ page }) => {
    await open(page, { offered: false });
    await page.click('#btnFull');
    await expect(page.locator('#fullBuy')).toHaveText('Coming soon to the Microsoft Store');
    await expect(page.locator('#fullBuy')).toBeDisabled();
    await expect(page.locator('#fullRestore')).toBeHidden();
    await expect(page.locator('#fullStore')).toBeHidden();
  });

  test('a browser tab with the API but not the Store app stays the free version, even with a saved unlock', async ({ page }) => {
    await open(page, { store: false }, true);
    expect(await ms(page, () => [window.__full.canBuy, window.__full.owned])).toEqual([false, false]);
    await page.click('#btnFull');
    await expect(page.locator('#fullBuy')).toBeHidden();
    await expect(page.locator('#fullWeb')).toContainText('free version');
  });
});
