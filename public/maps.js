// Built-in hand-crafted map pack. Each map is designed on one half (or quarter) and mirrored so it is fair.
import { W, H, T, SIZES, setMapSize } from './const.js';
import { getLayout, applyLayout, encodeMap, mirrorGrid, checkConnectivity } from './levels.js';

const { BRICK: B, STEEL: S, WATER: Wt, TREES: Tr, ICE: I, BOOST: P, TELE: Tp, BRIDGE: G, BARREL: X, MINE: M, EMPTY: E } = T;

function builder() {
  const g = new Uint8Array(W * H);
  let b;
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = v; return b; };
  b = {
    g, set,
    get: (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : g[y * W + x],
    fill(x, y, w, h, v) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, v); return b; },
    box(x, y, w, h, v, t = 1) { b.fill(x, y, w, t, v); b.fill(x, y + h - t, w, t, v); b.fill(x, y, t, h, v); b.fill(x + w - t, y, t, h, v); return b; },
    hl(x, y, len, v, t = 2) { return b.fill(x, y, len, t, v); },
    vl(x, y, len, v, t = 2) { return b.fill(x, y, t, len, v); },
    blk(x, y, v) { return b.fill(x, y, 2, 2, v); },
    disc(cx, cy, r0, r1, v, q = null) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d >= r0 && d < r1 && (!q || q(x, y))) set(x, y, v); } return b; },
    replace(from, to, x0 = 0, y0 = 0, x1 = W, y1 = H) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g[y * W + x] === from) g[y * W + x] = to; return b; },
    each(fn) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fn(x, y); return b; },
  };
  return b;
}

