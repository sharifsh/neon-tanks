// Map layouts, procedural generation, encoding. All coordinates scale with the live map size.
import { W, H, T, TILE_CHARS, SIZES, LEGACY_SIZE, setMapSize } from './const.js';

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Layout: positions for bases and spawns per layout type, computed for the current W×H
export function getLayout(type) {
  const cx = W / 2 - 1, cy = H / 2 - 1;
  // Everything sits on the 2×2 block grid (even cells), so tanks line up with the lanes between walls.
  const ev = v => 2 * Math.round(v / 2);
  if (type === 'D') { // free-for-all: 8 spread-out spawns, no bases
    return {
      type, bases: [], rings: [], enemySpawns: [],
      playerSpawns: [[
        { x: 0, y: 0, dir: 2 }, { x: W - 2, y: H - 2, dir: 0 }, { x: W - 2, y: 0, dir: 2 }, { x: 0, y: H - 2, dir: 0 },
        { x: cx, y: 0, dir: 2 }, { x: cx, y: H - 2, dir: 0 }, { x: 0, y: cy, dir: 1 }, { x: W - 2, y: cy, dir: 3 },
      ]],
    };
  }
  if (type === 'U') { // duel: 1v1, facing each other across the map
    return {
      type, bases: [], rings: [], enemySpawns: [],
      playerSpawns: [[{ x: 0, y: cy, dir: 1 }, { x: W - 2, y: cy, dir: 3 }, { x: cx, y: 0, dir: 2 }, { x: cx, y: H - 2, dir: 0 }]],
    };
  }
  if (type === 'A') {
    const c = ev(H * 0.29), g = ev(H * 0.21);
    const ys1 = [2, H - 4, c, H - c - 2], ys2 = [0, H - 2, g, H - g - 2];
    const x1 = W < 30 ? 2 : 4, x2 = x1 + 4;
    const team = (x1, x2, dir) => [...ys1.map(y => ({ x: x1, y, dir })), ...ys2.map(y => ({ x: x2, y, dir }))];
    return {
      type,
      bases: [{ x: 0, y: cy, team: 0 }, { x: W - 2, y: cy, team: 1 }],
      rings: [ringCells(0, cy), ringCells(W - 2, cy)],
      playerSpawns: [team(x1, x2, 1), team(W - 2 - x1, W - 2 - x2, 3)],
      enemySpawns: [],
    };
  }
  // classic co-op: core at the bottom centre, enemies from the top
  const bx = W / 2 - 1, by = H - 2, spawns = [];
  const offs = [-6, 6, -10, 10, -14, 14, -18, 18, -22, 22, -26, 26];
  for (const o of offs) { const x = bx + o; if (x >= 1 && x <= W - 3 && spawns.length < 8) spawns.push({ x, y: by, dir: 0 }); }
  for (let i = 0; spawns.length < 8; i++) spawns.push({ x: bx + (i % 2 ? 4 + (i >> 1) * 4 : -4 - (i >> 1) * 4), y: ev(H - 8), dir: 0 });
  const q = ev(W / 4);
  return {
    type: 'C',
    bases: [{ x: bx, y: by, team: 0 }],
    rings: [ringCells(bx, by, 2)],
    playerSpawns: [spawns.map(s => ({ ...s, x: Math.max(0, Math.min(W - 2, s.x)) }))],
    enemySpawns: [{ x: 0, y: 0 }, { x: q, y: 0 }, { x: bx, y: 0 }, { x: W - q - 2, y: 0 }, { x: W - 2, y: 0 }],
    bossSpawn: { x: bx - 1, y: 0 },
    sideSpawns: [{ x: 0, y: ev(H * 0.36) }, { x: W - 2, y: ev(H * 0.36) }],
  };
}

function ringCells(bx, by, th = 1) {
  const out = [];
  for (let y = by - th; y <= by + 1 + th; y++) for (let x = bx - th; x <= bx + 1 + th; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    if (x >= bx && x <= bx + 1 && y >= by && y <= by + 1) continue;
    out.push([x, y]);
  }
  return out;
}

// Cells that must be empty (spawns, base) for a layout
export function reservedMask(layout) {
  const m = new Uint8Array(W * H);
  const mark = (x0, y0, w, h, v = 1) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++)
      if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = v;
  };
  for (const b of layout.bases) mark(b.x, b.y, 2, 2, 2);
  for (const r of layout.rings) for (const [x, y] of r) if (!m[y * W + x]) m[y * W + x] = 3;
  for (const team of layout.playerSpawns) for (const s of team) mark(s.x, s.y, 2, 2);
  for (const s of layout.enemySpawns) mark(s.x, s.y, 2, 2);
  if (layout.bossSpawn) mark(layout.bossSpawn.x, layout.bossSpawn.y, 4, 4);
  if (layout.sideSpawns) for (const s of layout.sideSpawns) mark(s.x, s.y, 2, 2);
  return m;
}

