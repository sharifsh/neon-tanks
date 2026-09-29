// Neon renderer: crisp at any resolution up to 4K, glow via prerendered sprites
import { W, H, T, TEAM_MAIN } from './const.js';

const TAU = Math.PI * 2;
const PU_COLORS = { star: '#ffd23f', helmet: '#3de0ff', grenade: '#ff4d5e', shovel: '#ff9b3d', clock: '#a98bff', tank: '#3dff8b' };
const PU_LABEL = { star: 'POWER UP', helmet: 'SHIELD', grenade: 'NUKE', shovel: 'FORTIFY', clock: 'FREEZE', tank: '+1 LIFE' };

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

// ---------- tile painting (shared with editor) ----------
export function paintCell(g, grid, x, y, cs, layer) {
  const v = grid[y * W + x];
  const px = x * cs, py = y * cs;
  const nb = (dx, dy) => { const xx = x + dx, yy = y + dy; return (xx < 0 || yy < 0 || xx >= W || yy >= H) ? -1 : grid[yy * W + xx]; };
  if (layer === 'trees') {
    if (v !== T.TREES) return;
    const rnd = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    g.save();
    g.shadowColor = '#2dff8a'; g.shadowBlur = cs * 0.35;
    for (let i = 0; i < 4; i++) {
      const ox = ((rnd >> (i * 3)) & 7) / 7, oy = ((rnd >> (i * 3 + 9)) & 7) / 7;
      const cx = px + cs * (0.2 + ox * 0.6), cy = py + cs * (0.2 + oy * 0.6), r = cs * (0.42 + ((rnd >> i) & 3) * 0.05);
      const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      gr.addColorStop(0, '#5dffa8'); gr.addColorStop(0.5, '#1c9c55'); gr.addColorStop(1, '#0a4a2a');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    }
    g.restore();
    return;
  }
  if (v === T.BRICK) {
    g.fillStyle = '#1c0907'; g.fillRect(px, py, cs, cs);
    const bh = cs / 2;
    for (let r = 0; r < 2; r++) {
      const off = ((y * 2 + r) % 2) * (cs / 2);
      for (let k = -1; k < 2; k++) {
        const bx = px + off + k * cs, by = py + r * bh;
        const x0 = Math.max(px, bx) + cs * 0.04, x1 = Math.min(px + cs, bx + cs) - cs * 0.04;
        if (x1 <= x0) continue;
        const gr = g.createLinearGradient(0, by, 0, by + bh);
        gr.addColorStop(0, '#e2643c'); gr.addColorStop(0.45, '#a8381f'); gr.addColorStop(1, '#5e1a0e');
        g.fillStyle = gr; g.fillRect(x0, by + cs * 0.04, x1 - x0, bh - cs * 0.08);
        g.fillStyle = 'rgba(255,190,140,0.35)'; g.fillRect(x0, by + cs * 0.04, x1 - x0, cs * 0.04);
      }
    }
    g.save(); g.strokeStyle = '#ff7a45'; g.lineWidth = Math.max(1, cs * 0.06); g.shadowColor = '#ff5a1f'; g.shadowBlur = cs * 0.3;
    edge(g, px, py, cs, nb, T.BRICK); g.restore();
  } else if (v === T.STEEL) {
    const gr = g.createLinearGradient(px, py, px + cs, py + cs);
    gr.addColorStop(0, '#9fb4c8'); gr.addColorStop(0.5, '#4b5a6b'); gr.addColorStop(1, '#232b35');
    g.fillStyle = gr; g.fillRect(px, py, cs, cs);
    g.fillStyle = 'rgba(12,18,26,0.9)'; g.fillRect(px + cs * 0.18, py + cs * 0.18, cs * 0.64, cs * 0.64);
    const g2 = g.createLinearGradient(px, py, px + cs, py + cs);
    g2.addColorStop(0, '#c9d8e6'); g2.addColorStop(1, '#56677a');
    g.fillStyle = g2; g.fillRect(px + cs * 0.24, py + cs * 0.24, cs * 0.52, cs * 0.52);
    g.fillStyle = '#e8f4ff';
    for (const [a, b] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) { g.beginPath(); g.arc(px + a * cs, py + b * cs, cs * 0.045, 0, TAU); g.fill(); }
    g.save(); g.strokeStyle = '#8ff3ff'; g.lineWidth = Math.max(1, cs * 0.06); g.shadowColor = '#3de0ff'; g.shadowBlur = cs * 0.35;
    edge(g, px, py, cs, nb, T.STEEL); g.restore();
  } else if (v === T.WATER) {
    const gr = g.createLinearGradient(px, py, px, py + cs);
    gr.addColorStop(0, '#0a3a6b'); gr.addColorStop(1, '#041a36');
    g.fillStyle = gr; g.fillRect(px, py, cs, cs);
    g.save(); g.strokeStyle = '#3d9bff'; g.lineWidth = Math.max(1, cs * 0.05); g.shadowColor = '#3d9bff'; g.shadowBlur = cs * 0.3;
    edge(g, px, py, cs, nb, T.WATER); g.restore();
  } else if (v === T.ICE) {
    g.fillStyle = '#16304a'; g.fillRect(px, py, cs, cs);
    g.strokeStyle = 'rgba(200,240,255,0.35)'; g.lineWidth = Math.max(1, cs * 0.04);
    g.beginPath();
    for (let i = -1; i < 3; i++) { g.moveTo(px + i * cs * 0.45, py + cs); g.lineTo(px + i * cs * 0.45 + cs * 0.5, py); }
    g.save(); g.beginPath(); g.rect(px, py, cs, cs); g.clip();
    g.beginPath(); for (let i = -1; i < 3; i++) { g.moveTo(px + i * cs * 0.45, py + cs); g.lineTo(px + i * cs * 0.45 + cs * 0.5, py); } g.stroke();
    g.restore();
    g.fillStyle = 'rgba(180,230,255,0.08)'; g.fillRect(px, py, cs, cs);
  }
}

