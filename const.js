// Shared constants for Neon Tanks
export const W = 48;           // map width in cells (a tank is 2x2 cells)
export const H = 28;           // map height in cells
export const TICK = 1 / 60;    // simulation step (seconds)
export const MAX_PLAYERS = 8;

export const T = { EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, TREES: 4, ICE: 5 };
export const TILE_CHARS = '.bswti';

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
};
