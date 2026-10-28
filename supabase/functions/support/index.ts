// Supabase Edge Function "support": the support form and the admin page's server.
// Deploy with JWT verification off: the form is public, and admin actions check the
// Supabase Auth token themselves (handler.js). Email goes out on port 465 (SSL/TLS);
// Edge Functions can't open ports 25 or 587.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createHandler } from './handler.js';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const url = Deno.env.get('SUPABASE_URL')!;
let secretKeys: Record<string, string> = {};
try { secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); } catch { /* use the legacy key */ }
const serverKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const must = <T>(r: { data: T; error: unknown }) => { if (r.error) throw r.error; return r.data; };
const stamp = () => new Date().toISOString();

const db = {
  insertRequest: async (row: Record<string, unknown>) => must(await sb.from('support_requests').insert(row).select('*').single()),
  updateRequest: async (id: string, patch: Record<string, unknown>) => { must(await sb.from('support_requests').update({ ...patch, updated_at: stamp() }).eq('id', id)); },
  deleteRequest: async (id: string) => { must(await sb.from('support_requests').delete().eq('id', id)); },
  getRequest: async (id: string) => must(await sb.from('support_requests').select('*').eq('id', id).maybeSingle()),
  listRequests: async ({ status, before, limit }: { status: string | null; before: string | null; limit: number }) => {
    let q = sb.from('support_requests').select('*').order('created_at', { ascending: false }).limit(limit);
    if (status) q = q.eq('status', status);
    if (before) q = q.lt('created_at', before);
    return must(await q);
  },
  countByStatus: async () => {
    const out: Record<string, number> = {};
    await Promise.all(['new', 'open', 'done'].map(async s => {
      const r = await sb.from('support_requests').select('id', { count: 'exact', head: true }).eq('status', s);
      if (r.error) throw r.error;
      out[s] = r.count || 0;
    }));
    return out;
  },
  getSettings: async () => must(await sb.from('support_settings').select('*').eq('id', 1).maybeSingle()),
  saveSettings: async (row: Record<string, unknown>) => must(await sb.from('support_settings').upsert({ id: 1, ...row }).select('*').single()),
  getPassword: async () => (must(await sb.rpc('support_smtp_password')) as string | null) || null,
  setPassword: async (p: string) => { must(await sb.rpc('support_set_smtp_password', { p_password: p })); },
  throttleCount: async (key: string, since: string) => {
    const r = await sb.from('support_throttle').select('id', { count: 'exact', head: true }).eq('key', key).gte('created_at', since);
    if (r.error) throw r.error;
    return r.count || 0;
  },
  throttleAdd: async (keys: string[]) => { must(await sb.from('support_throttle').insert(keys.map(key => ({ key })))); },
  cleanup: async (requestsBefore: string, throttleBefore: string) => {
    must(await sb.from('support_requests').delete().lt('created_at', requestsBefore));
    must(await sb.from('support_throttle').delete().lt('created_at', throttleBefore));
  },
};

const auth = {
  getUser: async (token: string) => {
    const { data, error } = await sb.auth.getUser(token);
    return error || !data?.user ? null : data.user;
  },
};

// SSL/TLS from the first byte (port 465)
async function connect(hostname: string, port: number) {
  const conn = await Deno.connectTls({ hostname, port });
  return {
    async read() { const buf = new Uint8Array(16384); const n = await conn.read(buf); return n === null ? null : buf.subarray(0, n); },
    async write(bytes: Uint8Array) { let off = 0; while (off < bytes.length) off += await conn.write(bytes.subarray(off)); },
    close() { try { conn.close(); } catch { /* already closed */ } },
  };
}

// one-way, salted: the throttle never stores a network address
async function hash(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${serverKey}|support|${s}`));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const ORIGINS = [
  /^https:\/\/(www\.)?tanksarenabattle\.com$/,
  /^https:\/\/([a-z0-9-]+--)?neon-tanks-sharif\.netlify\.app$/,
  /^capacitor:\/\/localhost$/, // iPhone/iPad app
  /^https?:\/\/localhost(:\d+)?$/, // Android app, local development
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

const handle = createHandler({
  db, auth, connect, hash,
  waitUntil: (p: Promise<unknown>) => { const safe = p.catch(e => console.error('support background task failed:', e)); if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(safe); },
  allowOrigin: (o: string) => ORIGINS.some(r => r.test(o)),
  adminUrl: 'https://tanksarenabattle.com/admin',
  heloName: 'tanksarenabattle.com',
  log: (...a: unknown[]) => console.error(...a),
});

Deno.serve(handle);
