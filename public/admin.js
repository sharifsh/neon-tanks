// Support inbox: sign in (Supabase Auth, email + password), read and sort form messages,
// and set up where new messages are emailed (SMTP on port 465). Everything goes through the
// support server function, which checks that the signed-in account is an admin.
import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { callSupport } from './support-api.js';

const $ = id => document.getElementById(id);
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'nt-support-admin' },
});
const TOPICS = { purchase: 'Purchase or restore', bug: 'Bug or crash', online: 'Online play', idea: 'Idea or feedback', other: 'Something else' };
const SOURCES = { web: 'Website', ios: 'iPhone/iPad app', android: 'Android app' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const state = { filter: 'new', rows: [], counts: { new: 0, open: 0, done: 0 }, more: false, current: null, settings: null, hasPassword: false, dirty: false, loadedAt: 0 };

// ---------- screens ----------
function show(screen) {
  for (const s of ['loading', 'signin', 'denied', 'app']) $(s).hidden = s !== screen;
  $('who').hidden = screen !== 'app';
}
function say(id, text, bad) { const el = $(id); el.textContent = text || ''; el.classList.toggle('bad', !!bad); }

function toSignIn(message) {
  show('signin');
  say('siStatus', message || '', !!message);
  setTimeout(() => ($('siEmail').value ? $('siPass') : $('siEmail')).focus(), 0);
}

// ---------- server calls ----------
async function token() {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.access_token : null;
}
async function api(action, body = {}) {
  const t = await token();
  if (!t) { toSignIn('Please sign in.'); return { ok: false, status: 401 }; }
  const r = await callSupport({ action, ...body }, t);
  if (r.status === 401) { await sb.auth.signOut().catch(() => {}); toSignIn('Your sign-in has expired. Please sign in again.'); }
  return r;
}
const why = r => (r.status === 0 ? 'no connection to the server' : r.error || `error ${r.status}`);

// ---------- sign in / out ----------
$('signinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('siEmail').value.trim(), password = $('siPass').value;
  if (!email || !password) { say('siStatus', 'Enter your email and password.', true); return; }
  const btn = $('siBtn');
  btn.disabled = true; btn.textContent = 'Signing in…'; say('siStatus', '');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Sign in';
  $('siPass').value = '';
  if (error) {
    const msg = error.status === 429 ? 'Too many tries. Wait a minute, then try again.'
      : /invalid login|invalid credentials/i.test(error.message || '') ? 'Wrong email or password.'
      : `Couldn't sign in: ${error.message || 'no connection'}`;
    say('siStatus', msg, true); $('siPass').focus();
    return;
  }
  await enter();
});

async function signOut() {
  await sb.auth.signOut().catch(() => {});
  Object.assign(state, { rows: [], current: null, settings: null });
  $('list').replaceChildren(); $('detail').hidden = true;
  history.replaceState(null, '', location.pathname);
  toSignIn('Signed out.');
  $('siStatus').classList.remove('bad');
}
$('signOut').addEventListener('click', signOut);
$('deniedOut').addEventListener('click', signOut);

async function enter() {
  show('loading');
  const r = await api('whoami');
  if (r.status === 401) return;
  if (r.status === 403) {
    const { data } = await sb.auth.getSession();
    $('deniedEmail').textContent = (data.session && data.session.user && data.session.user.email) || 'this account';
    show('denied');
    return;
  }
  if (!r.ok) { toSignIn(`Couldn't reach the support inbox (${why(r)}). Try again in a moment.`); return; }
  $('whoEmail').textContent = r.email;
  show('app');
  await Promise.all([loadList(), loadSettings()]);
  await openFromHash();
}

// ---------- tabs ----------
function tab(which) {
  const inbox = which !== 'settings';
  $('tabInbox').setAttribute('aria-selected', String(inbox));
  $('tabSettings').setAttribute('aria-selected', String(!inbox));
  $('inbox').hidden = !inbox; $('settings').hidden = inbox;
}
$('tabInbox').addEventListener('click', () => tab('inbox'));
$('tabSettings').addEventListener('click', () => tab('settings'));
$('toSettings').addEventListener('click', e => { e.preventDefault(); tab('settings'); $('smEnabled').focus(); });