function edge(g, px, py, cs, nb, same) {
  g.beginPath();
  if (nb(0, -1) !== same) { g.moveTo(px, py); g.lineTo(px + cs, py); }
  if (nb(0, 1) !== same) { g.moveTo(px, py + cs); g.lineTo(px + cs, py + cs); }
  if (nb(-1, 0) !== same) { g.moveTo(px, py); g.lineTo(px, py + cs); }
  if (nb(1, 0) !== same) { g.moveTo(px + cs, py); g.lineTo(px + cs, py + cs); }
  g.stroke();
}

export function paintFloor(g, cs, withFrame = true) {
  const w = W * cs, h = H * cs;
  const gr = g.createRadialGradient(w / 2, h / 2, cs * 2, w / 2, h / 2, w * 0.7);
  gr.addColorStop(0, '#0b1020'); gr.addColorStop(1, '#05070e');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.lineWidth = 1;
  for (let x = 0; x <= W; x++) { g.strokeStyle = x % 2 ? 'rgba(80,120,255,0.035)' : 'rgba(80,140,255,0.08)'; g.beginPath(); g.moveTo(x * cs + 0.5, 0); g.lineTo(x * cs + 0.5, h); g.stroke(); }
  for (let y = 0; y <= H; y++) { g.strokeStyle = y % 2 ? 'rgba(80,120,255,0.035)' : 'rgba(80,140,255,0.08)'; g.beginPath(); g.moveTo(0, y * cs + 0.5); g.lineTo(w, y * cs + 0.5); g.stroke(); }
}

