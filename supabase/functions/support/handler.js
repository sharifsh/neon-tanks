// Server side of the Neon Tanks support form and the admin page. Runs as a Supabase Edge Function
// (index.ts wires it to the database, Supabase Auth and the mail server); the tests wire it to stand-ins.
//
// One endpoint, POST JSON { action, ... }:
//   submit                         public: the support form
//   whoami, list, get, set_status, admin only (Supabase Auth account whose app_metadata.support_admin is true)
//   delete, resend, get_settings,
//   save_settings, test_email
import { sendMail, isAddress } from './smtp.js';

export const TOPICS = { purchase: 'Purchase or restore', bug: 'Bug or crash', online: 'Online play', idea: 'Idea or feedback', other: 'Something else' };
export const SOURCES = { web: 'Website', ios: 'iPhone/iPad app', android: 'Android app' };
export const STATUSES = ['new', 'open', 'done'];
export const LIMITS = { perHour: 5, perDay: 20, allPerHour: 60, minFillMs: 2500, keepDays: 365 };
export const SMTP_PORT = 465;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DEVICE_KEYS = { ua: 400, lang: 40, screen: 40, tz: 60, page: 60 };

const str = v => (typeof v === 'string' ? v : '');
const oneLine = v => str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

export function createHandler(deps) {
  const {
    db, auth, connect, hash,
    now = () => new Date(),
    waitUntil = p => { p.catch(() => {}); },
    allowOrigin = () => false,
    adminUrl = '',
    heloName = 'localhost',
    log = () => {},
  } = deps;

  const corsFor = origin => (origin && allowOrigin(origin) ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-max-age': '86400',
    vary: 'Origin',
  } : { vary: 'Origin' });

  const reply = (status, body, cors) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
  });

  function clientIp(req) {
    const h = req.headers;
    return h.get('cf-connecting-ip') || h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  }

  // ---------- email ----------
  function requestText(row) {
    const d = row.device || {};
    return [
      'New message from the Neon Tanks support form.',
      '',
      `Topic: ${TOPICS[row.topic] || row.topic}`,
      `From: ${row.email} (reply to this email to answer)`,
      `Sent from: ${SOURCES[row.source] || row.source}`,
      `When: ${new Date(row.created_at || now()).toUTCString()}`,
      '',
      'Message:',
      '----------------------------------------',
      row.message,
      '----------------------------------------',
      '',
      d.ua ? `Device: ${d.ua}` : null,
      [d.lang && `Language: ${d.lang}`, d.screen && `Screen: ${d.screen}`, d.tz && `Time zone: ${d.tz}`].filter(Boolean).join(' · ') || null,
      adminUrl ? `Admin page: ${adminUrl}#${row.id}` : null,
    ].filter(l => l !== null).join('\n');
  }

  async function mailWith(settings, mail) {
    const pass = await db.getPassword();
    if (!pass) throw new Error('No SMTP password is saved');
    await sendMail({
      connect, host: settings.smtp_host, port: SMTP_PORT, user: settings.smtp_user, pass,
      from: settings.smtp_from, fromName: settings.smtp_from_name || 'Neon Tanks Support', to: settings.notify_to,
      heloName, ...mail,
    });
  }

  async function notify(row, settings) {
    try {
      await mailWith(settings, {
        replyTo: row.email,
        subject: `Neon Tanks support: ${TOPICS[row.topic] || 'Message'} from ${row.email}`,
        text: requestText(row),
      });
      await db.updateRequest(row.id, { mail_status: 'sent', mail_error: null });
      return { mail_status: 'sent', mail_error: null };
    } catch (e) {
      const mail_error = oneLine(e && e.message).slice(0, 500) || 'Unknown error';
      log('support email failed:', mail_error);
      await db.updateRequest(row.id, { mail_status: 'failed', mail_error }).catch(() => {});
      return { mail_status: 'failed', mail_error };
    }
  }

  const settingsReady = s => !!(s && s.smtp_enabled && s.smtp_host && s.smtp_from && s.notify_to);
  const publicSettings = (s, hasPassword) => ({
    settings: {
      smtp_enabled: !!(s && s.smtp_enabled), smtp_host: (s && s.smtp_host) || '', smtp_port: SMTP_PORT,
      smtp_user: (s && s.smtp_user) || '', smtp_from: (s && s.smtp_from) || '', smtp_from_name: (s && s.smtp_from_name) || '',
      notify_to: (s && s.notify_to) || '', updated_at: (s && s.updated_at) || null,
    },
    has_password: hasPassword,
  });

  // ---------- public: the support form ----------
  async function submit(body, req, cors) {
    const email = oneLine(body.email);
    const topic = str(body.topic);
    const message = str(body.message).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    const source = SOURCES[body.source] ? body.source : 'web';
    const fields = {};
    if (!isAddress(email)) fields.email = 'Please enter your email address so we can reply.';
    if (!TOPICS[topic]) fields.topic = 'Please choose what your message is about.';
    if (message.replace(/\s/g, '').length < 10) fields.message = 'Please tell us a bit more (at least 10 characters).';
    else if (message.length > 4000) fields.message = 'Please keep your message under 4,000 characters.';
    if (Object.keys(fields).length) return reply(400, { ok: false, error: 'Please check the highlighted fields.', fields }, cors);

    // Bots fill in the hidden field or send the form instantly: answer as if it worked, keep nothing.
    if (str(body.website) || !(Number(body.elapsed) >= LIMITS.minFillMs)) return reply(200, { ok: true }, cors);

    const t = now().getTime();
    const hourAgo = new Date(t - 3600e3).toISOString(), dayAgo = new Date(t - 86400e3).toISOString();
    const who = 'submit:' + await hash(clientIp(req));
    const [perHour, perDay, all] = await Promise.all([
      db.throttleCount(who, hourAgo), db.throttleCount(who, dayAgo), db.throttleCount('submit:all', hourAgo),
    ]);
    if (perHour >= LIMITS.perHour || perDay >= LIMITS.perDay || all >= LIMITS.allPerHour) {
      return reply(429, { ok: false, error: 'Too many messages in a short time. Please try again later.' }, cors);
    }
    await db.throttleAdd([who, 'submit:all']);

    const device = {};
    if (body.device && typeof body.device === 'object') {
      for (const [k, max] of Object.entries(DEVICE_KEYS)) { const v = oneLine(body.device[k]); if (v) device[k] = v.slice(0, max); }
    }
    const row = await db.insertRequest({ email, topic, message, device, source, status: 'new', mail_status: 'off' });
    const settings = await db.getSettings();
    if (settingsReady(settings)) waitUntil(notify(row, settings));
    waitUntil(db.cleanup(new Date(t - LIMITS.keepDays * 86400e3).toISOString(), dayAgo).catch(e => log('support cleanup failed:', e && e.message)));
    return reply(200, { ok: true }, cors);
  }

  // ---------- admin ----------
  async function admin(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || '');
    if (!m) return { status: 401, error: 'Please sign in.' };
    const user = await auth.getUser(m[1]);
    if (!user) return { status: 401, error: 'Your sign-in has expired. Please sign in again.' };
    if (!user.app_metadata || user.app_metadata.support_admin !== true) return { status: 403, error: "This account doesn't have access to the support inbox." };
    return { user };
  }

  async function adminAction(action, body, user, cors) {
    switch (action) {
      case 'whoami':
        return reply(200, { ok: true, email: user.email || '' }, cors);

      case 'list': {
        const status = STATUSES.includes(body.status) ? body.status : null;
        const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
        const before = typeof body.before === 'string' && !Number.isNaN(Date.parse(body.before)) ? new Date(body.before).toISOString() : null;
        const [rows, counts] = await Promise.all([db.listRequests({ status, before, limit }), db.countByStatus()]);
        return reply(200, { ok: true, rows, counts, more: rows.length === limit }, cors);
      }

      case 'get': {
        if (!UUID.test(str(body.id))) return reply(400, { ok: false, error: 'Unknown message.' }, cors);
        const row = await db.getRequest(body.id);
        return row ? reply(200, { ok: true, row }, cors) : reply(404, { ok: false, error: 'That message no longer exists.' }, cors);
      }

      case 'set_status': {
        if (!UUID.test(str(body.id)) || !STATUSES.includes(body.status)) return reply(400, { ok: false, error: 'Unknown message or status.' }, cors);
        await db.updateRequest(body.id, { status: body.status });
        return reply(200, { ok: true }, cors);
      }

      case 'delete': {
        if (!UUID.test(str(body.id))) return reply(400, { ok: false, error: 'Unknown message.' }, cors);
        await db.deleteRequest(body.id);
        return reply(200, { ok: true }, cors);
      }

      case 'resend': {
        if (!UUID.test(str(body.id))) return reply(400, { ok: false, error: 'Unknown message.' }, cors);
        const row = await db.getRequest(body.id);
        if (!row) return reply(404, { ok: false, error: 'That message no longer exists.' }, cors);
        const settings = await db.getSettings();
        if (!settingsReady(settings)) return reply(409, { ok: false, error: 'Turn on email in Email settings first.' }, cors);
        return reply(200, { ok: true, ...(await notify(row, settings)) }, cors);
      }

      case 'get_settings': {
        const [s, pass] = await Promise.all([db.getSettings(), db.getPassword()]);
        return reply(200, { ok: true, ...publicSettings(s, !!pass) }, cors);
      }

      case 'save_settings': {
        const v = {
          smtp_enabled: body.smtp_enabled === true,
          smtp_host: oneLine(body.smtp_host).toLowerCase(),
          smtp_user: oneLine(body.smtp_user),
          smtp_from: oneLine(body.smtp_from),
          smtp_from_name: oneLine(body.smtp_from_name),
          notify_to: oneLine(body.notify_to),
        };
        const password = str(body.smtp_password);
        const fields = {};
        if (v.smtp_host && !HOST.test(v.smtp_host)) fields.smtp_host = 'Enter the mail server name, for example smtp.gmail.com.';
        if (v.smtp_user.length > 255) fields.smtp_user = 'That username is too long.';
        if (v.smtp_from && !isAddress(v.smtp_from)) fields.smtp_from = 'Enter a valid email address.';
        if (v.smtp_from_name.length > 100) fields.smtp_from_name = 'Keep the name under 100 characters.';
        if (v.notify_to && !isAddress(v.notify_to)) fields.notify_to = 'Enter a valid email address.';
        if (password.length > 500) fields.smtp_password = 'That password is too long.';
        const hadPassword = !!(await db.getPassword());
        if (v.smtp_enabled) {
          if (!v.smtp_host) fields.smtp_host = fields.smtp_host || 'Needed to send email.';
          if (!v.smtp_user) fields.smtp_user = fields.smtp_user || 'Needed to send email.';
          if (!v.smtp_from) fields.smtp_from = fields.smtp_from || 'Needed to send email.';
          if (!v.notify_to) fields.notify_to = fields.notify_to || 'Needed to send email.';
          if (!password && !hadPassword) fields.smtp_password = 'Needed to send email.';
        }
        if (Object.keys(fields).length) return reply(400, { ok: false, error: 'Please check the highlighted fields.', fields }, cors);
        if (password) await db.setPassword(password);
        const saved = await db.saveSettings({ ...v, smtp_port: SMTP_PORT, smtp_security: 'ssl', updated_at: now().toISOString() });
        return reply(200, { ok: true, ...publicSettings(saved, hadPassword || !!password) }, cors);
      }

      case 'test_email': {
        const s = await db.getSettings();
        if (!s || !s.smtp_host || !s.smtp_from || !s.notify_to) return reply(409, { ok: false, error: 'Save the mail server, from and send-to addresses first.' }, cors);
        try {
          await mailWith(s, {
            subject: 'Neon Tanks support: test email',
            text: `This is a test from the Neon Tanks support inbox.\n\nIf you can read this, messages from the support form will reach ${s.notify_to}.\n\nSent through ${s.smtp_host}:${SMTP_PORT} (SSL/TLS) at ${now().toUTCString()}.`,
          });
          return reply(200, { ok: true }, cors);
        } catch (e) {
          return reply(502, { ok: false, error: oneLine(e && e.message).slice(0, 500) || 'Sending failed.' }, cors);
        }
      }

      default:
        return reply(400, { ok: false, error: 'Unknown action.' }, cors);
    }
  }

  return async function handle(req) {
    const cors = corsFor(req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, { ok: false, error: 'Use POST.' }, cors);
    if (!(req.headers.get('content-type') || '').toLowerCase().includes('application/json')) return reply(415, { ok: false, error: 'Send JSON.' }, cors);
    let body;
    try {
      const raw = await req.text();
      if (raw.length > 20000) return reply(413, { ok: false, error: 'That message is too long.' }, cors);
      body = JSON.parse(raw);
    } catch {
      return reply(400, { ok: false, error: 'Bad request.' }, cors);
    }
    if (!body || typeof body !== 'object') return reply(400, { ok: false, error: 'Bad request.' }, cors);
    try {
      if (body.action === 'submit') return await submit(body, req, cors);
      const a = await admin(req);
      if (a.error) return reply(a.status, { ok: false, error: a.error }, cors);
      return await adminAction(body.action, body, a.user, cors);
    } catch (e) {
      log('support function error:', e && (e.stack || e.message));
      return reply(500, { ok: false, error: 'Something went wrong on our side. Please try again.' }, cors);
    }
  };
}
