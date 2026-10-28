// Built-in hand-made map pack, designed phone first:
// - square fields (Small 26, Medium 30, Large 38 cells), so most of the map shows on a phone either way up;
// - drawn in 2×2 blocks (one tank), so every lane is at least a tank wide and lines up with the tanks;
// - chunky, readable shapes and a few clear routes rather than lots of small pieces.
// Each map is drawn on its left half (co-op and team maps) or top-left quarter (deathmatch and duel)
// and mirrored, so it is fair. One character = one 2×2 block:
//   .  open      b  brick     s  steel     w  water     t  trees     i  ice
//   p  boost     T  teleporter pad (pads link in mirrored pairs)     g  bridge
//   x  barrel    X  two barrels          m  mine      M  two mines
import { W, H, T, SIZES, setMapSize } from './const.js';
import { getLayout, applyLayout, encodeMap, mirrorGrid, checkConnectivity } from './levels.js';

const { BRICK: B, STEEL: S, WATER: Wt, TREES: Tr, ICE: I, BOOST: P, TELE: Tp, BRIDGE: G, BARREL: X, MINE: M, EMPTY: E } = T;
const FILL = { '.': E, b: B, s: S, w: Wt, t: Tr, i: I, p: P, T: Tp, g: G };

function paint(g, rows) {
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = v; };
  rows.forEach((row, by) => [...row].forEach((c, bx) => {
    const x = bx * 2, y = by * 2;
    if (c in FILL) { for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) set(x + i, y + j, FILL[c]); return; }
    if (c === 'x') set(x, y, X);
    else if (c === 'X') { set(x, y, X); set(x + 1, y, X); }
    else if (c === 'm') set(x, y, M);
    else if (c === 'M') { set(x, y, M); set(x + 1, y + 1, M); }
  }));
}

