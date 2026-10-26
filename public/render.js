// Theme-driven renderer: crisp at any resolution up to 4K
import { W, H, T, TEAM_MAIN, setMapSize } from './const.js';
import { teleportPads } from './levels.js';
import { THEMES, NEON, TAU, rgba, rr, hex, drawIcon, lighten } from './themes.js';

const PU_COLORS = { star: '#ffd23f', helmet: '#3de0ff', grenade: '#ff4d5e', shovel: '#ff9b3d', clock: '#a98bff', tank: '#3dff8b' };
// Phone view: how many map cells fit across the short side of the screen at each zoom level
export const ZOOMS = { close: 22, near: 17, fit: 0 };
const LAYER_BUDGET = 4.5e6; // max pixels per pre-rendered map layer when zoomed in (keeps phone memory in check)
const AHEAD = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const PU_LABEL = { star: 'POWER UP', helmet: 'SHIELD', grenade: 'NUKE', shovel: 'FORTIFY', clock: 'FREEZE', tank: '+1 LIFE' };
// tank colours can be #rgb or #rrggbb; anything else falls back to a neutral cyan
const tint = (c, a) => /^#[0-9a-f]{6}$/i.test(c) ? rgba(c, a) : /^#[0-9a-f]{3}$/i.test(c) ? rgba('#' + [...c.slice(1)].map(x => x + x).join(''), a) : `rgba(127,220,255,${a})`;
function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