// ---------- tank sprites ----------
function drawTank(g, style, color, S, frame) {
  const u = S / 16;
  const dark = '#0b0f18';
  g.lineJoin = 'round';
  const boss = style === 'boss';
  const slim = style === 'pscout' || style === 'fast';
  const wide = style === 'pheavy' || style === 'armor' || boss;
  // treads
  const tw = wide ? 3.6 : 3;
  for (const side of [0, 1]) {
    const x = side ? 16 - 0.6 - tw : 0.6;
    g.fillStyle = '#10151f'; g.strokeStyle = color; g.lineWidth = u * 0.6;
    g.shadowColor = color; g.shadowBlur = u * 2.5;
    rr(g, x * u, 0.6 * u, tw * u, 14.8 * u, u * 1.2); g.fill(); g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = rgba(color, 0.55); g.lineWidth = u * 0.5;
    for (let i = 0; i < 8; i++) {
      const yy = (1.4 + i * 1.9 + (frame ? 0.95 : 0)) * u;
      if (yy > 15 * u) continue;
      g.beginPath(); g.moveTo((x + 0.4) * u, yy); g.lineTo((x + tw - 0.4) * u, yy); g.stroke();
    }
  }
  // hull
  const hx = slim ? 4.3 : wide ? 3.4 : 3.8, hw = 16 - hx * 2;
  const gr = g.createLinearGradient(0, 2 * u, 0, 15 * u);
  gr.addColorStop(0, rgba(color, 0.55)); gr.addColorStop(1, '#141a28');
  g.fillStyle = dark; rr(g, hx * u, 2.2 * u, hw * u, 12.4 * u, u * 1.6); g.fill();
  g.fillStyle = gr; g.fill();
  g.strokeStyle = color; g.lineWidth = u * 0.7; g.shadowColor = color; g.shadowBlur = u * 3; g.stroke(); g.shadowBlur = 0;
  // class details
  g.strokeStyle = rgba(color, 0.6); g.lineWidth = u * 0.45;
  if (wide) { g.beginPath(); g.moveTo(hx * u + u, 4 * u); g.lineTo((16 - hx) * u - u, 4 * u); g.moveTo(hx * u + u, 13 * u); g.lineTo((16 - hx) * u - u, 13 * u); g.stroke(); }
  if (slim) { g.beginPath(); g.moveTo(hx * u, 13 * u); g.lineTo(2.5 * u, 15.2 * u); g.moveTo((16 - hx) * u, 13 * u); g.lineTo(13.5 * u, 15.2 * u); g.stroke(); }
  if (style === 'pengineer') {
    g.fillStyle = '#ffd23f'; g.fillRect(5.5 * u, 11.6 * u, 5 * u, 1.6 * u);
    g.fillStyle = dark; for (let i = 0; i < 3; i++) g.fillRect((6 + i * 1.6) * u, 11.6 * u, 0.7 * u, 1.6 * u);
  }
  if (boss) {
    g.fillStyle = color;
    for (const [sx, sy] of [[2.4, 3], [13.6, 3], [2.4, 13], [13.6, 13]]) { g.beginPath(); g.moveTo(sx * u, (sy - 1.2) * u); g.lineTo((sx + 0.9) * u, sy * u); g.lineTo(sx * u, (sy + 1.2) * u); g.lineTo((sx - 0.9) * u, sy * u); g.fill(); }
  }
  // barrel(s)
  g.shadowColor = color; g.shadowBlur = u * 3;
  const barrel = (bx, bw, top) => {
    const gb = g.createLinearGradient(bx * u, 0, (bx + bw) * u, 0);
    gb.addColorStop(0, rgba(color, 0.7)); gb.addColorStop(0.5, '#ffffff'); gb.addColorStop(1, rgba(color, 0.7));
    g.fillStyle = gb; rr(g, bx * u, top * u, bw * u, (8.5 - top) * u, u * 0.4); g.fill();
  };
  if (style === 'pheavy' || boss) { barrel(5.6, 1.6, 0.2); barrel(8.8, 1.6, 0.2); }
  else if (style === 'power') barrel(6.9, 2.2, -0.6);
  else if (slim) barrel(7.35, 1.3, -0.2);
  else if (style === 'pengineer') barrel(7.1, 1.8, 2.2);
  else barrel(7.1, 1.8, 0.4);
  // turret
  const tr = boss ? 3.6 : wide ? 3.4 : slim ? 2.6 : 3.1;
  const gt = g.createRadialGradient(7.3 * u, 8.2 * u, u * 0.3, 8 * u, 9 * u, tr * u);
  gt.addColorStop(0, '#ffffff'); gt.addColorStop(0.35, color); gt.addColorStop(1, rgba(color, 0.25));
  g.fillStyle = gt; g.beginPath(); g.arc(8 * u, 9 * u, tr * u, 0, TAU); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = '#ffffff'; g.lineWidth = u * 0.35; g.globalAlpha = 0.7; g.stroke(); g.globalAlpha = 1;
  if (style === 'armor' || boss) { g.fillStyle = dark; g.beginPath(); g.arc(8 * u, 9 * u, tr * 0.4 * u, 0, TAU); g.fill(); g.fillStyle = color; g.beginPath(); g.arc(8 * u, 9 * u, tr * 0.22 * u, 0, TAU); g.fill(); }
}

