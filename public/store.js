// Free-to-start: one non-consumable "Full" unlock bought through the App Store / Google Play.
// The website is always the free version and links to the store.
// In the native app, ownership is read from the store account at launch and whenever the app
// comes back to the foreground, so refunds and restores take effect without a reinstall.

export const PRODUCT_ID = 'com.sharifsh.neontanks.full';
// App Store page: https://apps.apple.com/app/id6826830695 — fill in APP_STORE_URL once the app is live
// (empty = the website says "coming soon to the App Store").
export const APP_STORE_URL = '';
export const PLAY_STORE_URL = '';
// Public website (used for invite/map links from inside the app, privacy and support pages)
export const SITE_URL = 'https://tanksarenabattle.com';

// What the free version includes. Everything else needs the Full unlock.
export const FREE = {
  modes: ['classic', 'battle'],
  difficulties: ['easy', 'normal'],
  themes: ['neon', 'pixel'],
  classes: ['striker', 'scout'],
  maps: ['b:fortress-gate', 'b:river-crossing', 'b:minefield', 'b:frozen-lake', 'b:twin-rivers', 'b:crossfire', 'b:mirror-keep', 'b:portal-wars'],
  shareMaps: false, // editing and test play are free; publishing to the community needs Full
  players: 3, // online rooms hosted with the free version hold 3 players (full version: 8); others can still watch as spectators
};

const CACHE_KEY = 'nt_full';
const cache = {
  get() { try { return localStorage.getItem(CACHE_KEY) === '1'; } catch (e) { return false; } },
  set(v) { try { v ? localStorage.setItem(CACHE_KEY, '1') : localStorage.removeItem(CACHE_KEY); } catch (e) {} },
};

function plugin() {
  const C = window.Capacitor;
  if (!C || !(C.isNativePlatform ? C.isNativePlatform() : C.isNative)) return null;
  return (C.Plugins && C.Plugins.NativePurchases) || null;
}
const errText = e => String((e && (e.message || e.errorMessage)) || e || '');
const errCode = e => String((e && e.code) || '');
const isCancel = e => /cancel/i.test(errText(e)) || /USER_CANCELED/i.test(errCode(e));
const isPending = e => /pending/i.test(errText(e));
const isOwnedAlready = e => /ALREADY_OWNED/i.test(errText(e) + errCode(e));

// A transaction counts if it's for our product, not revoked/refunded and (Android) actually purchased.
export function grants(t) {
  if (!t || t.productIdentifier !== PRODUCT_ID) return false;
  if (t.revocationDate) return false;
  if (t.purchaseState != null && String(t.purchaseState) !== '1' && !/^purchased$/i.test(String(t.purchaseState))) return false;
  return true;
}