export function applyLayout(grid, layout) {
  const m = reservedMask(layout);
  for (let i = 0; i < W * H; i++) if (m[i] === 1 || m[i] === 2) grid[i] = T.EMPTY;
  for (const r of layout.rings) for (const [x, y] of r) grid[y * W + x] = T.BRICK;
}

// Map string: "<layout>[:<w>x<h>]|<cells>" — old maps without a size are 48×28
export function encodeMap(layoutType, grid) {
  let s = `${layoutType}:${W}x${H}|`;
  for (let i = 0; i < W * H; i++) s += TILE_CHARS[grid[i]] || '.';
  return s;
}
export function mapDims(str) {
  const head = String(str).split('|')[0], m = head.match(/:(\d+)x(\d+)/);
  return m ? [+m[1], +m[2]] : LEGACY_SIZE;
}
export const mapLayout = str => ('CADU'.includes(String(str)[0]) ? String(str)[0] : 'C');
// Pure: returns the grid at the map's own size (callers set the live size when they use it)
export function decodeMap(str) {
  const [head, body] = String(str).split('|');
  const [w, h] = mapDims(str);
  const grid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = TILE_CHARS.indexOf(body ? body[i] : '.');
    grid[i] = v < 0 ? 0 : v;
  }
  const lt = head[0];
  return { layout: 'CADU'.includes(lt) ? lt : 'C', grid, w, h };
}

const STAGE_NAMES = ['Iron Gate', 'Brick Maze', 'Delta River', 'Titan\'s Den', 'Frozen Lake', 'Pine Ridge', 'Steel Canyon', 'Red Fortress',
  'Neon Harbor', 'Glass Fields', 'Night Forest', 'Storm Citadel', 'Rust Belt', 'Echo Valley', 'Last Bastion', 'Crimson Ice'];
export function stageName(n) { return STAGE_NAMES[(n - 1) % STAGE_NAMES.length]; }

// Procedural symmetric map for the current size
export function generateMap(layoutType, seed, difficulty = 1) {
  const layout = getLayout(layoutType);
  const areaK = (W * H) / (48 * 28);
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = rng(seed * 7919 + attempt * 104729 + (layoutType === 'A' ? 5 : 0) + W * 13);
    const grid = new Uint8Array(W * H);
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) grid[y * W + x] = v; };
    const block = (bx, by, v) => { set(bx * 2, by * 2, v); set(bx * 2 + 1, by * 2, v); set(bx * 2, by * 2 + 1, v); set(bx * 2 + 1, by * 2 + 1, v); };
    const BW = W / 4, BH = H / 2;
    const steelP = Math.min(0.12, 0.03 + difficulty * 0.012);
    const features = Math.round((16 + Math.floor(r() * 8)) * areaK);
    for (let f = 0; f < features; f++) {
      const kind = r();
      const bx = Math.floor(r() * BW), by = Math.floor(r() * BH);
      if (kind < 0.42) { // wall run
        const len = 2 + Math.floor(r() * 5), horiz = r() < 0.5;
        const mat = r() < steelP * 2.5 ? T.STEEL : T.BRICK;
        for (let i = 0; i < len; i++) block(horiz ? bx + i : bx, horiz ? by : by + i, (mat === T.STEEL && i % 3 !== 1) ? T.BRICK : mat);
      } else if (kind < 0.58) { // bunker rectangle
        const w = 2 + Math.floor(r() * 2), h = 2 + Math.floor(r() * 2);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) block(bx + x, by + y, T.BRICK);
        if (r() < 0.5) block(bx + Math.floor(w / 2), by + h - 1, T.EMPTY);
      } else if (kind < 0.67) { // pond, sometimes with a bridge
        const w = 1 + Math.floor(r() * 3), h = 1 + Math.floor(r() * 2);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) block(bx + x, by + y, T.WATER);
        if (w >= 2 && r() < 0.35) for (let y = 0; y < h; y++) block(bx + 1, by + y, T.BRIDGE);
      } else if (kind < 0.78) { // forest
        const n = 3 + Math.floor(r() * 5);
        for (let i = 0; i < n; i++) block(bx + Math.floor(r() * 3), by + Math.floor(r() * 3), T.TREES);
      } else if (kind < 0.84) { // ice
        const w = 2 + Math.floor(r() * 3), h = 1 + Math.floor(r() * 2);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) block(bx + x, by + y, T.ICE);
      } else if (kind < 0.89) { // barrels
        set(bx * 2, by * 2, T.BARREL); if (r() < 0.6) set(bx * 2 + 1, by * 2, T.BARREL); if (r() < 0.4) set(bx * 2, by * 2 + 1, T.BARREL);
      } else if (kind < 0.93) { // boost lane
        const len = 2 + Math.floor(r() * 3), horiz = r() < 0.5;
        for (let i = 0; i < len; i++) block(horiz ? bx + i : bx, horiz ? by : by + i, T.BOOST);
      } else { // steel pillar
        block(bx, by, T.STEEL);
      }
    }
    // knock whole 2×2 blocks out of brick walls (never single cells: lanes stay one tank wide and edges stay clean)
    for (let y = 0; y < H - 1; y += 2) for (let x = 0; x < W - 1; x += 2) {
      const i = y * W + x;
      if (grid[i] === T.BRICK && grid[i + 1] === T.BRICK && grid[i + W] === T.BRICK && grid[i + W + 1] === T.BRICK && r() < 0.12) grid[i] = grid[i + 1] = grid[i + W] = grid[i + W + 1] = T.EMPTY;
    }
    mirrorGrid(grid, layoutType === 'D' || layoutType === 'U');
    applyLayout(grid, layout);
    addCover(grid, layout);
    if (checkConnectivity(grid, layout) && coreShielded(grid, layout)) return { layout: layoutType, grid };
  }
  const grid = new Uint8Array(W * H);
  applyLayout(grid, layout);
  addCover(grid, layout);
  return { layout: layoutType, grid };
}
export function mirrorGrid(grid, vertical) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) grid[y * W + (W - 1 - x)] = grid[y * W + x];
  if (vertical) for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x++) grid[(H - 1 - y) * W + x] = grid[y * W + x];
}

