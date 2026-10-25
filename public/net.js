// Online rooms: Supabase Realtime for discovery/signaling, WebRTC data channels for gameplay,
// automatic fallback to Supabase broadcast relay when a direct connection can't be made.
import { fakeClient } from './fakenet.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { MAX_PLAYERS } from './const.js';

let _sb = null;
const SB_CDN = './vendor/supabase.js'; // bundled locally (npm run vendor) so the app runs no remote code
export function sb() { return _sb; }
export async function sbReady() {
  if (_sb) return _sb;
  if (/fakenet/.test(location.search)) return (_sb = fakeClient());
  const { createClient } = await import(SB_CDN);
  return (_sb = _sb || createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 40 } } }));
}

const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }] };
const RTC_TIMEOUT = 7000;

export function makeRoomCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 5; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}

export class Net {
  constructor({ code, me, isHost, on }) {
    this.code = code; this.me = me; this.isHost = isHost; this.on = on;
    this.peers = new Map(); // host: id -> peer
    this.hostId = null; this.hostSeen = false; this.closed = false;
    this.pc = null; this.dc = null; this.rel = null; this.mode = 'pending';
  }

  async connect() {
    await sbReady();
    const ch = this.ch = sb().channel('tanks:' + this.code, { config: { broadcast: { self: false, ack: false }, presence: { key: this.me.id } } });
    ch.on('broadcast', { event: 'sig' }, ({ payload }) => this.onSig(payload));
    ch.on('broadcast', { event: 'relay' }, ({ payload }) => { if (payload.to === this.me.id || payload.to === '*') this.onMsg(payload.from, payload.m); });
    ch.on('presence', { event: 'sync' }, () => this.onPresence());
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('Could not reach the game server')), 12000);
      ch.subscribe(async st => {
        if (st === 'SUBSCRIBED') { clearTimeout(to); await ch.track({ id: this.me.id, name: this.me.name, host: this.isHost, ts: Date.now() }); res(); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(to); rej(new Error('Realtime connection failed')); }
      });
    });
    // liveness: drop silent peers (host) / detect a vanished host (client)
    this.liveTimer = setInterval(() => {
      const now = Date.now();
      if (this.isHost) { for (const [id, p] of this.peers) if (now - (p.lastSeen || p.created) > 15000) this.dropPeer(id); }
      else if (this.lastHost && now - this.lastHost > 15000 && !this.closed) { this.lastHost = 0; this.hostSeen = false; this.goneHost = this.hostId; this.on.hostLeft && this.on.hostLeft(this.hostId); }
    }, 3000);
    if (!this.isHost) {
      this.startHello('Room not found — check the code or ask the host for a new link.', 9000);
    }
  }

  helloData() { return this.on.hello ? this.on.hello() : { name: this.me.name, cls: this.me.cls }; }
  startHello(errMsg, wait) {
    clearInterval(this.helloTimer); clearTimeout(this.findTimer);
    this.helloTimer = setInterval(() => { if (!this.welcomed && !this.isHost) this.sig('*', 'hello', this.helloData()); }, 1500);
    this.sig('*', 'hello', this.helloData());
    this.findTimer = setTimeout(() => { if (!this.hostSeen && !this.isHost && !this.closed) this.on.error && this.on.error(errMsg); }, wait);
  }

  presentIds() {
    const st = this.ch ? this.ch.presenceState() : {}, ids = new Set();
    for (const k in st) for (const p of st[k]) ids.add(p.id);
    return ids;
  }

  // ---------- host migration ----------
  async promote() {
    clearInterval(this.helloTimer); clearTimeout(this.findTimer);
    if (this.pc) try { this.pc.close(); } catch (e) {}
    this.pc = this.dc = this.rel = null;
    this.isHost = true; this.hostId = this.me.id; this.welcomed = true;
    this.peers = new Map();
    await this.ch.track({ id: this.me.id, name: this.me.name, host: true, ts: Date.now() });
  }
  resetForNewHost() {
    if (this.pc) try { this.pc.close(); } catch (e) {}
    this.pc = this.dc = this.rel = null; this.ice = [];
    this.mode = 'pending'; this.hostId = null; this.hostSeen = false; this.welcomed = false; this.lastHost = 0;
    this.startHello('The host left and nobody could take over the room.', 20000);
  }

  sig(to, type, data) { this.ch && this.ch.send({ type: 'broadcast', event: 'sig', payload: { from: this.me.id, to, type, data } }); }
  relay(to, m) { this.ch && this.ch.send({ type: 'broadcast', event: 'relay', payload: { from: this.me.id, to, m } }); }

  onPresence() {
    const st = this.ch.presenceState();
    const ids = new Set();
    let host = null;
    let hostTs = -1;
    for (const k in st) for (const p of st[k]) { ids.add(p.id); if (p.host && p.id !== this.goneHost && (p.ts || 0) > hostTs) { host = p.id; hostTs = p.ts || 0; } }
    if (!this.isHost) {
      if (host) { if (this.hostId && host !== this.hostId && this.welcomed) return; this.hostId = host; this.hostSeen = true; }
      else if (this.hostSeen && !this.closed) { const h = this.hostId; this.hostSeen = false; this.goneHost = h; this.on.hostLeft && this.on.hostLeft(h); }
    } else {
      for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.dropPeer(id);
    }
  }

  // ---------- signaling ----------
  async onSig({ from, to, type, data }) {
    if (to !== '*' && to !== this.me.id) return;
    if (this.isHost) {
      if (type === 'hello') {
        if (this.peers.has(from)) { const p = this.peers.get(from); if (p.welcomed) { this.sig(from, 'welcome', {}); return; } }
        if (!this.peers.has(from) && this.peers.size >= MAX_PLAYERS * 2 - 1) { this.sig(from, 'full', {}); return; }
        if (this.on.canJoin && !this.on.canJoin()) { this.sig(from, 'closed', {}); return; }
        this.createPeer(from, data);
      } else if (type === 'answer') {
        const p = this.peers.get(from);
        if (p) { await p.pc.setRemoteDescription(data).catch(() => {}); for (const c of p.ice) p.pc.addIceCandidate(c).catch(() => {}); p.ice = []; }
      } else if (type === 'ice') {
        const p = this.peers.get(from);
        if (p && data) { if (p.pc.remoteDescription) p.pc.addIceCandidate(data).catch(() => {}); else p.ice.push(data); }
      }
    } else {
      if (type === 'welcome') { this.welcomed = true; this.hostId = from; this.hostSeen = true; this.lastHost = Date.now(); }
      else if (type === 'full') { this.on.error && this.on.error('This room is full (8 players + 7 spectators).'); }
      else if (type === 'closed') { this.on.error && this.on.error('This room is not accepting players right now.'); }
      else if (type === 'offer') await this.acceptOffer(from, data);
      else if (type === 'ice' && data) { if (this.pc && this.pc.remoteDescription) this.pc.addIceCandidate(data).catch(() => {}); else (this.ice || (this.ice = [])).push(data); }
    }
  }

  createPeer(id, info) {
    const old = this.peers.get(id); if (old) try { old.pc.close(); } catch (e) {}
    const pc = new RTCPeerConnection(ICE);
    const peer = { id, info: info || {}, name: String(info.name || 'Player').slice(0, 16), cls: info.cls, pc, dc: null, rel: null, mode: 'pending', welcomed: true, seq: -1, ice: [], created: Date.now(), lastSeen: Date.now() };
    this.peers.set(id, peer);
    peer.dc = pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 });
    peer.rel = pc.createDataChannel('rel', { ordered: true });
    const onOpen = () => { if (peer.dc.readyState === 'open' && peer.rel.readyState === 'open') { peer.mode = 'rtc'; this.on.peerMode && this.on.peerMode(id, 'rtc'); } };
    peer.dc.onopen = onOpen; peer.rel.onopen = onOpen;
    peer.dc.onmessage = peer.rel.onmessage = e => this.onMsg(id, JSON.parse(e.data));
    pc.onicecandidate = e => { if (e.candidate) this.sig(id, 'ice', e.candidate.toJSON()); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && peer.mode === 'rtc') { peer.mode = 'relay'; this.on.peerMode && this.on.peerMode(id, 'relay'); } };
    pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => this.sig(id, 'offer', { type: pc.localDescription.type, sdp: pc.localDescription.sdp }));
    setTimeout(() => { if (peer.mode === 'pending' && this.peers.get(id) === peer) { peer.mode = 'relay'; this.on.peerMode && this.on.peerMode(id, 'relay'); } }, RTC_TIMEOUT);
    this.sig(id, 'welcome', {});
    this.on.peerJoin && this.on.peerJoin(peer);
  }

  async acceptOffer(from, offer) {
    this.hostId = from;
    if (this.pc) try { this.pc.close(); } catch (e) {}
    const pc = this.pc = new RTCPeerConnection(ICE);
    this.mode = 'pending';
    pc.ondatachannel = e => {
      const c = e.channel;
      if (c.label === 'game') this.dc = c; else this.rel = c;
      c.onmessage = ev => this.onMsg(from, JSON.parse(ev.data));
      c.onopen = () => { if (this.dc && this.rel && this.dc.readyState === 'open' && this.rel.readyState === 'open') { this.mode = 'rtc'; this.on.mode && this.on.mode('rtc'); } };
    };
    pc.onicecandidate = e => { if (e.candidate) this.sig(from, 'ice', e.candidate.toJSON()); };
    await pc.setRemoteDescription(offer);
    for (const c of this.ice || []) pc.addIceCandidate(c).catch(() => {});
    this.ice = [];
    const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
    this.sig(from, 'answer', { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    setTimeout(() => { if (this.mode === 'pending') { this.mode = 'relay'; this.on.mode && this.on.mode('relay'); } }, RTC_TIMEOUT);
  }

  dropPeer(id) {
    const p = this.peers.get(id); if (!p) return;
    try { p.pc.close(); } catch (e) {}
    this.peers.delete(id);
    this.on.peerLeave && this.on.peerLeave(id);
  }

  onMsg(from, m) {
    if (this.isHost) { const p = this.peers.get(from); if (p) p.lastSeen = Date.now(); }
    else this.lastHost = Date.now();
    this.on.msg && this.on.msg(from, m);
  }

  // ---------- sending ----------
  // reliable = must arrive (lobby/start); unreliable = snapshots/inputs
  sendTo(id, m, reliable = false) {
    const p = this.peers.get(id); if (!p) return;
    if (p.mode === 'rtc') { const c = reliable ? p.rel : p.dc; if (c.readyState === 'open') { try { c.send(JSON.stringify(m)); } catch (e) {} } }
    else if (p.mode === 'relay' || reliable) this.relay(id, m);
  }
  peerMode(id) { const p = this.peers.get(id); return p ? p.mode : 'none'; }

  sendToHost(m, reliable = false) {
    if (!this.hostId) return;
    if (this.mode === 'rtc') { const c = reliable ? this.rel : this.dc; if (c && c.readyState === 'open') { try { c.send(JSON.stringify(m)); } catch (e) {} } }
    else if (this.mode === 'relay' || reliable) this.relay(this.hostId, m);
  }

  close() {
    this.closed = true;
    clearInterval(this.helloTimer); clearTimeout(this.findTimer); clearInterval(this.liveTimer);
    for (const p of this.peers.values()) try { p.pc.close(); } catch (e) {}
    if (this.pc) try { this.pc.close(); } catch (e) {}
    if (this.ch) { try { this.ch.untrack(); } catch (e) {} sb().removeChannel(this.ch); }
    this.ch = null;
  }
}

// ---------- shared levels ----------
export async function saveLevel({ name, author, data }) {
  const { data: row, error } = await (await sbReady()).from('tank_levels').insert({ name, author, data }).select('id').single();
  if (error) throw error;
  return row.id;
}
export async function loadLevel(id) {
  const { data, error } = await (await sbReady()).from('tank_levels').select('id,name,author,data').eq('id', id).single();
  if (error) throw error;
  return data;
}
export async function listLevels(limit = 40) {
  const { data, error } = await (await sbReady()).from('tank_levels').select('id,name,author,data,created_at').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}
