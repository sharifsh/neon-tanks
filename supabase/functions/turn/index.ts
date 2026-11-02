// Supabase Edge Function "turn": short-lived relay (TURN) credentials from Cloudflare Realtime for online rooms.
// Players' devices connect directly where they can; when a firewall or mobile network blocks that, the relay carries
// the game between them (it stores nothing). The game asks for these when it joins a room, without signing in, so
// deploy with JWT verification off.
// Secrets (Edge Functions → Secrets): CF_TURN_KEY_ID and CF_TURN_API_TOKEN, from Cloudflare → Realtime → TURN Server.
// Until they're set, it answers an empty list and the game uses direct connections and the Supabase channel as before.

const KEY_ID = Deno.env.get("CF_TURN_KEY_ID") ?? "";
const TOKEN = Deno.env.get("CF_TURN_API_TOKEN") ?? "";
const TTL = 4 * 3600; // seconds each credential works; the game asks again after 30 minutes
const ORIGINS = [
  /^https:\/\/(www\.)?tanksarenabattle\.com$/,
  /^https:\/\/([a-z0-9-]+--)?neon-tanks-sharif\.netlify\.app$/,
  /^capacitor:\/\/localhost$/, // iPhone/iPad app
  /^https?:\/\/localhost(:\d+)?$/, // Android app, local development
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

type Ice = { urls: string | string[]; username?: string; credential?: string };
let cache: { at: number; list: Ice[] } | null = null;

function headers(origin: string | null): Record<string, string> {
  const ok = !!origin && ORIGINS.some((r) => r.test(origin));
  return {
    ...(ok ? { "Access-Control-Allow-Origin": origin! } : {}),
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

/* One credential is handed out for up to 10 minutes (each works for 4 hours), so a busy evening makes few calls. */
async function iceServers(): Promise<Ice[]> {
  if (!KEY_ID || !TOKEN) return [];
  if (cache && Date.now() - cache.at < 10 * 60e3) return cache.list;
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: TTL }),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) {
    console.error("turn: Cloudflare answered", r.status, (await r.text()).slice(0, 300));
    return [];
  }
  const j = await r.json();
  // Port 53 addresses are left out: browsers refuse them and would only slow the connection down.
  const list = ([] as Ice[]).concat(j?.iceServers ?? [])
    .map((x) => ({ ...x, urls: ([] as string[]).concat(x.urls ?? []).filter((u) => typeof u === "string" && !/:53(\?|$)/.test(u)) }))
    .filter((x) => x.urls.length);
  if (list.length) cache = { at: Date.now(), list };
  return list;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = headers(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  // Only the game's own pages and apps get relay credentials; anyone else gets the empty list.
  if (!origin || !ORIGINS.some((r) => r.test(origin))) return new Response(JSON.stringify({ iceServers: [] }), { headers: h });
  let list: Ice[] = [];
  try { list = await iceServers(); } catch (e) { console.error("turn:", String(e)); }
  return new Response(JSON.stringify({ iceServers: list }), { headers: h });
});
