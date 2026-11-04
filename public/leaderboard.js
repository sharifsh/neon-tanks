// Leaderboards: the best solo Classic and Survival results, this week and of all time.
// Talks to the leaderboard server function. The player ID is random and made on this device the first time a result
// is posted; it keeps a player's results together and is never shown. Each result is kept on the device until the
// server has answered for it, so a game that ends offline (or as the app closes) is posted later.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const LB_FN = `${SUPABASE_URL}/functions/v1/leaderboard`;
export const LB_MODES = ['classic', 'survival'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

export const lbOn = () => ls.get('nt_lb', '1') !== '0';
export const setLbOn = on => ls.set('nt_lb', on ? '1' : '0');

// the player ID (kept for this session too, for browsers that don't keep site data)
let pidNow = null;
const newId = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
export function playerId(create) {
  const stored = ls.get('nt_pid', '');
  if (UUID.test(stored)) pidNow = stored;
  if (!pidNow && create) { pidNow = newId(); ls.set('nt_pid', pidNow); }
  return pidNow;
}
// the callsign to post under: always the current one, also for results kept from earlier
let nameNow = () => '';
export function useName(fn) { nameNow = fn; }
const source = () => { try { const p = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform(); return p === 'ios' || p === 'android' ? p : 'web'; } catch (e) { return 'web'; } };

// Returns { status, ok, ...json }. Network trouble comes back as { status: 0, ok: false }.
async function call(body) {
  try {
    const res = await fetch(LB_FN, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify(body) });
    let json = {};
    try { json = await res.json(); } catch (e) { /* not JSON */ }
    return { ...json, status: res.status, ok: res.ok && json.ok === true };
  } catch (e) {
    return { status: 0, ok: false };
  }
}
// Posting, sending kept results and removing results happen one at a time, in order.
let chain = Promise.resolve();
const inTurn = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

export const fetchBoard = ({ mode, difficulty, period }) => call({ action: 'top', mode, difficulty, period, pid: playerId(false) });

// ---------- results kept on the device until the server answers ----------
const PENDING = 'nt_lb_pending', KEEP = 20;
const better = (a, b) => a.level > b.level || (a.level === b.level && (a.score > b.score || (a.score === b.score && a.seconds < b.seconds)));
function pending() { try { const a = JSON.parse(ls.get(PENDING, '[]')); return Array.isArray(a) ? a.filter(p => p && p.id && p.run) : []; } catch (e) { return []; } }
function keep(list) {
  // too many waiting (a long time offline): drop the weakest results, not the oldest
  const sorted = [...list].sort((a, b) => (better(a.run, b.run) ? -1 : better(b.run, a.run) ? 1 : 0)).slice(0, KEEP);
  const ids = new Set(sorted.map(p => p.id));
  const out = list.filter(p => ids.has(p.id));
  if (out.length) ls.set(PENDING, JSON.stringify(out)); else ls.del(PENDING);
}
const add = item => keep([...pending(), item]);
const drop = id => keep(pending().filter(p => p.id !== id));
// a temporary problem: keep the result and try again later; 'name': kept until the callsign is changed
const later = r => r.status === 0 || r.status === 429 || r.status >= 500 || r.reason === 'name';

const answers = new Map(); // the server's last answer for each result sent in this session
async function send(item, pid) {
  const r = await call({ action: 'submit', pid, name: nameNow() || item.name, run: item.run, source: source(), ago: Math.max(0, (Date.now() - item.at) / 1000) });
  answers.set(item.id, r);
  if (!later(r)) drop(item.id);
  return r;
}

// Posts a finished game ({ mode, difficulty, level, score, kills, seconds, splits, cls, map, size }).
// Resolves to the server's answer ({ ok, weekly: { rank, improved, level } | null, allTime: {...} } or
// { ok: false, reason }); reason 'offline' means the result is kept and sent later.
export function postResult(name, run) {
  const item = { id: newId(), name, run, at: Date.now() };
  add(item); // before sending: if the app closes now, it still goes out next time
  return inTurn(async () => {
    if (!pending().some(p => p.id === item.id)) return answers.get(item.id) || { ok: false, status: 0, reason: 'gone' }; // already sent, or removed
    const r = await send(item, playerId(true));
    return !r.ok && later(r) && r.reason !== 'name' ? { ...r, reason: 'offline' } : r;
  });
}

// Sends the results kept on the device. Resolves to how many went out.
export function flushPending() {
  return inTurn(async () => {
    let sent = 0;
    const pid = playerId(false);
    if (!pid) return 0;
    for (const item of pending()) {
      if (Date.now() - item.at > 30 * 86400e3) { drop(item.id); continue; } // too old to matter
      const r = await send(item, pid);
      if (r.ok) sent++;
      else if (later(r)) break; // offline, busy, or the callsign is refused: try again later
    }
    return sent;
  });
}
export const hasPending = () => pending().length > 0;

// Removes every result this device has posted (after anything being sent right now), and starts a new player ID
// next time.
export function forgetMe() {
  return inTurn(async () => {
    ls.del(PENDING);
    const pid = playerId(false);
    if (!pid) return { ok: true, removed: 0 };
    const r = await call({ action: 'forget', pid });
    if (r.ok) { ls.del('nt_pid'); pidNow = null; }
    return r;
  });
}
