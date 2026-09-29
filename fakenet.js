// Local-only stand-in for Supabase Realtime (used for offline testing with ?fakenet=1).
// Syncs tabs of the same browser via BroadcastChannel.
class FakeChannel {
  constructor(name, opts) {
    this.key = opts.config.presence.key; this.handlers = []; this.presence = {};
    this.bc = new BroadcastChannel('fake-' + name); this.bc.onmessage = e => this.recv(e.data);
    addEventListener('beforeunload', () => this.untrack());
  }
  on(type, filter, cb) { this.handlers.push({ type, event: filter.event, cb }); return this; }
  subscribe(cb) { setTimeout(() => cb('SUBSCRIBED'), 20); return this; }
  async track(p) { this.me = p; this.presence[this.key] = [p]; this.bc.postMessage({ k: 'pres', key: this.key, p }); this.bc.postMessage({ k: 'presq' }); this.sync(); }
  untrack() { try { this.bc.postMessage({ k: 'leave', key: this.key }); } catch (e) {} }
  presenceState() { return this.presence; }
  send({ event, payload }) { this.bc.postMessage({ k: 'b', event, payload }); }
  recv(m) {
    if (m.k === 'pres') { this.presence[m.key] = [m.p]; this.sync(); }
    else if (m.k === 'presq') { if (this.me) this.bc.postMessage({ k: 'pres', key: this.key, p: this.me }); }
    else if (m.k === 'leave') { delete this.presence[m.key]; this.sync(); }
    else if (m.k === 'b') for (const h of this.handlers) if (h.type === 'broadcast' && h.event === m.event) h.cb({ payload: m.payload });
  }
  sync() { for (const h of this.handlers) if (h.type === 'presence') h.cb(); }
  close() { this.bc.close(); }
}
export function fakeClient() {
  return { channel: (n, o) => new FakeChannel(n, o), removeChannel: ch => ch.close(), from() { throw new Error('offline test mode'); } };
}
