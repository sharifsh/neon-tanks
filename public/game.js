// Authoritative game simulation (runs on the host only)
import { W, H, T, DIRS, SIZES, setMapSize, TICK, CLASSES, ENEMY_TYPES, POWERUPS, PLAYER_COLORS, TEAM_COLORS, MODES, DIFFICULTIES, BOT_COLORS } from './const.js';
import { getLayout, generateMap, decodeMap, mapDims, rng, stageName, walkable, applyLayout, teleportPads } from './levels.js';

const EPS = 0.001;
const r2 = v => Math.round(v * 100) / 100;

export class Game {
  constructor(cfg) {
    this.cfg = cfg;               // {mode, customMap, customName, seed, bots}
    this.mode = cfg.mode;
    // map size: a chosen map dictates it, otherwise S/M/L or auto by mode & player count
    let dims = SIZES[cfg.size];
    if (cfg.customMap) dims = mapDims(cfg.customMap);
    if (!dims) { const n = (cfg.players || []).length; dims = this.mode === 'duel' ? SIZES.S : (n > 4 && MODES[this.mode].pvp) ? SIZES.L : SIZES.M; }
    [this.mapW, this.mapH] = dims; setMapSize(this.mapW, this.mapH);
    this.atmo = ['night', 'fog'].includes(cfg.atmo) ? cfg.atmo : 'clear';
    this.zoneOn = !!cfg.zone && this.mode === 'deathmatch';
    this.pendingBarrels = [];
    this.ffa = !!MODES[this.mode].ffa;
    this.pvp = !!MODES[this.mode].pvp;
    this.layoutType = MODES[this.mode].layout;
    this.layout = getLayout(this.layoutType);
    this.bounds = this.layout.bounds || null;
    this.freezeAllBut = null;
    this.seed = cfg.seed || (Math.random() * 1e9) | 0;
    this.rs = (this.seed >>> 0) || 1;
    this.difficulty = DIFFICULTIES[cfg.difficulty] ? cfg.difficulty : 'normal';
    this.diff = DIFFICULTIES[this.difficulty];
    this.time = 0; this.tick = 0; this.nextId = 1;
    this.players = new Map();     // id -> player record
    this.inputs = new Map();
    this.tanks = []; this.bullets = []; this.powerups = []; this.airstrikes = [];
    this.events = [];
    this.fields = new Map();
    this.gridRev = 0; this.gridChangedAt = 0; this.hitTeam = -1;
    this.status = 'play'; this.statusAt = 0;
    this.banner = null;
    this.stage = 0; this.wave = 0;
    this.teamScore = [0, 0];
    this.teamFreeze = [0, 0];
    this.freezeUntil = 0;
    this.shovel = [0, 0];
    this.winner = -1;
    if (this.pvp) {
      this.timeLimit = { ctf: 8 * 60, battle: 6 * 60, deathmatch: 5 * 60, duel: 1e9 }[this.mode];
      this.target = { ctf: 3, battle: 20, deathmatch: 15, duel: 3 }[this.mode];
    }
    for (const p of cfg.players || []) this.addPlayer(p);
    this.loadStage(1, true);
  }

