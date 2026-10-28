import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { SMTPServer } from 'smtp-server';
import { createHandler, LIMITS } from '../supabase/functions/support/handler.js';
import { sendMail, buildMessage, encodeHeaderText } from '../supabase/functions/support/smtp.js';
import { memoryDb, USERS, READY as READY_BASE, SMTP_USER, SMTP_PASS } from './support-standins.js';

// The support form's server function, run in Node with stand-ins: an in-memory database, a fake
// sign-in service and a local mail server speaking SSL/TLS from the first byte (like port 465).
// Nothing here touches the real database or sends real email.

test.describe.configure({ mode: 'serial' });

let dir, key, cert, smtp, smtpPort;
const inbox = [];

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nt-smtp-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  key = readFileSync(join(dir, 'key.pem')); cert = readFileSync(join(dir, 'cert.pem'));
  smtp = new SMTPServer({
    secure: true, key, cert, logger: false, authMethods: ['PLAIN', 'LOGIN'],
    onAuth(auth, session, cb) { return auth.username === SMTP_USER && auth.password === SMTP_PASS ? cb(null, { user: auth.username }) : cb(new Error('Invalid username or password')); },
    onData(stream, session, cb) {
      const parts = [];
      stream.on('data', d => parts.push(d));
      stream.on('end', () => { inbox.push({ from: session.envelope.mailFrom.address, to: session.envelope.rcptTo.map(r => r.address), user: session.user, raw: Buffer.concat(parts).toString() }); cb(); });
    },
  });
  smtp.on('error', () => {}); // a client hanging up mid-handshake must not stop the test server
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  smtpPort = smtp.server.address().port;
});
test.afterAll(async () => { await new Promise(r => smtp.close(r)); rmSync(dir, { recursive: true, force: true }); });

// TLS from the first byte, trusting only the test certificate. The function always asks for port 465;
// here that is redirected to the local test server.
const ports = [];
function connect(host, port) {
  ports.push(port);
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port: smtpPort, ca: cert, servername: 'localhost' }, () => {
      const chunks = []; let waiting = null, ended = false, failed = null;
      const settle = v => { if (waiting) { const w = waiting; waiting = null; v instanceof Error ? w.reject(v) : w.resolve(v); } };
      sock.on('data', d => { if (waiting) settle(new Uint8Array(d)); else chunks.push(new Uint8Array(d)); });
      sock.on('end', () => { ended = true; settle(null); });
      sock.on('close', () => { ended = true; settle(null); });
      sock.on('error', e => { failed = e; settle(e); });
      resolve({
        read: () => chunks.length ? Promise.resolve(chunks.shift()) : failed ? Promise.reject(failed) : ended ? Promise.resolve(null) : new Promise((res, rej) => { waiting = { resolve: res, reject: rej }; }),
        write: b => new Promise((res, rej) => sock.write(Buffer.from(b), e => (e ? rej(e) : res()))),
        close: () => sock.destroy(),
      });
    });
    sock.once('error', reject);
  });
}

// ---------- stand-ins (in-memory database, fake sign-in) with the real TLS mail server above ----------
function standIns() {
  const mem = memoryDb();
  const pending = [];
  const handle = createHandler({
    db: mem.db, auth: { getUser: async t => USERS[t] || null }, connect,
    hash: async s => `h(${s})`,
    now: mem.now,
    waitUntil: p => pending.push(p),
    allowOrigin: o => /^(https:\/\/tanksarenabattle\.com|capacitor:\/\/localhost|https:\/\/localhost)$/.test(o),
    adminUrl: 'https://tanksarenabattle.com/admin',
    heloName: 'tanksarenabattle.com',
  });
  return Object.assign(mem, { handle, flush: async () => { while (pending.length) await pending.shift(); } });
}

const READY = { ...READY_BASE, smtp_host: '127.0.0.1' };
const FORM = { action: 'submit', topic: 'bug', email: 'player@example.com', message: 'The tank gets stuck on the bridge in River Crossing.', source: 'ios', website: '', elapsed: 9000, device: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)', lang: 'en-US', screen: '390x844@3', tz: 'America/New_York', page: 'support', extra: 'dropped' } };

