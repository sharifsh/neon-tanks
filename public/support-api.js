// Talks to the support server function (the form here, the inbox on the admin page).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const SUPPORT_FN = `${SUPABASE_URL}/functions/v1/support`;
export const SUPPORT_EMAIL = 'trackmyreceipt@gmail.com';

// Returns { status, ok, ...json }. Network trouble comes back as { status: 0, ok: false }.
export async function callSupport(body, token) {
  const headers = { 'content-type': 'application/json', apikey: SUPABASE_KEY };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(SUPPORT_FN, { method: 'POST', headers, body: JSON.stringify(body) });
    let json = {};
    try { json = await res.json(); } catch { /* not JSON */ }
    return { ...json, status: res.status, ok: res.ok && json.ok === true };
  } catch {
    return { status: 0, ok: false };
  }
}