export const Full = {
  native: false,
  owned: false,
  product: null,          // { title, priceString } from the store, once it answers
  productState: 'idle',   // idle | loading | ready | missing | error
  busy: false,
  pending: false,
  listeners: new Set(),
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(why) { for (const fn of this.listeners) { try { fn(why); } catch (e) { console.error(e); } } },
  set(owned, why) {
    const was = this.owned;
    this.owned = !!owned; cache.set(this.owned);
    if (owned) this.pending = false;
    if (was !== this.owned || why) this.emit(why || (owned ? 'unlocked' : 'locked'));
  },

  async init() {
    const P = plugin();
    this.native = !!P;
    if (!P) { this.owned = false; cache.set(false); return; } // website = free version
    this.owned = cache.get(); // last known answer while the store replies
    try {
      await P.addListener('transactionUpdated', t => { if (grants(t)) this.set(true, 'unlocked'); });
    } catch (e) {}
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.refresh(); });
    await this.refresh();
    this.loadProduct();
  },

  // Ask the store what this account owns. Keeps the cached answer if the store can't be reached.
  async refresh() {
    const P = plugin(); if (!P) return this.owned;
    try {
      const r = await P.getPurchases({ productType: 'inapp', onlyCurrentEntitlements: true });
      this.set((r && r.purchases || []).some(grants));
    } catch (e) { console.warn('purchases check failed', errText(e)); }
    return this.owned;
  },

  // Called whenever the unlock card opens: a new product can take a while to appear after setup.
  async loadProduct() {
    const P = plugin(); if (!P) return null;
    if (this.productState === 'loading') return this.product;
    this.productState = 'loading'; this.emit('product');
    try {
      const r = await P.getProducts({ productIdentifiers: [PRODUCT_ID], productType: 'inapp' });
      const p = (r && r.products || []).find(x => x.identifier === PRODUCT_ID);
      this.product = p ? { title: p.title, priceString: p.priceString } : null;
      this.productState = p ? 'ready' : 'missing';
    } catch (e) {
      this.product = null;
      this.productState = /not found/i.test(errText(e)) ? 'missing' : 'error';
    }
    this.emit('product');
    return this.product;
  },

  // Returns { ok, status: 'unlocked'|'cancelled'|'pending'|'failed'|'unavailable', message }
  async buy() {
    const P = plugin(); if (!P) return { ok: false, status: 'unavailable', message: 'Purchases are only available in the app.' };
    if (this.busy) return { ok: false, status: 'busy' };
    if (this.productState !== 'ready') { await this.loadProduct(); if (this.productState !== 'ready') return { ok: false, status: 'unavailable', message: 'The store isn’t offering the unlock right now. Please try again in a little while.' }; }
    this.busy = true; this.emit('busy');
    try {
      const t = await P.purchaseProduct({ productIdentifier: PRODUCT_ID, productType: 'inapp', quantity: 1 });
      if (grants(t) || (t && t.transactionId && t.productIdentifier === PRODUCT_ID && t.purchaseState == null)) { this.set(true, 'unlocked'); return { ok: true, status: 'unlocked' }; }
      if (t && String(t.purchaseState) === '2') { this.pending = true; this.emit('pending'); return { ok: false, status: 'pending' }; }
      await this.refresh();
      return this.owned ? { ok: true, status: 'unlocked' } : { ok: false, status: 'failed', message: 'The purchase didn’t complete.' };
    } catch (e) {
      if (isCancel(e)) return { ok: false, status: 'cancelled' };
      if (isPending(e)) { this.pending = true; this.emit('pending'); return { ok: false, status: 'pending' }; }
      if (isOwnedAlready(e)) { await this.restore(); if (this.owned) return { ok: true, status: 'unlocked' }; }
      return { ok: false, status: 'failed', message: errText(e) || 'The purchase didn’t complete.' };
    } finally { this.busy = false; this.emit('busy'); }
  },

  // Returns { ok, status: 'restored'|'none'|'failed'|'unavailable' }
  async restore() {
    const P = plugin(); if (!P) return { ok: false, status: 'unavailable' };
    this.busy = true; this.emit('busy');
    try {
      try { await P.restorePurchases(); } catch (e) { if (isCancel(e)) return { ok: false, status: 'cancelled' }; throw e; }
      await this.refresh();
      return this.owned ? { ok: true, status: 'restored' } : { ok: false, status: 'none' };
    } catch (e) {
      return { ok: false, status: 'failed', message: errText(e) };
    } finally { this.busy = false; this.emit('busy'); }
  },
};

// ---- entitlement helpers (pass the copy that decides: the host's in online rooms) ----
export const modeFree = m => FREE.modes.includes(m);
export const diffFree = d => FREE.difficulties.includes(d);
export const themeFree = t => FREE.themes.includes(t);
export const classFree = c => FREE.classes.includes(c);
// built-in maps are listed; community/editor maps are free when their mode is free
export const mapFree = m => !m || !m.id || !String(m.id).startsWith('b:') || FREE.maps.includes(m.id);