async function call(s, body, { token, ip = '203.0.113.7', origin = 'https://tanksarenabattle.com', method = 'POST' } = {}) {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip, origin };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await s.handle(new Request('https://fn.test/functions/v1/support', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined }));
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) : null };
}
const decodeBody = raw => Buffer.from(raw.split(/\r?\n\r?\n/).slice(1).join('').replace(/\s+/g, ''), 'base64').toString('utf8');

test('a form message is saved and emailed over SSL/TLS on port 465, with the player as Reply-To', async () => {
  const s = standIns();
  s.setSettings(READY, SMTP_PASS);
  inbox.length = 0; ports.length = 0;
  const r = await call(s, FORM);
  expect(r.status).toBe(200); expect(r.json).toEqual({ ok: true });
  expect(r.headers.get('access-control-allow-origin')).toBe('https://tanksarenabattle.com');
  expect(s.rows).toHaveLength(1);
  expect(s.rows[0]).toMatchObject({ email: 'player@example.com', topic: 'bug', source: 'ios', status: 'new', message: FORM.message });
  expect(s.rows[0].device).toEqual({ ua: FORM.device.ua, lang: 'en-US', screen: '390x844@3', tz: 'America/New_York', page: 'support' }); // only known keys
  await s.flush();
  expect(s.rows[0].mail_status).toBe('sent');
  expect(ports).toEqual([465]);
  expect(inbox).toHaveLength(1);
  const m = inbox[0];
  expect(m.from).toBe('support@tanksarenabattle.com'); expect(m.to).toEqual(['inbox@example.com']); expect(m.user).toBe(SMTP_USER);
  expect(m.raw).toContain('From: "Neon Tanks Support" <support@tanksarenabattle.com>');
  expect(m.raw).toContain('Reply-To: <player@example.com>');
  expect(m.raw).toContain('Subject: Neon Tanks support: Bug or crash from player@example.com');
  const text = decodeBody(m.raw);
  expect(text).toContain(FORM.message);
  expect(text).toContain('Sent from: iPhone/iPad app');
  expect(text).toContain(`Admin page: https://tanksarenabattle.com/admin#${s.rows[0].id}`);
  // the throttle only ever sees a one-way hash of the network address
  expect(s.throttle.map(t => t.key)).toEqual(['submit:h(203.0.113.7)', 'submit:all']);
  expect(JSON.stringify(s.throttle)).not.toMatch(/203\.0\.113\.7(?!\))/);
});

