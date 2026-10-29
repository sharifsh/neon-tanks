// Sends a signed app bundle (.aab) to a Google Play testing track with the Android Publisher API.
// The service account key comes from the environment (PLAY_SERVICE_ACCOUNT_JSON, a GitHub secret) and never leaves
// this process. No dependencies: the sign-in token is a JWT signed here with Node's crypto.
//   node tools/play-upload.mjs <bundle.aab> [--track internal] [--package com.sharifsh.neontanks] [--name "1.0 (101)"] [--notes "..."]
import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const b64url = s => Buffer.from(s).toString('base64url');

// An access token for the service account (OAuth 2.0 JWT bearer grant)
export async function getToken(key, { fetch = globalThis.fetch, now = Date.now() } = {}) {
  if (!key || !key.client_email || !key.private_key) throw new Error('The service account key is missing client_email or private_key');
  const aud = key.token_uri || 'https://oauth2.googleapis.com/token';
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 }))}`;
  const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')}`;
  const r = await fetch(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in failed (${r.status}): ${j.error_description || j.error || 'no access token'}`);
  return j.access_token;
}

// One edit: upload the bundle, put it on the track, commit. A brand-new app that is still a draft in Play Console
// only accepts draft releases; then the release is left as a draft to roll out in Play Console.
export async function sendBundle({ key, bundle, pkg, track = 'internal', name, notes, fetch = globalThis.fetch, log = console.log }) {
  const auth = `Bearer ${await getToken(key, { fetch })}`;
  const call = async (method, url, body, type) => {
    const r = await fetch(url, { method, headers: { authorization: auth, ...(type ? { 'content-type': type } : {}) }, body });
    const text = await r.text();
    let j = {}; try { j = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    if (!r.ok) { const e = new Error(`${method} ${url.split('?')[0].replace(API, '').replace(UPLOAD, '')} failed (${r.status}): ${(j.error && j.error.message) || text.slice(0, 300)}`); e.status = r.status; throw e; }
    return j;
  };
  const edit = await call('POST', `${API}/${pkg}/edits`, '{}', 'application/json');
  try {
    const up = await call('POST', `${UPLOAD}/${pkg}/edits/${edit.id}/bundles?uploadType=media`, bundle, 'application/octet-stream');
    log(`Uploaded versionCode ${up.versionCode}`);
    const release = status => ({ name, versionCodes: [String(up.versionCode)], status, ...(notes ? { releaseNotes: [{ language: 'en-US', text: notes }] } : {}) });
    let status = 'completed';
    try {
      await call('PUT', `${API}/${pkg}/edits/${edit.id}/tracks/${track}`, JSON.stringify({ track, releases: [release(status)] }), 'application/json');
    } catch (e) {
      if (!/draft app/i.test(e.message)) throw e;
      status = 'draft';
      await call('PUT', `${API}/${pkg}/edits/${edit.id}/tracks/${track}`, JSON.stringify({ track, releases: [release(status)] }), 'application/json');
    }
    await call('POST', `${API}/${pkg}/edits/${edit.id}:commit`);
    log(status === 'completed' ? `Released to ${track} testing` : `Saved as a draft on ${track} testing: roll it out in Play Console (the app is still a draft there)`);
    return { versionCode: up.versionCode, status };
  } catch (e) {
    await call('DELETE', `${API}/${pkg}/edits/${edit.id}`).catch(() => {});
    throw e;
  }
}

async function main(argv) {
  const args = { track: 'internal', package: 'com.sharifsh.neontanks' };
  const files = [];
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) args[a.slice(2)] = argv[++i]; else files.push(a); }
  if (files.length !== 1) throw new Error('Give exactly one .aab file');
  let key;
  try { key = JSON.parse(process.env.PLAY_SERVICE_ACCOUNT_JSON || ''); } catch { throw new Error('PLAY_SERVICE_ACCOUNT_JSON is not set to the service account key (JSON)'); }
  const bundle = await readFile(files[0]);
  console.log(`Sending ${files[0]} (${(bundle.length / 1048576).toFixed(1)} MB) to ${args.package}, ${args.track} track`);
  await sendBundle({ key, bundle, pkg: args.package, track: args.track, name: args.name, notes: args.notes });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).catch(e => { console.error(`::error title=Google Play upload failed::${e.message}`); process.exit(1); });
}
