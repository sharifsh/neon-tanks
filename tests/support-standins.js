// Stand-ins for the support form's server function: an in-memory database, a fake sign-in service
// and a scripted mail server. Used by the server tests and the page tests; nothing here touches the
// real database or sends real email.
import { createHandler } from '../supabase/functions/support/handler.js';

export const SMTP_USER = 'mailer@example.com';
export const SMTP_PASS = 'right-pass';
export const READY = { smtp_enabled: true, smtp_host: 'smtp.example.com', smtp_port: 465, smtp_security: 'ssl', smtp_user: SMTP_USER, smtp_from: 'support@tanksarenabattle.com', smtp_from_name: 'Neon Tanks Support', notify_to: 'inbox@example.com' };
export const USERS = {
  'admin-token': { id: 'a1', email: 'boss@example.com', app_metadata: { support_admin: true } },
  'player-token': { id: 'p1', email: 'someone@example.com', app_metadata: { provider: 'email' } },
};

export function memoryDb(start = Date.parse('2026-10-28T12:00:00Z')) {
  const rows = [], throttle = [], calls = [];
  let settings = null, password = null, n = 0, clock = start;
  const db = {
    insertRequest: async r => { const row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, created_at: new Date(clock).toISOString(), updated_at: new Date(clock).toISOString(), mail_error: null, ...r }; rows.push(row); return { ...row }; },
    updateRequest: async (id, patch) => { const r = rows.find(x => x.id === id); if (r) Object.assign(r, patch); },
    deleteRequest: async id => { const i = rows.findIndex(x => x.id === id); if (i >= 0) rows.splice(i, 1); },
    getRequest: async id => { const r = rows.find(x => x.id === id); return r ? { ...r } : null; },
    listRequests: async ({ status, before, limit }) => rows.filter(r => (!status || r.status === status) && (!before || r.created_at < before))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map(r => ({ ...r })),
    countByStatus: async () => ({ new: rows.filter(r => r.status === 'new').length, open: rows.filter(r => r.status === 'open').length, done: rows.filter(r => r.status === 'done').length }),
    getSettings: async () => (settings ? { ...settings } : null),
    saveSettings: async s => { settings = { id: 1, ...s }; return { ...settings }; },
    getPassword: async () => password,
    setPassword: async p => { calls.push('setPassword'); password = p; },
    throttleCount: async (key, since) => throttle.filter(t => t.key === key && t.at >= since).length,
    throttleAdd: async keys => { for (const key of keys) throttle.push({ key, at: new Date(clock).toISOString() }); },
    cleanup: async (requestsBefore, throttleBefore) => {
      calls.push(['cleanup', requestsBefore, throttleBefore]);
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].created_at < requestsBefore) rows.splice(i, 1);
      for (let i = throttle.length - 1; i >= 0; i--) if (throttle[i].at < throttleBefore) throttle.splice(i, 1);
    },
  };
  return {
    db, rows, throttle, calls,
    tick: ms => { clock += ms; },
    now: () => new Date(clock),
    setSettings: (s, p) => { settings = s; password = p; },
    get settings() { return settings; }, get password() { return password; },
  };
}

// A mail server conversation in memory: EHLO, AUTH, MAIL, RCPT, DATA, QUIT.
export function fakeSmtp({ failAuth = false } = {}) {
  const sent = [], ports = [];
  const enc = new TextEncoder(), dec = new TextDecoder();
  async function connect(host, port) {
    ports.push(port);
    const queue = [enc.encode('220 fake.test ESMTP\r\n')];
    let waiting = null, buf = '', data = false, msg = '';
    const push = s => { const b = enc.encode(s); if (waiting) { const w = waiting; waiting = null; w(b); } else queue.push(b); };
    return {
      read: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise(r => { waiting = r; })),
      write: async bytes => {
        buf += dec.decode(bytes);
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (data) { if (line === '.') { data = false; sent.push({ host, port, raw: msg }); msg = ''; push('250 queued\r\n'); } else msg += line + '\r\n'; continue; }
          const cmd = line.split(' ')[0].toUpperCase();
          if (cmd === 'EHLO') push('250-fake.test\r\n250 AUTH PLAIN LOGIN\r\n');
          else if (cmd === 'AUTH') push(failAuth ? '535 5.7.8 Username and Password not accepted\r\n' : '235 2.7.0 Accepted\r\n');
          else if (cmd === 'MAIL' || cmd === 'RCPT') push('250 OK\r\n');
          else if (cmd === 'DATA') { data = true; push('354 Go ahead\r\n'); }
          else if (cmd === 'QUIT') push('221 Bye\r\n');
          else push('502 Unknown command\r\n');
        }
      },
      close: () => {},
    };
  }
  return { connect, sent, ports, set failAuth(v) { failAuth = v; } };
}

// The real handler wired to stand-ins. allowOrigin: any origin in the list (tests run on neon.test / localhost).
export function backend({ connect, origins = [/^http:\/\/(neon\.test|localhost|127\.0\.0\.1)(:\d+)?$/, /^https:\/\/tanksarenabattle\.com$/, /^capacitor:\/\/localhost$/, /^https:\/\/localhost$/] } = {}) {
  const mem = memoryDb();
  const pending = [];
  const handle = createHandler({
    db: mem.db,
    auth: { getUser: async t => USERS[t] || null },
    connect,
    hash: async s => `h(${s})`,
    now: mem.now,
    waitUntil: p => pending.push(p),
    allowOrigin: o => origins.some(r => r.test(o)),
    adminUrl: 'https://tanksarenabattle.com/admin',
    heloName: 'tanksarenabattle.com',
  });
  return Object.assign(mem, { handle, flush: async () => { while (pending.length) await pending.shift(); } }); // keeps the live settings/password getters
}

// Routes the page's calls to the stand-ins: the support function, and Supabase sign-in for the admin page.
// Anything else aimed at the real backend is refused and recorded.
export async function routeBackend(page, be, { accounts = { 'boss@example.com': { password: 'admin-pass', token: 'admin-token' }, 'someone@example.com': { password: 'pw', token: 'player-token' } } } = {}) {
  const calls = [], stray = [];
  await page.route(/supabase\.co|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/functions/v1/support') {
      const headers = req.headers();
      let body;
      if (req.method() === 'POST') { body = req.postData(); try { calls.push(JSON.parse(body)); } catch { calls.push(body); } }
      const r = await be.handle(new Request(url.href, { method: req.method(), headers, body }));
      return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: r.status === 204 ? '' : await r.text() });
    }
    const cors = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = JSON.parse(req.postData() || '{}');
      const acct = accounts[email];
      if (!acct || acct.password !== password) return route.fulfill({ status: 400, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) });
      const user = { ...USERS[acct.token], aud: 'authenticated', role: 'authenticated', user_metadata: {}, identities: [], created_at: '2026-10-28T00:00:00Z' };
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ access_token: acct.token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-${acct.token}`, user }) });
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    stray.push(`${req.method()} ${url.pathname}`);
    return route.abort();
  });
  return { calls, stray };
}