// ---------- inbox ----------
function when(iso) {
  const d = new Date(iso), now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  if (now - d < 6 * 86400e3) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function renderCounts() {
  for (const b of document.querySelectorAll('.chip')) {
    const n = b.querySelector('.n');
    if (n) n.textContent = state.counts[b.dataset.f] ? String(state.counts[b.dataset.f]) : '';
    b.setAttribute('aria-pressed', String(b.dataset.f === state.filter));
  }
  const nb = $('newBadge');
  nb.textContent = String(state.counts.new || 0); nb.hidden = !state.counts.new;
}

function renderList() {
  const ul = $('list');
  ul.replaceChildren(...state.rows.map(row => {
    const li = el('li');
    const b = el('button', `item s-${row.status}`);
    b.type = 'button'; b.dataset.id = row.id;
    if (state.current && state.current.id === row.id) b.setAttribute('aria-current', 'true');
    b.append(el('span', 'st'), el('span', 'em', row.email), el('span', 'tm', when(row.created_at)));
    const tp = el('span', 'tp', `${TOPICS[row.topic] || row.topic} · ${SOURCES[row.source] || row.source}`);
    if (row.mail_status === 'failed') tp.append(' · ', el('span', 'fl', 'email failed'));
    b.append(tp, el('span', 'sn', row.message.replace(/\s+/g, ' ').slice(0, 140)));
    b.setAttribute('aria-label', `${row.status === 'new' ? 'New. ' : ''}${row.email}, ${TOPICS[row.topic] || row.topic}, ${when(row.created_at)}`);
    b.addEventListener('click', () => openRow(row));
    li.append(b);
    return li;
  }));
  $('empty').hidden = state.rows.length > 0;
  $('more').hidden = !state.more;
}

async function loadList(append) {
  const before = append && state.rows.length ? state.rows[state.rows.length - 1].created_at : undefined;
  say('listStatus', append ? 'Loading…' : '');
  const r = await api('list', { status: state.filter, before, limit: 50 });
  if (r.status === 401) return;
  if (!r.ok) { say('listStatus', `Couldn't load messages (${why(r)}).`, true); return; }
  say('listStatus', '');
  state.rows = append ? state.rows.concat(r.rows) : r.rows;
  state.counts = r.counts; state.more = r.more; state.loadedAt = Date.now();
  renderList(); renderCounts();
}

for (const b of document.querySelectorAll('.chip')) {
  b.addEventListener('click', () => { state.filter = b.dataset.f; renderCounts(); loadList(); });
}
$('refresh').addEventListener('click', () => loadList());
$('more').addEventListener('click', () => loadList(true));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('app').hidden && Date.now() - state.loadedAt > 30e3) loadList();
});

// ---------- one message ----------
function mailLine(row) {
  const p = $('dMail');
  p.replaceChildren();
  if (row.mail_status === 'sent') p.append(el('span', 'good', '✓ Emailed to you'));
  else if (row.mail_status === 'failed') p.append(el('span', 'bad', `Email failed: ${row.mail_error || 'unknown error'}`));
  else p.append(el('span', 'muted', 'Not emailed (email was off when it arrived)'));
  $('dResend').hidden = row.mail_status === 'sent' || !(state.settings && state.settings.smtp_enabled);
}

function renderDetail(row) {
  $('dTopic').textContent = TOPICS[row.topic] || row.topic;
  const t = $('dWhen'); t.dateTime = row.created_at; t.textContent = new Date(row.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const a = $('dEmail'); a.textContent = row.email; a.href = `mailto:${row.email}`;
  $('dSource').textContent = `· ${SOURCES[row.source] || row.source}`;
  $('dMessage').textContent = row.message;
  const d = row.device || {};
  const dl = $('dDevice');
  dl.replaceChildren(...[['Device', d.ua], ['Language', d.lang], ['Screen', d.screen], ['Time zone', d.tz]].filter(([, v]) => v)
    .flatMap(([k, v]) => [el('dt', null, k), el('dd', null, v)]));
  $('dReply').href = `mailto:${row.email}?subject=${encodeURIComponent(`Re: Your Neon Tanks message (${TOPICS[row.topic] || 'support'})`)}`;
  for (const b of $('detail').querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.s === row.status));
  mailLine(row);
  $('dConfirm').hidden = true; $('dDelete').hidden = false;
  say('dStatus', '');
}

async function openRow(row) {
  state.current = row;
  renderDetail(row);
  $('detail').hidden = false;
  document.querySelector('.split').classList.add('reading');
  history.replaceState(null, '', `#${row.id}`);
  renderList();
  if (matchMedia('(max-width: 820px)').matches) $('detail').scrollIntoView({ block: 'start' });
  if (row.status === 'new') await setStatus(row, 'open');
}

function closeDetail() {
  state.current = null;
  $('detail').hidden = true;
  document.querySelector('.split').classList.remove('reading');
  history.replaceState(null, '', location.pathname);
  renderList();
}
$('back').addEventListener('click', closeDetail);

async function setStatus(row, status) {
  if (row.status === status) return;
  const old = row.status;
  const r = await api('set_status', { id: row.id, status });
  if (!r.ok) { say('dStatus', `Couldn't change the status (${why(r)}).`, true); return; }
  row.status = status;
  state.counts[old] = Math.max(0, (state.counts[old] || 0) - 1); state.counts[status] = (state.counts[status] || 0) + 1;
  if (state.current && state.current.id === row.id) renderDetail(row);
  renderList(); renderCounts();
}
for (const b of $('detail').querySelectorAll('.seg button')) b.addEventListener('click', () => state.current && setStatus(state.current, b.dataset.s));