// current theme (shared with editor + menus)
let current = THEMES.neon;
export function getTheme() { return current; }
export function setGlobalTheme(id) { current = THEMES[id] || THEMES.neon; return current; }
export function paintCell(g, grid, x, y, cs, layer) { current.cell(g, grid, x, y, cs, layer); }
export function paintFloor(g, cs) { current.floor(g, cs); }
export function tankIcon(style, color, px = 108) {
  const c = mk(px, px), g = c.getContext('2d'), pad = px * 0.14;
  g.translate(pad, pad); current.tank(g, style, color, px - pad * 2, 0);
  return c;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.sprites = new Map(); this.particles = []; this.lights = []; this.texts = []; this.caches = new Map();
    this.shake = 0; this.time = 0; this.grid = new Uint8Array(W * H); this.gridStr = '';
    this.trackPos = new Map(); this.decalFade = 0; this.weather = [];
    this.theme = current;
    this.frameInfo = null; this.frameKey = ''; this.zoom = 'close'; this.dprCap = 3;
    this.cam = { x: 0, y: 0, s: 0, lx: 0, ly: 0, init: false }; this.baseSeen = new Map();
    this.resize();
  }

  setTheme(id) { this.theme = setGlobalTheme(id); this.particles = []; this.lights = []; this.resize(); }
  cache(key, fn) { if (!this.caches.has(key)) this.caches.set(key, fn()); return this.caches.get(key); }

  // Phones: main.js reports the HUD and safe-area sizes (CSS px) so the map is kept clear of them at its edges.
  setFrame(f) {
    const key = f ? [f.compact ? 1 : 0, f.top, f.bottom, f.left, f.right].map(v => Math.round(v)).join() : '';
    if (key === this.frameKey) return;
    this.frameKey = key; this.frameInfo = f; this.relayout();
  }
  setZoom(z) { if (!(z in ZOOMS) || z === this.zoom) return; this.zoom = z; this.relayout(); }
  setDprCap(d) { if (d === this.dprCap) return; this.dprCap = d; this.resize(); }
  resetCamera() { this.cam.init = false; this.cam.lx = this.cam.ly = 0; this.baseSeen.clear(); }
  relayout() { const cs = this.cs, c = this.compact; this.layout(); if (this.layerCs() !== cs || this.compact !== c) this.resize(); }

  // Where the map may sit on screen (device px), the cell size that shows the whole map,
  // and on phones the bigger cell size used while the view follows your tank.
  layout() {
    const k = this.scale, cw = this.canvas.width, ch = this.canvas.height, f = this.frameInfo;
    this.compact = !!(f && f.compact);
    this.rect = this.compact
      ? { l: f.left * k, t: f.top * k, r: cw - f.right * k, b: ch - f.bottom * k }
      : { l: 14 * k, t: 58 * k, r: cw - 14 * k, b: ch - 64 * k };
    const rw = Math.max(40, this.rect.r - this.rect.l), rh = Math.max(40, this.rect.b - this.rect.t);
    this.fitScs = Math.max(4, Math.floor(Math.min(rw / W, rh / H)));
    const across = this.compact ? ZOOMS[this.zoom] : 0;
    this.zoomScs = across ? Math.max(this.fitScs, Math.round(Math.min(cw, ch) / across)) : this.fitScs;
  }
  // resolution of the pre-rendered map layers (zoomed views draw them scaled when a big map would use too much memory)
  layerCs() {
    if (this.theme.pixel) return 16;
    if (this.zoomScs <= this.fitScs) return this.fitScs;
    return Math.min(this.zoomScs, Math.max(this.fitScs, Math.floor(Math.sqrt(LAYER_BUDGET / (W * H)))));
  }

  resize() {
    const th = this.theme;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap || 3);
    let cw = Math.floor(innerWidth * dpr), ch = Math.floor(innerHeight * dpr);
    const cap = 3840 * 2160 * 1.05;
    if (cw * ch > cap) { const k = Math.sqrt(cap / (cw * ch)); cw = Math.floor(cw * k); ch = Math.floor(ch * k); }
    if (cw !== this.canvas.width || ch !== this.canvas.height || W !== this.mapW || H !== this.mapH) this.cam.init = false; // new screen or map: place the view at once (zoom changes glide)
    this.canvas.width = cw; this.canvas.height = ch;
    this.scale = cw / innerWidth;
    this.layout();
    this.scs = this.fitScs; // screen cell size (the camera changes it on phones)
    this.ox = Math.floor((this.rect.l + this.rect.r - this.scs * W) / 2); this.oy = Math.floor((this.rect.t + this.rect.b - this.scs * H) / 2);
    this.cs = this.layerCs(); // world cell size
    const cs = this.cs;
    this.world = th.pixel ? mk(W * cs, H * cs) : null;
    this.sprites.clear();
    this.floor = mk(W * cs, H * cs); th.floor(this.floor.getContext('2d'), cs);
    this.tiles = mk(W * cs, H * cs); this.trees = mk(W * cs, H * cs);
    this.decals = mk(W * cs, H * cs);
    this.water = [];
    if (th.water) for (let f = 0; f < 8; f++) { const c = mk(cs, cs); th.water(c.getContext('2d'), cs, f); this.water.push(c); }
    this.vignette = mk(cw, ch);
    const vg = this.vignette.getContext('2d');
    const gr = vg.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${(th.vignette ?? 0.55) * (this.compact ? 0.55 : 1)})`); // lighter on phones, where the map reaches the screen edges
    vg.fillStyle = gr; vg.fillRect(0, 0, cw, ch);
    this.weather = [];
    if (th.weather) for (let i = 0; i < (th.weather === 'snow' ? 260 : 140); i++) this.weather.push({ x: Math.random() * W, y: Math.random() * H, z: 0.4 + Math.random() * 0.6, p: Math.random() * TAU });
    this.trackPos.clear();
    this.mapW = W; this.mapH = H;
    if (this.grid.length !== W * H) { this.grid = new Uint8Array(W * H); this.gridStr = ''; this.hadMap = false; }
    this.fogTex = null; this.dark = null;
    this.redrawTiles(null);
  }
  // follow the map size announced by the game (host or snapshot)
  ensureSize(size) {
    if (size && (size[0] !== W || size[1] !== H)) setMapSize(size[0], size[1]);
    if (this.mapW !== W || this.mapH !== H) this.resize();
  }

  setMap(str) {
    if (str === this.gridStr) return;
    if (str.length !== this.grid.length) return;
    const changed = [];
    for (let i = 0; i < W * H; i++) { const v = str.charCodeAt(i) - 48; if (this.grid[i] !== v) { this.grid[i] = v; changed.push(i); } }
    this.gridStr = str;
    this.redrawTiles(changed.length > 200 || !this.hadMap ? null : changed);
    this.hadMap = true;
    this.specials = { boost: [], mine: [], tele: teleportPads(this.grid).pads };
    for (let i = 0; i < W * H; i++) { const v = this.grid[i]; if (v === T.BOOST) this.specials.boost.push(i); else if (v === T.MINE) this.specials.mine.push(i); }
  }

  redrawTiles(changed) {
    const cs = this.cs, th = this.theme, gt = this.tiles.getContext('2d'), gtr = this.trees.getContext('2d');
    const paintRegion = (x0, y0, x1, y1) => {
      for (const [g, layers] of [[gt, ['shadow', 'tiles']], [gtr, ['trees']]]) {
        g.save(); g.beginPath(); g.rect(x0 * cs, y0 * cs, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs); g.clip();
        g.clearRect(x0 * cs, y0 * cs, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs);
        for (const layer of layers)
          for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x1 + 1); x++) th.cell(g, this.grid, x, y, cs, layer);
        g.restore();
      }
    };
    if (!changed) { paintRegion(0, 0, W - 1, H - 1); return; }
    for (const i of changed) { const x = i % W, y = (i / W) | 0; paintRegion(Math.max(0, x - 1), Math.max(0, y - 1), Math.min(W - 1, x + 1), Math.min(H - 1, y + 1)); }
  }

  sprite(style, color, size, frame) {
    const key = style + color + size + frame;
    let s = this.sprites.get(key);
    if (!s) {
      const S = this.theme.pixel ? this.cs * size : this.cs * size * 0.98, pad = Math.ceil(this.cs * 0.7 * size / 2 + this.cs * 0.4);
      s = mk(S + pad * 2, S + pad * 2);
      const g = s.getContext('2d');
      if (this.theme.halo) { // dark outline so vehicles separate from busy terrain
        const tmp = mk(s.width, s.height), tg = tmp.getContext('2d'); tg.translate(pad, pad); this.theme.tank(tg, style, color, S, frame);
        g.shadowColor = this.theme.halo; g.shadowBlur = Math.max(2, this.cs * 0.14);
        g.drawImage(tmp, 0, 0); g.drawImage(tmp, 0, 0); g.shadowBlur = 0; g.drawImage(tmp, 0, 0);
      } else { g.translate(pad, pad); this.theme.tank(g, style, color, S, frame); }
      this.sprites.set(key, s);
    }
    return s;
  }

  shadowSprite(size) {
    const key = 'shadow' + size;
    let s = this.sprites.get(key);
    if (!s) {
      const S = this.cs * size, pad = Math.ceil(this.cs * 0.4);
      s = mk(S + pad * 2, S + pad * 2); s.pad = pad;
      const g = s.getContext('2d');
      if ('filter' in g) g.filter = `blur(${Math.max(1, this.cs * 0.14)}px)`;
      g.fillStyle = '#000'; rr(g, pad + S * 0.04, pad + S * 0.03, S * 0.92, S * 0.94, S * 0.12); g.fill();
      this.sprites.set(key, s);
    }
    return s;
  }

  // ---------- effects from events ----------
  addEvents(evs) {
    const fx = this.theme.fx;
    for (const e of evs) {
      const c = e.c || '#fff';
      switch (e.k) {
        case 'shot':
          if (fx.fire) { this.light(e.x, e.y, 1.3, '#ffcc66', 0.1); this.particles.push({ x: e.x, y: e.y, life: 0, max: 0.09, size: 0.55, color: '#ffe08a', type: 'fire' }); this.puff(e.x, e.y, 2, fx.smoke, 0.35, 0.6); }
          else { this.light(e.x, e.y, 1.2, c, 0.12); this.burst(e.x, e.y, 4, fx.sketch ? '#e8f2ff' : c, 3, 0.15, 0.08); }
          break;
        case 'boom': {
          const s = e.s || 1;
          if (fx.fire) {
            this.light(e.x, e.y, 2 + s * 1.5, '#ff9a3a', 0.4 + s * 0.05);
            for (let i = 0; i < 2 + s * 2; i++) this.particles.push({ x: e.x + (Math.random() - 0.5) * s * 0.4, y: e.y + (Math.random() - 0.5) * s * 0.4, vx: (Math.random() - 0.5) * s, vy: (Math.random() - 0.5) * s, life: 0, max: 0.25 + Math.random() * 0.25 + s * 0.04, size: 0.4 + s * 0.3 * Math.random() + s * 0.12, color: '#ffb347', type: 'fire' });
            this.burst(e.x, e.y, Math.round(6 * s), '#ffd27a', 5 + s * 2, 0.4, 0.07);
            this.puff(e.x, e.y, Math.round(3 + s * 3), fx.smoke, 0.5 + s * 0.25, 1.2 + s * 0.4);
            this.chips(e.x, e.y, Math.round(3 * s), '#2b2b2b');
            if (s >= 1.5) this.scorch(e.x, e.y, s * 0.5);
          } else if (fx.sketch) {
            for (let i = 0; i < 3; i++) this.particles.push({ x: e.x, y: e.y, life: -i * 0.06, max: 0.45 + s * 0.05, size: s * (0.8 + i * 0.35), color: i ? '#e8f2ff' : lighten(c, 0.3), type: 'ring' });
            this.burst(e.x, e.y, Math.round(6 * s), '#e8f2ff', 5 + s * 2, 0.4, 0.05);
          } else {
            this.light(e.x, e.y, 2 + s * 1.6, c, 0.35 + s * 0.05); this.light(e.x, e.y, 1 + s, '#ffffff', 0.15);
            this.burst(e.x, e.y, Math.round(8 * s), c, 6 + s * 2, 0.5, 0.12);
            this.burst(e.x, e.y, Math.round(5 * s), '#ffd9a0', 4 + s * 2, 0.4, 0.1);
            this.puff(e.x, e.y, Math.round(3 * s), fx.smoke, 0.4 + s * 0.25, 0.8);
            this.particles.push({ x: e.x, y: e.y, life: 0, max: 0.35 + s * 0.05, size: s * 1.2, color: c, type: 'ring' });
            if (s >= 2) this.scorch(e.x, e.y, s * 0.45);
          }
          if (s >= 2 && fx.fire) this.particles.push({ x: e.x, y: e.y, life: 0, max: 0.3, size: s * 1.1, color: 'rgba(255,255,255,0.5)', type: 'ring' });
          break;
        }
        case 'brick': this.chips(e.x, e.y, 7, fx.chip); if (e.s) this.burst(e.x, e.y, 6, fx.steel, 7, 0.3, 0.08); if (fx.light) this.light(e.x, e.y, 1.2, fx.fire ? '#ffb070' : '#ff7a45', 0.12); break;
        case 'steel': this.burst(e.x, e.y, 8, fx.steel, 8, 0.25, 0.07); if (fx.light) this.light(e.x, e.y, 1, fx.steel, 0.12); break;
        case 'hit': this.burst(e.x, e.y, 10, fx.fire ? '#ffd27a' : c, 7, 0.35, 0.09); if (fx.light) this.light(e.x, e.y, 1.4, fx.fire ? '#ffb347' : c, 0.2); if (fx.fire) this.puff(e.x, e.y, 2, fx.smoke, 0.35, 0.7); break;
        case 'spark': this.burst(e.x, e.y, 6, fx.sketch ? '#e8f2ff' : c, 5, 0.25, 0.07); break;
        case 'spawn': this.particles.push({ x: e.x, y: e.y, life: 0, max: 0.6, size: 2.2, color: c, type: 'ring' }); break;
        case 'pick': { const pc = PU_COLORS[e.t] || c; this.particles.push({ x: e.x, y: e.y, life: 0, max: 0.5, size: 3, color: pc, type: 'ring' }); if (fx.light) this.light(e.x, e.y, 3, pc, 0.4); this.texts.push({ x: e.x, y: e.y - 1, text: PU_LABEL[e.t] || '', color: pc, life: 0, max: 1.2 }); break; }
        case 'build': this.chips(e.x, e.y, 10, fx.chip); this.particles.push({ x: e.x, y: e.y, life: 0, max: 0.35, size: 1.5, color: fx.chip, type: 'ring' }); break;
        case 'shake': this.shake = Math.max(this.shake, e.a); break;
        case 'tele': { const tc = this.theme.fam === 'real' ? '#6fc2ff' : '#b36bff'; for (let i = 0; i < 3; i++) this.particles.push({ x: e.x, y: e.y, life: -i * 0.07, max: 0.45, size: 1.6 - i * 0.3, color: tc, type: 'ring' }); this.burst(e.x, e.y, 14, tc, 6, 0.35, 0.07); this.light(e.x, e.y, 2.5, tc, 0.3); break; }
        case 'splash': this.burst(e.x, e.y, 20, '#9fd4ff', 6, 0.6, 0.1); this.puff(e.x, e.y, 5, '#cfe8ff', 0.6, 0.9); break;
      }
    }
    if (this.particles.length > 3000) this.particles.splice(0, this.particles.length - 3000);
  }
  light(x, y, r, color, max) { if (this.theme.fx.light) this.lights.push({ x, y, r, color, life: 0, max }); }
  burst(x, y, n, color, spd, max, size) {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = spd * (0.3 + Math.random()); this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: max * (0.5 + Math.random()), size, color, type: 'spark' }); }
  }
  puff(x, y, n, color, size, max) {
    for (let i = 0; i < n; i++) this.particles.push({ x: x + (Math.random() - 0.5) * size, y: y + (Math.random() - 0.5) * size, vx: (Math.random() - 0.5) * 1.4, vy: (Math.random() - 0.5) * 1.4 - 0.2, life: 0, max: max * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.6), color, type: 'smoke' });
  }
  chips(x, y, n, color) {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = 2 + Math.random() * 5; this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.4 + Math.random() * 0.4, size: 0.12 + Math.random() * 0.12, color, type: 'chip', rot: Math.random() * 6 }); }
    this.puff(x, y, 2, this.theme.fx.fire ? this.theme.fx.dust || '#6b5a45' : '#6b3a2a', 0.45, 0.7);
  }
  scorch(x, y, r) {
    if (this.theme.fx.sketch) return;
    const g = this.decals.getContext('2d'), cs = this.cs;
    const gr = g.createRadialGradient(x * cs, y * cs, 0, x * cs, y * cs, r * cs);
    gr.addColorStop(0, 'rgba(10,8,5,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x * cs, y * cs, r * cs, 0, TAU); g.fill();
  }
  // Movement effects: tread marks, dust and exhaust. Your own tank gets the strongest version so it reads clearly.
  tracks(view, dt = 1 / 60, localId) {
    const fx = this.theme.fx, g = this.decals.getContext('2d'), cs = this.cs;
    for (const t of view.tk) {
      const [id, x100, y100, dir, size, , color, flags, , , owner] = t;
      if (!(flags & 1)) continue;
      const x = x100 / 100, y = y100 / 100;
      const mine = !!(owner && localId && (localId.has ? localId.has(owner) : owner === localId));
      const back = [[0, 1], [-1, 0], [0, -1], [1, 0]][dir], side = [back[1], -back[0]];
      const rx = x + size / 2 + back[0] * size * 0.48, ry = y + size / 2 + back[1] * size * 0.48; // rear centre
      const fast = flags & 64 ? 1.8 : 1;
      // exhaust: neon glow motes, or a little diesel smoke behind your own tank in the realistic styles
      if (fx.exhaust === 'glow') {
        const rate = (mine ? 34 : 9) * fast;
        for (let k = Math.random() < (rate * dt) % 1 ? 1 : 0, n = Math.floor(rate * dt) + k; n > 0; n--) {
          const off = (Math.random() - 0.5) * size * 0.55, sp = 1.2 + Math.random() * 1.4;
          this.particles.push({ x: rx + side[0] * off, y: ry + side[1] * off, vx: back[0] * sp + side[0] * (Math.random() - 0.5) * 0.8, vy: back[1] * sp + side[1] * (Math.random() - 0.5) * 0.8, life: 0, max: 0.25 + Math.random() * 0.25, size: (mine ? 0.15 : 0.12) * size, color: Math.random() < 0.1 ? '#ffffff' : color, type: 'glow' });
        }
      } else if (fx.exhaust === 'smoke' && mine && Math.random() < 5 * dt * fast) {
        this.particles.push({ x: rx, y: ry, vx: back[0] * 0.5 + (Math.random() - 0.5) * 0.3, vy: back[1] * 0.5 + (Math.random() - 0.5) * 0.3 - 0.15, life: 0, max: 0.8 + Math.random() * 0.4, size: 0.16 * size, color: fx.smoke, type: 'smoke' });
      }
      const last = this.trackPos.get(id);
      if (last && Math.hypot(last[0] - x, last[1] - y) < 0.3) continue;
      this.trackPos.set(id, [x, y]);
      const vert = dir % 2 === 0, s = size * cs;
      const treads = (k, q, w = 0) => {
        if (vert) { g.fillRect(x * cs + s * 0.04 - w, y * cs + s * 0.45 - w, s * k + w * 2, s * q + w * 2); g.fillRect(x * cs + s * (0.96 - k) - w, y * cs + s * 0.45 - w, s * k + w * 2, s * q + w * 2); }
        else { g.fillRect(x * cs + s * 0.45 - w, y * cs + s * 0.04 - w, s * q + w * 2, s * k + w * 2); g.fillRect(x * cs + s * 0.45 - w, y * cs + s * (0.96 - k) - w, s * q + w * 2, s * k + w * 2); }
      };
      if (fx.track === 'tank') { // neon: light trails in the tank's own colour, a soft halo plus a brighter core
        g.fillStyle = tint(color, mine ? 0.12 : 0.06); treads(0.16, 0.12, cs * 0.06);
        g.fillStyle = tint(color, mine ? 0.42 : 0.2); treads(0.1, 0.1);
      } else if (fx.track) {
        g.fillStyle = fx.track;
        const k = fx.fire ? 0.2 : 0.16, q = fx.fire ? 0.2 : 0.12;
        treads(k, q);
      }
      if (fx.dust && Math.random() < (mine ? 1 : fx.dustChance ?? 0.55)) {
        this.particles.push({ x: rx + (Math.random() - 0.5) * size * 0.6, y: ry + (Math.random() - 0.5) * size * 0.6, vx: back[0] * 0.6 + (Math.random() - 0.5) * 0.5, vy: back[1] * 0.6 + (Math.random() - 0.5) * 0.5, life: 0, max: 0.7 + Math.random() * 0.5, size: (mine ? 0.4 : 0.35) * size * (fx.dustSize || 1), color: fx.dust, type: 'smoke' });
      }
    }
    if (this.trackPos.size > 400) this.trackPos.clear();
  }

  glowSprite(color) { // cached soft dot used for neon exhaust
    const key = 'glow' + color;
    let s = this.caches.get(key);
    if (!s) {
      s = mk(64, 64); const g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.3, tint(color, 0.8)); gr.addColorStop(1, tint(color, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); this.caches.set(key, s);
    }
    return s;
  }

  // ---------- frame ----------
  render(view, dt, localId) {
    this.time += dt;
    const th = this.theme, main = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    main.setTransform(1, 0, 0, 1, 0, 0); main.imageSmoothingEnabled = true;
    main.fillStyle = th.bg; main.fillRect(0, 0, cw, ch);
    if (!view) return;
    this.ensureSize(view.hud && view.hud.size);
    if (view.map) this.setMap(view.map);
    this.tracks(view, dt, localId);
    this.decalFade += dt;
    if (this.decalFade > 0.5) { this.decalFade = 0; const d = this.decals.getContext('2d'); d.globalCompositeOperation = 'destination-out'; d.fillStyle = `rgba(0,0,0,${th.fx.trackFade ?? 0.04})`; d.fillRect(0, 0, this.decals.width, this.decals.height); d.globalCompositeOperation = 'source-over'; }

    this.updateCamera(view, dt, localId);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const shS = this.shake * Math.min(this.scs, this.fitScs * 1.5) * 0.45, sx = (Math.random() - 0.5) * shS, sy = (Math.random() - 0.5) * shS;
    // frame (screen space)
    main.save(); main.translate(this.ox + sx, this.oy + sy); th.frame(main, this.scs); main.restore();

    // world pass
    let g, cs = this.cs;
    if (this.world) { g = this.world.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false; g.clearRect(0, 0, this.world.width, this.world.height); }
    else { g = main; g.save(); g.translate(this.ox + sx, this.oy + sy); if (this.scs !== cs) g.scale(this.scs / cs, this.scs / cs); }
    g.drawImage(this.floor, 0, 0);
    g.drawImage(this.decals, 0, 0);
    g.drawImage(this.tiles, 0, 0);
    if (this.water.length) {
      g.globalCompositeOperation = th.waterBlend || 'source-over';
      const wf = Math.floor(this.time * 6);
      for (let i = 0; i < W * H; i++) if (this.grid[i] === T.WATER) { const x = i % W, y = (i / W) | 0; g.drawImage(this.water[(wf + x + y) & 7], x * cs, y * cs); }
      g.globalCompositeOperation = 'source-over';
    }
    this.drawSpecials(g);
    const mode = view.hud && view.hud.mode;
    const ar = view.hud && view.hud.arena;
    if (ar) { // duel arena: dim everything outside and outline the ring
      const [x0, y0, x1, y1] = ar;
      g.fillStyle = th.id === 'winter' ? 'rgba(20,35,55,0.45)' : 'rgba(0,0,0,0.62)';
      g.fillRect(0, 0, W * cs, y0 * cs); g.fillRect(0, y1 * cs, W * cs, (H - y1) * cs);
      g.fillRect(0, y0 * cs, x0 * cs, (y1 - y0) * cs); g.fillRect(x1 * cs, y0 * cs, (W - x1) * cs, (y1 - y0) * cs);
      g.save(); g.strokeStyle = th.fx.add ? '#ff4fd8' : 'rgba(255,255,255,0.8)'; g.lineWidth = Math.max(2, cs * 0.12);
      if (th.fx.add) { g.shadowColor = '#ff4fd8'; g.shadowBlur = cs * 0.6; }
      g.strokeRect(x0 * cs, y0 * cs, (x1 - x0) * cs, (y1 - y0) * cs); g.restore();
    }
    this.drawBases(g, view, mode);
    this.drawPowerups(g, view);
    this.drawTanks(g, view, localId);
    this.drawFlags(g, view);
    this.drawBullets(g, view);
    this.updateParticles(g, dt);
    g.drawImage(this.trees, 0, 0);
    const atmo = view.hud && view.hud.atmo;
    if (atmo === 'fog') this.drawFog(g);
    if (atmo === 'night') this.drawNight(g, view, localId);
    if (view.hud && view.hud.zone) this.drawZone(g, view.hud.zone);
    this.drawWeather(g, dt);
    this.drawAir(g, view);
    this.drawLights(g, dt);
    if (this.world) {
      main.save(); main.imageSmoothingEnabled = false;
      main.drawImage(this.world, this.ox + sx, this.oy + sy, W * this.scs, H * this.scs);
      main.restore();
    } else g.restore();

    // labels in screen space
    main.save(); main.translate(this.ox + sx, this.oy + sy);
    this.drawLabels(main, view, this.scs, dt);
    main.restore();
    if (th.post) th.post(main, cw, ch, this);
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.drawImage(this.vignette, 0, 0);
    if (view.hud && view.hud.freeze) { main.fillStyle = 'rgba(80,160,255,0.06)'; main.fillRect(0, 0, cw, ch); }
    if (this.compact) this.drawOffscreen(main, view, localId);
  }

  // ---------- camera ----------
  // Whole map on big screens. On phones the view zooms in and follows your tank (both tanks when two
  // people share the device), looks a little ahead while you drive, holds still while you respawn and
  // shows the whole map when you are only watching.
  updateCamera(view, dt, localId) {
    const r = this.rect, rw = r.r - r.l, rh = r.b - r.t, cam = this.cam;
    let ts = this.fitScs, tx = W / 2, ty = H / 2;
    if (this.compact && this.zoomScs > this.fitScs) {
      const has = id => !!(id && localId && (localId.has ? localId.has(id) : id === localId));
      const mine = view.tk.filter(t => has(t[10]));
      if (mine.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const t of mine) { const x = t[1] / 100 + t[4] / 2, y = t[2] / 100 + t[4] / 2; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        ts = Math.max(this.fitScs, Math.min(this.zoomScs, rw / (x1 - x0 + 16), rh / (y1 - y0 + 10)));
        let lx = 0, ly = 0;
        if (mine.length === 1 && (mine[0][7] & 1)) { const d = AHEAD[mine[0][3]] || [0, 0]; lx = d[0] * rw / ts * 0.13; ly = d[1] * rh / ts * 0.13; }
        const la = 1 - Math.exp(-dt * 1.5); cam.lx += (lx - cam.lx) * la; cam.ly += (ly - cam.ly) * la;
        tx = (x0 + x1) / 2 + cam.lx; ty = (y0 + y1) / 2 + cam.ly;
      } else {
        const ps = (view.hud && view.hud.players) || [];
        if (cam.init && ps.some(p => has(p[0]) && p[6] === 0)) { tx = cam.x; ty = cam.y; ts = Math.max(cam.s, this.fitScs); } // respawning: hold the view
        cam.lx = cam.ly = 0;
      }
    }
    const m = 0.35; // a sliver of the map frame stays visible at the edges
    const fitC = (c, s, span, n) => { const v = span / s; return v >= n + 2 * m ? n / 2 : Math.max(v / 2 - m, Math.min(n - v / 2 + m, c)); };
    tx = fitC(tx, ts, rw, W); ty = fitC(ty, ts, rh, H);
    if (!cam.init) { cam.x = tx; cam.y = ty; cam.s = ts; cam.init = true; }
    else {
      const a = 1 - Math.exp(-dt * 6), az = 1 - Math.exp(-dt * 4);
      cam.s = Math.abs(ts - cam.s) < 0.05 ? ts : cam.s + (ts - cam.s) * az;
      cam.x += (tx - cam.x) * a; cam.y += (ty - cam.y) * a;
      cam.x = fitC(cam.x, cam.s, rw, W); cam.y = fitC(cam.y, cam.s, rh, H);
    }
    this.scs = cam.s;
    this.ox = Math.round((r.l + r.r) / 2 - cam.x * cam.s); this.oy = Math.round((r.t + r.b) / 2 - cam.y * cam.s);
  }

  // Phones: small arrows at the screen edge for what the zoomed view can't show (your base, other tanks, flags).
  drawOffscreen(g, view, localId) {
    const r = this.rect, s = this.scs, k = this.scale;
    const vx0 = (r.l - this.ox) / s, vy0 = (r.t - this.oy) / s, vx1 = (r.r - this.ox) / s, vy1 = (r.b - this.oy) / s;
    if (vx0 <= 0.01 && vy0 <= 0.01 && vx1 >= W - 0.01 && vy1 >= H - 0.01) return;
    const hud = view.hud || {}, mode = hud.mode, ffa = mode === 'deathmatch' || mode === 'duel', teams = mode === 'battle' || mode === 'ctf';
    const has = id => !!(id && localId && (localId.has ? localId.has(id) : id === localId));
    const me = view.tk.find(t => has(t[10])) || null;
    const myTeam = me ? me[11] : (((hud.players || []).find(p => has(p[0])) || [])[8]);
    const items = [];
    for (const b of view.bs || []) {
      if (!b[3]) continue;
      const key = b[0] + ',' + b[1], seen = this.baseSeen.get(key);
      if (seen && b[4] < seen.hp) seen.alert = this.time + 3;
      this.baseSeen.set(key, { hp: b[4], alert: seen ? seen.alert : 0 });
      const own = !teams || b[2] === myTeam;
      items.push({ x: b[0] + 1, y: b[1] + 1, c: teams ? TEAM_MAIN[b[2]] : '#ffd23f', kind: own ? 'base' : 'enemyBase', alert: own && seen && seen.alert > this.time });
    }
    for (const t of view.tk) {
      if (has(t[10]) || (t[7] & 4)) continue;
      const friend = !ffa && (teams ? t[11] === myTeam : t[5][0] === 'p');
      items.push({ x: t[1] / 100 + t[4] / 2, y: t[2] / 100 + t[4] / 2, c: friend ? t[6] : ffa ? t[6] : '#ff4d5e', kind: friend ? 'friend' : 'enemy' });
    }
    for (const f of view.fl || []) if (!f[3]) items.push({ x: f[1], y: f[2], c: TEAM_MAIN[f[0]], kind: 'flag' });
    for (const u of view.pu || []) items.push({ x: u[2] + 1, y: u[3] + 1, c: PU_COLORS[u[1]] || '#fff', kind: 'pickup' });
    const M = 15 * k, cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2, hw = (r.r - r.l) / 2 - M, hh = (r.b - r.t) / 2 - M;
    g.save();
    for (const it of items) {
      if (it.x > vx0 && it.x < vx1 && it.y > vy0 && it.y < vy1) continue;
      const dx = this.ox + it.x * s - cx, dy = this.oy + it.y * s - cy;
      const t = Math.min(hw / Math.max(1e-6, Math.abs(dx)), hh / Math.max(1e-6, Math.abs(dy)));
      const ex = cx + dx * t, ey = cy + dy * t, ang = Math.atan2(dy, dx);
      const dist = Math.max(it.x - vx1, vx0 - it.x, it.y - vy1, vy0 - it.y, 0);
      const big = it.kind === 'base' || it.kind === 'enemyBase' || it.kind === 'flag' || it.kind === 'pickup';
      g.globalAlpha = big ? 0.95 : Math.max(0.4, 0.95 - dist / 40);
      g.translate(ex, ey); g.rotate(ang);
      const z = (big ? 9 : it.kind === 'friend' ? 7 : 6) * k;
      g.beginPath(); g.moveTo(z * 1.25, 0); g.lineTo(-z * 0.7, -z * 0.85); g.lineTo(-z * 0.35, 0); g.lineTo(-z * 0.7, z * 0.85); g.closePath();
      g.fillStyle = it.alert && Math.floor(this.time * 6) % 2 ? '#ff2a2a' : it.c; g.fill();
      g.lineWidth = 1.5 * k; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.stroke();
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (big) { // a small badge next to the arrow: the base or flag being pointed at
        const bx = ex - Math.cos(ang) * 14 * k, by = ey - Math.sin(ang) * 14 * k, R = 7 * k;
        g.beginPath(); g.arc(bx, by, R, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.65)'; g.fill();
        g.lineWidth = 2 * k; g.strokeStyle = it.alert && Math.floor(this.time * 6) % 2 ? '#ff2a2a' : it.c; g.stroke();
        g.fillStyle = it.c;
        if (it.kind === 'pickup') { g.beginPath(); g.moveTo(bx, by - R * 0.6); g.lineTo(bx + R * 0.5, by); g.lineTo(bx, by + R * 0.6); g.lineTo(bx - R * 0.5, by); g.closePath(); g.fill(); }
        else if (it.kind === 'flag') { g.fillRect(bx - R * 0.35, by - R * 0.55, R * 0.12 * 2, R * 1.1); g.beginPath(); g.moveTo(bx - R * 0.15, by - R * 0.55); g.lineTo(bx + R * 0.55, by - R * 0.3); g.lineTo(bx - R * 0.15, by - R * 0.05); g.fill(); }
        else { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? R * 0.28 : R * 0.65; g.lineTo(bx + Math.cos(a) * q, by + Math.sin(a) * q); } g.closePath(); g.fill(); }
      }
    }
    g.restore();
  }

  drawBases(g, view, mode) {
    const cs = this.cs, t = this.time, th = this.theme;
    for (const [x, y, team, alive, hp, maxHp] of view.bs || []) {
      const cx = (x + 1) * cs, cy = (y + 1) * cs, R = cs * 0.95;
      const color = mode === 'battle' || mode === 'ctf' ? TEAM_MAIN[team] : '#ffd23f';
      g.save(); g.translate(cx, cy);
      if (mode === 'ctf') {
        g.strokeStyle = color; g.lineWidth = cs * 0.1; if (th.fx.add) { g.shadowColor = color; g.shadowBlur = cs * 0.6; }
        g.setLineDash([cs * 0.3, cs * 0.2]); g.lineDashOffset = t * cs; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke();
        g.setLineDash([]); g.globalAlpha = 0.18; g.fillStyle = color; g.fill(); g.restore(); continue;
      }
      th.base(g, cs, R, color, alive, t);
      g.restore();
      if (!alive && th.fx.fire && Math.random() < 0.12) this.puff(x + 1, y + 1, 1, th.fx.smoke, 0.6, 1.6);
      if (maxHp > 1 && alive) this.bar(g, x * cs, (y - 0.5) * cs, 2 * cs, hp / maxHp, color);
    }
  }

  drawPowerups(g, view) {
    const cs = this.cs, t = this.time, th = this.theme;
    for (const [id, type, x, y, blink] of view.pu || []) {
      if (blink && Math.floor(t * 8) % 2) continue;
      const color = PU_COLORS[type] || '#fff';
      const bob = th.pixel ? 0 : Math.sin(t * 3 + id) * cs * 0.12;
      const cx = (x + 1) * cs, cy = (y + 1) * cs + bob, s = cs * 1.7;
      g.save(); th.pickup(g, cx, cy, s, color, cs, type); g.restore();
    }
  }

  drawTanks(g, view, localId) {
    const cs = this.cs, t = this.time, th = this.theme, add = th.fx.add;
    for (const tk of view.tk) {
      const [id, x100, y100, dir, size, style, color, flags, hp, maxHp, owner, team] = tk;
      const x = x100 / 100, y = y100 / 100, S = size * cs;
      const cx = x * cs + S / 2, cy = y * cs + S / 2;
      if (flags & 4) { // spawning star
        g.save(); g.translate(cx, cy); g.rotate(t * 6); g.globalCompositeOperation = add ? 'lighter' : 'source-over';
        const k = 0.5 + Math.abs(Math.sin(t * 10)) * 0.6;
        g.fillStyle = add ? color : rgba('#ffffff', 0.85); if (add) { g.shadowColor = color; g.shadowBlur = cs; }
        g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = (i % 2 ? 0.15 : 0.55) * S * k; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill();
        if (!add) { g.strokeStyle = color; g.lineWidth = cs * 0.08; g.stroke(); }
        g.restore(); continue;
      }
      if (owner && localId && (localId.has ? localId.has(owner) : owner === localId)) {
        g.save(); g.strokeStyle = add ? 'rgba(255,255,255,0.35)' : rgba(color, 0.8); g.lineWidth = cs * 0.06; g.setLineDash([cs * 0.25, cs * 0.2]); g.lineDashOffset = -t * cs;
        g.beginPath(); g.arc(cx, cy, S * 0.72, 0, TAU); g.stroke(); g.restore();
      }
      const flash = (flags & 16) && Math.floor(t * 6) % 2;
      let col = flash ? '#ffffff' : color;
      if (style === 'armor' && !flash) col = ['#ff4d4d', '#ff4d4d', '#ffcf3d', '#3dff8b', '#d7dde8'][Math.max(0, Math.min(4, hp))];
      const spr = this.sprite(style, col, size, (flags & 1) ? Math.floor(t * 14) % 2 : 0);
      if (th.markers) { // coloured ground ring: who is who at a glance
        const mc = style[0] === 'p' ? color : style === 'bot' ? (TEAM_MAIN[team] || color) : '#ff3b30';
        g.save(); g.fillStyle = rgba(mc, 0.2); g.strokeStyle = rgba(mc, 0.95); g.lineWidth = Math.max(2, cs * 0.08);
        g.beginPath(); g.ellipse(cx, cy + S * 0.04, S * 0.68, S * 0.68, 0, 0, TAU); g.fill(); g.stroke(); g.restore();
      }
      if (th.tankShadow) {
        const sh = this.shadowSprite(size);
        g.save(); g.globalAlpha = th.tankShadow; g.drawImage(sh, x * cs + S * 0.1 - sh.pad, y * cs + S * 0.14 - sh.pad); g.restore();
      }
      g.save(); g.translate(cx, cy); g.rotate(dir * Math.PI / 2);
      if (flags & 64) { g.globalAlpha = 0.25; g.drawImage(spr, -spr.width / 2, -spr.width / 2 + cs * 0.9); g.globalAlpha = 1; }
      g.drawImage(spr, -spr.width / 2, -spr.height / 2);
      g.restore();
      if (flags & 8) { // frozen
        g.save(); g.fillStyle = 'rgba(140,210,255,0.3)'; g.strokeStyle = '#dff'; g.lineWidth = cs * 0.05;
        rr(g, x * cs, y * cs, S, S, cs * 0.3); g.fill(); g.stroke(); g.restore();
      }
      if (flags & 2) { // shield
        g.save(); g.globalCompositeOperation = add ? 'lighter' : 'source-over'; g.translate(cx, cy); g.rotate(t * 2);
        g.strokeStyle = add ? 'rgba(120,240,255,0.8)' : 'rgba(90,200,255,0.95)'; g.lineWidth = cs * 0.08; if (add) { g.shadowColor = '#3de0ff'; g.shadowBlur = cs * 0.7; }
        hex(g, S * 0.72); g.stroke();
        g.fillStyle = 'rgba(80,200,255,0.12)'; g.fill(); g.restore();
      }
      if (flags & 32) this.flagShape(g, cx + S * 0.2, cy - S * 0.2, cs, TEAM_MAIN[1 - team]);
      if (maxHp > 1 && !(style === 'armor')) this.bar(g, x * cs, y * cs - cs * 0.45, S, hp / maxHp, style === 'boss' ? '#ff2a2a' : color);
    }
  }

  drawLabels(g, view, cs, dt) {
    const lab = this.theme.label || NEON.label;
    if (view.names) {
      g.font = lab.font.replace('{s}', Math.max((this.compact ? 10 : 9) * this.scale, cs * 0.5).toFixed(1)); g.textAlign = 'center'; g.textBaseline = 'top';
      for (const tk of view.tk) {
        const [, x100, y100, , size, , color, flags, , , owner] = tk;
        if (!owner || (flags & 4)) continue;
        const name = view.names[owner]; if (!name) continue;
        const x = x100 / 100 * cs + size * cs / 2, y = y100 / 100 * cs + size * cs + cs * 0.12;
        if (lab.outline) { g.lineWidth = Math.max(2, cs * 0.12); g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineJoin = 'round'; g.strokeText(name, x, y); }
        else { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(name, x + 1, y + 1); }
        g.fillStyle = color; g.fillText(name, x, y);
      }
    }
    this.texts = this.texts.filter(x => (x.life += dt) < x.max);
    g.save(); g.textAlign = 'center'; g.font = lab.big.replace('{s}', (cs * 0.75).toFixed(1));
    for (const x of this.texts) {
      const k = x.life / x.max; g.globalAlpha = 1 - k * k;
      const tx = x.x * cs, ty = (x.y - k * 1.5) * cs;
      if (lab.outline) { g.lineWidth = cs * 0.15; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(x.text, tx, ty); }
      else if (this.theme.fx.add) { g.shadowColor = x.color; g.shadowBlur = cs * 0.5; }
      g.fillStyle = x.color; g.fillText(x.text, tx, ty);
    }
    g.restore();
  }

  flagShape(g, x, y, cs, color) {
    const t = this.time;
    g.save(); g.strokeStyle = '#ddd'; g.lineWidth = cs * 0.08; g.beginPath(); g.moveTo(x, y + cs * 0.9); g.lineTo(x, y - cs * 0.9); g.stroke();
    g.fillStyle = color; if (this.theme.fx.add) { g.shadowColor = color; g.shadowBlur = cs * 0.6; }
    g.beginPath(); g.moveTo(x, y - cs * 0.9);
    for (let i = 0; i <= 6; i++) g.lineTo(x + i * cs * 0.18, y - cs * 0.9 + Math.sin(t * 8 + i) * cs * 0.08);
    for (let i = 6; i >= 0; i--) g.lineTo(x + i * cs * 0.18, y - cs * 0.2 + Math.sin(t * 8 + i) * cs * 0.08);
    g.closePath(); g.fill(); g.restore();
  }

  drawFlags(g, view) {
    const cs = this.cs;
    for (const [team, x, y, carried] of view.fl || []) if (!carried) this.flagShape(g, x * cs, y * cs, cs * 1.2, TEAM_MAIN[team]);
  }

  drawBullets(g, view) {
    const cs = this.cs, th = this.theme;
    for (const [id, x100, y100, vx10, vy10, color, heavy] of view.b) {
      g.save(); th.bullet(g, x100 / 100 * cs, y100 / 100 * cs, vx10 / 10, vy10 / 10, color, heavy, cs); g.restore();
    }
  }

  updateParticles(g, dt) {
    const cs = this.cs, fx = this.theme.fx;
    g.save();
    const alive = [];
    for (const p of this.particles) {
      p.life += dt; if (p.life >= p.max) continue; alive.push(p);
      if (p.life < 0) continue;
      const k = 1 - p.life / p.max;
      if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; const d = p.type === 'smoke' ? 0.985 : 0.93; p.vx *= d; p.vy *= d; }
      const X = p.x * cs, Y = p.y * cs;
      if (fx.square) { // pixel look: everything is a square
        g.globalCompositeOperation = p.type === 'smoke' || p.type === 'chip' ? 'source-over' : 'lighter';
        g.globalAlpha = p.type === 'smoke' ? k * 0.5 : k;
        g.fillStyle = p.type === 'fire' ? (k > 0.5 ? '#fcfcfc' : '#fc9838') : p.color;
        if (p.type === 'ring') { const R = Math.floor(p.size * cs * (1 - k * k)); const s = Math.max(2, Math.floor(cs * 0.12)); for (let i = 0; i < 8; i++) { const a = i * TAU / 8; g.fillRect(Math.floor(X + Math.cos(a) * R), Math.floor(Y + Math.sin(a) * R), s, s); } }
        else { const s = Math.max(2, Math.round((p.type === 'smoke' ? p.size * (1.4 - k * 0.4) : p.type === 'fire' ? p.size : p.size * 1.6) * cs)); g.fillRect(Math.floor(X - s / 2), Math.floor(Y - s / 2), s, s); }
        continue;
      }
      if (p.type === 'smoke') {
        g.globalCompositeOperation = 'source-over';
        if (fx.sketch) { g.globalAlpha = k * 0.5; g.strokeStyle = p.color; g.lineWidth = 1; g.beginPath(); g.arc(X, Y, p.size * cs * (1.5 - k * 0.5), 0, TAU); g.stroke(); }
        else { g.globalAlpha = k * (fx.fire ? 0.45 : 0.35); g.fillStyle = p.color; g.beginPath(); g.arc(X, Y, p.size * cs * (1.6 - k * 0.6), 0, TAU); g.fill(); }
      } else if (p.type === 'fire') {
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, k * 1.4);
        const R = p.size * cs * (0.7 + (1 - k) * 0.6);
        const gr = g.createRadialGradient(X, Y, 0, X, Y, R);
        gr.addColorStop(0, 'rgba(255,250,220,0.95)'); gr.addColorStop(0.35, 'rgba(255,190,80,0.85)'); gr.addColorStop(0.75, 'rgba(230,80,20,0.5)'); gr.addColorStop(1, 'rgba(120,30,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(X, Y, R, 0, TAU); g.fill();
      } else if (p.type === 'glow') {
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = k * 0.65;
        const R = p.size * cs * (1 + (1 - k) * 0.9);
        g.drawImage(this.glowSprite(p.color), X - R, Y - R, R * 2, R * 2);
      } else if (p.type === 'ring') {
        g.globalCompositeOperation = fx.add ? 'lighter' : 'source-over'; g.globalAlpha = k; g.strokeStyle = p.color; g.lineWidth = cs * 0.12 * k + 1;
        g.beginPath(); g.arc(X, Y, p.size * cs * (1 - k * k) + 1, 0, TAU); g.stroke();
      } else if (p.type === 'chip') {
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(1, k * 2); g.fillStyle = p.color;
        p.rot += dt * 10; g.save(); g.translate(X, Y); g.rotate(p.rot); g.fillRect(-p.size * cs / 2, -p.size * cs / 2, p.size * cs, p.size * cs * 0.6); g.restore();
      } else {
        g.globalCompositeOperation = fx.add || fx.fire ? 'lighter' : 'source-over'; g.globalAlpha = k; g.strokeStyle = p.color; g.lineWidth = Math.max(1, p.size * cs); g.lineCap = 'round';
        g.beginPath(); g.moveTo(X, Y); g.lineTo((p.x - p.vx * 0.03) * cs, (p.y - p.vy * 0.03) * cs); g.stroke();
      }
    }
    this.particles = alive;
    g.restore();
  }

  // animated overlays for special terrain
  drawSpecials(g) {
    const sp = this.specials; if (!sp) return;
    const cs = this.cs, t = this.time, fam = this.theme.fam;
    g.save();
    if (sp.tele.length) {
      const col = fam === 'real' ? '#8fd0ff' : fam === 'bp' ? '#e8f2ff' : '#d49bff';
      g.globalCompositeOperation = fam === 'bp' || fam === 'real' ? 'source-over' : 'lighter'; g.strokeStyle = col; g.lineWidth = Math.max(1.5, cs * 0.09); g.lineCap = 'round';
      for (const p of sp.tele) {
        const cx = (p.x + 1) * cs, cy = (p.y + 1) * cs;
        for (let k = 0; k < 3; k++) { const a = t * 2.4 + k * TAU / 3; g.globalAlpha = 0.85; g.beginPath(); g.arc(cx, cy, cs * 0.66, a, a + 1.1); g.stroke(); }
        g.globalAlpha = 0.25 + Math.sin(t * 4 + p.x) * 0.15; g.fillStyle = col; g.beginPath(); g.arc(cx, cy, cs * 0.45, 0, TAU); g.fill();
      }
    }
    if (sp.mine.length && Math.floor(t * 1.6) % 2 === 0) {
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.fillStyle = '#ff2a2a';
      for (const i of sp.mine) { if (this.grid[i] !== T.MINE) continue; const x = i % W, y = (i / W) | 0; g.beginPath(); g.arc((x + 0.5) * cs, (y + 0.5) * cs, Math.max(1.5, cs * 0.07), 0, TAU); g.fill(); }
    }
    if (sp.boost.length && fam !== 'pixel') {
      g.globalCompositeOperation = fam === 'neon' ? 'lighter' : 'source-over';
      const k = (t * 1.6) % 1;
      g.fillStyle = fam === 'neon' ? 'rgba(61,224,255,0.35)' : 'rgba(255,240,180,0.28)';
      for (const i of sp.boost) { if (this.grid[i] !== T.BOOST) continue; const x = i % W, y = (i / W) | 0; g.globalAlpha = 1; g.fillRect(x * cs, (y + 1 - k) * cs - cs * 0.12, cs, cs * 0.12); }
    }
    g.restore();
  }

  drawFog(g) {
    const cs = this.cs, w = W * cs, h = H * cs;
    if (!this.fogTex) {
      const c = document.createElement('canvas'); c.width = Math.ceil(w / 2); c.height = Math.ceil(h / 2);
      const x = c.getContext('2d'), col = this.theme.fam === 'neon' ? [150, 130, 220] : this.theme.id === 'desert' ? [225, 200, 160] : [220, 226, 232];
      for (let i = 0; i < 90; i++) { const px = Math.random() * c.width, py = Math.random() * c.height, R = (0.06 + Math.random() * 0.14) * c.width; const gr = x.createRadialGradient(px, py, 0, px, py, R); gr.addColorStop(0, `rgba(${col},0.55)`); gr.addColorStop(1, `rgba(${col},0)`); x.fillStyle = gr; x.fillRect(px - R, py - R, R * 2, R * 2); }
      this.fogTex = c;
    }
    const t = this.time;
    g.save(); g.globalAlpha = 0.6;
    const ox = (t * cs * 0.4) % w;
    g.drawImage(this.fogTex, -ox, 0, w, h); g.drawImage(this.fogTex, w - ox, 0, w, h);
    g.globalAlpha = 0.35; const oy = (t * cs * 0.25) % h;
    g.drawImage(this.fogTex, 0, -oy, w, h); g.drawImage(this.fogTex, 0, h - oy, w, h);
    g.restore();
  }

  drawNight(g, view, localId) {
    const cs = this.cs, w = W * cs, h = H * cs;
    if (!this.dark || this.dark.width !== Math.ceil(w / 2)) { this.dark = document.createElement('canvas'); this.dark.width = Math.ceil(w / 2); this.dark.height = Math.ceil(h / 2); }
    const d = this.dark.getContext('2d'), k = 0.5; // half-resolution mask, soft edges when scaled up
    d.globalCompositeOperation = 'source-over'; d.clearRect(0, 0, this.dark.width, this.dark.height);
    d.fillStyle = this.theme.id === 'winter' ? 'rgba(10,20,45,0.86)' : 'rgba(2,4,12,0.9)'; d.fillRect(0, 0, this.dark.width, this.dark.height);
    d.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a = 1) => { const X = x * cs * k, Y = y * cs * k, R = r * cs * k; const gr = d.createRadialGradient(X, Y, R * 0.35, X, Y, R); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); d.fillStyle = gr; d.fillRect(X - R, Y - R, R * 2, R * 2); };
    const mine = view.tk.filter(t => t[10] && localId && localId.has && localId.has(t[10]));
    const teams = new Set(mine.map(t => t[11]));
    for (const t of view.tk) {
      const x = t[1] / 100 + t[4] / 2, y = t[2] / 100 + t[4] / 2;
      if (mine.includes(t)) hole(x, y, 7.5);
      else if (teams.has(t[11]) && t[5][0] === 'p') hole(x, y, 4.5, 0.85);
    }
    if (!mine.length) d.globalAlpha = 1, hole(W / 2, H / 2, Math.max(W, H), 0.45);
    for (const b of view.b) hole(b[1] / 100, b[2] / 100, 1.3, 0.8);
    for (const l of this.lights) hole(l.x, l.y, l.r * 1.6, Math.max(0, 1 - l.life / l.max));
    for (const b of view.bs || []) if (b[3]) hole(b[0] + 1, b[1] + 1, 3.2, 0.7);
    g.drawImage(this.dark, 0, 0, w, h);
  }

  drawZone(g, z) {
    const cs = this.cs, [zx, zy, zr] = z, t = this.time;
    g.save();
    g.beginPath(); g.rect(0, 0, W * cs, H * cs); g.arc(zx * cs, zy * cs, zr * cs, 0, TAU, true);
    g.fillStyle = `rgba(255,40,40,${0.16 + Math.sin(t * 3) * 0.04})`; g.fill();
    g.strokeStyle = '#ff3b30'; g.lineWidth = Math.max(2, cs * 0.12); g.setLineDash([cs * 0.4, cs * 0.25]); g.lineDashOffset = -t * cs;
    if (this.theme.fx.add) { g.shadowColor = '#ff3b30'; g.shadowBlur = cs * 0.6; }
    g.beginPath(); g.arc(zx * cs, zy * cs, zr * cs, 0, TAU); g.stroke();
    g.restore();
  }

  drawWeather(g, dt) {
    const w = this.theme.weather; if (!w) return;
    const cs = this.cs, t = this.time;
    g.save();
    if (w === 'snow') {
      g.fillStyle = '#ffffff';
      for (const f of this.weather) {
        f.y += dt * 1.1 * f.z; f.x += dt * (0.5 + Math.sin(t + f.p) * 0.5) * f.z;
        if (f.y > H) { f.y = -0.2; f.x = Math.random() * W; } if (f.x > W) f.x = 0;
        g.globalAlpha = 0.5 + f.z * 0.45; g.beginPath(); g.arc(f.x * cs, f.y * cs, cs * 0.06 * (0.6 + f.z), 0, TAU); g.fill();
      }
    } else if (w === 'sand') {
      g.strokeStyle = 'rgba(235,205,150,0.55)'; g.lineCap = 'round';
      for (const f of this.weather) {
        f.x += dt * 7 * f.z; f.y += dt * Math.sin(t * 2 + f.p) * 0.4;
        if (f.x > W) { f.x = -1; f.y = Math.random() * H; }
        g.globalAlpha = 0.25 + f.z * 0.35; g.lineWidth = Math.max(1, cs * 0.04 * f.z);
        g.beginPath(); g.moveTo(f.x * cs, f.y * cs); g.lineTo((f.x - 0.6 * f.z) * cs, f.y * cs); g.stroke();
      }
    }
    g.restore();
  }

  drawAir(g, view) {
    const cs = this.cs, t = this.time, add = this.theme.fx.add;
    for (const [x, y, rem, r] of view.air || []) {
      const k = Math.max(0, Math.min(1, 1 - rem / 2.5));
      g.save(); g.translate(x * cs, y * cs);
      g.strokeStyle = '#ff2a2a'; g.lineWidth = cs * 0.08; if (add) { g.shadowColor = '#ff2a2a'; g.shadowBlur = cs * 0.6; }
      g.setLineDash([cs * 0.3, cs * 0.2]); g.lineDashOffset = t * cs * 2;
      g.beginPath(); g.arc(0, 0, r * cs, 0, TAU); g.stroke(); g.setLineDash([]);
      g.fillStyle = `rgba(255,40,40,${0.1 + k * 0.25 + Math.sin(t * 20) * 0.04})`; g.beginPath(); g.arc(0, 0, r * cs * k, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(-r * cs * 0.4, 0); g.lineTo(r * cs * 0.4, 0); g.moveTo(0, -r * cs * 0.4); g.lineTo(0, r * cs * 0.4); g.stroke();
      g.restore();
    }
  }

  drawLights(g, dt) {
    const cs = this.cs;
    this.lights = this.lights.filter(l => (l.life += dt) < l.max);
    if (!this.lights.length) return;
    g.save(); g.globalCompositeOperation = 'lighter';
    const strength = this.theme.fx.light ?? 1;
    for (const l of this.lights) {
      const k = 1 - l.life / l.max, R = l.r * cs;
      const gr = g.createRadialGradient(l.x * cs, l.y * cs, 0, l.x * cs, l.y * cs, R);
      gr.addColorStop(0, rgba(l.color, 0.55 * k * strength)); gr.addColorStop(1, rgba(l.color, 0));
      g.fillStyle = gr; g.fillRect(l.x * cs - R, l.y * cs - R, R * 2, R * 2);
    }
    g.restore();
  }

  bar(g, x, y, w, frac, color) {
    const h = Math.max(3, this.cs * 0.16);
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x, y, w, h);
    g.fillStyle = color; g.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }
}

export { PU_COLORS, drawIcon };