// tank-footprint walkability (bricks and barrels are breakable, so count as walkable)
const BLOCK = new Set([T.STEEL, T.WATER]);
export function walkable(grid, x, y, allowBrick = true) {
  if (x < 0 || y < 0 || x > W - 2 || y > H - 2) return false;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const t = grid[(y + dy) * W + x + dx];
    if (BLOCK.has(t)) return false;
    if (!allowBrick && (t === T.BRICK || t === T.BARREL)) return false;
  }
  return true;
}

function reach(grid, sx, sy) {
  const seen = new Uint8Array(W * H);
  const q = [sx, sy]; seen[sy * W + sx] = 1;
  const tele = teleportPads(grid);
  while (q.length) {
    const y = q.pop(), x = q.pop();
    const nbrs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    const pi = tele.index.get(y * W + x); if (pi !== undefined && tele.link[pi] !== undefined) { const o = tele.pads[tele.link[pi]]; nbrs.push([o.x, o.y]); }
    for (const [nx, ny] of nbrs) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx]) continue;
      if (!walkable(grid, nx, ny)) continue;
      seen[ny * W + nx] = 1; q.push(nx, ny);
    }
  }
  return seen;
}

// Teleport pads are 2×2 blocks of TELE tiles; pads are linked in pairs in reading order (1↔2, 3↔4 …)
export function teleportPads(grid) {
  const pads = [], index = new Map(), used = new Uint8Array(W * H);
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const i = y * W + x;
    if (used[i] || grid[i] !== T.TELE || grid[i + 1] !== T.TELE || grid[i + W] !== T.TELE || grid[i + W + 1] !== T.TELE) continue;
    used[i] = used[i + 1] = used[i + W] = used[i + W + 1] = 1;
    index.set(i, pads.length); pads.push({ x, y });
  }
  const link = {};
  // pair each pad with its mirror partner if there is one, otherwise sequentially
  const free = pads.map((_, k) => k);
  while (free.length > 1) {
    const a = free.shift(), pa = pads[a];
    let best = 0, bd = -1;
    free.forEach((b, j) => { const pb = pads[b]; const d = Math.abs(pb.x - pa.x) + Math.abs(pb.y - pa.y) * 0.2; if (d > bd) { bd = d; best = j; } });
    const b = free.splice(best, 1)[0];
    link[a] = b; link[b] = a;
  }
  return { pads, index, link };
}

function nearBase(seen, b) {
  for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++)
    if (x >= 0 && y >= 0 && x < W && y < H && seen[y * W + x]) return true;
  return false;
}

