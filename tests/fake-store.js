// Stand-in for the App Store / Google Play: a fake window.Capacitor with the NativePurchases plugin.
// Nothing here talks to a real store, and the helpers below block every request to the real
// database / CDN so tests can never write to it.
export const PRODUCT_ID = 'com.sharifsh.neontanks.full';

export function installFakeStore(page, init = {}) {
  return page.addInitScript(({ init, ID }) => {
    const fs = window.__fs = Object.assign({
      native: true, owned: false, revoked: false, next: 'ok', restoreOwned: false, offered: true, calls: [], listeners: {},
    }, init);
    if (!fs.native) return;
    const product = { identifier: ID, title: 'Neon Tanks Full', description: 'Unlock all modes, maps and styles', priceString: '$3.99', price: 3.99, currencyCode: 'USD' };
    const purchase = () => ({ productIdentifier: ID, transactionId: '2000000001', purchaseDate: '2026-10-25T10:00:00Z', ...(fs.revoked ? { revocationDate: '2026-10-26T10:00:00Z', revocationReason: 'other' } : {}) });
    const NativePurchases = {
      async getPurchases(o) { fs.calls.push('getPurchases'); return { purchases: fs.owned ? [purchase()] : [] }; },
      async getProducts(o) { fs.calls.push('getProducts'); return { products: fs.offered ? [product].filter(p => o.productIdentifiers.includes(p.identifier)) : [] }; },
      async purchaseProduct(o) {
        fs.calls.push('purchaseProduct:' + o.productIdentifier);
        await new Promise(r => setTimeout(r, 50));
        switch (fs.next) {
          case 'ok': fs.owned = true; return purchase();
          case 'cancel': throw Object.assign(new Error('User cancelled'), { code: 'USER_CANCELED' });
          case 'pending': throw new Error('Transaction pending');
          case 'fail': throw new Error('Payment declined');
        }
      },
      async restorePurchases() { fs.calls.push('restorePurchases'); if (fs.restoreOwned) fs.owned = true; },
      async addListener(ev, fn) { fs.listeners[ev] = fn; return { remove() {} }; },
    };
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { NativePurchases } };
  }, { init, ID: PRODUCT_ID });
}

// Fail loudly if anything tries to reach the real database; keep fonts/CDN offline for speed.
export async function blockNetwork(page) {
  const hits = [];
  await page.route(/supabase\.co|jsdelivr\.net/, r => { hits.push(r.request().url()); return r.abort(); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  return hits;
}

export async function open(page, init, path = '/') {
  await installFakeStore(page, init);
  const hits = await blockNetwork(page);
  await page.goto(path);
  await page.waitForFunction(() => window.__full && document.querySelector('#stylePicker .sty'));
  return hits;
}
