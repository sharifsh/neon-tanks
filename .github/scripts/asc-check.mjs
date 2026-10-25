// Fast sanity check of the App Store Connect secrets before spending Mac minutes.
// Checks formats (e.g. the letter "O" typed instead of a zero), then signs a token with the
// API key and asks App Store Connect for this app. Never prints the secrets themselves.
import { createPrivateKey, createSign } from 'node:crypto';

const BUNDLE_ID = process.env.BUNDLE_ID || 'com.sharifsh.neontanks';
const env = k => (process.env[k] || '').trim();
const teamId = env('APPLE_TEAM_ID'), keyId = env('ASC_KEY_ID'), issuer = env('ASC_ISSUER_ID');
const p8 = env('ASC_KEY_P8').replace(/\\n/g, '\n');
const problems = [];

const describe = (name, v, re, hint) => {
  if (!v) return problems.push(`${name} is empty or missing.`);
  if (!re.test(v)) {
    const extra = /O/.test(v) ? ' It contains the letter "O"; these IDs use the digit zero.' : '';
    problems.push(`${name} doesn't look right (length ${v.length}). ${hint}${extra}`);
  }
};
describe('APPLE_TEAM_ID', teamId, /^[A-Z0-9]{10}$/, 'Expected 10 capital letters/digits (Membership details > Team ID).');
describe('ASC_KEY_ID', keyId, /^[A-Z0-9]{10}$/, 'Expected 10 capital letters/digits (Users and Access > Integrations > Key ID).');
describe('ASC_ISSUER_ID', issuer, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Expected a UUID like 69a6de70-xxxx-xxxx-xxxx-xxxxxxxxxxxx (shown above the keys list).');
if (!p8) problems.push('ASC_KEY_P8 is empty or missing.');
else if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(p8)) problems.push('ASC_KEY_P8 should be the whole .p8 file, including the BEGIN/END PRIVATE KEY lines.');

if (problems.length) { console.error('Secret check failed:\n- ' + problems.join('\n- ')); process.exit(1); }

const b64u = b => Buffer.from(b).toString('base64url');
let jwt;
try {
  const key = createPrivateKey(p8);
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }));
  const sig = createSign('SHA256').update(`${head}.${body}`).sign({ key, dsaEncoding: 'ieee-p1363' });
  jwt = `${head}.${body}.${b64u(sig)}`;
} catch (e) { console.error('ASC_KEY_P8 could not be read as a private key:', e.message); process.exit(1); }

let res;
try {
  res = await fetch(`https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&fields[apps]=name,bundleId,sku`, { headers: { Authorization: `Bearer ${jwt}` } });
} catch (e) { console.error('Could not reach App Store Connect:', (e.cause && e.cause.code) || e.message); process.exit(1); }
if (res.status === 401) { console.error('App Store Connect rejected the key (401). Check that ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 belong together and the key is not revoked.'); process.exit(1); }
if (res.status === 403) { console.error('The key is valid but lacks access (403). It needs the Admin role (Team key) for cloud signing.'); process.exit(1); }
if (!res.ok) { console.error(`App Store Connect answered ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
const apps = (await res.json()).data || [];
if (!apps.length) { console.error(`The key works, but there's no app with bundle ID ${BUNDLE_ID} in App Store Connect yet.`); process.exit(1); }
console.log(`OK: key accepted; found "${apps[0].attributes.name}" (${BUNDLE_ID}). Team ID format OK.`);
