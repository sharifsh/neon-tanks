import { test, expect } from '@playwright/test';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { getToken, sendBundle } from '../tools/play-upload.mjs';

// The Google Play upload script, against a stand-in for Google's sign-in and Android Publisher API.
// Nothing here reaches Google; the service account key is made up for the test.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const KEY = { type: 'service_account', client_email: 'play-uploader@neon-tanks.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' };
const PKG = 'com.sharifsh.neontanks';
const BUNDLE = Buffer.from('PK\u0003\u0004 fake bundle bytes');

// Answers like Google would; `fail` makes a step fail once with a given status and message
function fakeGoogle({ fail = {} } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    calls.push({ method, path: u.pathname + u.search, headers: init.headers || {}, body: init.body });
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    const step = u.host === 'oauth2.googleapis.com' ? 'token' : method === 'POST' && u.pathname.endsWith('/edits') ? 'edit'
      : u.pathname.includes('/bundles') ? 'upload' : method === 'PUT' ? 'track' : u.pathname.endsWith(':commit') ? 'commit' : method === 'DELETE' ? 'delete' : '?';
    if (fail[step]) { const [status, message] = fail[step]; delete fail[step]; return reply(status, step === 'token' ? { error: 'invalid_grant', error_description: message } : { error: { code: status, message } }); }
    switch (step) {
      case 'token': return reply(200, { access_token: 'ya29.test-token', expires_in: 3599, token_type: 'Bearer' });
      case 'edit': return reply(200, { id: 'edit-42', expiryTimeSeconds: '1793300000' });
      case 'upload': return reply(200, { versionCode: 101, sha256: 'abc' });
      case 'track': return reply(200, JSON.parse(init.body));
      case 'commit': return reply(200, { id: 'edit-42' });
      case 'delete': return new Response(null, { status: 204 });
    }
    return reply(404, { error: { message: 'unexpected call' } });
  };
  return { fetch, calls };
}

test('signs in as the service account with a signed token', async () => {
  const g = fakeGoogle();
  expect(await getToken(KEY, { fetch: g.fetch, now: Date.parse('2026-10-29T01:00:00Z') })).toBe('ya29.test-token');
  const form = new URLSearchParams(g.calls[0].body);
  expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [head, claims, sig] = form.get('assertion').split('.');
  expect(JSON.parse(Buffer.from(head, 'base64url'))).toEqual({ alg: 'RS256', typ: 'JWT' });
  const c = JSON.parse(Buffer.from(claims, 'base64url'));
  expect(c).toMatchObject({ iss: KEY.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: KEY.token_uri, iat: 1793235600, exp: 1793239200 });
  expect(createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, sig, 'base64url')).toBe(true);
});

test('uploads the bundle, releases it to internal testing and commits', async () => {
  const g = fakeGoogle(), log = [];
  const r = await sendBundle({ key: KEY, bundle: BUNDLE, pkg: PKG, name: '1.0 (101)', notes: 'Sound fix', fetch: g.fetch, log: m => log.push(m) });
  expect(r).toEqual({ versionCode: 101, status: 'completed' });
  expect(g.calls.map(c => `${c.method} ${c.path}`)).toEqual([
    'POST /token',
    `POST /androidpublisher/v3/applications/${PKG}/edits`,
    `POST /upload/androidpublisher/v3/applications/${PKG}/edits/edit-42/bundles?uploadType=media`,
    `PUT /androidpublisher/v3/applications/${PKG}/edits/edit-42/tracks/internal`,
    `POST /androidpublisher/v3/applications/${PKG}/edits/edit-42:commit`,
  ]);
  for (const c of g.calls.slice(1)) expect(c.headers.authorization).toBe('Bearer ya29.test-token');
  expect(g.calls[2].headers['content-type']).toBe('application/octet-stream');
  expect(Buffer.compare(Buffer.from(g.calls[2].body), BUNDLE)).toBe(0);
  expect(JSON.parse(g.calls[3].body)).toEqual({ track: 'internal', releases: [{ name: '1.0 (101)', versionCodes: ['101'], status: 'completed', releaseNotes: [{ language: 'en-US', text: 'Sound fix' }] }] });
  expect(log.join(' ')).toContain('Released to internal testing');
});

test('an app that is still a draft in Play Console gets a draft release to roll out by hand', async () => {
  const g = fakeGoogle({ fail: { track: [400, 'Only releases with status draft may be created on draft app.'] } }), log = [];
  const r = await sendBundle({ key: KEY, bundle: BUNDLE, pkg: PKG, name: '1.0 (101)', fetch: g.fetch, log: m => log.push(m) });
  expect(r.status).toBe('draft');
  const puts = g.calls.filter(c => c.method === 'PUT').map(c => JSON.parse(c.body).releases[0].status);
  expect(puts).toEqual(['completed', 'draft']);
  expect(g.calls.at(-1).path).toMatch(/:commit$/);
  expect(log.join(' ')).toContain('roll it out in Play Console');
});

test('a failed step throws a readable error and throws the edit away', async () => {
  const g = fakeGoogle({ fail: { upload: [403, 'The caller does not have permission'] } });
  await expect(sendBundle({ key: KEY, bundle: BUNDLE, pkg: PKG, fetch: g.fetch, log: () => {} })).rejects.toThrow(/bundles failed \(403\): The caller does not have permission/);
  expect(g.calls.at(-1)).toMatchObject({ method: 'DELETE', path: `/androidpublisher/v3/applications/${PKG}/edits/edit-42` });
  expect(g.calls.some(c => c.path.endsWith(':commit'))).toBe(false);
});

test('a bad service account key is refused before anything is sent', async () => {
  const g = fakeGoogle({ fail: { token: [400, 'Invalid JWT Signature.'] } });
  await expect(sendBundle({ key: KEY, bundle: BUNDLE, pkg: PKG, fetch: g.fetch, log: () => {} })).rejects.toThrow('Google sign-in failed (400): Invalid JWT Signature.');
  expect(g.calls).toHaveLength(1);
  await expect(getToken({ client_email: 'x@y' }, { fetch: g.fetch })).rejects.toThrow(/missing client_email or private_key/);
});