// ---------- lines of fire ----------
// A shot flies along a tank's centre line and is stopped by brick or steel in either of the two cells
// beside that line. Tanks only shoot straight, so two 2×2 tanks can hit each other only when they share
// a row or a column.
const stops = (v, steelOnly) => v === T.STEEL || (!steelOnly && v === T.BRICK);
// Is there anything between two lined-up 2×2 footprints that stops a shot? (Not lined up: no straight shot.)
export function lineCovered(grid, a, b, steelOnly = false) {
  if (a.y === b.y) {
    for (let x = Math.min(a.x, b.x) + 2; x < Math.max(a.x, b.x); x++)
      if (stops(grid[a.y * W + x], steelOnly) || stops(grid[(a.y + 1) * W + x], steelOnly)) return true;
    return false;
  }
  if (a.x === b.x) {
    for (let y = Math.min(a.y, b.y) + 2; y < Math.max(a.y, b.y); y++)
      if (stops(grid[y * W + a.x], steelOnly) || stops(grid[y * W + a.x + 1], steelOnly)) return true;
    return false;
  }
  return true;
}
// Co-op: an enemy that appears in the middle of the top (or the Titan) must not have a clear shot at the
// core. Steel (which enemy shells can't break) somewhere in the core's column, between the spawns and
// the brick ring, blocks it for good.
export function coreShielded(grid, layout) {
  if (layout.type !== 'C') return true;
  const b = layout.bases[0], top = layout.bossSpawn ? layout.bossSpawn.y + 4 : 2;
  for (let y = top; y < b.y - 2; y++) if (stops(grid[y * W + b.x], true) || stops(grid[y * W + b.x + 1], true)) return true;
  return false;
}
// PvP: pairs of rival spawn points with a clear shot at each other (should be none)
export function openSpawnLines(grid, layout) {
  if (layout.type === 'C') return [];
  // team maps: the two teams; deathmatch: everyone; duel: the two duellists (the other two points are unused)
  const sides = layout.type === 'A' ? layout.playerSpawns : layout.playerSpawns[0].slice(0, layout.type === 'U' ? 2 : 8).map(s => [s]);
  const out = [];
  for (let i = 0; i < sides.length; i++) for (let j = i + 1; j < sides.length; j++)
    for (const a of sides[i]) for (const b of sides[j])
      if ((a.x === b.x || a.y === b.y) && !lineCovered(grid, a, b)) out.push([a, b]);
  return out;
}
// Random maps: add the cover the checks above ask for (steel in the core's column for co-op, a brick
// block between rival spawns for PvP), mirrored so the map stays fair. Cells that must stay clear are skipped.
function addCover(grid, layout) {
  const reserved = reservedMask(layout);
  const free2 = (x, y) => { for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= W || yy >= H || reserved[yy * W + xx]) return false; } return true; };
  const put = (x, y, v) => { for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) grid[(y + j) * W + x + i] = v; };
  const mirrors = (x, y) => layout.type === 'A' ? [[x, y], [W - 2 - x, y]] : [[x, y], [W - 2 - x, y], [x, H - 2 - y], [W - 2 - x, H - 2 - y]];
  if (layout.type === 'C') {
    if (coreShielded(grid, layout)) return;
    const b = layout.bases[0], top = (layout.bossSpawn ? layout.bossSpawn.y + 4 : 2);
    const rows = []; for (let y = top; y + 1 < b.y - 2; y += 2) rows.push(y);
    rows.sort((p, q) => Math.abs(p - H * 0.42) - Math.abs(q - H * 0.42));
    const y = rows.find(y => free2(b.x, y));
    if (y !== undefined) put(b.x, y, T.STEEL);
    return;
  }
  for (let guard = 0; guard < 16; guard++) {
    const open = openSpawnLines(grid, layout);
    if (!open.length) return;
    const [a, c] = open[0], horiz = a.y === c.y;
    const from = horiz ? Math.min(a.x, c.x) + 2 : Math.min(a.y, c.y) + 2, to = horiz ? Math.max(a.x, c.x) - 2 : Math.max(a.y, c.y) - 2;
    const spots = []; for (let v = from; v <= to; v += 2) spots.push(v);
    // nearest the first spawn, but not touching it: cover right in front of a spawn point
    spots.sort((p, q) => Math.abs(p - from - 2) - Math.abs(q - from - 2));
    const at = spots.find(v => (horiz ? free2(v, a.y) : free2(a.x, v)));
    if (at === undefined) return;
    for (const [x, y] of mirrors(horiz ? at : a.x, horiz ? a.y : at)) if (free2(x, y)) put(x, y, T.BRICK);
  }
}

export function checkConnectivity(grid, layout) {
  if (layout.type === 'D' || layout.type === 'U') {
    const sp = layout.playerSpawns[0], seen = reach(grid, sp[0].x, sp[0].y);
    return sp.every(p => seen[p.y * W + p.x]);
  }
  if (layout.type === 'A') {
    const s = layout.playerSpawns[0][0];
    const seen = reach(grid, s.x, s.y);
    for (const team of layout.playerSpawns) for (const p of team) if (!seen[p.y * W + p.x]) return false;
    return layout.bases.every(b => nearBase(seen, b));
  }
  const s = layout.enemySpawns[0];
  const seen = reach(grid, s.x, s.y);
  for (const e of layout.enemySpawns) if (!seen[e.y * W + e.x]) return false;
  for (const p of layout.playerSpawns[0]) if (!seen[p.y * W + p.x]) return false;
  return nearBase(seen, layout.bases[0]);
}
