// Map layouts, procedural generation, encoding
import { W, H, T, TILE_CHARS } from './const.js';

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Layout: fixed positions for bases and spawns per layout type
export function getLayout(type) {
  if (type === 'A') {
    return {
      type,
      bases: [{ x: 0, y: 13, team: 0 }, { x: 46, y: 13, team: 1 }],
      rings: [ringCells(0, 13, 0), ringCells(46, 13, 1)],
      playerSpawns: [
        [{ x: 4, y: 3, dir: 1 }, { x: 4, y: 23, dir: 1 }, { x: 4, y: 8, dir: 1 }, { x: 4, y: 18, dir: 1 }, { x: 8, y: 1, dir: 1 }, { x: 8, y: 25, dir: 1 }, { x: 8, y: 6, dir: 1 }, { x: 8, y: 20, dir: 1 }],
        [{ x: 42, y: 3, dir: 3 }, { x: 42, y: 23, dir: 3 }, { x: 42, y: 8, dir: 3 }, { x: 42, y: 18, dir: 3 }, { x: 38, y: 1, dir: 3 }, { x: 38, y: 25, dir: 3 }, { x: 38, y: 6, dir: 3 }, { x: 38, y: 20, dir: 3 }],
      ],
      enemySpawns: [],
    };
  }
  return {
    type: 'C',
    bases: [{ x: 23, y: 26, team: 0 }],
    rings: [ringCells(23, 26, -1, 2)],
    playerSpawns: [[
      { x: 17, y: 26, dir: 0 }, { x: 29, y: 26, dir: 0 }, { x: 13, y: 26, dir: 0 }, { x: 33, y: 26, dir: 0 },
      { x: 9, y: 26, dir: 0 }, { x: 37, y: 26, dir: 0 }, { x: 5, y: 26, dir: 0 }, { x: 41, y: 26, dir: 0 },
    ]],
    enemySpawns: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 23, y: 0 }, { x: 34, y: 0 }, { x: 46, y: 0 }],
    bossSpawn: { x: 22, y: 0 },
    sideSpawns: [{ x: 0, y: 10 }, { x: 46, y: 10 }],
  };
}

function ringCells(bx, by, side, th = 1) {
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

export function encodeMap(layoutType, grid) {
  let s = layoutType + '|';
  for (let i = 0; i < W * H; i++) s += TILE_CHARS[grid[i]] || '.';
  return s;
}

export function decodeMap(str) {
  const [lt, body] = String(str).split('|');
  const grid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = TILE_CHARS.indexOf(body ? body[i] : '.');
    grid[i] = v < 0 ? 0 : v;
  }
  return { layout: lt === 'A' ? 'A' : 'C', grid };
}

const STAGE_NAMES = ['Iron Gate', 'Brick Maze', 'Delta River', 'Titan\'s Den', 'Frozen Lake', 'Pine Ridge', 'Steel Canyon', 'Red Fortress',
  'Neon Harbor', 'Glass Fields', 'Night Forest', 'Storm Citadel', 'Rust Belt', 'Echo Valley', 'Last Bastion', 'Crimson Ice'];
export function stageName(n) { return STAGE_NAMES[(n - 1) % STAGE_NAMES.length]; }

// Procedural symmetric map
export function generateMap(layoutType, seed, difficulty = 1) {
  const layout = getLayout(layoutType);
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = rng(seed * 7919 + attempt * 104729 + (layoutType === 'A' ? 5 : 0));
    const grid = new Uint8Array(W * H);
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) grid[y * W + x] = v; };
    const block = (bx, by, v) => { set(bx * 2, by * 2, v); set(bx * 2 + 1, by * 2, v); set(bx * 2, by * 2 + 1, v); set(bx * 2 + 1, by * 2 + 1, v); };
    const BW = W / 4; // half-width in blocks (mirror)
    const BH = H / 2;
    const steelP = Math.min(0.12, 0.03 + difficulty * 0.012);
    const features = 16 + Math.floor(r() * 8);
    for (let f = 0; f < features; f++) {
      const kind = r();
      const bx = Math.floor(r() * BW), by = Math.floor(r() * BH);
      if (kind < 0.45) { // wall run
        const len = 2 + Math.floor(r() * 5), horiz = r() < 0.5;
        const mat = r() < steelP * 2.5 ? T.STEEL : T.BRICK;
        for (let i = 0; i < len; i++) block(horiz ? bx + i : bx, horiz ? by : by + i, (mat === T.STEEL && i % 3 !== 1) ? T.BRICK : mat);
      } else if (kind < 0.62) { // bunker rectangle
        const w = 2 + Math.floor(r() * 2), h = 2 + Math.floor(r() * 2);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) block(bx + x, by + y, T.BRICK);
        if (r() < 0.5) block(bx + Math.floor(w / 2), by + h - 1, T.EMPTY);
      } else if (kind < 0.72) { // pond
        const w = 1 + Math.floor(r() * 3), h = 1 + Math.floor(r() * 2);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) block(bx + x, by + y, T.WATER);
      } else if (kind < 0.84) { // forest
        const n = 3 + Math.floor(r() * 5);
        for (let i = 0; i < n; i++) block(bx + Math.floor(r() * 3), by + Math.floor(r() * 3), T.TREES);
      } else if (kind < 0.91) { // ice
        const w = 2 + Math.floor(r() * 3), h = 1 + Math.floor(r() * 2);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) block(bx + x, by + y, T.ICE);
      } else { // steel pillar
        block(bx, by, T.STEEL);
      }
    }
    // chip bricks for texture
    for (let i = 0; i < W * H; i++) if (grid[i] === T.BRICK && r() < 0.08) grid[i] = T.EMPTY;
    // mirror
    if (layoutType === 'A') {
      for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) grid[y * W + (W - 1 - x)] = grid[y * W + x];
    } else {
      for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) grid[y * W + (W - 1 - x)] = grid[y * W + x];
    }
    applyLayout(grid, layout);
    if (checkConnectivity(grid, layout)) return { layout: layoutType, grid };
  }
  const grid = new Uint8Array(W * H);
  applyLayout(grid, layout);
  return { layout: layoutType, grid };
}

// tank-footprint walkability (bricks are breakable, so count as walkable)
export function walkable(grid, x, y, allowBrick = true) {
  if (x < 0 || y < 0 || x > W - 2 || y > H - 2) return false;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const t = grid[(y + dy) * W + x + dx];
    if (t === T.STEEL || t === T.WATER) return false;
    if (!allowBrick && t === T.BRICK) return false;
  }
  return true;
}

function reach(grid, sx, sy) {
  const seen = new Uint8Array(W * H);
  const q = [sx, sy]; seen[sy * W + sx] = 1;
  while (q.length) {
    const y = q.pop(), x = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx]) continue;
      if (!walkable(grid, nx, ny)) continue;
      seen[ny * W + nx] = 1; q.push(nx, ny);
    }
  }
  return seen;
}

function nearBase(seen, b) {
  for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++)
    if (x >= 0 && y >= 0 && x < W && y < H && seen[y * W + x]) return true;
  return false;
}

export function checkConnectivity(grid, layout) {
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