// layout, size, default conditions, and the design
const DEFS = [
  // ---------------- CO-OP ----------------
  { id: 'fortress-gate', name: 'Fortress Gate', layout: 'C', size: 'M', desc: 'Twin walls with steel gatehouses guard the core.', build(b) {
    b.hl(3, 17, 19, B).blk(11, 17, S).fill(15, 17, 2, 2, E);
    b.vl(17, 20, 6, B);
    b.box(5, 5, 7, 6, B).fill(8, 10, 2, 1, E).blk(7, 7, S);
    b.fill(1, 9, 3, 4, Tr).blk(13, 2, S).fill(20, 7, 4, 7, B).fill(22, 9, 2, 2, S);
    b.fill(1, 22, 5, 2, Tr);
  } },
  { id: 'river-crossing', name: 'River Crossing', layout: 'C', size: 'M', desc: 'A river splits the field. Bridges collapse under fire — mind the barrels.', build(b) {
    b.fill(0, 12, 24, 3, Wt).fill(6, 12, 2, 3, G).fill(16, 12, 2, 3, G);
    b.set(4, 10, X).set(9, 10, X).set(15, 16, X).set(18, 16, X);
    b.fill(0, 7, 5, 2, Tr).fill(10, 4, 4, 4, B).blk(11, 5, S).hl(19, 7, 5, B);
    b.box(8, 18, 6, 4, B).fill(10, 21, 2, 1, E).fill(1, 18, 4, 3, Tr);
  } },
  { id: 'minefield', name: 'Minefield', layout: 'C', size: 'M', desc: 'Open ground seeded with mines between small bunkers.', build(b) {
    for (let r = 0, y = 7; y <= 19; y += 3, r++) for (let x = 2 + (r % 2) * 3; x < 23; x += 5) b.set(x, y, M);
    b.box(3, 3, 5, 4, B).fill(5, 6, 1, 1, E).box(13, 9, 5, 4, B).fill(15, 9, 1, 1, E).box(6, 15, 5, 4, B).fill(8, 15, 1, 1, E);
    b.blk(20, 4, S).fill(18, 20, 4, 2, Tr).fill(0, 11, 2, 4, Tr);
  } },
  { id: 'night-raid', name: 'Night Raid', layout: 'C', size: 'L', atmo: 'night', desc: 'A sprawling brick maze under a moonless sky.', build(b) {
    for (const y of [6, 13, 20, 27]) b.hl(2, y, 28, B);
    b.fill(8, 6, 3, 2, E).fill(20, 13, 3, 2, E).fill(5, 20, 3, 2, E).fill(14, 27, 3, 2, E).fill(26, 6, 4, 2, E).fill(28, 20, 4, 2, E);
    for (const [x, y, l] of [[12, 8, 5], [24, 15, 5], [6, 22, 5], [18, 1, 5], [30, 8, 5], [16, 29, 4]]) b.vl(x, y, l, B);
    b.fill(1, 9, 4, 3, Tr).fill(26, 23, 5, 3, Tr).fill(14, 16, 4, 3, Tr).blk(22, 9, S).blk(4, 16, S);
    b.set(10, 24, X).set(11, 24, X).set(27, 17, X);
  } },
  { id: 'frozen-lake', name: 'Frozen Lake', layout: 'C', size: 'M', desc: 'A slippery lake with brick islands and open ice holes.', build(b) {
    b.disc(24, 13.5, 0, 12.5, I, (x, y) => y > 4 && y < 22);
    b.box(9, 9, 4, 4, B).box(17, 6, 4, 3, B).blk(19, 15, Wt).blk(6, 16, Wt).blk(14, 13, Wt);
    b.fill(0, 3, 4, 3, Tr).fill(0, 20, 5, 3, Tr).blk(22, 3, S).hl(4, 22, 6, B);
  } },
  { id: 'teleport-labs', name: 'Teleport Labs', layout: 'C', size: 'M', desc: 'Steel labs with teleporters that cross the whole map.', build(b) {
    b.box(1, 4, 9, 18, S).fill(1, 9, 1, 8, E).fill(9, 7, 1, 4, E).fill(9, 15, 1, 4, E).fill(4, 4, 3, 1, E).fill(4, 21, 3, 1, E);
    b.blk(3, 6, Tp).blk(3, 18, Tp);
    b.hl(13, 8, 8, B).hl(13, 16, 8, B).blk(16, 12, S).fill(20, 20, 4, 2, B);
    b.fill(12, 2, 3, 2, Tr).fill(11, 22, 3, 2, Tr);
  } },
  { id: 'last-stand', name: 'Last Stand', layout: 'C', size: 'S', desc: 'Tiny and brutal. Every brick counts.', build(b) {
    b.hl(2, 12, 11, B).fill(6, 12, 2, 2, E).blk(9, 9, S).fill(3, 5, 4, 4, B).fill(4, 6, 2, 2, E);
    b.set(12, 8, X).set(13, 8, X).set(12, 9, X).fill(0, 9, 2, 2, Tr).fill(13, 3, 3, 2, Tr);
  } },
  { id: 'citadel', name: 'Citadel', layout: 'C', size: 'L', desc: 'Three rings of walls around the core on a huge map.', build(b) {
    b.box(8, 19, 24, 17, B, 2).fill(20, 19, 4, 2, E).fill(8, 25, 2, 4, E);
    b.box(2, 10, 30, 26, B, 1).fill(14, 10, 3, 1, E).fill(2, 18, 1, 4, E).fill(26, 10, 4, 1, E);
    b.blk(12, 6, S).blk(24, 3, S).fill(4, 2, 5, 4, Tr).fill(18, 13, 4, 3, Tr).set(6, 14, X).set(7, 14, X).set(28, 15, X);
    b.fill(27, 22, 3, 3, P);
  } },
  // ---------------- TEAM ARENA ----------------
  { id: 'twin-rivers', name: 'Twin Rivers', layout: 'A', size: 'M', desc: 'Two rivers, three bridges each. Blow them to cut off the enemy.', build(b) {
    b.vl(14, 0, 28, Wt, 3).fill(14, 3, 3, 2, G).fill(14, 13, 3, 2, G).fill(14, 23, 3, 2, G);
    b.set(13, 2, X).set(13, 26, X).set(18, 12, X).set(18, 15, X);
    b.fill(19, 5, 5, 2, B).fill(19, 21, 5, 2, B).blk(22, 13, S).fill(8, 11, 3, 6, Tr);
  } },
  { id: 'crossfire', name: 'Crossfire', layout: 'A', size: 'M', desc: 'A speed lane cuts through the middle. Cover is scarce.', build(b) {
    b.hl(12, 13, 12, P).blk(22, 5, S).blk(22, 21, S);
    for (const [x, y] of [[14, 4], [18, 9], [14, 18], [18, 22], [11, 9], [11, 17]]) b.blk(x, y, B);
    b.fill(6, 0, 4, 2, Tr).fill(6, 26, 4, 2, Tr);
  } },
  { id: 'hedge-maze', name: 'Hedge Maze', layout: 'A', size: 'L', atmo: 'fog', desc: 'Foggy gardens: brick hedges hide who is around the corner.', build(b) {
    for (const [x, y, l] of [[12, 2, 9], [12, 25, 9], [18, 8, 8], [18, 20, 8], [25, 13, 10], [30, 3, 7], [30, 26, 7]]) b.vl(x, y, l, B);
    for (const [x, y, l] of [[12, 12, 7], [12, 22, 7], [20, 4, 9], [20, 30, 9]]) b.hl(x, y, l, B);
    b.fill(14, 14, 4, 8, Tr).fill(22, 16, 3, 4, Tr).fill(26, 0, 4, 3, Tr).fill(26, 33, 4, 3, Tr);
  } },
  { id: 'canyon', name: 'Canyon', layout: 'A', size: 'L', desc: 'Steel canyon walls with narrow passes and explosive chokepoints.', build(b) {
    b.hl(10, 8, 22, S).hl(10, 26, 22, S).fill(18, 8, 3, 2, E).fill(26, 26, 3, 2, E).fill(28, 8, 4, 2, E).fill(14, 26, 3, 2, E);
    b.set(17, 7, X).set(21, 7, X).set(25, 28, X).set(29, 28, X);
    b.fill(14, 15, 3, 6, B).fill(24, 13, 2, 10, B).blk(30, 17, S).fill(8, 2, 4, 3, Tr).fill(8, 31, 4, 3, Tr);
  } },
  { id: 'mirror-keep', name: 'Mirror Keep', layout: 'A', size: 'S', desc: 'Small keeps, a steel cross in the middle. Fast and loud.', build(b) {
    b.box(3, 5, 6, 10, B).fill(3, 9, 1, 2, E).fill(8, 7, 1, 6, E);
    b.vl(15, 4, 4, S).vl(15, 12, 4, S).hl(12, 9, 4, S).fill(11, 1, 3, 2, Tr).fill(11, 17, 3, 2, Tr);
  } },
  { id: 'portal-wars', name: 'Portal Wars', layout: 'A', size: 'M', desc: 'Teleporters beside each base jump straight to the far flank.', build(b) {
    b.blk(10, 2, Tp).blk(10, 24, Tp);
    b.box(14, 6, 8, 16, B).fill(14, 12, 1, 4, E).fill(21, 9, 1, 3, E).fill(21, 16, 1, 3, E).blk(17, 13, S);
    b.fill(2, 0, 3, 2, Tr).fill(2, 26, 3, 2, Tr).hl(22, 1, 2, B).hl(22, 25, 2, B);
  } },
  // ---------------- DEATHMATCH (designed in the top-left quarter) ----------------
  { id: 'the-pit', name: 'The Pit', layout: 'D', size: 'M', desc: 'A moat around a central island, four bridges in.', build(b) {
    b.disc(24, 14, 6, 8.5, Wt).each((x, y) => { if ((x === 22 || x === 23 || y === 12 || y === 13) && b.get(x, y) === Wt) b.set(x, y, G); });
    b.set(20, 11, X).blk(4, 5, S).fill(8, 2, 5, 2, B).fill(2, 8, 2, 4, B).fill(10, 8, 3, 3, Tr).hl(14, 4, 4, P);
  } },
  { id: 'checkerboard', name: 'Checkerboard', layout: 'D', size: 'M', desc: 'A grid of brick blocks. Every corner is an ambush.', build(b) {
    for (let y = 4; y < 14; y += 4) for (let x = 4; x < 24; x += 4) b.blk(x, y, ((x + y) / 4) % 2 ? B : S);
    b.fill(0, 5, 2, 2, P).fill(12, 0, 2, 2, Tr);
  } },
  { id: 'warehouse', name: 'Warehouse', layout: 'D', size: 'L', atmo: 'night', desc: 'Dark aisles of shelves stacked with explosive barrels.', build(b) {
    for (const y of [6, 12]) { b.hl(6, y, 20, B, 2); b.set(5, y, X).set(5, y + 1, X).set(26, y, X).set(26, y + 1, X); }
    b.blk(10, 2, S).blk(22, 2, S).blk(30, 8, S).blk(16, 15, S).fill(0, 15, 4, 2, Tr);
    for (let x = 8; x < 26; x += 6) b.set(x, 9, X);
  } },
  { id: 'ring-of-fire', name: 'Ring of Fire', layout: 'D', size: 'M', desc: 'Concentric brick rings with diagonal breaches. Try it with the shrinking zone.', zone: true, build(b) {
    b.disc(24, 14, 4, 5, B).disc(24, 14, 9, 10, B).disc(24, 14, 14, 15, B);
    b.each((x, y) => { const dx = x + 0.5 - 24, dy = y + 0.5 - 14; if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 1.2) b.set(x, y, b.get(x, y) === B ? E : b.get(x, y)); });
    b.set(15, 13, X).set(24, 6, X).blk(2, 2, S);
  } },
  { id: 'speedway', name: 'Speedway', layout: 'D', size: 'L', desc: 'A boost-pad racetrack loops around the arena.', build(b) {
    b.box(6, 5, 52, 26, P, 2);
    b.fill(12, 11, 20, 2, B).fill(16, 13, 4, 5, Tr).blk(26, 14, S).fill(2, 2, 3, 2, Tr).set(9, 9, X).set(10, 9, X);
  } },
  { id: 'foggy-bog', name: 'Foggy Bog', layout: 'D', size: 'M', atmo: 'fog', desc: 'Murky pools and rickety bridges in thick fog.', build(b) {
    b.fill(6, 4, 6, 4, Wt).fill(8, 4, 2, 4, G).fill(16, 8, 5, 3, Wt).fill(16, 9, 5, 1, G).fill(2, 10, 3, 3, Wt);
    b.fill(12, 1, 4, 3, Tr).fill(20, 3, 4, 3, Tr).fill(4, 0, 2, 2, E).set(13, 11, M).set(22, 12, M).set(6, 12, X);
  } },
  // ---------------- DUEL ----------------
  { id: 'pillars', name: 'Pillars', layout: 'U', size: 'S', desc: 'Steel pillars and brick cover. Classic duel ground.', build(b) {
    for (let y = 3; y < 10; y += 5) for (let x = 4; x < 16; x += 5) b.blk(x, y, (x + y) % 2 ? S : B);
    b.fill(12, 7, 2, 2, E).fill(0, 3, 2, 2, Tr);
  } },
  { id: 'crossroads', name: 'Crossroads', layout: 'U', size: 'S', desc: 'Four brick blocks, a boost pad crossroad in the middle.', build(b) {
    b.fill(3, 3, 8, 4, B).fill(5, 4, 3, 2, S).hl(12, 9, 4, P).vl(15, 4, 5, P).fill(0, 0, 2, 2, E);
  } },
  { id: 'bridge-duel', name: 'Bridge Duel', layout: 'U', size: 'M', desc: 'A river down the middle with two fragile bridges.', build(b) {
    b.fill(22, 4, 2, 10, Wt).fill(22, 7, 2, 3, G).set(20, 4, X).set(20, 8, X).fill(10, 4, 5, 2, B).blk(14, 10, S).fill(4, 8, 3, 3, Tr);
  } },
  { id: 'mirror-maze', name: 'Mirror Maze', layout: 'U', size: 'M', desc: 'Tight brick corridors with teleporters in the corners.', build(b) {
    b.hl(4, 4, 14, B).vl(10, 6, 6, B).hl(14, 9, 8, B).vl(20, 1, 6, B).blk(1, 1, Tp).fill(6, 8, 2, 2, S);
  } },
];

function buildMap(def) {
  setMapSize(...SIZES[def.size]);
  const b = builder();
  def.build(b);
  mirrorGrid(b.g, def.layout === 'D' || def.layout === 'U');
  applyLayout(b.g, getLayout(def.layout));
  return b.g;
}

let cache = null;
export function builtinMaps() {
  if (cache) return cache;
  const prevW = W, prevH = H;
  cache = DEFS.map(d => {
    const grid = buildMap(d);
    const ok = checkConnectivity(grid, getLayout(d.layout));
    return { id: 'b:' + d.id, name: d.name, desc: d.desc, layout: d.layout, size: d.size, atmo: d.atmo || 'clear', zone: !!d.zone, data: encodeMap(d.layout, grid), valid: ok, builtin: true };
  });
  setMapSize(prevW, prevH);
  return cache;
}