$('dDelete').addEventListener('click', () => { $('dDelete').hidden = true; $('dConfirm').hidden = false; $('dDeleteNo').focus(); });
$('dDeleteNo').addEventListener('click', () => { $('dConfirm').hidden = true; $('dDelete').hidden = false; });
$('dDeleteYes').addEventListener('click', async () => {
  const row = state.current;
  if (!row) return;
  const r = await api('delete', { id: row.id });
  if (!r.ok) { say('dStatus', `Couldn't delete it (${why(r)}).`, true); return; }
  state.rows = state.rows.filter(x => x.id !== row.id);
  state.counts[row.status] = Math.max(0, (state.counts[row.status] || 0) - 1);
  closeDetail(); renderCounts();
  say('listStatus', 'Message deleted.');
});

$('dResend').addEventListener('click', async () => {
  const row = state.current;
  if (!row) return;
  say('dStatus', 'Sending…');
  const r = await api('resend', { id: row.id });
  if (!r.ok) { say('dStatus', `Couldn't send it (${why(r)}).`, true); return; }
  Object.assign(row, { mail_status: r.mail_status, mail_error: r.mail_error });
  mailLine(row); renderList();
  say('dStatus', r.mail_status === 'sent' ? 'Sent to your inbox.' : 'It failed again; see the reason above.', r.mail_status !== 'sent');
});

async function openFromHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'settings') { tab('settings'); return; }
  if (!UUID.test(h)) return;
  let row = state.rows.find(x => x.id === h);
  if (!row) {
    const r = await api('get', { id: h });
    if (!r.ok) { say('listStatus', r.status === 404 ? 'That message no longer exists.' : `Couldn't open that message (${why(r)}).`, true); return; }
    row = r.row;
  }
  await openRow(row);
}
addEventListener('hashchange', () => { if (!$('app').hidden) openFromHash(); });

// ---------- email settings ----------
const F = { smtp_host: 'smHost', smtp_user: 'smUser', smtp_password: 'smPass', smtp_from: 'smFrom', smtp_from_name: 'smFromName', notify_to: 'smTo' };

function fieldErrors(fields = {}) {
  for (const [k, id] of Object.entries(F)) {
    const e = $(`${id}Err`), msg = fields[k] || '';
    if (e) { e.textContent = msg; e.hidden = !msg; }
    $(id).setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
}

function fillSettings(s, hasPassword) {
  state.settings = s; state.hasPassword = hasPassword; state.dirty = false;
  $('smEnabled').checked = !!s.smtp_enabled;
  $('smHost').value = s.smtp_host; $('smUser').value = s.smtp_user; $('smFrom').value = s.smtp_from;
  $('smFromName').value = s.smtp_from_name; $('smTo').value = s.notify_to; $('smPass').value = '';
  $('smPass').placeholder = hasPassword ? '•••••••• (saved)' : '';
  $('smPassHint').textContent = hasPassword ? 'A password is saved. Leave this empty to keep it, or type a new one to replace it.' : 'No password saved yet.';
  const off = !s.smtp_enabled;
  $('mailWarn').hidden = !off; $('mailOffNote').hidden = !off;
  fieldErrors();
}

async function loadSettings() {
  const r = await api('get_settings');
  if (r.ok) fillSettings(r.settings, r.has_password);
  else if (r.status !== 401) say('smStatus', `Couldn't load the settings (${why(r)}).`, true);
}

$('smtpForm').addEventListener('input', () => { state.dirty = true; say('smStatus', ''); });
$('smtpForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('smSave');
  btn.disabled = true; btn.textContent = 'Saving…'; say('smStatus', '');
  const r = await api('save_settings', {
    smtp_enabled: $('smEnabled').checked, smtp_host: $('smHost').value, smtp_user: $('smUser').value, smtp_password: $('smPass').value,
    smtp_from: $('smFrom').value, smtp_from_name: $('smFromName').value, notify_to: $('smTo').value,
  });
  btn.disabled = false; btn.textContent = 'Save';
  $('smPass').value = '';
  if (r.status === 400 && r.fields) { fieldErrors(r.fields); say('smStatus', r.error || 'Please check the highlighted fields.', true); return; }
  if (!r.ok) { say('smStatus', `Couldn't save (${why(r)}).`, true); return; }
  fillSettings(r.settings, r.has_password);
  say('smStatus', r.settings.smtp_enabled ? 'Saved. New messages will be emailed to you. Send a test email to check.' : 'Saved. Email is off: messages only show up here.');
  if (state.current) mailLine(state.current);
});

$('smTest').addEventListener('click', async () => {
  if (state.dirty) { say('smStatus', 'Save your changes first, then send the test email.', true); return; }
  const btn = $('smTest');
  btn.disabled = true; btn.textContent = 'Sending…'; say('smStatus', '');
  const r = await api('test_email');
  btn.disabled = false; btn.textContent = 'Send test email';
  if (r.ok) say('smStatus', `Test email sent to ${state.settings.notify_to}. Check that inbox (and its spam folder).`);
  else say('smStatus', `The test email didn't go through: ${why(r)}`, true);
});

// ---------- start ----------
sb.auth.getSession().then(({ data }) => (data.session ? enter() : toSignIn()), () => toSignIn());
