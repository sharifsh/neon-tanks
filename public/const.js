// Shared constants for Neon Tanks
// Map size is live: every module reads the current W/H (ES module live bindings).
export let W = 48;             // map width in cells (a tank is 2x2 cells)
export let H = 28;             // map height in cells
export const SIZES = { S: [32, 20], M: [48, 28], L: [64, 36] };
export const SIZE_NAMES = { S: 'Small', M: 'Medium', L: 'Large' };
export function setMapSize(w, h) { W = w; H = h; }
export function sizeKey(w, h) { for (const k in SIZES) if (SIZES[k][0] === w && SIZES[k][1] === h) return k; return 'M'; }
export const TICK = 1 / 60;    // simulation step (seconds)
export const MAX_PLAYERS = 8;

export const T = { EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, TREES: 4, ICE: 5, BOOST: 6, TELE: 7, BRIDGE: 8, BARREL: 9, MINE: 10 };
export const TILE_CHARS = '.bswtiPTGXM';
export const SPECIAL_TILES = [6, 7, 8, 9, 10];

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up right down left

export const PLAYER_COLORS = ['#ffd23f', '#3dff8b', '#3de0ff', '#ff4fd8', '#ff9b3d', '#a98bff', '#c6ff3d', '#ff6b8b'];
export const TEAM_COLORS = [
  ['#3de0ff', '#5b8cff', '#3dffd0', '#8fd3ff', '#3d9bff', '#7af5ff', '#4dc6c6', '#9aa9ff'],
  ['#ff4d5e', '#ff9b3d', '#ff4fd8', '#ffcf3d', '#ff7a7a', '#ff6b3d', '#e05cff', '#ffb38a'],
];
export const TEAM_NAMES = ['Cyan', 'Crimson'];
export const TEAM_MAIN = ['#3de0ff', '#ff4d5e'];

export const CLASSES = {
  striker: { name: 'Striker', speed: 5.2, hp: 1, bullet: 13, desc: 'Balanced all-rounder. Ability: triple spread shot.', ability: 'Spread Shot', cd: 5 },
  scout: { name: 'Scout', speed: 6.6, hp: 1, bullet: 14, desc: 'Fastest tank. Ability: nitro dash.', ability: 'Nitro Dash', cd: 6 },
  heavy: { name: 'Heavy', speed: 4.0, hp: 3, bullet: 11, desc: 'Takes 3 hits, shells punch deeper. Ability: energy shield.', ability: 'Shield', cd: 12 },
  engineer: { name: 'Engineer', speed: 5.0, hp: 1, bullet: 12, desc: 'Builds walls, longer base fortify. Ability: build wall.', ability: 'Build Wall', cd: 2.5 },
};
export const CLASS_KEYS = Object.keys(CLASSES);

export const ENEMY_TYPES = {
  basic: { speed: 3.0, bullet: 10, hp: 1, score: 100, color: '#ff4d4d' },
  fast: { speed: 6.2, bullet: 10, hp: 1, score: 200, color: '#ff2e88' },
  power: { speed: 4.0, bullet: 17, hp: 1, score: 300, color: '#ff8c42' },
  armor: { speed: 3.0, bullet: 12, hp: 4, score: 400, color: '#d7dde8' },
  boss: { speed: 2.2, bullet: 11, hp: 30, score: 5000, color: '#ff2a2a' },
  bot: { speed: 5.0, bullet: 12, hp: 1, score: 100, color: '#aaa' },
};

export const POWERUPS = ['star', 'helmet', 'grenade', 'shovel', 'clock', 'tank'];

export const MODES = {
  classic: { name: 'Classic', layout: 'C', desc: 'Defend the core through endless stages. Titan boss every 4th stage.' },
  survival: { name: 'Survival', layout: 'C', desc: 'Endless escalating waves on one map. How long can you hold?' },
  battle: { name: 'Team Battle', layout: 'A', desc: 'Two teams. Destroy the enemy core or reach the kill target.' },
  ctf: { name: 'Capture the Flag', layout: 'A', desc: 'Steal the enemy flag and bring it home. 3 captures wins.' },
  deathmatch: { name: 'Deathmatch', layout: 'D', desc: 'Every tank for itself. First to 15 kills or top score after 5 minutes.' },
  duel: { name: 'Duel', layout: 'U', desc: '1v1 in a tight arena, best of 5 rounds, one life each. Extra players watch.' },
};
for (const k of ['battle', 'ctf', 'deathmatch', 'duel']) MODES[k].pvp = true;
for (const k of ['deathmatch', 'duel']) MODES[k].ffa = true;
export const BOT_COLORS = ['#c0c7d1', '#b58cff', '#8fd3ff', '#ffb38a', '#9dffc9', '#ff9ec7', '#e6e68a'];

export const DIFFICULTIES = {
  easy: { name: 'Easy', lives: 5, count: 0.7, speed: 0.85, fire: 0.55, bullet: 0.85, alive: -1, boss: 0.65, events: 1.4, desc: '5 lives, fewer & slower enemies' },
  normal: { name: 'Normal', lives: 3, count: 1, speed: 1, fire: 1, bullet: 1, alive: 0, boss: 1, events: 1, desc: 'The classic balance' },
  hard: { name: 'Hard', lives: 2, count: 1.25, speed: 1.1, fire: 1.4, bullet: 1.1, alive: 2, boss: 1.3, events: 0.8, desc: '2 lives, aggressive enemies' },
  insane: { name: 'Insane', lives: 1, count: 1.6, speed: 1.2, fire: 1.9, bullet: 1.25, alive: 4, boss: 1.7, events: 0.6, desc: '1 life. Good luck.' },
};
