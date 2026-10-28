// The support form: checks the fields, sends them to the support server function and shows
// what happened. Same page on the website and inside the app.
import { callSupport, SUPPORT_EMAIL } from './support-api.js';

const $ = id => document.getElementById(id);
const form = $('supportForm'), sent = $('supportSent');
const fields = { topic: $('sfTopic'), email: $('sfEmail'), message: $('sfMessage') };
const errs = { topic: $('sfTopicErr'), email: $('sfEmailErr'), message: $('sfMessageErr') };
const shownAt = Date.now();
const mail = `<a href="mailto:${SUPPORT_EMAIL}?subject=Neon%20Tanks%20support">${SUPPORT_EMAIL}</a>`;

function platform() {
  try { const p = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform(); if (p === 'ios' || p === 'android') return p; } catch { /* website */ }
  return 'web';
}
function device() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* unknown */ }
  return { ua: navigator.userAgent, lang: navigator.language || '', screen: `${screen.width}x${screen.height}@${Math.round((devicePixelRatio || 1) * 100) / 100}`, tz, page: 'support' };
}

function showError(name, text) {
  const f = fields[name], e = errs[name];
  if (!f) return;
  f.setAttribute('aria-invalid', text ? 'true' : 'false');
  e.textContent = text || ''; e.hidden = !text;
}
function status(html, bad) { const s = $('sfStatus'); s.innerHTML = html; s.classList.toggle('bad', !!bad); }

function check() {
  const v = { topic: fields.topic.value, email: fields.email.value.trim(), message: fields.message.value.trim() };
  const problems = {
    topic: v.topic ? '' : 'Please choose what your message is about.',
    email: /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/.test(v.email) ? '' : 'Please enter your email address so we can reply.',
    message: v.message.replace(/\s/g, '').length >= 10 ? '' : 'Please tell us a bit more (at least 10 characters).',
  };
  for (const k in problems) showError(k, problems[k]);
  return { v, ok: !Object.values(problems).some(Boolean), first: Object.keys(problems).find(k => problems[k]) };
}

fields.message.addEventListener('input', () => { $('sfCount').textContent = `${fields.message.value.length} / 4000`; if (errs.message.textContent) check(); });
fields.email.addEventListener('input', () => { if (errs.email.textContent) check(); });
fields.topic.addEventListener('change', () => { $('sfRestoreTip').hidden = fields.topic.value !== 'purchase'; if (errs.topic.textContent) check(); });

form.addEventListener('submit', async e => {
  e.preventDefault();
  const { v, ok, first } = check();
  if (!ok) { status('Please check the highlighted fields.', true); fields[first].focus(); return; }
  const btn = $('sfSend');
  btn.disabled = true; btn.textContent = 'Sending…'; status('');
  const r = await callSupport({ action: 'submit', ...v, website: $('sfWebsite').value, elapsed: Date.now() - shownAt, source: platform(), device: device() });
  btn.disabled = false; btn.textContent = 'Send message';
  if (r.ok) {
    $('sentTo').textContent = v.email;
    form.hidden = true; sent.hidden = false; sent.focus();
    form.reset(); $('sfCount').textContent = '0 / 4000'; $('sfRestoreTip').hidden = true;
    return;
  }
  if (r.status === 400 && r.fields) {
    for (const k in errs) showError(k, r.fields[k] || '');
    status('Please check the highlighted fields.', true);
    const f = Object.keys(r.fields).find(k => fields[k]); if (f) fields[f].focus();
  } else if (r.status === 429) {
    status(`You've sent several messages in a short time. Please try again later, or email ${mail}.`, true);
  } else {
    status(`Your message couldn't be sent just now${navigator.onLine === false ? ' (no internet connection)' : ''}. Please try again in a moment, or email ${mail}.`, true);
  }
});

$('sfAgain').addEventListener('click', e => {
  e.preventDefault();
  sent.hidden = true; form.hidden = false; status('');
  fields.topic.focus();
});