test('form checks: missing or bad fields are explained; bots get a polite yes and nothing is kept', async () => {
  const s = standIns();
  let r = await call(s, { ...FORM, email: 'not-an-email', topic: 'nope', message: 'hi' });
  expect(r.status).toBe(400);
  expect(Object.keys(r.json.fields).sort()).toEqual(['email', 'message', 'topic']);
  r = await call(s, { ...FORM, email: 'player@example.com\r\nBcc: victim@example.com' });
  expect(r.status).toBe(400); expect(r.json.fields.email).toBeTruthy(); // no header injection
  r = await call(s, { ...FORM, message: 'x'.repeat(4001) });
  expect(r.status).toBe(400);
  r = await call(s, { ...FORM, website: 'http://spam.example' }); // the hidden field
  expect(r.json).toEqual({ ok: true });
  r = await call(s, { ...FORM, elapsed: 800 }); // sent instantly
  expect(r.json).toEqual({ ok: true });
  expect(s.rows).toHaveLength(0);
  r = await s.handle(new Request('https://fn.test/x', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello' }));
  expect(r.status).toBe(415);
  r = await s.handle(new Request('https://fn.test/x', { method: 'GET' }));
  expect(r.status).toBe(405);
});

test('spam limits: five messages an hour per network, then a friendly 429; other networks still get through', async () => {
  const s = standIns();
  for (let i = 0; i < LIMITS.perHour; i++) expect((await call(s, FORM)).status).toBe(200);
  const r = await call(s, FORM);
  expect(r.status).toBe(429); expect(r.json.error).toMatch(/try again later/i);
  expect((await call(s, FORM, { ip: '198.51.100.20' })).status).toBe(200);
  s.tick(3601e3);
  expect((await call(s, FORM)).status).toBe(200); // an hour later
  expect(s.rows).toHaveLength(LIMITS.perHour + 2);
});

test('a mail server problem never reaches the player: the message is kept and marked failed with the reason', async () => {
  const s = standIns();
  s.setSettings(READY, 'wrong-pass');
  inbox.length = 0;
  const r = await call(s, FORM);
  expect(r.status).toBe(200); expect(r.json).toEqual({ ok: true });
  await s.flush();
  expect(s.rows[0].mail_status).toBe('failed');
  expect(s.rows[0].mail_error).toMatch(/Sign-in failed: 535/);
  expect(inbox).toHaveLength(0);
  // email off: messages are just kept
  const s2 = standIns();
  s2.setSettings({ ...READY, smtp_enabled: false }, SMTP_PASS);
  await call(s2, FORM); await s2.flush();
  expect(s2.rows[0].mail_status).toBe('off');
});

test('admin actions need a signed-in admin account', async () => {
  const s = standIns();
  expect((await call(s, { action: 'list' })).status).toBe(401);
  expect((await call(s, { action: 'list' }, { token: 'made-up' })).status).toBe(401);
  const r = await call(s, { action: 'list' }, { token: 'player-token' });
  expect(r.status).toBe(403); expect(r.json.error).toMatch(/access/);
  expect((await call(s, { action: 'whoami' }, { token: 'admin-token' })).json).toEqual({ ok: true, email: 'boss@example.com' });
  expect((await call(s, { action: 'nope' }, { token: 'admin-token' })).status).toBe(400);
});

test('admin inbox: list newest first with counts, change status, resend a failed email, delete', async () => {
  const s = standIns();
  await call(s, FORM); s.tick(60e3);
  await call(s, { ...FORM, topic: 'purchase', email: 'buyer@example.com', message: 'Restore purchases did not unlock Survival.' });
  let r = await call(s, { action: 'list', status: 'all' }, { token: 'admin-token' });
  expect(r.json.rows.map(x => x.email)).toEqual(['buyer@example.com', 'player@example.com']);
  expect(r.json.counts).toEqual({ new: 2, open: 0, done: 0 });
  const [first, second] = r.json.rows;
  expect((await call(s, { action: 'set_status', id: first.id, status: 'done' }, { token: 'admin-token' })).json.ok).toBe(true);
  expect((await call(s, { action: 'set_status', id: first.id, status: 'archived' }, { token: 'admin-token' })).status).toBe(400);
  r = await call(s, { action: 'list', status: 'new' }, { token: 'admin-token' });
  expect(r.json.rows.map(x => x.id)).toEqual([second.id]);
  expect(r.json.counts).toEqual({ new: 1, open: 0, done: 1 });
  // resend: email off → explained; on → sent
  expect((await call(s, { action: 'resend', id: second.id }, { token: 'admin-token' })).status).toBe(409);
  s.setSettings(READY, SMTP_PASS); inbox.length = 0;
  r = await call(s, { action: 'resend', id: second.id }, { token: 'admin-token' });
  expect(r.json).toMatchObject({ ok: true, mail_status: 'sent' });
  expect(inbox).toHaveLength(1);
  expect((await call(s, { action: 'delete', id: first.id }, { token: 'admin-token' })).json.ok).toBe(true);
  expect(s.rows.map(x => x.id)).toEqual([second.id]);
  expect((await call(s, { action: 'delete', id: "1' or 1=1" }, { token: 'admin-token' })).status).toBe(400);
});

test('email settings: the password is write-only, the port is always 465, and the test email reports what happened', async () => {
  const s = standIns();
  let r = await call(s, { action: 'get_settings' }, { token: 'admin-token' });
  expect(r.json).toMatchObject({ ok: true, has_password: false, settings: { smtp_enabled: false, smtp_port: 465 } });
  // turning email on without the details is explained field by field
  r = await call(s, { action: 'save_settings', smtp_enabled: true }, { token: 'admin-token' });
  expect(r.status).toBe(400);
  expect(Object.keys(r.json.fields).sort()).toEqual(['notify_to', 'smtp_from', 'smtp_host', 'smtp_password', 'smtp_user']);
  r = await call(s, { action: 'save_settings', smtp_enabled: true, smtp_host: 'not a host!', smtp_user: 'u', smtp_from: 'bad', notify_to: 'x@y', smtp_password: 'p' }, { token: 'admin-token' });
  expect(Object.keys(r.json.fields).sort()).toEqual(['notify_to', 'smtp_from', 'smtp_host']);
  expect(s.password).toBe(null); // nothing saved when anything is wrong
  r = await call(s, { action: 'save_settings', ...READY, smtp_port: 587, smtp_security: 'starttls', smtp_password: 'super-secret-value' }, { token: 'admin-token' });
  expect(r.status).toBe(200);
  expect(r.text).not.toContain('super-secret-value');
  expect(r.json).toMatchObject({ has_password: true, settings: { smtp_enabled: true, smtp_host: '127.0.0.1', smtp_port: 465, notify_to: 'inbox@example.com' } });
  expect(s.settings).toMatchObject({ smtp_port: 465, smtp_security: 'ssl' });
  expect(s.password).toBe('super-secret-value');
  r = await call(s, { action: 'get_settings' }, { token: 'admin-token' });
  expect(r.text).not.toContain('super-secret-value'); expect(r.json.has_password).toBe(true);
  // saving again without a password keeps the saved one
  r = await call(s, { action: 'save_settings', ...READY, smtp_from_name: 'Neon Tanks' }, { token: 'admin-token' });
  expect(r.status).toBe(200); expect(s.password).toBe('super-secret-value'); expect(s.calls.filter(c => c === 'setPassword')).toHaveLength(1);
  // test email: wrong password → the server's answer; right password → it arrives
  inbox.length = 0;
  r = await call(s, { action: 'test_email' }, { token: 'admin-token' });
  expect(r.status).toBe(502); expect(r.json.error).toMatch(/Sign-in failed: 535/);
  await call(s, { action: 'save_settings', ...READY, smtp_password: SMTP_PASS }, { token: 'admin-token' });
  r = await call(s, { action: 'test_email' }, { token: 'admin-token' });
  expect(r.json).toEqual({ ok: true });
  expect(inbox).toHaveLength(1);
  expect(inbox[0].raw).toContain('Subject: Neon Tanks support: test email');
  expect(decodeBody(inbox[0].raw)).toContain('reach inbox@example.com');
});

test('cross-site calls: only the website and the apps get CORS headers', async () => {
  const s = standIns();
  for (const origin of ['https://tanksarenabattle.com', 'capacitor://localhost', 'https://localhost']) {
    const r = await call(s, null, { method: 'OPTIONS', origin });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe(origin);
    expect(r.headers.get('access-control-allow-headers')).toContain('authorization');
  }
  const r = await call(s, null, { method: 'OPTIONS', origin: 'https://evil.example' });
  expect(r.headers.get('access-control-allow-origin')).toBe(null);
});

test('old messages are removed after 12 months, and throttle notes after a day', async () => {
  const s = standIns();
  await call(s, FORM);
  s.tick(366 * 86400e3);
  await call(s, { ...FORM, email: 'later@example.com' });
  await s.flush();
  expect(s.rows.map(r => r.email)).toEqual(['later@example.com']);
  expect(s.throttle.every(t => t.at > '2027-10-28')).toBe(true);
});

test('mail format: non-English names and subjects are encoded, long text is wrapped, bad addresses are refused', async () => {
  const raw = buildMessage({ from: 'a@example.com', fromName: 'Поддержка Neon Tanks', to: 'b@example.com', replyTo: 'c@example.com', subject: 'Ошибка: танк застрял на мосту и не может ехать дальше', text: '.leading dot\nline two\n' + 'x'.repeat(300), messageId: 'id@test' });
  const [head, body] = raw.split('\r\n\r\n');
  expect(head).toMatch(/^From: =\?UTF-8\?B\?/m);
  expect(head).toMatch(/^Subject: =\?UTF-8\?B\?.+\?=\r\n =\?UTF-8\?B\?/m); // folded encoded words
  expect(body.split('\r\n').every(l => l.length <= 76)).toBe(true);
  expect(Buffer.from(body.replace(/\s+/g, ''), 'base64').toString()).toBe('.leading dot\r\nline two\r\n' + 'x'.repeat(300));
  expect(encodeHeaderText('Plain ASCII subject')).toBe('Plain ASCII subject');
  await expect(sendMail({ connect, host: '127.0.0.1', from: 'not valid', to: 'b@example.com', subject: 's', text: 't' })).rejects.toThrow(/from/);
  await expect(sendMail({ connect, host: '127.0.0.1', from: 'a@example.com', to: 'b@example.com\r\nRCPT TO:<x@y.z>', subject: 's', text: 't' })).rejects.toThrow(/send to/);
});