// layout, size, default conditions, and the design
const DEFS = [
  // ---------------- CO-OP: core at the bottom, enemies from the top ----------------
  { id: 'fortress-gate', name: 'Fortress Gate', layout: 'C', size: 'S', desc: 'A long wall with two steel-guarded gates shields the core.', rows: [
    '.......',
    '.bb.b..',
    '.bb.b..',
    '.......',
    '..t...t',
    '.bs..bb',
    '.......',
    'bbb.sbb',
    '.......',
    '.t...t.',
    '.b...b.',
    '.bb.b..',
    '.......',
  ] },
  { id: 'river-crossing', name: 'River Crossing', layout: 'C', size: 'S', desc: 'A river splits the field. Bridges collapse under fire — mind the barrels.', rows: [
    '.......',
    '..b.b..',
    '.bb.b..',
    '.......',
    '.t..x..',
    '...x...',
    'wwgwwgg',
    'wwgwwgg',
    '.......',
    '.t...t.',
    '..bb.b.',
    '.b.....',
    '.......',
  ] },
  { id: 'minefield', name: 'Minefield', layout: 'C', size: 'S', desc: 'Open ground seeded with mines between small bunkers.', rows: [
    '.......',
    '.bb..m.',
    '.b..bb.',
    'm..m...',
    '..m..m.',
    '.bb....',
    'm...bbm',
    '..m....',
    '.m..m..',
    't....m.',
    '.bb....',
    '.b.m...',
    '.......',
  ] },
  { id: 'night-raid', name: 'Night Raid', layout: 'C', size: 'M', atmo: 'night', desc: 'A brick maze under a moonless sky.', rows: [
    '........',
    '.b.bb...',
    '.b....b.',
    '.bbb.bb.',
    '........',
    '.bb.b.bb',
    '..t.b...',
    'b...bbb.',
    'b.t.....',
    'bb.bb.bb',
    '....b...',
    '.bb...bb',
    '.b..t.b.',
    '.b.x....',
    '........',
  ] },
  { id: 'frozen-lake', name: 'Frozen Lake', layout: 'C', size: 'S', desc: 'A slippery lake with brick islands and open ice holes.', rows: [
    '.......',
    '.t..b..',
    '.bb.b..',
    '....iii',
    '..iiiii',
    '.iiiiib',
    '.iwiibb',
    '.iiiiii',
    '..iiwii',
    '...iiii',
    '.b...t.',
    '.b.....',
    '.......',
  ] },
  { id: 'teleport-labs', name: 'Teleport Labs', layout: 'C', size: 'M', desc: 'Steel labs with teleporters that cross the whole map.', rows: [
    '........',
    '.sssss..',
    '.sT..s..',
    '.s...s.t',
    '.ss.ss..',
    '........',
    '...bb.b.',
    '.t....b.',
    '...bb...',
    'sss.....',
    'sT..b.b.',
    's.....b.',
    'ss.s....',
    '........',
    '........',
  ] },
  { id: 'last-stand', name: 'Last Stand', layout: 'C', size: 'S', desc: 'Brick everywhere and the enemy close. Every brick counts.', rows: [
    '.......',
    '.b.b...',
    '.b.b.b.',
    '.......',
    'bb.bbb.',
    '.......',
    '.bb.b.b',
    '.b..b..',
    '.......',
    'bb.b.bb',
    '.....b.',
    '.bb.b..',
    '.x.....',
  ] },
  { id: 'citadel', name: 'Citadel', layout: 'C', size: 'M', desc: 'Three rings of walls around the core.', rows: [
    '........',
    '.t......',
    '........',
    '.bbb.bbb',
    '.b......',
    '.b.....t',
    '.b.bb.bb',
    '.b.b....',
    '...b.s..',
    '.b.b.bb.',
    '.b...b..',
    '.b.b.b..',
    '.b.b....',
    '........',
    '........',
  ] },
  // ---------------- TEAM ARENA: a core on each side ----------------
  { id: 'twin-rivers', name: 'Twin Rivers', layout: 'A', size: 'M', desc: 'Two rivers, three bridges each. Blow them to cut off the enemy.', rows: [
    '.....w..',
    '.t...w..',
    '...b.g.x',
    '.....w..',
    '.....w.b',
    '..b..w..',
    '.....w..',
    '.....g.s',
    '.....w..',
    '..b..w..',
    '.....w.b',
    '.....w..',
    '...b.g.x',
    '.t...w..',
    '.....w..',
  ] },
  { id: 'crossfire', name: 'Crossfire', layout: 'A', size: 'M', desc: 'A speed lane cuts through the middle. Cover is scarce.', rows: [
    '........',
    '......t.',
    '....b...',
    '......b.',
    '..s.....',
    '.....b..',
    '........',
    '....pppp',
    '........',
    '.....b..',
    '..s.....',
    '......b.',
    '....b...',
    '......t.',
    '........',
  ] },
  { id: 'hedge-maze', name: 'Hedge Maze', layout: 'A', size: 'L', atmo: 'fog', desc: 'Foggy gardens: brick hedges hide who is around the corner.', rows: [
    '........b.',
    '......b.b.',
    '...bb.b...',
    '......b.tt',
    '..b.....tt',
    '..b.bbbb..',
    '......b...',
    '.bb...b.b.',
    '...b....b.',
    '...b.tt.b.',
    '...b....b.',
    '.bb...b.b.',
    '......b...',
    '..b.bbbb..',
    '..b.....tt',
    '......b.tt',
    '...bb.b...',
    '......b.b.',
    '........b.',
  ] },
  { id: 'canyon', name: 'Canyon', layout: 'A', size: 'L', desc: 'Steel canyon walls with narrow passes and explosive chokepoints.', rows: [
    '..........',
    '.t........',
    '..........',
    '...sss.sss',
    '......x...',
    '..........',
    '....b...b.',
    '....b...b.',
    '.......s..',
    '..........',
    '.......s..',
    '....b...b.',
    '....b...b.',
    '..........',
    '......x...',
    '...sss.sss',
    '..........',
    '.t........',
    '..........',
  ] },
  { id: 'mirror-keep', name: 'Mirror Keep', layout: 'A', size: 'S', desc: 'Small keeps, a steel cross in the middle. Fast and loud.', rows: [
    '..t....',
    '.......',
    '....b..',
    '..b.b..',
    '......s',
    '..b...s',
    '..b.sss',
    '..b...s',
    '......s',
    '..b.b..',
    '....b..',
    '.......',
    '..t....',
  ] },
  { id: 'portal-wars', name: 'Portal Wars', layout: 'A', size: 'M', desc: 'Teleporters beside each core jump straight to the far flank.', rows: [
    '........',
    '.T......',
    '......t.',
    '..b.....',
    '.....bbb',
    '.....b..',
    '.....b.s',
    '........',
    '.....b.s',
    '.....b..',
    '.....bbb',
    '..b.....',
    '......t.',
    '.T......',
    '........',
  ] },
  // ---------------- DEATHMATCH (drawn in the top-left quarter) ----------------
  { id: 'the-pit', name: 'The Pit', layout: 'D', size: 'M', desc: 'A moat around a central island, four bridges in.', rows: [
    '........',
    '.t....b.',
    '..s.....',
    '.b..wwwg',
    '...ww...',
    '..ww..x.',
    '..w..b..',
    '..g.....',
  ] },
  { id: 'checkerboard', name: 'Checkerboard', layout: 'D', size: 'M', desc: 'A grid of brick and steel blocks. Every corner is an ambush.', rows: [
    '........',
    '.b.s.b.s',
    '........',
    '.s.b.s.b',
    '........',
    '.b.s.b.s',
    '........',
    '.s.b.s.p',
  ] },
  { id: 'warehouse', name: 'Warehouse', layout: 'D', size: 'L', atmo: 'night', desc: 'Dark aisles of shelves stacked with explosive barrels.', rows: [
    '..........',
    '..s.....s.',
    '..........',
    '..bbbb.bbb',
    '.X........',
    '..........',
    '..bbb.bbbb',
    '.X..x...x.',
    '..........',
    '...s....tt',
  ] },
  { id: 'ring-of-fire', name: 'Ring of Fire', layout: 'D', size: 'M', zone: true, desc: 'Brick rings with breaches on the diagonals. Try it with the shrinking zone.', rows: [
    '........',
    '.s.bbbbb',
    '..b.....',
    '.b...bbb',
    '.b..b...',
    '.b.b..x.',
    '.b.b..bb',
    '.b.b..b.',
  ] },
  { id: 'speedway', name: 'Speedway', layout: 'D', size: 'L', desc: 'A boost-pad racetrack loops around the arena.', rows: [
    '..........',
    '.t........',
    '..pppppppp',
    '..p.......',
    '..p..bbbbb',
    '..p..b....',
    '..p..b..t.',
    '..p.......',
    '..p....s..',
    '..p.x.....',
  ] },
  { id: 'foggy-bog', name: 'Foggy Bog', layout: 'D', size: 'M', atmo: 'fog', desc: 'Murky pools and rickety bridges in thick fog.', rows: [
    '........',
    '..t..t..',
    '.ww.....',
    '.wg..ww.',
    '....wgw.',
    '..m.....',
    '.t...ww.',
    '...x.gw.',
  ] },
  // ---------------- DUEL (top-left quarter) ----------------
  { id: 'pillars', name: 'Pillars', layout: 'U', size: 'S', desc: 'Steel pillars and brick cover. Classic duel ground.', rows: [
    '.......',
    '.s..b..',
    '.......',
    '.b..s..',
    '.......',
    '.s..b.t',
    '.......',
  ] },
  { id: 'crossroads', name: 'Crossroads', layout: 'U', size: 'S', desc: 'Four brick blocks, a boost-pad crossroad in the middle.', rows: [
    '.......',
    '.bbb...',
    '.bsb...',
    '.bbb...',
    '......p',
    '......p',
    '....ppp',
  ] },
  { id: 'bridge-duel', name: 'Bridge Duel', layout: 'U', size: 'S', desc: 'A river down the middle with two fragile bridges.', rows: [
    '......w',
    '..t...w',
    '....x.g',
    '..b...w',
    '......w',
    '.b..s.w',
    '......w',
  ] },
  { id: 'mirror-maze', name: 'Mirror Maze', layout: 'U', size: 'M', desc: 'Brick corridors with teleporters in the corners.', rows: [
    'T.......',
    '........',
    '..bbbbb.',
    '..b.....',
    '..b..bbb',
    '.....b..',
    '.bb..b..',
    '........',
  ] },
];

function buildMap(def) {
  setMapSize(...SIZES[def.size]);
  const g = new Uint8Array(W * H);
  paint(g, def.rows);
  mirrorGrid(g, def.layout === 'D' || def.layout === 'U');
  applyLayout(g, getLayout(def.layout));
  return g;
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