  // ---------- helpers ----------
  rand() { // serializable mulberry32
    let a = (this.rs = (this.rs + 0x6D2B79F5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  id() { return this.nextId++; }
  emit(e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  setBanner(text, sub = '', dur = 3) { this.banner = { text, sub, until: this.time + dur }; }
  outside(x, y) { const b = this.bounds; return b && (x < b.x0 || y < b.y0 || x >= b.x1 || y >= b.y1); }
  inArena(x, y) { const b = this.bounds; return !b || (x >= b.x0 && y >= b.y0 && x + 2 <= b.x1 && y + 2 <= b.y1); }
  teamFrozen(team) { const f = this.freezeAllBut; return this.time < (this.teamFreeze[team] || 0) || (!!f && this.time < f[1] && team !== f[0]); }
  t(x, y) { return (x < 0 || y < 0 || x >= W || y >= H || this.outside(x, y)) ? T.STEEL : this.grid[y * W + x]; }
  setTile(x, y, v) {
    if (x < 0 || y < 0 || x >= W || y >= H || this.outside(x, y)) return;
    if (this.grid[y * W + x] === v) return;
    this.grid[y * W + x] = v; this.gridRev++; this.gridChangedAt = this.time;
  }
  get humanCount() { return Math.max(1, this.players.size); }
  center(t) { return [t.x + t.size / 2, t.y + t.size / 2]; }

  // ---------- stage management ----------
  loadStage(n, first = false) {
    this.stage = n;
    setMapSize(this.mapW, this.mapH); this.layout = getLayout(this.layoutType);
    let map;
    if (n === 1 && this.cfg.customMap) {
      map = decodeMap(this.cfg.customMap);
      if (map.layout !== this.layoutType || map.w !== this.mapW) map = generateMap(this.layoutType, this.seed + n, n);
      applyLayout(map.grid, this.layout);
      this.stageTitle = this.cfg.customName || 'Custom Map';
    } else {
      map = generateMap(this.layoutType, this.seed + n * 31, this.mode === 'survival' ? 3 : n);
      this.stageTitle = stageName(n);
    }
    this.grid = map.grid; this.gridRev++; this.gridChangedAt = this.time; this.tele = null; this.pendingBarrels = [];
    this.bullets = []; this.powerups = []; this.airstrikes = [];
    if (this.zoneOn) { const R = Math.hypot(W, H) / 2 + 1; this.zone = { cx: W / 2, cy: H / 2, r0: R, r1: Math.max(4, Math.min(W, H) * 0.18), start: this.time + 45, end: this.time + 195, warned: false }; }
    this.tanks = this.tanks.filter(t => t.kind === 'player');
    this.bases = this.layout.bases.map(b => ({ ...b, alive: true, hp: this.mode === 'battle' ? 10 : 1, maxHp: this.mode === 'battle' ? 10 : 1 }));
    this.shovel = [0, 0]; this.freezeUntil = 0;
    this.status = 'play';
    this.nextEventAt = this.time + 30 + this.rand() * 15;
    this.powerTimer = this.time + 10;
    if (this.mode === 'ctf') this.flags = this.bases.map(b => ({ team: b.team, x: b.x + 1, y: b.y + 1, carrier: 0, home: true, droppedAt: 0 }));
    else this.flags = [];
    // carry surviving players into the new stage without costing a life
    const hadTank = new Set([...this.players.values()].filter(p => p.tankId).map(p => p.id));
    this.tanks = [];
    for (const p of this.players.values()) {
      if (this.mode === 'classic' && !first && p.lives <= 0 && !p.tankId) p.lives = 1;
      p.tankId = 0; p.respawnAt = 0;
      if (hadTank.has(p.id)) this.spawnPlayerTank(p);
    }
    if (this.mode === 'classic') this.setupClassicStage(n);
    else if (this.mode === 'survival') { this.wave = 0; this.queue = []; this.nextWaveAt = this.time + 3; this.setBanner('SURVIVAL', 'Hold the core', 3); }
    else if (this.mode === 'deathmatch') { this.startAt = this.time; this.setBanner('DEATHMATCH', `Every tank for itself · first to ${this.target} kills`, 4); this.setupBots(); }
    else if (this.mode === 'duel') { this.startAt = this.time; this.setupBots(); this.duelWins = {}; this.duelRound = 0; this.duelState = 'break'; this.duelNext = this.time + 3; this.setBanner('DUEL', 'Best of 5 rounds · one life each', 3); }
    else { this.startAt = this.time; this.setBanner(this.mode === 'ctf' ? 'CAPTURE THE FLAG' : 'TEAM BATTLE', this.mode === 'ctf' ? `First to ${this.target} captures` : `Destroy the enemy core or reach ${this.target} kills`, 4); this.setupBots(); }
    this.emit({ k: 'sfx', n: 'stage' });
  }

  setupClassicStage(n) {
    const r = rng(this.seed + n * 101);
    const total = Math.max(6, Math.round((16 + 4 * this.humanCount) * this.diff.count));
    this.queue = this.buildQueue(total, n, r);
    this.stageTotal = total; this.killed = 0;
    this.bossStage = n % 4 === 0; this.bossSpawned = false; this.bossAlive = false;
    this.spawnTimer = this.time + 1.5; this.spawnIdx = 0;
    this.setBanner(`STAGE ${n}`, this.stageTitle + (this.bossStage ? ' · TITAN STAGE' : ''), 3);
  }

  buildQueue(total, d, r) {
    const w = { basic: Math.max(1.5, 10 - d), fast: 2 + d * 0.8, power: 1 + d * 0.7, armor: Math.max(0, (d - 1) * 0.7) };
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    const q = [];
    for (let i = 0; i < total; i++) {
      let x = r() * sum, type = 'basic';
      for (const k in w) { x -= w[k]; if (x <= 0) { type = k; break; } }
      q.push({ type, bonus: i % 5 === 3 });
    }
    return q;
  }

  startWave() {
    this.wave++;
    const r = rng(this.seed + this.wave * 977);
    const count = Math.max(4, Math.round((6 + this.wave * 3 + 2 * this.humanCount) * this.diff.count));
    this.queue = this.buildQueue(count, 1 + this.wave * 0.8, r);
    this.stageTotal = count; this.killed = 0;
    this.bossStage = this.wave % 5 === 0; this.bossSpawned = false; this.bossAlive = false;
    this.spawnTimer = this.time + 1; this.spawnIdx = 0;
    this.nextWaveAt = 0;
    // repair core ring
    for (const [x, y] of this.layout.rings[0]) if (this.t(x, y) !== T.STEEL) this.setTile(x, y, T.BRICK);
    if (this.wave % 3 === 0) for (const p of this.players.values()) p.lives++;
    this.setBanner(`WAVE ${this.wave}`, this.bossStage ? 'TITAN INCOMING' : (this.wave % 3 === 0 ? '+1 life for everyone' : `${count} enemies`), 3);
  }

  // ---------- players ----------
  addPlayer({ id, name, cls }) {
    if (this.players.has(id)) return;
    const used = new Set([...this.players.values()].map(p => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    let team = 0;
    if (this.ffa) team = 10 + slot;
    else if (this.pvp) {
      const c = [0, 0]; for (const p of this.players.values()) c[p.team]++;
      team = c[0] <= c[1] ? 0 : 1;
    }
    const teamIdx = [...this.players.values()].filter(p => p.team === team).length;
    const p = {
      id, name: String(name || 'Player').slice(0, 16), cls: CLASSES[cls] ? cls : 'striker', slot, team,
      color: this.pvp && !this.ffa ? TEAM_COLORS[team][teamIdx % 8] : PLAYER_COLORS[slot % 8],
      lives: this.diff.lives, score: 0, kills: 0, deaths: 0, power: 0, tankId: 0, respawnAt: this.time + 0.3,
      abilityAt: 0, prevA: false, spawnSlot: teamIdx,
    };
    this.players.set(id, p);
    this.inputs.set(id, { d: -1, f: false, a: false });
    if (this.pvp) this.setupBots();
  }

  removePlayer(id) {
    const p = this.players.get(id); if (!p) return;
    const t = this.tankById(p.tankId); if (t) this.killTank(t, null, true);
    this.players.delete(id); this.inputs.delete(id);
    if (this.pvp) this.setupBots();
    if (this.mode === 'duel' && this.status === 'play') { this.tanks = []; this.bullets = []; this.duelState = 'break'; this.duelNext = this.time + 2.5; }
  }

  setClass(id, cls) { const p = this.players.get(id); if (p && CLASSES[cls]) p.cls = cls; }
  setInput(id, inp) { if (this.inputs.has(id)) this.inputs.set(id, { d: inp.d | 0, f: !!inp.f, a: !!inp.a }); }

  setupBots() {
    if (this.ffa) {
      this.tanks = this.tanks.filter(t => t.kind !== 'bot');
      const n = this.players.size;
      const need = this.mode === 'duel' ? Math.max(0, 2 - n) : (this.cfg.bots ? Math.max(0, 4 - n) : (n < 2 ? 1 : 0));
      const old = this.botSlots || [];
      this.botSlots = [];
      for (let i = 0; i < need; i++) {
        const o = old[i] || {};
        this.botSlots.push({ team: 100 + i, idx: i, bid: 'bot' + i, name: 'Bot ' + (i + 1), color: BOT_COLORS[i % BOT_COLORS.length], kills: o.kills || 0, deaths: o.deaths || 0, score: o.score || 0, respawnAt: this.time + 1 + i * 0.3, tankId: 0 });
      }
      return;
    }
    if (!this.cfg.bots) { this.tanks = this.tanks.filter(t => t.kind !== 'bot'); return; }
    const need = [0, 0];
    const counts = [0, 0]; for (const p of this.players.values()) counts[p.team]++;
    const per = Math.max(3, Math.max(counts[0], counts[1]));
    need[0] = per - counts[0]; need[1] = per - counts[1];
    this.botSlots = [];
    for (let team = 0; team < 2; team++) for (let i = 0; i < need[team]; i++) this.botSlots.push({ team, idx: counts[team] + i, respawnAt: this.time + 1 + i * 0.3, tankId: 0 });
    this.tanks = this.tanks.filter(t => t.kind !== 'bot');
  }

  tankById(id) { return id ? this.tanks.find(t => t.id === id) : null; }

  // free-for-all: spawn where nobody else is
  pickSpawn() {
    const sp = this.layout.playerSpawns[0];
    let best = sp[0], bd = -1;
    for (const s of sp) {
      let d = 99;
      for (const o of this.tanks) { if (o.dead) continue; d = Math.min(d, Math.abs(o.x - s.x) + Math.abs(o.y - s.y)); }
      d += this.rand() * 4;
      if (d > bd) { bd = d; best = s; }
    }
    return best;
  }
  duelists() {
    const ps = [...this.players.values()].sort((a, b) => a.slot - b.slot).slice(0, 2).map(p => ({ id: p.id, name: p.name, color: p.color, p }));
    for (const b of this.botSlots || []) if (ps.length < 2) ps.push({ id: b.bid, name: b.name, color: b.color, bot: b });
    return ps;
  }
  startDuelRound() {
    this.duelRound++; this.duelState = 'fight'; this.roundStart = this.time;
    const map = this.cfg.customMap ? decodeMap(this.cfg.customMap) : generateMap(this.layoutType, this.seed + 31, 1);
    setMapSize(this.mapW, this.mapH);
    if (map.w && map.w !== this.mapW) Object.assign(map, generateMap(this.layoutType, this.seed + 31, 1));
    applyLayout(map.grid, this.layout);
    this.grid = map.grid; this.gridRev++; this.gridChangedAt = this.time; this.tele = null; this.pendingBarrels = [];
    this.bullets = []; this.powerups = []; this.tanks = []; this.powerTimer = this.time + 8;
    const sp = this.layout.playerSpawns[0];
    this.duelists().forEach((d, i) => {
      if (d.p) { d.p.tankId = 0; d.p.power = 0; this.spawnPlayerTank(d.p, sp[i]); }
      else this.spawnBot(d.bot, sp[i]);
    });
    this.setBanner(`ROUND ${this.duelRound}`, this.duelists().map(d => `${d.name} ${this.duelWins[d.id] || 0}`).join('  —  '), 2);
    this.emit({ k: 'sfx', n: 'stage' });
  }
  duelKill(t) {
    if (this.mode !== 'duel' || this.duelState !== 'fight' || this.status !== 'play') return;
    const ds = this.duelists();
    const loser = ds.find(d => (d.p && d.p.id === t.owner) || (d.bot && d.bot.tankId === t.id));
    if (!loser) return;
    const win = ds.find(d => d !== loser);
    if (!win) return;
    this.duelWins[win.id] = (this.duelWins[win.id] || 0) + 1;
    if (win.p) { win.p.score += 1000; }
    this.duelState = 'break'; this.duelNext = this.time + 3.2;
    if (this.duelWins[win.id] >= this.target) this.declareWinner(win.name);
    else this.setBanner(`${win.name} WINS ROUND ${this.duelRound}`, ds.map(d => `${d.name} ${this.duelWins[d.id] || 0}`).join('  —  '), 3);
  }
  declareWinner(name) {
    this.status = 'win'; this.statusAt = this.time; this.winnerName = name;
    this.setBanner(name === 'DRAW' ? 'DRAW' : `${name.toUpperCase()} WINS`, this.mode === 'duel' ? 'Duel complete' : `${this.target} kill target`, 999);
    this.emit({ k: 'sfx', n: 'win' });
  }
  spawnBot(s, at) {
    const sp = at || (this.ffa ? this.pickSpawn() : this.layout.playerSpawns[s.team][s.idx % this.layout.playerSpawns[s.team].length]);
    const color = s.color || (s.team ? '#b8616b' : '#5f9fb0');
    const t = this.makeTank({ kind: 'bot', team: s.team, x: sp.x, y: sp.y, dir: sp.dir, size: 2, speed: 4.6 * this.diff.speed, hp: 1, etype: 'bot', color, bullet: 12 * this.diff.bullet });
    t.shieldUntil = this.time + 2; t.owner = s.bid || 0;
    s.tankId = t.id;
    return t;
  }

  spawnPlayerTank(p, at) {
    const spawns = this.layout.playerSpawns[this.pvp && !this.ffa ? p.team : 0];
    const s = at || (this.ffa ? this.pickSpawn() : spawns[(this.pvp ? p.spawnSlot : p.slot) % spawns.length]);
    const c = CLASSES[p.cls];
    const t = this.makeTank({
      kind: 'player', owner: p.id, team: p.team, x: s.x, y: s.y, dir: s.dir, size: 2,
      speed: c.speed, hp: c.hp, cls: p.cls, color: p.color, bullet: c.bullet,
    });
    t.shieldUntil = this.time + 3;
    p.tankId = t.id;
    return t;
  }

  makeTank(o) {
    const t = {
      id: this.id(), kind: o.kind, owner: o.owner || 0, team: o.team, x: o.x, y: o.y, dir: o.dir || 0, size: o.size || 2,
      speed: o.speed, hp: o.hp, maxHp: o.hp, cls: o.cls || '', etype: o.etype || '', color: o.color,
      bulletSpeed: o.bullet, fireAt: 0, moving: false, slideUntil: 0, shieldUntil: 0, spawnUntil: this.time + 0.9,
      frozenUntil: 0, dashUntil: 0, bonus: !!o.bonus, carrying: -1, ai: null,
    };
    this.tanks.push(t);
    this.emit({ k: 'spawn', x: t.x + t.size / 2, y: t.y + t.size / 2, c: t.color });
    return t;
  }

  // ---------- main step ----------
  step(dt = TICK) {
    this.time += dt; this.tick++;
    if (this.status === 'over' || this.status === 'win') { this.updateBullets(dt); return; }
    if (this.status === 'clear') {
      if (this.time > this.statusAt + 4) this.loadStage(this.stage + 1);
      this.updateTanksAll(dt); this.updateBullets(dt);
      return;
    }
    if (this.mode === 'duel') {
      if (this.duelState === 'break' && this.time >= this.duelNext) this.startDuelRound();
      else if (this.duelState === 'fight' && this.time - this.roundStart > 75) { this.duelState = 'break'; this.duelNext = this.time + 3; this.tanks = []; this.setBanner('TIME UP', 'Round is a draw', 2.5); }
    }
    // respawns
    for (const p of this.players.values()) {
      if (this.mode === 'duel') continue;
      if (p.tankId || !(this.pvp || p.lives > 0)) continue;
      if (!p.respawnAt) p.respawnAt = this.time + 1.5;
      if (this.time >= p.respawnAt) { if (!this.pvp) p.lives--; this.spawnPlayerTank(p); p.respawnAt = 0; }
    }
    if (this.pvp) this.updateBotSlots();
    else this.updateEnemySpawns();
    this.updateTanksAll(dt);
    this.updateBullets(dt);
    this.updatePowerups();
    this.updateAirstrikes();
    if (this.zone) this.updateZone();
    if (this.mode === 'ctf') this.updateFlags();
    this.updateShovels();
    this.updateWorldEvents();
    this.checkEnd();
  }

  updateTanksAll(dt) {
    for (const t of this.tanks) {
      if (t.dead) continue;
      if (this.time < t.spawnUntil) { t.moving = false; continue; }
      if (t.kind === 'player') this.updatePlayerTank(t, dt);
      else this.updateAITank(t, dt);
      if (!t.dead) this.tileEffects(t);
    }
    this.updateBarrels();
    this.tanks = this.tanks.filter(t => !t.dead);
  }

  // ---------- terrain features ----------
  teleData() { if (!this.tele || this.tele.rev !== this.gridRev) { this.tele = teleportPads(this.grid); this.tele.rev = this.gridRev; } return this.tele; }
  tileEffects(t) {
    if (this.time < t.spawnUntil) return;
    const [cx, cy] = this.center(t), mx = Math.floor(cx), my = Math.floor(cy);
    if (this.t(mx, my) === T.MINE) { this.setTile(mx, my, T.EMPTY); this.explode(mx + 0.5, my + 0.5, 1.6, 1, t.team === -1 ? null : undefined); this.emit({ k: 'sfx', n: 'alarm' }); return; }
    if (t.size !== 2 || this.time < (t.teleAt || 0)) return;
    const rx = Math.round(t.x), ry = Math.round(t.y);
    if (Math.abs(t.x - rx) > 0.35 || Math.abs(t.y - ry) > 0.35) return;
    const td = this.teleData(), pi = td.index.get(ry * W + rx);
    if (pi === undefined || td.link[pi] === undefined) return;
    const d = td.pads[td.link[pi]];
    if (this.tanks.some(o => o !== t && !o.dead && d.x < o.x + o.size && d.x + 2 > o.x && d.y < o.y + o.size && d.y + 2 > o.y)) return;
    this.emit({ k: 'tele', x: t.x + 1, y: t.y + 1, c: t.color });
    t.x = d.x; t.y = d.y; t.teleAt = this.time + 1.5; t.slideUntil = 0; if (t.ai) { t.ai.lastCell = -1; t.ai.stuck = 0; }
    this.emit({ k: 'tele', x: d.x + 1, y: d.y + 1, c: t.color }); this.emit({ k: 'sfx', n: 'dash' });
  }
  explodeBarrel(x, y) {
    if (this.t(x, y) !== T.BARREL) return;
    this.setTile(x, y, T.EMPTY);
    this.explode(x + 0.5, y + 0.5, 2.3, 1);
  }
  updateBarrels() {
    if (!this.pendingBarrels.length) return;
    const due = this.pendingBarrels.filter(b => this.time >= b.at);
    this.pendingBarrels = this.pendingBarrels.filter(b => this.time < b.at);
    for (const b of due) this.explodeBarrel(b.x, b.y);
  }
  // generic blast: wrecks bricks/trees/bridges, sets off barrels, damages tanks in range
  explode(x, y, r, dmg = 1) {
    for (let yy = Math.floor(y - r - 1); yy <= y + r + 1; yy++) for (let xx = Math.floor(x - r - 1); xx <= x + r + 1; xx++) {
      const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y), v = this.t(xx, yy);
      if (d < r * 0.75 && (v === T.BRICK || v === T.TREES)) this.setTile(xx, yy, T.EMPTY);
      else if (d < r && v === T.BRIDGE) this.setTile(xx, yy, T.WATER);
      else if (d < r && v === T.BARREL && !this.pendingBarrels.some(b => b.x === xx && b.y === yy)) this.pendingBarrels.push({ x: xx, y: yy, at: this.time + 0.14 });
    }
    for (const t of this.tanks) {
      if (t.dead) continue;
      const [cx, cy] = this.center(t);
      if (Math.hypot(cx - x, cy - y) < r + t.size / 2 - 0.6) this.damageTank(t, null, t.etype === 'boss' ? 3 * dmg : dmg);
    }
    this.drownCheck();
    this.emit({ k: 'boom', x: r2(x), y: r2(y), s: r * 1.4, c: '#ff6a00' });
    this.emit({ k: 'shake', a: Math.min(1, r * 0.25) });
  }
  // tanks standing on a bridge that collapses sink
  drownCheck() {
    for (const t of this.tanks) {
      if (t.dead) continue;
      let wet = 0;
      for (let y = Math.floor(t.y + EPS); y <= Math.floor(t.y + t.size - EPS); y++) for (let x = Math.floor(t.x + EPS); x <= Math.floor(t.x + t.size - EPS); x++) if (this.t(x, y) === T.WATER) wet++;
      if (wet >= 2) { this.emit({ k: 'splash', x: t.x + t.size / 2, y: t.y + t.size / 2 }); t.shieldUntil = 0; t.hp = 1; this.damageTank(t, null, 99); }
    }
  }
  updateZone() {
    const z = this.zone; if (!z) return;
    const k = Math.max(0, Math.min(1, (this.time - z.start) / (z.end - z.start)));
    z.r = z.r0 + (z.r1 - z.r0) * k;
    if (!z.warned && this.time > z.start - 5) { z.warned = true; this.setBanner('ZONE CLOSING', 'Stay inside the circle', 3); this.emit({ k: 'sfx', n: 'alarm' }); }
    for (const t of this.tanks) {
      if (t.dead || this.time < t.spawnUntil) continue;
      const [cx, cy] = this.center(t);
      if (Math.hypot(cx - z.cx, cy - z.cy) > z.r) {
        t.zoneT = (t.zoneT || 0) + TICK;
        if (t.zoneT > 2) { t.zoneT = 0; this.emit({ k: 'hit', x: cx, y: cy, c: '#ff3b30' }); const sh = t.shieldUntil; t.shieldUntil = 0; this.damageTank(t, null, 1); if (!t.dead) t.shieldUntil = sh; }
      } else t.zoneT = 0;
    }
  }

  // ---------- movement ----------
  blockedAt(t, nx, ny) {
    const s = t.size;
    if (nx < -EPS || ny < -EPS || nx + s > W + EPS || ny + s > H + EPS) return true;
    const x0 = Math.floor(nx + EPS), x1 = Math.floor(nx + s - EPS), y0 = Math.floor(ny + EPS), y1 = Math.floor(ny + s - EPS);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const v = this.t(x, y);
      if (v === T.STEEL || v === T.WATER) return true;
      if ((v === T.BRICK || v === T.BARREL) && t.etype !== 'boss') return true;
    }
    if (this.mode !== 'ctf') for (const b of this.bases) {
      if (nx < b.x + 2 - EPS && nx + s > b.x + EPS && ny < b.y + 2 - EPS && ny + s > b.y + EPS) return true;
    }
    for (const o of this.tanks) {
      if (o === t || o.dead) continue;
      const ov = (ax, ay) => ax < o.x + o.size - EPS && ax + s > o.x + EPS && ay < o.y + o.size - EPS && ay + s > o.y + EPS;
      if (ov(nx, ny) && !ov(t.x, t.y)) return true;
    }
    return false;
  }

  moveTank(t, dir, dist) {
    if (dir !== t.dir) {
      if ((dir % 2) !== (t.dir % 2)) {
        if (dir % 2 === 0) t.x = Math.round(t.x); else t.y = Math.round(t.y);
      }
      t.dir = dir;
    }
    const [dx, dy] = DIRS[dir];
    const n = Math.max(1, Math.ceil(dist / 0.1)), st = dist / n;
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const nx = t.x + dx * st, ny = t.y + dy * st;
      if (t.etype === 'boss') this.bulldoze(nx, ny, t.size);
      if (this.blockedAt(t, nx, ny)) break;
      t.x = nx; t.y = ny; moved += st;
    }
    return moved;
  }

  bulldoze(nx, ny, s) {
    const x0 = Math.floor(nx + EPS), x1 = Math.floor(nx + s - EPS), y0 = Math.floor(ny + EPS), y1 = Math.floor(ny + s - EPS);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.t(x, y) === T.BARREL) this.explodeBarrel(x, y);
    else if (this.t(x, y) === T.BRICK || this.t(x, y) === T.TREES) {
      this.setTile(x, y, T.EMPTY);
      if (this.rand() < 0.5) this.emit({ k: 'brick', x: x + 0.5, y: y + 0.5 });
    }
  }

  tileUnder(t) { const [cx, cy] = this.center(t); return this.t(Math.floor(cx), Math.floor(cy)); }
  boostK(t) { return this.tileUnder(t) === T.BOOST ? 1.75 : 1; }
  onIce(t) { const [cx, cy] = this.center(t); return this.t(Math.floor(cx), Math.floor(cy)) === T.ICE; }

  updatePlayerTank(t, dt) {
    const p = this.players.get(t.owner);
    if (!p) { t.dead = true; return; }
    const inp = this.inputs.get(p.id) || { d: -1 };
    const frozen = this.time < t.frozenUntil || this.teamFrozen(t.team);
    let speed = t.speed * (this.time < t.dashUntil ? 1.9 : 1) * (t.carrying >= 0 ? 0.85 : 1) * this.boostK(t);
    t.moving = false;
    if (!frozen) {
      if (inp.d >= 0 && inp.d < 4) {
        const m = this.moveTank(t, inp.d, speed * dt); t.moving = m > 0;
        if (this.onIce(t)) t.slideUntil = this.time + 0.35;
      } else if (this.time < t.slideUntil) {
        const m = this.moveTank(t, t.dir, speed * 0.8 * dt); t.moving = m > 0;
      }
      if (inp.f) this.tryFire(t, p);
      if (inp.a && !p.prevA) this.useAbility(t, p);
    }
    p.prevA = !!inp.a;
    // pick up powerups
    const [cx, cy] = this.center(t);
    for (const pu of this.powerups) {
      if (!pu.dead && Math.abs(pu.x + 1 - cx) < 1.7 && Math.abs(pu.y + 1 - cy) < 1.7) this.applyPowerup(pu, t, p);
    }
  }

  // ---------- firing ----------
  bulletsOf(t) { let n = 0; for (const b of this.bullets) if (b.owner === t.id) n++; return n; }

  tryFire(t, p) {
    const power = p ? p.power : 0;
    const max = t.kind === 'player' ? (power >= 2 ? 2 : 1) : (t.etype === 'boss' ? 99 : 1);
    const cd = t.kind === 'player' ? (power >= 2 ? 0.16 : 0.26) : 0.5 / this.diff.fire;
    if (this.time < t.fireAt || this.bulletsOf(t) >= max) return false;
    t.fireAt = this.time + cd;
    let spd = t.bulletSpeed * (t.kind === 'player' && power >= 1 ? 1.4 : 1);
    this.fireBullet(t, 0, spd, { heavy: t.cls === 'heavy' || t.etype === 'boss', steel: power >= 3 });
    return true;
  }

  fireBullet(t, angle, spd, { heavy = false, steel = false } = {}) {
    const [cx, cy] = this.center(t);
    const [dx, dy] = DIRS[t.dir];
    const a = Math.atan2(dy, dx) + angle;
    const vx = Math.cos(a), vy = Math.sin(a);
    const b = {
      id: this.id(), x: cx + dx * (t.size / 2 - 0.2), y: cy + dy * (t.size / 2 - 0.2), vx: vx * spd, vy: vy * spd,
      owner: t.id, team: t.team, kind: t.kind, heavy, steel, card: angle === 0, color: t.color, ownerPlayer: t.owner,
    };
    this.bullets.push(b);
    this.emit({ k: 'shot', x: r2(b.x), y: r2(b.y), c: t.color, h: heavy ? 1 : 0 });
    return b;
  }

  useAbility(t, p) {
    const c = CLASSES[p.cls];
    if (this.time < p.abilityAt) return;
    let ok = true;
    if (p.cls === 'striker') {
      const spd = t.bulletSpeed * (p.power >= 1 ? 1.4 : 1);
      for (const a of [-0.22, 0, 0.22]) this.fireBullet(t, a, spd, { steel: p.power >= 3 });
      this.emit({ k: 'sfx', n: 'spread' });
    } else if (p.cls === 'scout') {
      t.dashUntil = this.time + 1.2; this.emit({ k: 'sfx', n: 'dash' });
    } else if (p.cls === 'heavy') {
      t.shieldUntil = Math.max(t.shieldUntil, this.time + 3.5); this.emit({ k: 'sfx', n: 'shield' });
    } else if (p.cls === 'engineer') {
      ok = this.buildWall(t);
    }
    if (ok) p.abilityAt = this.time + c.cd;
  }

  buildWall(t) {
    const [dx, dy] = DIRS[t.dir];
    const bx = Math.round(t.x) + dx * 2, by = Math.round(t.y) + dy * 2;
    const cells = [];
    for (let y = by; y < by + 2; y++) for (let x = bx; x < bx + 2; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const v = this.t(x, y); if (v !== T.EMPTY && v !== T.ICE) continue;
      let blocked = false;
      for (const o of this.tanks) if (x + 1 > o.x && x < o.x + o.size && y + 1 > o.y && y < o.y + o.size) blocked = true;
      for (const b of this.bases) if (x >= b.x && x < b.x + 2 && y >= b.y && y < b.y + 2) blocked = true;
      if (!blocked) cells.push([x, y]);
    }
    if (!cells.length) return false;
    for (const [x, y] of cells) this.setTile(x, y, T.BRICK);
    this.emit({ k: 'build', x: bx + 1, y: by + 1 });
    return true;
  }

  // ---------- bullets ----------
  updateBullets(dt) {
    const bl = this.bullets;
    for (const b of bl) {
      if (b.dead) continue;
      const spd = Math.hypot(b.vx, b.vy);
      const n = Math.max(1, Math.ceil(spd * dt / 0.25));
      for (let i = 0; i < n && !b.dead; i++) {
        b.x += b.vx * dt / n; b.y += b.vy * dt / n;
        if (b.x < 0 || b.y < 0 || b.x > W || b.y > H) { b.dead = true; this.emit({ k: 'boom', x: r2(Math.min(W, Math.max(0, b.x))), y: r2(Math.min(H, Math.max(0, b.y))), s: 0.5, c: b.color }); break; }
        if (this.bulletTiles(b)) break;
        if (this.bulletBases(b)) break;
        if (this.bulletTanks(b)) break;
      }
    }
    // bullet vs bullet
    for (let i = 0; i < bl.length; i++) {
      const a = bl[i]; if (a.dead) continue;
      for (let j = i + 1; j < bl.length; j++) {
        const b = bl[j]; if (b.dead || a.team === b.team) continue;
        if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) {
          a.dead = b.dead = true; this.emit({ k: 'spark', x: r2(a.x), y: r2(a.y), c: '#fff' }); break;
        }
      }
    }
    this.bullets = bl.filter(b => !b.dead);
  }

  bulletTiles(b) {
    let cells;
    const sx = Math.sign(b.vx), sy = Math.sign(b.vy);
    if (b.card) {
      if (Math.abs(b.vy) > Math.abs(b.vx)) {
        const cy = Math.floor(b.y + sy * 0.15);
        cells = [[Math.floor(b.x - 0.5), cy], [Math.floor(b.x + 0.49), cy]];
      } else {
        const cx = Math.floor(b.x + sx * 0.15);
        cells = [[cx, Math.floor(b.y - 0.5)], [cx, Math.floor(b.y + 0.49)]];
      }
    } else cells = [[Math.floor(b.x), Math.floor(b.y)]];
    let hit = false, steelHit = false;
    for (const [x, y] of cells) {
      const v = this.t(x, y);
      if (v === T.BRICK || v === T.STEEL || v === T.BARREL) { hit = true; if (v === T.STEEL) steelHit = true; }
    }
    if (!hit) return false;
    b.dead = true;
    const barrel = cells.find(([x, y]) => this.t(x, y) === T.BARREL);
    if (barrel) { this.explodeBarrel(barrel[0], barrel[1]); return true; }
    let destroyed = false;
    const depth = b.heavy ? 2 : 1;
    const vert = Math.abs(b.vy) > Math.abs(b.vx);
    for (const [x, y] of cells) for (let d = 0; d < depth; d++) {
      const xx = vert ? x : x + sx * d, yy = vert ? y + sy * d : y;
      const v = this.t(xx, yy);
      if (v === T.BRICK || (v === T.STEEL && b.steel && d === 0)) { this.setTile(xx, yy, T.EMPTY); destroyed = true; }
      if (d === 0 && v !== T.BRICK && v !== T.STEEL) break;
    }
    if (destroyed) this.emit({ k: 'brick', x: r2(b.x), y: r2(b.y), s: steelHit && b.steel ? 1 : 0 });
    else if (steelHit) this.emit({ k: 'steel', x: r2(b.x), y: r2(b.y) });
    return true;
  }

  bulletBases(b) {
    if (this.mode === 'ctf') return false;
    for (const base of this.bases) {
      if (b.x > base.x && b.x < base.x + 2 && b.y > base.y && b.y < base.y + 2) {
        b.dead = true;
        if (!base.alive) { this.emit({ k: 'spark', x: r2(b.x), y: r2(b.y), c: '#888' }); return true; }
        const friendly = this.pvp ? b.team === base.team : b.kind === 'player';
        if (friendly) { this.emit({ k: 'spark', x: r2(b.x), y: r2(b.y), c: '#8ff' }); return true; }
        base.hp--;
        this.emit({ k: 'boom', x: base.x + 1, y: base.y + 1, s: base.hp <= 0 ? 4 : 1.2, c: '#ffd23f' });
        if (base.hp <= 0) {
          base.alive = false; this.emit({ k: 'shake', a: 1 }); this.emit({ k: 'sfx', n: 'coreDown' });
          if (this.pvp) { const bp = this.players.get(b.ownerPlayer); if (bp) bp.score += 2000; }
        } else this.emit({ k: 'sfx', n: 'alarm' });
        return true;
      }
    }
    return false;
  }

  bulletTanks(b) {
    for (const t of this.tanks) {
      if (t.dead || t.id === b.owner) continue;
      if (b.x < t.x - 0.15 || b.x > t.x + t.size + 0.15 || b.y < t.y - 0.15 || b.y > t.y + t.size + 0.15) continue;
      if (this.time < t.spawnUntil) continue;
      const sameTeam = t.team === b.team;
      if (sameTeam) {
        if (!this.pvp && t.kind === 'player' && b.kind === 'player') {
          b.dead = true;
          if (this.time >= t.shieldUntil) { t.frozenUntil = this.time + 1.6; this.emit({ k: 'sfx', n: 'freeze' }); }
          this.emit({ k: 'spark', x: r2(b.x), y: r2(b.y), c: '#8ef' });
          return true;
        }
        continue; // pass through allies
      }
      b.dead = true;
      this.hitTeam = b.team; this.hitOwner = b.owner;
      this.damageTank(t, b.ownerPlayer ? this.players.get(b.ownerPlayer) : null, 1, b);
      this.hitTeam = -1;
      return true;
    }
    return false;
  }

  damageTank(t, killer, amount, b) {
    if (this.time < t.shieldUntil) { this.emit({ k: 'spark', x: t.x + t.size / 2, y: t.y + t.size / 2, c: '#9ff' }); this.emit({ k: 'sfx', n: 'deflect' }); return; }
    t.hp -= amount;
    if (t.hp > 0) {
      this.emit({ k: 'hit', x: r2(b ? b.x : t.x + 1), y: r2(b ? b.y : t.y + 1), c: t.color });
      if (t.etype === 'boss' && t.hp < t.maxHp * 0.6 && !t.p2) { t.p2 = true; this.setBanner('TITAN ENRAGED', 'Phase 2', 2); this.emit({ k: 'sfx', n: 'boss' }); }
      if (t.etype === 'boss' && t.hp < t.maxHp * 0.25 && !t.p3) { t.p3 = true; t.speed = 3.2; this.setBanner('TITAN OVERDRIVE', 'Final phase', 2); this.emit({ k: 'sfx', n: 'boss' }); }
      return;
    }
    this.killTank(t, killer);
  }

  killTank(t, killer, silent = false) {
    if (t.dead) return;
    t.dead = true;
    const [cx, cy] = this.center(t);
    if (!silent) for (let y = Math.floor(t.y); y < t.y + t.size; y++) for (let x = Math.floor(t.x); x < t.x + t.size; x++) if (this.t(x, y) === T.BRIDGE && this.rand() < 0.5) this.setTile(x, y, T.WATER);
    if (!silent) {
      this.emit({ k: 'boom', x: r2(cx), y: r2(cy), s: t.size === 4 ? 5 : 2.2, c: t.color });
      this.emit({ k: 'shake', a: t.size === 4 ? 1.2 : (t.kind === 'player' ? 0.5 : 0.25) });
    }
    if (t.carrying >= 0) this.dropFlag(t);
    if (this.ffa && !silent) {
      const kb = this.botSlots && this.botSlots.find(s => s.tankId && s.tankId === this.hitOwner && s.team !== t.team);
      if (kb && this.hitTeam >= 0) { kb.kills++; kb.score += 500; }
      if (t.kind === 'bot') { const vb = this.botSlots && this.botSlots.find(s => s.tankId === t.id); if (vb) vb.deaths++; }
      this.duelKill(t);
    }
    if (t.kind === 'enemy') {
      this.killed++;
      if (killer) { killer.score += ENEMY_TYPES[t.etype].score; killer.kills++; }
      if (t.bonus) this.spawnPowerup();
      if (t.etype === 'boss') {
        this.bossAlive = false; this.spawnPowerup(); this.spawnPowerup();
        this.setBanner('TITAN DESTROYED', killer ? `Final blow: ${killer.name}` : '', 3);
        this.emit({ k: 'sfx', n: 'win' });
      }
    } else if (t.kind === 'player') {
      const p = this.players.get(t.owner);
      if (p) {
        p.tankId = 0; p.deaths++;
        p.power = this.pvp ? 0 : Math.max(0, p.power - 1);
        p.respawnAt = this.time + (this.ffa ? 2.5 : this.pvp ? 3 : 2);
        if (!this.pvp && p.lives <= 0) p.respawnAt = 0;
      }
      if (killer && killer.team !== t.team) { killer.kills++; killer.score += 500; }
      if (this.pvp && !silent && this.mode === 'battle' && this.hitTeam >= 0 && this.hitTeam !== t.team) this.teamScore[this.hitTeam]++;
    } else if (t.kind === 'bot') {
      const slot = this.botSlots && this.botSlots.find(s => s.tankId === t.id);
      if (slot) { slot.tankId = 0; slot.respawnAt = this.time + (this.ffa ? 2.5 : 4); }
      if (killer && killer.team !== t.team) { killer.kills++; killer.score += 300; }
      if (this.mode === 'battle' && this.hitTeam >= 0 && this.hitTeam !== t.team) this.teamScore[this.hitTeam]++;
    }
  }

  // ---------- enemies & AI ----------
  updateEnemySpawns() {
    if (this.mode === 'survival' && this.nextWaveAt && this.time >= this.nextWaveAt) this.startWave();
    if (!this.queue) return;
    const alive = this.tanks.filter(t => t.kind === 'enemy').length;
    const maxAlive = Math.max(2, Math.min(14, 2 + Math.ceil(this.humanCount * 1.5) + this.diff.alive));
    if (this.bossStage && !this.bossSpawned && this.killed >= Math.floor(this.stageTotal / 2)) {
      this.spawnBoss(); return;
    }
    if (this.queue.length && alive < maxAlive && this.time >= this.spawnTimer && this.time >= this.freezeUntil) {
      const sp = this.layout.enemySpawns;
      for (let k = 0; k < sp.length; k++) {
        const s = sp[(this.spawnIdx + k) % sp.length];
        const probe = { size: 2, x: s.x, y: s.y };
        if (this.tanks.some(o => s.x < o.x + o.size && s.x + 2 > o.x && s.y < o.y + o.size && s.y + 2 > o.y)) continue;
        const q = this.queue.shift();
        this.spawnEnemy(q.type, s.x, s.y, q.bonus);
        this.spawnIdx = (this.spawnIdx + k + 1) % sp.length;
        break;
      }
      this.spawnTimer = this.time + Math.max(0.8, 2.6 - this.humanCount * 0.2 - this.stage * 0.05);
    }
  }

  spawnEnemy(type, x, y, bonus = false) {
    const e = ENEMY_TYPES[type];
    const t = this.makeTank({ kind: 'enemy', team: 1, x, y, dir: 2, size: 2, speed: e.speed * this.diff.speed, hp: e.hp, etype: type, color: e.color, bullet: e.bullet * this.diff.bullet, bonus });
    return t;
  }

  spawnBoss() {
    this.bossSpawned = true; this.bossAlive = true;
    const s = this.layout.bossSpawn;
    for (const o of this.tanks) if (o.kind === 'enemy' && o.x < s.x + 4 && o.x + 2 > s.x && o.y < s.y + 4) { /* allow overlap */ }
    const e = ENEMY_TYPES.boss;
    const hp = Math.round((30 + 12 * this.humanCount + (this.mode === 'survival' ? this.wave * 3 : this.stage * 2)) * this.diff.boss);
    const t = this.makeTank({ kind: 'enemy', team: 1, x: s.x, y: s.y, dir: 2, size: 4, speed: e.speed, hp, etype: 'boss', color: e.color, bullet: e.bullet });
    t.spawnUntil = this.time + 2;
    t.nextSpread = this.time + 3; t.nextRing = this.time + 5; t.nextMinion = this.time + 8;
    this.setBanner('WARNING', 'TITAN APPROACHING', 3);
    this.emit({ k: 'sfx', n: 'boss' }); this.emit({ k: 'shake', a: 0.8 });
  }

  updateBotSlots() {
    if (!this.botSlots || this.mode === 'duel') return;
    for (const s of this.botSlots) {
      if (s.tankId || this.time < s.respawnAt) continue;
      this.spawnBot(s);
    }
  }

  // Dijkstra flow field toward target positions (tank top-left coords)
  field(key, seeds) {
    const c = this.fields.get(key);
    if (c && c.rev === this.gridRev && this.time - c.time < 1.5) return c.dist;
    if (c && this.time - c.time < 0.5) return c.dist;
    if (this.fields.size > 80) this.fields.clear();
    const N = W * H, INF = 65535;
    const dist = new Uint16Array(N).fill(INF);
    const buckets = [];
    const push = (i, d) => { (buckets[d] || (buckets[d] = [])).push(i); };
    for (const [x, y] of seeds) {
      const xi = Math.max(0, Math.min(W - 2, x)), yi = Math.max(0, Math.min(H - 2, y));
      dist[yi * W + xi] = 0; push(yi * W + xi, 0);
    }
    for (let d = 0; d < buckets.length; d++) {
      const b = buckets[d]; if (!b) continue;
      for (const i of b) {
        if (dist[i] !== d) continue;
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (!walkable(this.grid, nx, ny) || !this.inArena(nx, ny)) continue;
          let cost = 1;
          for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) { const v = this.grid[(ny + yy) * W + nx + xx]; if (v === T.BRICK || v === T.BARREL) cost = Math.max(cost, 4); else if (v === T.MINE) cost = 9; }
          const nd = d + cost, ni = ny * W + nx;
          if (nd < dist[ni]) { dist[ni] = nd; push(ni, nd); }
        }
      }
    }
    this.fields.set(key, { dist, rev: this.gridRev, time: this.time });
    return dist;
  }

  baseSeeds(base) { return [[base.x, base.y - 2], [base.x - 2, base.y], [base.x + 2, base.y], [base.x, base.y + 2]]; }

  nearestFoe(t, maxD = 999) {
    let best = null, bd = maxD;
    const [cx, cy] = this.center(t);
    for (const o of this.tanks) {
      if (o.dead || o.team === t.team || this.time < o.spawnUntil) continue;
      const [ox, oy] = this.center(o);
      const d = Math.abs(ox - cx) + Math.abs(oy - cy);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  updateAITank(t, dt) {
    const frozen = (t.kind === 'enemy' && this.time < this.freezeUntil) || this.teamFrozen(t.team);
    if (frozen) { t.moving = false; return; }
    const ai = t.ai || (t.ai = { mode: 'goal', until: 0, lastCell: -1, stuck: 0, fireRand: 0 });
    const [cx, cy] = this.center(t);
    // choose a goal
    if (this.time > ai.until) {
      const r = this.rand();
      if (t.kind === 'enemy') ai.mode = t.etype === 'boss' ? (r < 0.6 ? 'hunt' : 'goal') : (r < 0.4 ? 'goal' : r < 0.75 ? 'hunt' : 'wander');
      else ai.mode = this.ffa ? (r < 0.85 ? 'hunt' : 'wander') : (r < 0.5 ? 'goal' : 'hunt');
      ai.until = this.time + 3 + this.rand() * 4;
    }
    if (t.carrying >= 0) ai.mode = 'goal';
    let seeds = null, key = '';
    if (ai.mode === 'hunt') {
      const f = this.nearestFoe(t, t.kind === 'bot' && !this.ffa ? 18 : 999);
      if (f) { const fx = Math.round(f.x + (f.size - 2) / 2), fy = Math.round(f.y + (f.size - 2) / 2); seeds = [[fx, fy]]; key = 't' + fx + ',' + fy; }
    }
    if (!seeds && ai.mode !== 'wander') {
      if (this.ffa) { /* no objective: wander until someone shows up */ }
      else if (!this.pvp) { const b = this.bases[0]; seeds = this.baseSeeds(b); key = 'base0'; }
      else if (this.mode === 'battle') { const b = this.bases[1 - t.team]; seeds = this.baseSeeds(b); key = 'base' + b.team; }
      else {
        const own = this.flags[t.team], foe = this.flags[1 - t.team];
        if (t.carrying >= 0) { const b = this.bases[t.team]; seeds = [[b.x, b.y]]; key = 'pad' + t.team; }
        else if (!own.home && own.carrier) { const c = this.tankById(own.carrier); if (c) { seeds = [[Math.round(c.x), Math.round(c.y)]]; key = 'c' + Math.round(c.x) + ',' + Math.round(c.y); } }
        if (!seeds) { const fx = Math.round(foe.x - 1), fy = Math.round(foe.y - 1); seeds = [[fx, fy]]; key = 'f' + fx + ',' + fy; }
      }
    }
    const rx = Math.round(t.x), ry = Math.round(t.y);
    const aligned = Math.abs(t.x - rx) < 0.08 && Math.abs(t.y - ry) < 0.08;
    const cell = ry * W + rx;
    if ((aligned && cell !== ai.lastCell) || ai.stuck > 0.35) {
      if (aligned) { t.x = rx; t.y = ry; }
      ai.lastCell = cell;
      let nd = t.dir;
      if (seeds && this.rand() > 0.08) {
        const dist = this.field(key, seeds);
        const ox = t.size === 4 ? 1 : 0;
        let best = Infinity, cands = [];
        for (let d = 0; d < 4; d++) {
          const nx = rx + ox + DIRS[d][0], ny = ry + ox + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx > W - 2 || ny > H - 2) continue;
          const v = dist[ny * W + nx];
          if (v < best) { best = v; cands = [d]; } else if (v === best) cands.push(d);
        }
        if (ai.stuck > 0.35) cands = [0, 1, 2, 3].filter(d => d !== t.dir);
        if (cands.length) nd = cands[(this.rand() * cands.length) | 0];
      } else if (this.rand() < 0.35 || ai.stuck > 0.35) {
        nd = (this.rand() * 4) | 0;
        if (this.rand() < 0.4 && !this.pvp) nd = 2;
      }
      ai.dir = nd; ai.stuck = 0;
    }
    const speed = t.speed * (t.carrying >= 0 ? 0.85 : 1) * this.boostK(t);
    const moved = this.moveTank(t, ai.dir ?? t.dir, speed * dt);
    t.moving = moved > 0;
    if (moved < speed * dt * 0.3) ai.stuck += dt; else ai.stuck = 0;
    // shooting
    const facingBrick = this.frontHas(t, T.BRICK) || (t.kind !== 'enemy' ? false : this.frontHas(t, T.STEEL) && this.rand() < 0.01);
    const inLine = this.targetInLine(t);
    const randFire = this.rand() < dt * (t.etype === 'fast' ? 0.8 : 1.2) * this.diff.fire;
    if (t.etype === 'boss') this.bossAttacks(t, inLine);
    else if ((facingBrick && ai.stuck > 0.1) || inLine || randFire) this.tryFire(t, null);
    // flag pickup for bots
    if (this.mode === 'ctf') this.checkFlagTouch(t);
  }

  frontHas(t, type) {
    const [dx, dy] = DIRS[t.dir];
    const [cx, cy] = this.center(t);
    const fx = cx + dx * (t.size / 2 + 0.5), fy = cy + dy * (t.size / 2 + 0.5);
    if (dx) return this.t(Math.floor(fx), Math.floor(cy - 0.5)) === type || this.t(Math.floor(fx), Math.floor(cy + 0.49)) === type;
    return this.t(Math.floor(cx - 0.5), Math.floor(fy)) === type || this.t(Math.floor(cx + 0.49), Math.floor(fy)) === type;
  }

  targetInLine(t) {
    const [cx, cy] = this.center(t);
    const [dx, dy] = DIRS[t.dir];
    const check = (ox, oy, tol, range = 16) => {
      const rx = ox - cx, ry = oy - cy;
      if (dx) return Math.abs(ry) < tol && Math.sign(rx) === dx && Math.abs(rx) < range;
      return Math.abs(rx) < tol && Math.sign(ry) === dy && Math.abs(ry) < range;
    };
    for (const o of this.tanks) {
      if (o.dead || o.team === t.team) continue;
      const [ox, oy] = this.center(o);
      if (check(ox, oy, o.size / 2 + 0.2)) return true;
    }
    for (const b of this.bases) if (b.alive && (this.pvp ? b.team !== t.team : true) && this.mode !== 'ctf' && check(b.x + 1, b.y + 1, 1.2, 9)) return true;
    return false;
  }

  bossAttacks(t, inLine) {
    const now = this.time;
    const spreadCd = t.p3 ? 0.9 : 1.4;
    if (now > t.nextSpread && (inLine || this.rand() < 0.02)) {
      for (const a of [-0.25, 0, 0.25]) this.fireBullet(t, a, t.bulletSpeed, { heavy: true });
      t.nextSpread = now + spreadCd;
    }
    if (t.p2 && now > t.nextRing) {
      const n = t.p3 ? 12 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + now;
        const [cx, cy] = this.center(t);
        this.bullets.push({ id: this.id(), x: cx + Math.cos(a) * 2, y: cy + Math.sin(a) * 2, vx: Math.cos(a) * 8, vy: Math.sin(a) * 8, owner: t.id, team: t.team, kind: 'enemy', heavy: false, steel: false, card: false, color: '#ff2a2a' });
      }
      this.emit({ k: 'sfx', n: 'ring' });
      t.nextRing = now + (t.p3 ? 2.2 : 3.5);
    }
    if (t.p2 && now > t.nextMinion) {
      const sp = this.layout.sideSpawns;
      for (const s of sp) this.spawnEnemy('basic', s.x, s.y);
      t.nextMinion = now + 10;
    }
  }

  // ---------- powerups ----------
  spawnPowerup(forceType) {
    let type = forceType || POWERUPS[(this.rand() * POWERUPS.length) | 0];
    if (this.pvp && type === 'tank') type = 'helmet';
    if (this.ffa && type === 'shovel') type = 'star';
    const B = this.bounds || { x0: 0, y0: 0, x1: W, y1: H };
    for (let i = 0; i < 60; i++) {
      const x = B.x0 + 2 + ((this.rand() * (B.x1 - B.x0 - 6)) | 0), y = B.y0 + 2 + ((this.rand() * (B.y1 - B.y0 - 7)) | 0);
      if (!walkable(this.grid, x, y) || !this.inArena(x, y)) continue;
      if (this.bases.some(b => Math.abs(b.x - x) < 5 && Math.abs(b.y - y) < 5)) continue;
      this.powerups.push({ id: this.id(), type, x, y, until: this.time + 16 });
      this.emit({ k: 'sfx', n: 'puSpawn' });
      return;
    }
  }

  updatePowerups() {
    this.powerups = this.powerups.filter(p => !p.dead && this.time < p.until);
    if (this.pvp && this.time > this.powerTimer && !(this.mode === 'duel' && this.duelState !== 'fight')) { this.spawnPowerup(); this.powerTimer = this.time + (this.mode === 'duel' ? 9 : this.ffa ? 10 : 12); }
  }

  applyPowerup(pu, t, p) {
    pu.dead = true;
    p.score += 500;
    const cx = pu.x + 1, cy = pu.y + 1;
    this.emit({ k: 'pick', x: cx, y: cy, t: pu.type, c: t.color });
    const foes = this.tanks.filter(o => o.team !== t.team && !o.dead);
    switch (pu.type) {
      case 'star': p.power = Math.min(3, p.power + 1); break;
      case 'helmet': t.shieldUntil = Math.max(t.shieldUntil, this.time) + 10; break;
      case 'grenade':
        for (const o of foes) {
          if (o.etype === 'boss') this.damageTank(o, p, Math.ceil(o.maxHp * 0.2));
          else if (this.pvp) this.damageTank(o, p, 1);
          else this.killTank(o, p);
        }
        this.emit({ k: 'shake', a: 1 }); break;
      case 'shovel': {
        if (!this.layout.rings.length) break;
        const team = this.pvp ? t.team : 0;
        this.shovel[team] = this.time + (p.cls === 'engineer' ? 25 : 15);
        this.setRing(team, T.STEEL); break;
      }
      case 'clock':
        if (this.ffa) this.freezeAllBut = [t.team, this.time + 4];
        else if (this.pvp) this.teamFreeze[1 - t.team] = this.time + 4;
        else this.freezeUntil = this.time + 8;
        this.emit({ k: 'sfx', n: 'freeze' }); break;
      case 'tank': p.lives++; break;
    }
  }

  setRing(team, v) {
    const idx = this.pvp ? team : 0;
    for (const [x, y] of this.layout.rings[idx]) {
      if (this.tanks.some(o => x + 1 > o.x && x < o.x + o.size && y + 1 > o.y && y < o.y + o.size)) continue;
      this.setTile(x, y, v);
    }
  }

  updateShovels() {
    for (let i = 0; i < 2; i++) if (this.shovel[i] && this.time > this.shovel[i]) { this.shovel[i] = 0; this.setRing(i, T.BRICK); }
  }

  // ---------- world events (airstrikes, reinforcements, supply drops) ----------
  updateWorldEvents() {
    if (this.pvp || this.time < this.nextEventAt) return;
    this.nextEventAt = this.time + (32 + this.rand() * 18) * this.diff.events;
    const r = this.rand();
    if (r < 0.45) {
      const n = 4 + Math.floor(this.humanCount / 2);
      const ps = this.tanks.filter(t => t.kind === 'player');
      for (let i = 0; i < n; i++) {
        let x, y;
        if (ps.length && this.rand() < 0.6) { const t = ps[(this.rand() * ps.length) | 0]; x = t.x + 1 + (this.rand() - 0.5) * 8; y = t.y + 1 + (this.rand() - 0.5) * 8; }
        else { x = 2 + this.rand() * (W - 4); y = 2 + this.rand() * (H - 6); }
        x = Math.max(1, Math.min(W - 1, x)); y = Math.max(1, Math.min(H - 1, y));
        const b = this.bases[0]; if (Math.hypot(x - b.x - 1, y - b.y - 1) < 5) continue;
        this.airstrikes.push({ x: r2(x), y: r2(y), at: this.time + 2.5 + i * 0.25, r: 2.2 });
      }
      this.setBanner('AIRSTRIKE', 'Get out of the red zones!', 2.5);
      this.emit({ k: 'sfx', n: 'alarm' });
    } else if (r < 0.75) {
      for (const s of this.layout.sideSpawns) this.spawnEnemy(this.rand() < 0.5 ? 'fast' : 'power', s.x, s.y);
      this.spawnEnemy('fast', this.layout.enemySpawns[2].x, 0);
      this.setBanner('REINFORCEMENTS', 'Enemy flanking from the sides', 2.5);
      this.emit({ k: 'sfx', n: 'alarm' });
    } else {
      this.spawnPowerup(); this.spawnPowerup();
      this.setBanner('SUPPLY DROP', 'Grab the power-ups', 2.5);
    }
  }

  updateAirstrikes() {
    for (const a of this.airstrikes) {
      if (this.time < a.at) continue;
      a.done = true;
      this.explode(a.x, a.y, a.r, 1);
    }
    this.airstrikes = this.airstrikes.filter(a => !a.done);
  }

  // ---------- CTF ----------
  updateFlags() {
    for (const t of this.tanks) if (t.kind === 'player' && !t.dead) this.checkFlagTouch(t);
    for (const f of this.flags) {
      if (f.carrier) {
        const c = this.tankById(f.carrier);
        if (!c) { f.carrier = 0; f.droppedAt = this.time; }
        else { f.x = c.x + 1; f.y = c.y + 1; }
      } else if (!f.home && this.time - f.droppedAt > 15) this.returnFlag(f);
    }
  }

  checkFlagTouch(t) {
    if (this.time < t.spawnUntil) return;
    const [cx, cy] = this.center(t);
    for (const f of this.flags) {
      if (f.carrier) continue;
      if (Math.abs(f.x - cx) > 1.5 || Math.abs(f.y - cy) > 1.5) continue;
      if (f.team !== t.team && t.carrying < 0) {
        f.carrier = t.id; f.home = false; t.carrying = f.team;
        this.setBanner(`${this.nameOf(t)} HAS THE FLAG`, `${f.team ? 'Crimson' : 'Cyan'} flag taken`, 2);
        this.emit({ k: 'sfx', n: 'flag' });
      } else if (f.team === t.team && !f.home) {
        this.returnFlag(f); this.emit({ k: 'sfx', n: 'flag' });
      }
    }
    if (t.carrying >= 0) {
      const b = this.bases[t.team];
      if (Math.abs(b.x + 1 - cx) < 1.6 && Math.abs(b.y + 1 - cy) < 1.6) {
        const f = this.flags[t.carrying];
        this.teamScore[t.team]++; t.carrying = -1; this.returnFlag(f);
        const p = this.players.get(t.owner); if (p) p.score += 3000;
        this.setBanner('CAPTURE!', `${this.nameOf(t)} scores for ${t.team ? 'Crimson' : 'Cyan'}`, 2.5);
        this.emit({ k: 'sfx', n: 'capture' }); this.emit({ k: 'boom', x: b.x + 1, y: b.y + 1, s: 2, c: t.color });
      }
    }
  }

  nameOf(t) { const p = this.players.get(t.owner); return p ? p.name : 'BOT'; }
  dropFlag(t) {
    const f = this.flags[t.carrying]; t.carrying = -1;
    if (!f) return; f.carrier = 0; f.droppedAt = this.time; f.x = t.x + 1; f.y = t.y + 1;
  }
  returnFlag(f) { const b = this.bases[f.team]; f.carrier = 0; f.home = true; f.x = b.x + 1; f.y = b.y + 1; }

  // ---------- end conditions ----------
  // everyone who can score in free-for-all (players + bots)
  competitors() {
    const list = [...this.players.values()].map(p => ({ id: p.id, name: p.name, kills: p.kills }));
    for (const b of this.botSlots || []) list.push({ id: b.bid, name: b.name, kills: b.kills });
    return list;
  }

  checkEnd() {
    if (this.mode === 'duel') return;
    if (this.mode === 'deathmatch') {
      const c = this.competitors().sort((a, b) => b.kills - a.kills);
      if (!c.length) return;
      if (c[0].kills >= this.target) this.declareWinner(c[0].name);
      else if (this.time - this.startAt > this.timeLimit) this.declareWinner(c[1] && c[1].kills === c[0].kills ? 'DRAW' : c[0].name);
      return;
    }
    if (this.pvp) {
      let w = -1;
      if (this.mode === 'battle') for (const b of this.bases) if (!b.alive) w = 1 - b.team;
      for (let i = 0; i < 2; i++) if (this.teamScore[i] >= this.target) w = i;
      if (w < 0 && this.time - this.startAt > this.timeLimit) w = this.teamScore[0] === this.teamScore[1] ? 2 : (this.teamScore[0] > this.teamScore[1] ? 0 : 1);
      if (w >= 0) {
        this.status = 'win'; this.winner = w; this.statusAt = this.time;
        this.setBanner(w === 2 ? 'DRAW' : `${w ? 'CRIMSON' : 'CYAN'} WINS`, `${this.teamScore[0]} : ${this.teamScore[1]}`, 999);
        this.emit({ k: 'sfx', n: 'win' });
      }
      return;
    }
    const baseDown = !this.bases[0].alive;
    const anyAlive = [...this.players.values()].some(p => p.tankId || p.lives > 0);
    if (baseDown || (this.players.size && !anyAlive)) {
      this.status = 'over'; this.statusAt = this.time;
      this.setBanner('GAME OVER', baseDown ? 'The core has fallen' : 'All tanks destroyed', 999);
      this.emit({ k: 'sfx', n: 'gameover' });
      return;
    }
    const enemies = this.tanks.some(t => t.kind === 'enemy');
    const bossPending = this.bossStage && (!this.bossSpawned || this.bossAlive);
    if (!this.queue.length && !enemies && !bossPending) {
      if (this.mode === 'classic') {
        this.status = 'clear'; this.statusAt = this.time;
        for (const p of this.players.values()) p.score += 1000;
        this.setBanner('STAGE CLEAR', '+1000 each · next stage incoming', 3.8);
        this.emit({ k: 'sfx', n: 'win' });
      } else if (!this.nextWaveAt) {
        this.nextWaveAt = this.time + 5;
        this.setBanner(`WAVE ${this.wave} CLEARED`, 'Next wave in 5s', 3);
        this.emit({ k: 'sfx', n: 'win' });
      }
    }
  }

  // ---------- full-state checkpoints (host migration) ----------
  serialize() {
    const skip = new Set(['players', 'inputs', 'grid', 'fields', 'events', 'layout', 'diff', 'tele']);
    const o = {};
    for (const k of Object.keys(this)) if (!skip.has(k)) o[k] = this[k];
    o.cfg = { ...this.cfg, players: undefined };
    o.players = [...this.players.values()];
    o.gridStr = this.mapString();
    return JSON.stringify(o);
  }

  static deserialize(str) {
    const o = JSON.parse(str);
    const g = Object.create(Game.prototype);
    Object.assign(g, o);
    g.players = new Map(o.players.map(p => [p.id, p]));
    g.inputs = new Map(o.players.map(p => [p.id, { d: -1, f: false, a: false }]));
    setMapSize(g.mapW || 48, g.mapH || 28);
    g.grid = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) g.grid[i] = o.gridStr.charCodeAt(i) - 48;
    delete g.gridStr;
    g.fields = new Map(); g.events = [];
    g.layout = getLayout(g.layoutType);
    g.diff = DIFFICULTIES[g.difficulty] || DIFFICULTIES.normal;
    g.gridRev++;
    return g;
  }

  // ---------- snapshot ----------
  snapshot(includeMap) {
    const q = v => Math.round(v * 100);
    const now = this.time;
    const tk = this.tanks.map(t => {
      let f = 0;
      if (t.moving) f |= 1;
      if (now < t.shieldUntil) f |= 2;
      if (now < t.spawnUntil) f |= 4;
      if (now < t.frozenUntil || (t.kind === 'enemy' && now < this.freezeUntil) || this.teamFrozen(t.team)) f |= 8;
      if (t.bonus) f |= 16;
      if (t.carrying >= 0) f |= 32;
      if (now < t.dashUntil) f |= 64;
      return [t.id, q(t.x), q(t.y), t.dir, t.size, t.kind === 'player' ? 'p' + t.cls : t.etype, t.color, f, Math.max(0, t.hp), t.maxHp, t.owner || 0, t.team];
    });
    const b = this.bullets.map(b => [b.id, q(b.x), q(b.y), Math.round(b.vx * 10), Math.round(b.vy * 10), b.color, b.heavy ? 1 : 0]);
    const s = {
      tm: r2(now), tk, b,
      pu: this.powerups.map(p => [p.id, p.type, p.x, p.y, p.until - now < 3 ? 1 : 0]),
      bs: this.bases.map(b => [b.x, b.y, b.team, b.alive ? 1 : 0, b.hp, b.maxHp]),
      fl: this.flags.map(f => [f.team, r2(f.x), r2(f.y), f.carrier ? 1 : 0, f.home ? 1 : 0]),
      air: this.airstrikes.map(a => [a.x, a.y, r2(a.at - now), a.r]),
      rev: this.gridRev,
      hud: this.hud(),
    };
    if (includeMap) s.map = this.mapString();
    return s;
  }

  mapString() { let s = ''; for (let i = 0; i < W * H; i++) s += String.fromCharCode(48 + this.grid[i]); return s; }

  hud() {
    const now = this.time;
    const players = [...this.players.values()].map(p => [p.id, p.name, p.color, p.lives, p.score, p.power, p.tankId ? 1 : (this.pvp || p.lives > 0 ? 0 : 2), p.cls, p.team, p.kills, Math.max(0, r2(p.abilityAt - now))]);
    const enemiesLeft = this.pvp ? 0 : (this.queue ? this.queue.length : 0) + this.tanks.filter(t => t.kind === 'enemy').length + (this.bossStage && !this.bossSpawned ? 1 : 0);
    const boss = this.tanks.find(t => t.etype === 'boss');
    if (this.ffa) for (const b of this.botSlots || []) players.push([b.bid, b.name, b.color, 0, b.score, 0, b.tankId ? 1 : 0, 'striker', b.team, b.kills, 0]);
    let ffa = null;
    if (this.mode === 'deathmatch') { const c = this.competitors().sort((a, b) => b.kills - a.kills); ffa = { leader: c[0] ? [c[0].name, c[0].kills] : null }; }
    if (this.mode === 'duel') ffa = { duel: this.duelists().map(d => [d.name, d.color, this.duelWins[d.id] || 0]), round: this.duelRound, roundLeft: this.duelState === 'fight' ? Math.max(0, Math.round(75 - (now - this.roundStart))) : 75 };
    return {
      mode: this.mode, stage: this.stage, title: this.stageTitle, wave: this.wave, left: enemiesLeft, status: this.status,
      banner: this.banner && now < this.banner.until ? [this.banner.text, this.banner.sub] : null,
      team: this.teamScore, target: this.target || 0, timeLeft: this.pvp ? Math.max(0, Math.round(this.timeLimit - (now - this.startAt))) : 0,
      freeze: now < this.freezeUntil ? 1 : 0, winner: this.winner, players, diff: this.difficulty, size: [W, H], atmo: this.atmo, zone: this.zone && this.zone.r !== undefined ? [r2(this.zone.cx), r2(this.zone.cy), r2(this.zone.r)] : null,
      boss: boss ? [boss.hp, boss.maxHp] : null,
      ffa, winnerName: this.winnerName || null, arena: this.bounds ? [this.bounds.x0, this.bounds.y0, this.bounds.x1, this.bounds.y1] : null,
    };
  }
}
