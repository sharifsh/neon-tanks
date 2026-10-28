// A small SMTP client for one job: send a plain-text email over SSL/TLS on port 465.
// It runs anywhere: the caller passes connect(host, port), which opens the TLS connection and returns
// { read(): Promise<Uint8Array|null>, write(bytes): Promise<void>, close(): void }.
// (The server function uses Deno.connectTls; the tests use Node's tls with a local mail server.)

const enc = new TextEncoder();
const dec = new TextDecoder();

export class SmtpError extends Error {
  constructor(message, code) { super(message); this.name = 'SmtpError'; this.code = code; }
}

// base64 of a UTF-8 string
export function b64(str) {
  const bytes = enc.encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const oneLine = s => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();
const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/;
export const isAddress = s => typeof s === 'string' && s.length <= 254 && ADDRESS.test(s);

// RFC 2047 encoded words (UTF-8, base64) for header text that isn't plain ASCII, split so no word gets too long
export function encodeHeaderText(text) {
  const s = oneLine(text);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words = [];
  let cur = '';
  for (const ch of s) {
    if (enc.encode(cur + ch).length > 42) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map(w => `=?UTF-8?B?${b64(w)}?=`).join('\r\n ');
}

function mailbox(name, address) {
  const n = oneLine(name);
  if (!n) return `<${address}>`;
  if (/^[\x20-\x7e]*$/.test(n)) return `"${n.replace(/["\\]/g, '\\$&')}" <${address}>`;
  return `${encodeHeaderText(n)} <${address}>`;
}

const wrap76 = s => s.replace(/.{1,76}/g, '$&\r\n');

// The full message: headers, then the text as base64 (so line lengths and leading dots never matter)
export function buildMessage({ from, fromName, to, replyTo, subject, text, date = new Date(), messageId }) {
  const headers = [
    `From: ${mailbox(fromName, from)}`,
    `To: <${to}>`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    `Subject: ${encodeHeaderText(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  const body = wrap76(b64(String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n')));
  return headers.join('\r\n') + '\r\n\r\n' + body;
}

function withTimeout(promise, ms, what, onTimeout) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => { onTimeout?.(); reject(new SmtpError(`The mail server didn't answer in time (${what})`)); }, ms); }),
  ]).finally(() => clearTimeout(t));
}

// Reads one SMTP reply (possibly several "250-..." lines ending in "250 ...")
function replyReader(conn) {
  let buf = '';
  async function line() {
    for (;;) {
      const i = buf.indexOf('\n');
      if (i >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); return l; }
      const chunk = await conn.read();
      if (chunk === null) throw new SmtpError('The mail server closed the connection');
      buf += dec.decode(chunk, { stream: true });
      if (buf.length > 65536) throw new SmtpError('The mail server sent an unexpected reply');
    }
  }
  return async function reply() {
    const lines = [];
    for (;;) {
      const l = await line();
      if (!/^\d{3}([ -]|$)/.test(l)) throw new SmtpError(`Unexpected reply from the mail server: ${l.slice(0, 120)}`);
      lines.push(l.slice(4));
      if (l.length === 3 || l[3] === ' ') return { code: Number(l.slice(0, 3)), lines };
    }
  };
}

/**
 * Sends one email. Throws SmtpError with a readable message when something goes wrong.
 * @param {object} o
 * @param {(host: string, port: number) => Promise<{read: () => Promise<Uint8Array|null>, write: (b: Uint8Array) => Promise<void>, close: () => void}>} o.connect
 */
export async function sendMail(o) {
  const { connect, host, port = 465, user, pass, from, fromName, to, replyTo, subject, text, heloName = 'localhost', timeoutMs = 15000 } = o;
  if (!host) throw new SmtpError('No mail server is set');
  if (!isAddress(from)) throw new SmtpError('The "from" address is not a valid email address');
  if (!isAddress(to)) throw new SmtpError('The "send to" address is not a valid email address');
  if (replyTo && !isAddress(replyTo)) throw new SmtpError('The reply-to address is not a valid email address');
  const messageId = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}@${heloName}`;
  const message = buildMessage({ from, fromName, to, replyTo, subject, text, messageId });

  let conn;
  try {
    conn = await withTimeout(Promise.resolve().then(() => connect(host, port)), timeoutMs, 'connecting');
  } catch (e) {
    if (e instanceof SmtpError) throw e;
    throw new SmtpError(`Couldn't connect to ${host}:${port} with SSL/TLS (${oneLine(e && e.message).slice(0, 160)})`);
  }
  const reply = replyReader(conn);
  const send = cmd => conn.write(enc.encode(cmd + '\r\n'));
  const expect = async (codes, what) => {
    const r = await withTimeout(reply(), timeoutMs, what, () => conn.close());
    if (!codes.includes(r.code)) throw new SmtpError(`${what} failed: ${r.code} ${oneLine(r.lines.join(' ')).slice(0, 240)}`, r.code);
    return r;
  };
  try {
    await expect([220], 'Greeting');
    await send(`EHLO ${heloName}`);
    const ehlo = await expect([250], 'Hello');
    if (user) {
      const authLine = ehlo.lines.find(l => /^AUTH[ =]/i.test(l)) || '';
      const mechs = authLine.slice(5).toUpperCase().split(/\s+/);
      if (mechs.includes('PLAIN')) {
        await send(`AUTH PLAIN ${b64(`\0${user}\0${pass ?? ''}`)}`);
        await expect([235], 'Sign-in');
      } else if (mechs.includes('LOGIN')) {
        await send('AUTH LOGIN'); await expect([334], 'Sign-in');
        await send(b64(user)); await expect([334], 'Sign-in');
        await send(b64(pass ?? '')); await expect([235], 'Sign-in');
      } else {
        throw new SmtpError("The mail server doesn't offer a sign-in method this app supports (PLAIN or LOGIN)");
      }
    }
    await send(`MAIL FROM:<${from}>`); await expect([250], 'Sender');
    await send(`RCPT TO:<${to}>`); await expect([250, 251], 'Recipient');
    await send('DATA'); await expect([354], 'Message');
    await conn.write(enc.encode(message + '.\r\n'));
    await expect([250], 'Message');
    try { await send('QUIT'); await withTimeout(reply(), 3000, 'goodbye'); } catch { /* the message is already accepted */ }
  } catch (e) {
    if (e instanceof SmtpError) throw e;
    throw new SmtpError(`Mail server error: ${oneLine(e && e.message).slice(0, 200)}`);
  } finally {
    conn.close();
  }
}