function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ---------- powerup icons ----------
function drawIcon(g, type, cx, cy, s, color) {
  g.save(); g.translate(cx, cy); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = s * 0.09; g.lineJoin = 'round'; g.lineCap = 'round';
  g.shadowColor = color; g.shadowBlur = s * 0.3;
  if (type === 'star') {
    g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.2 : s * 0.46; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill();
  } else if (type === 'helmet') {
    g.beginPath(); g.moveTo(0, -s * 0.42); g.lineTo(s * 0.36, -s * 0.26); g.lineTo(s * 0.3, s * 0.12); g.quadraticCurveTo(s * 0.18, s * 0.34, 0, s * 0.44); g.quadraticCurveTo(-s * 0.18, s * 0.34, -s * 0.3, s * 0.12); g.lineTo(-s * 0.36, -s * 0.26); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-s * 0.14, 0); g.lineTo(-s * 0.02, s * 0.12); g.lineTo(s * 0.18, -s * 0.12); g.stroke();
  } else if (type === 'grenade') {
    g.beginPath(); g.arc(0, s * 0.08, s * 0.3, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(s * 0.18, -s * 0.18); g.quadraticCurveTo(s * 0.3, -s * 0.42, s * 0.42, -s * 0.36); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(s * 0.42, -s * 0.38, s * 0.07, 0, TAU); g.fill();
    g.font = `900 ${s * 0.3}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color; g.fillText('☢', 0, s * 0.1);
  } else if (type === 'shovel') {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) { const off = r % 2 ? s * 0.17 : 0; g.strokeRect(-s * 0.38 + off + c * s * 0.34 - (r % 2 ? s * 0.17 : 0), -s * 0.36 + r * s * 0.25, s * 0.3, s * 0.2); }
  } else if (type === 'clock') {
    g.beginPath(); g.arc(0, 0, s * 0.38, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -s * 0.26); g.moveTo(0, 0); g.lineTo(s * 0.18, s * 0.08); g.stroke();
  } else if (type === 'tank') {
    g.strokeRect(-s * 0.3, -s * 0.2, s * 0.6, s * 0.45); g.beginPath(); g.arc(0, s * 0.02, s * 0.13, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(0, -s * 0.1); g.lineTo(0, -s * 0.44); g.stroke();
  }
  g.restore();
}

// ---------- renderer ----------
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.sprites = new Map(); this.particles = []; this.lights = []; this.texts = [];
    this.shake = 0; this.time = 0; this.grid = new Uint8Array(W * H); this.gridStr = '';
    this.trackPos = new Map(); this.decalFade = 0; this.quality = 1;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let cw = Math.floor(innerWidth * dpr), ch = Math.floor(innerHeight * dpr);
    const cap = 3840 * 2160 * 1.05;
    if (cw * ch > cap) { const k = Math.sqrt(cap / (cw * ch)); cw = Math.floor(cw * k); ch = Math.floor(ch * k); }
    this.canvas.width = cw; this.canvas.height = ch;
    this.scale = cw / innerWidth;
    const top = 58 * this.scale, bottom = 64 * this.scale, pad = 10 * this.scale;
    this.cs = Math.max(4, Math.floor(Math.min((cw - pad * 2) / W, (ch - top - bottom) / H)));
    this.ox = Math.floor((cw - this.cs * W) / 2); this.oy = Math.floor(top + (ch - top - bottom - this.cs * H) / 2);
    const cs = this.cs;
    this.sprites.clear();
    this.floor = mk(W * cs, H * cs); paintFloor(this.floor.getContext('2d'), cs);
    this.tiles = mk(W * cs, H * cs); this.trees = mk(W * cs, H * cs);
    this.decals = mk(W * cs, H * cs);
    this.water = [];
    for (let f = 0; f < 8; f++) {
      const c = mk(cs, cs), g = c.getContext('2d');
      g.strokeStyle = 'rgba(120,200,255,0.5)'; g.lineWidth = Math.max(1, cs * 0.05);
      for (let k = 0; k < 2; k++) {
        g.beginPath();
        for (let x = 0; x <= cs; x += 2) { const y = cs * (0.3 + k * 0.45) + Math.sin((x / cs) * TAU + f / 8 * TAU + k) * cs * 0.08; x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
        g.stroke();
      }
      this.water.push(c);
    }
    this.vignette = mk(cw, ch);
    const vg = this.vignette.getContext('2d');
    const gr = vg.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
    vg.fillStyle = gr; vg.fillRect(0, 0, cw, ch);
    this.redrawTiles(null);
  }

  setMap(str) {
    if (str === this.gridStr) return;
    const changed = [];
    for (let i = 0; i < W * H; i++) { const v = str.charCodeAt(i) - 48; if (this.grid[i] !== v) { this.grid[i] = v; changed.push(i); } }
    this.gridStr = str;
    this.redrawTiles(changed.length > 200 || !this.hadMap ? null : changed);
    this.hadMap = true;
  }

  redrawTiles(changed) {
    const cs = this.cs, gt = this.tiles.getContext('2d'), gtr = this.trees.getContext('2d');
    const paintRegion = (x0, y0, x1, y1) => {
      for (const [g, layer] of [[gt, 'tiles'], [gtr, 'trees']]) {
        g.save(); g.beginPath(); g.rect(x0 * cs, y0 * cs, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs); g.clip();
        g.clearRect(x0 * cs, y0 * cs, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs);
        for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x1 + 1); x++) paintCell(g, this.grid, x, y, cs, layer);
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
      const S = this.cs * size * 0.98, pad = this.cs * 0.7;
      s = mk(S + pad * 2, S + pad * 2);
      const g = s.getContext('2d'); g.translate(pad, pad); drawTank(g, style, color, S, frame);
      s.pad = pad;
      this.sprites.set(key, s);
    }
    return s;
  }

  // ---------- effects from events ----------
  addEvents(evs) {
    for (const e of evs) {
      const c = e.c || '#fff';
      switch (e.k) {
        case 'shot': this.light(e.x, e.y, 1.2, c, 0.12); this.burst(e.x, e.y, 4, c, 3, 0.15, 0.08); break;
        case 'boom': {
          const s = e.s || 1;
          this.light(e.x, e.y, 2 + s * 1.6, c, 0.35 + s * 0.05); this.light(e.x, e.y, 1 + s, '#ffffff', 0.15);
          this.burst(e.x, e.y, Math.round(8 * s), c, 6 + s * 2, 0.5, 0.12);
          this.burst(e.x, e.y, Math.round(5 * s), '#ffd9a0', 4 + s * 2, 0.4, 0.1);
          for (let i = 0; i < 3 * s; i++) this.particles.push({ x: e.x + (Math.random() - 0.5) * s * 0.5, y: e.y + (Math.random() - 0.5) * s * 0.5, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5, life: 0, max: 0.8 + Math.random() * 0.8, size: 0.4 + s * 0.25, color: '#444', type: 'smoke' });
          this.particles.push({ x: e.x, y: e.y, life: 0, max: 0.35 + s * 0.05, size: s * 1.2, color: c, type: 'ring' });
          if (s >= 2) this.scorch(e.x, e.y, s * 0.45);
          break;
        }
        case 'brick': this.chips(e.x, e.y, 7, '#ff7a45'); if (e.s) this.burst(e.x, e.y, 6, '#bff', 7, 0.3, 0.08); this.light(e.x, e.y, 1.2, '#ff7a45', 0.15); break;
        case 'steel': this.burst(e.x, e.y, 8, '#e6fbff', 8, 0.25, 0.08); this.light(e.x, e.y, 1, '#8ff3ff', 0.12); break;
        case 'hit': this.burst(e.x, e.y, 10, c, 7, 0.35, 0.1); this.light(e.x, e.y, 1.4, c, 0.2); break;
        case 'spark': this.burst(e.x, e.y, 6, c, 5, 0.25, 0.08); break;
        case 'spawn': this.particles.push({ x: e.x, y: e.y, life: 0, max: 0.6, size: 2.2, color: c, type: 'ring' }); break;
        case 'pick': this.particles.push({ x: e.x, y: e.y, life: 0, max: 0.5, size: 3, color: PU_COLORS[e.t] || c, type: 'ring' }); this.light(e.x, e.y, 3, PU_COLORS[e.t] || c, 0.4); this.texts.push({ x: e.x, y: e.y - 1, text: PU_LABEL[e.t] || '', color: PU_COLORS[e.t] || c, life: 0, max: 1.2 }); break;
        case 'build': this.chips(e.x, e.y, 10, '#ffb070'); this.particles.push({ x: e.x, y: e.y, life: 0, max: 0.35, size: 1.5, color: '#ffb070', type: 'ring' }); break;
        case 'shake': this.shake = Math.max(this.shake, e.a); break;
      }
    }
    if (this.particles.length > 3000) this.particles.splice(0, this.particles.length - 3000);
  }
  light(x, y, r, color, max) { this.lights.push({ x, y, r, color, life: 0, max }); }
  burst(x, y, n, color, spd, max, size) {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = spd * (0.3 + Math.random()); this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: max * (0.5 + Math.random()), size, color, type: 'spark' }); }
  }
  chips(x, y, n, color) {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = 2 + Math.random() * 5; this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.4 + Math.random() * 0.4, size: 0.12 + Math.random() * 0.12, color, type: 'chip', rot: Math.random() * 6 }); }
    for (let i = 0; i < 3; i++) this.particles.push({ x, y, vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), life: 0, max: 0.7, size: 0.5, color: '#6b3a2a', type: 'smoke' });
  }
  scorch(x, y, r) {
    const g = this.decals.getContext('2d'), cs = this.cs;
    const gr = g.createRadialGradient(x * cs, y * cs, 0, x * cs, y * cs, r * cs);
    gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x * cs, y * cs, r * cs, 0, TAU); g.fill();
  }
  tracks(view) {
    const g = this.decals.getContext('2d'), cs = this.cs;
    for (const t of view.tk) {
      const [id, x100, y100, dir, size, , , flags] = t;
      if (!(flags & 1)) continue;
      const x = x100 / 100, y = y100 / 100;
      const last = this.trackPos.get(id);
      if (last && Math.hypot(last[0] - x, last[1] - y) < 0.3) continue;
      this.trackPos.set(id, [x, y]);
      g.fillStyle = 'rgba(120,160,255,0.07)';
      const vert = dir % 2 === 0, s = size * cs;
      if (vert) { g.fillRect(x * cs + s * 0.06, y * cs + s * 0.45, s * 0.16, s * 0.12); g.fillRect(x * cs + s * 0.78, y * cs + s * 0.45, s * 0.16, s * 0.12); }
      else { g.fillRect(x * cs + s * 0.45, y * cs + s * 0.06, s * 0.12, s * 0.16); g.fillRect(x * cs + s * 0.45, y * cs + s * 0.78, s * 0.12, s * 0.16); }
    }
    if (this.trackPos.size > 400) this.trackPos.clear();
  }

  // ---------- frame ----------
  render(view, dt, localId) {
    this.time += dt;
    const g = this.ctx, cs = this.cs, cw = this.canvas.width, ch = this.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#03040a'; g.fillRect(0, 0, cw, ch);
    if (!view) return;
    if (view.map) this.setMap(view.map);
    this.tracks(view);
    this.decalFade += dt;
    if (this.decalFade > 0.5) { this.decalFade = 0; const d = this.decals.getContext('2d'); d.globalCompositeOperation = 'destination-out'; d.fillStyle = 'rgba(0,0,0,0.04)'; d.fillRect(0, 0, this.decals.width, this.decals.height); d.globalCompositeOperation = 'source-over'; }

    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * cs * 0.45;
    const sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
    g.translate(this.ox + sx, this.oy + sy);

    // frame glow
    g.save(); g.strokeStyle = '#3d7bff'; g.lineWidth = Math.max(2, cs * 0.08); g.shadowColor = '#3d7bff'; g.shadowBlur = cs * 0.8;
    g.strokeRect(-cs * 0.12, -cs * 0.12, W * cs + cs * 0.24, H * cs + cs * 0.24); g.restore();

    g.drawImage(this.floor, 0, 0);
    g.drawImage(this.decals, 0, 0);
    g.drawImage(this.tiles, 0, 0);
    // water shimmer
    g.globalCompositeOperation = 'lighter';
    const wf = Math.floor(this.time * 6);
    for (let i = 0; i < W * H; i++) if (this.grid[i] === T.WATER) { const x = i % W, y = (i / W) | 0; g.drawImage(this.water[(wf + x + y) & 7], x * cs, y * cs); }
    g.globalCompositeOperation = 'source-over';

    const mode = view.hud && view.hud.mode;
    this.drawBases(g, view, mode);
    this.drawPowerups(g, view);
    this.drawTanks(g, view, localId);
    this.drawFlags(g, view);
    this.drawBullets(g, view);
    this.updateParticles(g, dt);
    g.drawImage(this.trees, 0, 0);
    this.drawAir(g, view);
    this.drawLights(g, dt);
    this.drawTexts(g, dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.vignette, 0, 0);
    if (view.hud && view.hud.freeze) { g.fillStyle = 'rgba(80,160,255,0.06)'; g.fillRect(0, 0, cw, ch); }
  }

  drawBases(g, view, mode) {
    const cs = this.cs, t = this.time;
    for (const [x, y, team, alive, hp, maxHp] of view.bs || []) {
      const cx = (x + 1) * cs, cy = (y + 1) * cs, R = cs * 0.95;
      const color = mode === 'battle' || mode === 'ctf' ? TEAM_MAIN[team] : '#ffd23f';
      g.save(); g.translate(cx, cy);
      if (mode === 'ctf') {
        g.strokeStyle = color; g.lineWidth = cs * 0.1; g.shadowColor = color; g.shadowBlur = cs * 0.6;
        g.setLineDash([cs * 0.3, cs * 0.2]); g.lineDashOffset = t * cs; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke();
        g.setLineDash([]); g.globalAlpha = 0.15; g.fillStyle = color; g.fill(); g.restore(); continue;
      }
      hex(g, R);
      g.fillStyle = alive ? '#0c1222' : '#141414'; g.fill();
      g.strokeStyle = alive ? color : '#555'; g.lineWidth = cs * 0.1; g.shadowColor = color; g.shadowBlur = alive ? cs * 0.8 : 0; g.stroke();
      if (alive) {
        const pulse = 0.75 + Math.sin(t * 4) * 0.25;
        g.rotate(t * 0.8);
        g.beginPath(); for (let i = 0; i < 3; i++) { const a = i * TAU / 3; g.lineTo(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55); } g.closePath();
        g.strokeStyle = color; g.lineWidth = cs * 0.07; g.stroke();
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.45);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, color); gr.addColorStop(1, rgba(color, 0));
        g.globalAlpha = pulse; g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.45, 0, TAU); g.fill(); g.globalAlpha = 1;
      } else {
        g.strokeStyle = '#333'; g.lineWidth = cs * 0.06; g.beginPath(); g.moveTo(-R * 0.6, -R * 0.2); g.lineTo(R * 0.1, R * 0.1); g.lineTo(R * 0.5, -R * 0.4); g.moveTo(R * 0.1, R * 0.1); g.lineTo(0, R * 0.7); g.stroke();
        if (Math.random() < 0.08) this.particles.push({ x: x + 1, y: y + 1, vx: 0, vy: -0.6, life: 0, max: 1.5, size: 0.6, color: '#333', type: 'smoke' });
      }
      g.restore();
      if (maxHp > 1 && alive) this.bar(g, x * cs, (y - 0.5) * cs, 2 * cs, hp / maxHp, color);
    }
  }

  drawPowerups(g, view) {
    const cs = this.cs, t = this.time;
    for (const [id, type, x, y, blink] of view.pu || []) {
      if (blink && Math.floor(t * 8) % 2) continue;
      const color = PU_COLORS[type] || '#fff';
      const cx = (x + 1) * cs, cy = (y + 1) * cs + Math.sin(t * 3 + id) * cs * 0.12, s = cs * 1.7;
      g.save();
      g.fillStyle = 'rgba(8,10,20,0.85)'; g.strokeStyle = color; g.lineWidth = cs * 0.08; g.shadowColor = color; g.shadowBlur = cs * 0.8;
      rr(g, cx - s / 2, cy - s / 2, s, s, cs * 0.3); g.fill(); g.stroke();
      g.restore();
      drawIcon(g, type, cx, cy, s * 0.8, color);
    }
  }

  drawTanks(g, view, localId) {
    const cs = this.cs, t = this.time;
    for (const tk of view.tk) {
      const [id, x100, y100, dir, size, style, color, flags, hp, maxHp, owner, team] = tk;
      const x = x100 / 100, y = y100 / 100, S = size * cs;
      const cx = x * cs + S / 2, cy = y * cs + S / 2;
      if (flags & 4) { // spawning star
        g.save(); g.translate(cx, cy); g.rotate(t * 6); g.globalCompositeOperation = 'lighter';
        const k = 0.5 + Math.abs(Math.sin(t * 10)) * 0.6;
        g.fillStyle = color; g.shadowColor = color; g.shadowBlur = cs;
        g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = (i % 2 ? 0.15 : 0.55) * S * k; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill();
        g.restore(); continue;
      }
      if (owner && owner === localId) {
        g.save(); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = cs * 0.06; g.setLineDash([cs * 0.25, cs * 0.2]); g.lineDashOffset = -t * cs;
        g.beginPath(); g.arc(cx, cy, S * 0.72, 0, TAU); g.stroke(); g.restore();
      }
      const flash = (flags & 16) && Math.floor(t * 6) % 2;
      let col = flash ? '#ffffff' : color;
      if (style === 'armor' && !flash) col = ['#ff4d4d', '#ff4d4d', '#ffcf3d', '#3dff8b', '#d7dde8'][Math.max(0, Math.min(4, hp))];
      const spr = this.sprite(style, col, size, (flags & 1) ? Math.floor(t * 14) % 2 : 0);
      g.save(); g.translate(cx, cy); g.rotate(dir * Math.PI / 2);
      if (flags & 64) { g.globalAlpha = 0.25; g.drawImage(spr, -spr.width / 2, -spr.width / 2 + cs * 0.9); g.globalAlpha = 1; }
      g.drawImage(spr, -spr.width / 2, -spr.height / 2);
      g.restore();
      if (flags & 8) { // frozen
        g.save(); g.fillStyle = 'rgba(140,210,255,0.28)'; g.strokeStyle = '#bff'; g.lineWidth = cs * 0.05;
        rr(g, x * cs, y * cs, S, S, cs * 0.3); g.fill(); g.stroke(); g.restore();
      }
      if (flags & 2) { // shield
        g.save(); g.globalCompositeOperation = 'lighter'; g.translate(cx, cy); g.rotate(t * 2);
        g.strokeStyle = 'rgba(120,240,255,0.8)'; g.lineWidth = cs * 0.08; g.shadowColor = '#3de0ff'; g.shadowBlur = cs * 0.7;
        hex(g, S * 0.72); g.stroke();
        g.fillStyle = 'rgba(80,200,255,0.08)'; g.fill(); g.restore();
      }
      if (flags & 32) { // carrying flag
        const fc = TEAM_MAIN[1 - team];
        this.flagShape(g, cx + S * 0.2, cy - S * 0.2, cs, fc);
      }
      if (maxHp > 1 && !(style === 'armor')) this.bar(g, x * cs, y * cs - cs * 0.45, S, hp / maxHp, style === 'boss' ? '#ff2a2a' : color);
      if (owner && view.names) {
        const name = view.names[owner];
        if (name) {
          g.font = `700 ${Math.max(9, cs * 0.5)}px 'Rajdhani', system-ui`; g.textAlign = 'center'; g.textBaseline = 'top';
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(name, cx + 1, y * cs + S + cs * 0.12 + 1);
          g.fillStyle = color; g.fillText(name, cx, y * cs + S + cs * 0.12);
        }
      }
    }
  }

  flagShape(g, x, y, cs, color) {
    const t = this.time;
    g.save(); g.strokeStyle = '#ddd'; g.lineWidth = cs * 0.08; g.beginPath(); g.moveTo(x, y + cs * 0.9); g.lineTo(x, y - cs * 0.9); g.stroke();
    g.fillStyle = color; g.shadowColor = color; g.shadowBlur = cs * 0.6;
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
    const cs = this.cs;
    g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (const [id, x100, y100, vx10, vy10, color, heavy] of view.b) {
      const x = x100 / 100 * cs, y = y100 / 100 * cs, vx = vx10 / 10, vy = vy10 / 10;
      const tx = x - vx * 0.05 * cs, ty = y - vy * 0.05 * cs;
      const gr = g.createLinearGradient(tx, ty, x, y); gr.addColorStop(0, rgba(color, 0)); gr.addColorStop(1, color);
      g.strokeStyle = gr; g.lineWidth = cs * (heavy ? 0.36 : 0.26);
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
      g.fillStyle = rgba(color, 0.35); g.beginPath(); g.arc(x, y, cs * (heavy ? 0.45 : 0.35), 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, cs * (heavy ? 0.17 : 0.12), 0, TAU); g.fill();
    }
    g.restore();
  }

  updateParticles(g, dt) {
    const cs = this.cs;
    g.save();
    const alive = [];
    for (const p of this.particles) {
      p.life += dt; if (p.life >= p.max) continue; alive.push(p);
      const k = 1 - p.life / p.max;
      if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; const d = p.type === 'smoke' ? 0.98 : 0.93; p.vx *= d; p.vy *= d; }
      if (p.type === 'smoke') {
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = k * 0.35; g.fillStyle = p.color;
        g.beginPath(); g.arc(p.x * cs, p.y * cs, p.size * cs * (1.5 - k * 0.5), 0, TAU); g.fill();
      } else if (p.type === 'ring') {
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = k; g.strokeStyle = p.color; g.lineWidth = cs * 0.12 * k + 1;
        g.beginPath(); g.arc(p.x * cs, p.y * cs, p.size * cs * (1 - k * k) + 1, 0, TAU); g.stroke();
      } else if (p.type === 'chip') {
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(1, k * 2); g.fillStyle = p.color;
        p.rot += dt * 10; g.save(); g.translate(p.x * cs, p.y * cs); g.rotate(p.rot); g.fillRect(-p.size * cs / 2, -p.size * cs / 2, p.size * cs, p.size * cs * 0.6); g.restore();
      } else {
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = k; g.strokeStyle = p.color; g.lineWidth = Math.max(1, p.size * cs); g.lineCap = 'round';
        g.beginPath(); g.moveTo(p.x * cs, p.y * cs); g.lineTo((p.x - p.vx * 0.03) * cs, (p.y - p.vy * 0.03) * cs); g.stroke();
      }
    }
    this.particles = alive;
    g.restore();
  }

  drawAir(g, view) {
    const cs = this.cs, t = this.time;
    for (const [x, y, rem, r] of view.air || []) {
      const k = Math.max(0, Math.min(1, 1 - rem / 2.5));
      g.save(); g.translate(x * cs, y * cs);
      g.strokeStyle = '#ff2a2a'; g.lineWidth = cs * 0.08; g.shadowColor = '#ff2a2a'; g.shadowBlur = cs * 0.6;
      g.setLineDash([cs * 0.3, cs * 0.2]); g.lineDashOffset = t * cs * 2;
      g.beginPath(); g.arc(0, 0, r * cs, 0, TAU); g.stroke(); g.setLineDash([]);
      g.fillStyle = `rgba(255,40,40,${0.08 + k * 0.25 + Math.sin(t * 20) * 0.04})`; g.beginPath(); g.arc(0, 0, r * cs * k, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(-r * cs * 0.4, 0); g.lineTo(r * cs * 0.4, 0); g.moveTo(0, -r * cs * 0.4); g.lineTo(0, r * cs * 0.4); g.stroke();
      g.restore();
    }
  }

  drawLights(g, dt) {
    const cs = this.cs;
    g.save(); g.globalCompositeOperation = 'lighter';
    this.lights = this.lights.filter(l => (l.life += dt) < l.max);
    for (const l of this.lights) {
      const k = 1 - l.life / l.max, R = l.r * cs;
      const gr = g.createRadialGradient(l.x * cs, l.y * cs, 0, l.x * cs, l.y * cs, R);
      gr.addColorStop(0, rgba(l.color, 0.55 * k)); gr.addColorStop(1, rgba(l.color, 0));
      g.fillStyle = gr; g.fillRect(l.x * cs - R, l.y * cs - R, R * 2, R * 2);
    }
    g.restore();
  }

  drawTexts(g, dt) {
    const cs = this.cs;
    this.texts = this.texts.filter(x => (x.life += dt) < x.max);
    g.save(); g.textAlign = 'center'; g.font = `800 ${cs * 0.75}px 'Orbitron', system-ui`;
    for (const x of this.texts) {
      const k = x.life / x.max; g.globalAlpha = 1 - k * k; g.fillStyle = x.color; g.shadowColor = x.color; g.shadowBlur = cs * 0.5;
      g.fillText(x.text, x.x * cs, (x.y - k * 1.5) * cs);
    }
    g.restore();
  }

  bar(g, x, y, w, frac, color) {
    const h = Math.max(3, this.cs * 0.16);
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x, y, w, h);
    g.fillStyle = color; g.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }
}

function hex(g, R) { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; g.lineTo(Math.cos(a) * R, Math.sin(a) * R); } g.closePath(); }

export { PU_COLORS, drawIcon };

// Standalone tank icon (menus)
export function tankIcon(style, color, px = 108) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d'); const pad = px * 0.14;
  g.translate(pad, pad); drawTank(g, style, color, px - pad * 2, 0);
  return c;
}
