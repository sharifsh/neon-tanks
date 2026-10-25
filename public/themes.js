// Visual styles. Each theme paints the same game state differently; gameplay is identical.
import { W, H, T, TEAM_MAIN } from './const.js';

export const TAU = Math.PI * 2;

// ---------- shared helpers ----------
export function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgba(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
export const lighten = (c, t) => mix(c, '#ffffff', t);
export const darken = (c, t) => mix(c, '#000000', t);
export function hash(x, y, k = 0) { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); }
export function srng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function rr(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export function hex(g, R) { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; g.lineTo(Math.cos(a) * R, Math.sin(a) * R); } g.closePath(); }
function poly(g, pts, u, ox = 0, oy = 0) { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo((x + ox) * u, (y + oy) * u) : g.moveTo((x + ox) * u, (y + oy) * u)); g.closePath(); }
const nbOf = (grid, x, y) => (dx, dy) => { const xx = x + dx, yy = y + dy; return (xx < 0 || yy < 0 || xx >= W || yy >= H) ? -1 : grid[yy * W + xx]; };
function edge(g, px, py, cs, nb, same) {
  g.beginPath();
  if (nb(0, -1) !== same) { g.moveTo(px, py); g.lineTo(px + cs, py); }
  if (nb(0, 1) !== same) { g.moveTo(px, py + cs); g.lineTo(px + cs, py + cs); }
  if (nb(-1, 0) !== same) { g.moveTo(px, py); g.lineTo(px, py + cs); }
  if (nb(1, 0) !== same) { g.moveTo(px + cs, py); g.lineTo(px + cs, py + cs); }
  g.stroke();
}
function speckle(g, x0, y0, w, h, n, colors, s0, s1, seed) {
  const r = srng(seed);
  for (let i = 0; i < n; i++) { g.fillStyle = colors[(r() * colors.length) | 0]; const s = s0 + r() * (s1 - s0); g.fillRect(x0 + r() * w, y0 + r() * h, s, s); }
}
function blotches(g, w, h, n, colors, rMin, rMax, seed, alpha = 1) {
  const r = srng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, R = rMin + r() * (rMax - rMin), c = colors[(r() * colors.length) | 0];
    const gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, rgba(c, alpha)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2);
  }
}

// ---------- power-up icons ----------
export function drawIcon(g, type, cx, cy, s, color, glow = true) {
  g.save(); g.translate(cx, cy); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = s * 0.09; g.lineJoin = 'round'; g.lineCap = 'round';
  if (glow) { g.shadowColor = color; g.shadowBlur = s * 0.3; }
  if (type === 'star') {
    g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.2 : s * 0.46; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill();
  } else if (type === 'helmet') {
    g.beginPath(); g.moveTo(0, -s * 0.42); g.lineTo(s * 0.36, -s * 0.26); g.lineTo(s * 0.3, s * 0.12); g.quadraticCurveTo(s * 0.18, s * 0.34, 0, s * 0.44); g.quadraticCurveTo(-s * 0.18, s * 0.34, -s * 0.3, s * 0.12); g.lineTo(-s * 0.36, -s * 0.26); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-s * 0.14, 0); g.lineTo(-s * 0.02, s * 0.12); g.lineTo(s * 0.18, -s * 0.12); g.stroke();
  } else if (type === 'grenade') {
    g.beginPath(); g.arc(0, s * 0.08, s * 0.3, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(s * 0.18, -s * 0.18); g.quadraticCurveTo(s * 0.3, -s * 0.42, s * 0.42, -s * 0.36); g.stroke();
    g.beginPath(); g.arc(s * 0.42, -s * 0.38, s * 0.07, 0, TAU); g.fill();
    for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * TAU / 3; g.beginPath(); g.moveTo(0, s * 0.08); g.arc(0, s * 0.08, s * 0.2, a - 0.45, a + 0.45); g.closePath(); g.fill(); }
  } else if (type === 'shovel') {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) g.strokeRect(-s * 0.38 + c * s * 0.36 + (r % 2 ? s * 0.08 : 0), -s * 0.36 + r * s * 0.25, s * 0.3, s * 0.2);
  } else if (type === 'clock') {
    g.beginPath(); g.arc(0, 0, s * 0.38, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -s * 0.26); g.moveTo(0, 0); g.lineTo(s * 0.18, s * 0.08); g.stroke();
  } else if (type === 'tank') {
    g.strokeRect(-s * 0.3, -s * 0.2, s * 0.6, s * 0.45); g.beginPath(); g.arc(0, s * 0.02, s * 0.13, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(0, -s * 0.1); g.lineTo(0, -s * 0.44); g.stroke();
  }
  g.restore();
}

// ======================================================================
// NEON
// ======================================================================
function neonCell(g, grid, x, y, cs, layer) {
  const v = grid[y * W + x], px = x * cs, py = y * cs, nb = nbOf(grid, x, y);
  if (layer === 'shadow') return;
  if (layer === 'trees') {
    if (v !== T.TREES) return;
    const rnd = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    g.save(); g.shadowColor = '#2dff8a'; g.shadowBlur = cs * 0.35;
    for (let i = 0; i < 4; i++) {
      const ox = ((rnd >> (i * 3)) & 7) / 7, oy = ((rnd >> (i * 3 + 9)) & 7) / 7;
      const cx = px + cs * (0.2 + ox * 0.6), cy = py + cs * (0.2 + oy * 0.6), r = cs * (0.42 + ((rnd >> i) & 3) * 0.05);
      const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      gr.addColorStop(0, '#5dffa8'); gr.addColorStop(0.5, '#1c9c55'); gr.addColorStop(1, '#0a4a2a');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    }
    g.restore(); return;
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
    g.save(); g.beginPath(); g.rect(px, py, cs, cs); g.clip();
    g.strokeStyle = 'rgba(200,240,255,0.35)'; g.lineWidth = Math.max(1, cs * 0.04);
    g.beginPath(); for (let i = -1; i < 3; i++) { g.moveTo(px + i * cs * 0.45, py + cs); g.lineTo(px + i * cs * 0.45 + cs * 0.5, py); } g.stroke();
    g.restore();
    g.fillStyle = 'rgba(180,230,255,0.08)'; g.fillRect(px, py, cs, cs);
  }
}

function neonFloor(g, cs) {
  const w = W * cs, h = H * cs;
  const gr = g.createRadialGradient(w / 2, h / 2, cs * 2, w / 2, h / 2, w * 0.7);
  gr.addColorStop(0, '#0b1020'); gr.addColorStop(1, '#05070e');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.lineWidth = 1;
  for (let x = 0; x <= W; x++) { g.strokeStyle = x % 2 ? 'rgba(80,120,255,0.035)' : 'rgba(80,140,255,0.08)'; g.beginPath(); g.moveTo(x * cs + 0.5, 0); g.lineTo(x * cs + 0.5, h); g.stroke(); }
  for (let y = 0; y <= H; y++) { g.strokeStyle = y % 2 ? 'rgba(80,120,255,0.035)' : 'rgba(80,140,255,0.08)'; g.beginPath(); g.moveTo(0, y * cs + 0.5); g.lineTo(w, y * cs + 0.5); g.stroke(); }
}

function neonTank(g, style, color, S, frame) {
  const u = S / 16, dark = '#0b0f18';
  g.lineJoin = 'round';
  const boss = style === 'boss', slim = style === 'pscout' || style === 'fast', wide = style === 'pheavy' || style === 'armor' || boss;
  const tw = wide ? 3.6 : 3;
  for (const side of [0, 1]) {
    const x = side ? 16 - 0.6 - tw : 0.6;
    g.fillStyle = '#10151f'; g.strokeStyle = color; g.lineWidth = u * 0.6; g.shadowColor = color; g.shadowBlur = u * 2.5;
    rr(g, x * u, 0.6 * u, tw * u, 14.8 * u, u * 1.2); g.fill(); g.stroke(); g.shadowBlur = 0;
    g.strokeStyle = rgba(color, 0.55); g.lineWidth = u * 0.5;
    for (let i = 0; i < 8; i++) { const yy = (1.4 + i * 1.9 + (frame ? 0.95 : 0)) * u; if (yy > 15 * u) continue; g.beginPath(); g.moveTo((x + 0.4) * u, yy); g.lineTo((x + tw - 0.4) * u, yy); g.stroke(); }
  }
  const hx = slim ? 4.3 : wide ? 3.4 : 3.8, hw = 16 - hx * 2;
  const gr = g.createLinearGradient(0, 2 * u, 0, 15 * u); gr.addColorStop(0, rgba(color, 0.55)); gr.addColorStop(1, '#141a28');
  g.fillStyle = dark; rr(g, hx * u, 2.2 * u, hw * u, 12.4 * u, u * 1.6); g.fill(); g.fillStyle = gr; g.fill();
  g.strokeStyle = color; g.lineWidth = u * 0.7; g.shadowColor = color; g.shadowBlur = u * 3; g.stroke(); g.shadowBlur = 0;
  g.strokeStyle = rgba(color, 0.6); g.lineWidth = u * 0.45;
  if (wide) { g.beginPath(); g.moveTo(hx * u + u, 4 * u); g.lineTo((16 - hx) * u - u, 4 * u); g.moveTo(hx * u + u, 13 * u); g.lineTo((16 - hx) * u - u, 13 * u); g.stroke(); }
  if (slim) { g.beginPath(); g.moveTo(hx * u, 13 * u); g.lineTo(2.5 * u, 15.2 * u); g.moveTo((16 - hx) * u, 13 * u); g.lineTo(13.5 * u, 15.2 * u); g.stroke(); }
  if (style === 'pengineer') { g.fillStyle = '#ffd23f'; g.fillRect(5.5 * u, 11.6 * u, 5 * u, 1.6 * u); g.fillStyle = dark; for (let i = 0; i < 3; i++) g.fillRect((6 + i * 1.6) * u, 11.6 * u, 0.7 * u, 1.6 * u); }
  if (boss) { g.fillStyle = color; for (const [sx, sy] of [[2.4, 3], [13.6, 3], [2.4, 13], [13.6, 13]]) { g.beginPath(); g.moveTo(sx * u, (sy - 1.2) * u); g.lineTo((sx + 0.9) * u, sy * u); g.lineTo(sx * u, (sy + 1.2) * u); g.lineTo((sx - 0.9) * u, sy * u); g.fill(); } }
  g.shadowColor = color; g.shadowBlur = u * 3;
  const barrel = (bx, bw, top) => { const gb = g.createLinearGradient(bx * u, 0, (bx + bw) * u, 0); gb.addColorStop(0, rgba(color, 0.7)); gb.addColorStop(0.5, '#ffffff'); gb.addColorStop(1, rgba(color, 0.7)); g.fillStyle = gb; rr(g, bx * u, top * u, bw * u, (8.5 - top) * u, u * 0.4); g.fill(); };
  if (style === 'pheavy' || boss) { barrel(5.6, 1.6, 0.2); barrel(8.8, 1.6, 0.2); }
  else if (style === 'power') barrel(6.9, 2.2, -0.6);
  else if (slim) barrel(7.35, 1.3, -0.2);
  else if (style === 'pengineer') barrel(7.1, 1.8, 2.2);
  else barrel(7.1, 1.8, 0.4);
  const tr = boss ? 3.6 : wide ? 3.4 : slim ? 2.6 : 3.1;
  const gt = g.createRadialGradient(7.3 * u, 8.2 * u, u * 0.3, 8 * u, 9 * u, tr * u);
  gt.addColorStop(0, '#ffffff'); gt.addColorStop(0.35, color); gt.addColorStop(1, rgba(color, 0.25));
  g.fillStyle = gt; g.beginPath(); g.arc(8 * u, 9 * u, tr * u, 0, TAU); g.fill(); g.shadowBlur = 0;
  g.strokeStyle = '#ffffff'; g.lineWidth = u * 0.35; g.globalAlpha = 0.7; g.stroke(); g.globalAlpha = 1;
  if (style === 'armor' || boss) { g.fillStyle = dark; g.beginPath(); g.arc(8 * u, 9 * u, tr * 0.4 * u, 0, TAU); g.fill(); g.fillStyle = color; g.beginPath(); g.arc(8 * u, 9 * u, tr * 0.22 * u, 0, TAU); g.fill(); }
}

function neonBase(g, cs, R, color, alive, t, fx) {
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
  }
}

function neonPickup(g, cx, cy, s, color, cs, type) {
  g.save(); g.fillStyle = 'rgba(8,10,20,0.85)'; g.strokeStyle = color; g.lineWidth = cs * 0.08; g.shadowColor = color; g.shadowBlur = cs * 0.8;
  rr(g, cx - s / 2, cy - s / 2, s, s, cs * 0.3); g.fill(); g.stroke(); g.restore();
  drawIcon(g, type, cx, cy, s * 0.8, color, true);
}

function glowBullet(g, x, y, vx, vy, color, heavy, cs) {
  g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  const tx = x - vx * 0.05 * cs, ty = y - vy * 0.05 * cs;
  const gr = g.createLinearGradient(tx, ty, x, y); gr.addColorStop(0, rgba(color, 0)); gr.addColorStop(1, color);
  g.strokeStyle = gr; g.lineWidth = cs * (heavy ? 0.36 : 0.26);
  g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
  g.fillStyle = rgba(color, 0.35); g.beginPath(); g.arc(x, y, cs * (heavy ? 0.45 : 0.35), 0, TAU); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, cs * (heavy ? 0.17 : 0.12), 0, TAU); g.fill();
}

function neonFrame(g, cs) {
  g.save(); g.strokeStyle = '#3d7bff'; g.lineWidth = Math.max(2, cs * 0.08); g.shadowColor = '#3d7bff'; g.shadowBlur = cs * 0.8;
  g.strokeRect(-cs * 0.12, -cs * 0.12, W * cs + cs * 0.24, H * cs + cs * 0.24); g.restore();
}

function neonWater(g, cs, f) {
  g.strokeStyle = 'rgba(120,200,255,0.5)'; g.lineWidth = Math.max(1, cs * 0.05);
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    for (let x = 0; x <= cs; x += 2) { const y = cs * (0.3 + k * 0.45) + Math.sin((x / cs) * TAU + f / 8 * TAU + k) * cs * 0.08; x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
  }
}

export const NEON = {
  id: 'neon', name: 'Neon', desc: 'Glowing synthwave arena', word: 'NEON',
  bg: '#03040a', floor: neonFloor, cell: neonCell, tank: neonTank, frame: neonFrame,
  water: neonWater, waterBlend: 'lighter',
  base: neonBase, pickup: neonPickup, bullet: glowBullet,
  tankShadow: 0, vignette: 0.55,
  fx: { add: true, fire: false, light: 1, smoke: '#444', chip: '#ff7a45', steel: '#e6fbff', track: 'tank', trackFade: 0.09, exhaust: 'glow', dust: null, spark: null },
  label: { font: "700 {s}px 'Rajdhani', system-ui", big: "800 {s}px 'Orbitron', system-ui" },
};

// ======================================================================
// REALISTIC TILE SET (shared by Miniature, Winter, Desert, Modern)
// ======================================================================
function bevel(g, px, py, cs, nb, same, light, dark, w) {
  g.fillStyle = light;
  if (nb(0, -1) !== same) g.fillRect(px, py, cs, w);
  if (nb(-1, 0) !== same) g.fillRect(px, py, w, cs);
  g.fillStyle = dark;
  if (nb(0, 1) !== same) g.fillRect(px, py + cs - w, cs, w);
  if (nb(1, 0) !== same) g.fillRect(px + cs - w, py, w, cs);
}
function snowCap(g, px, py, cs, nb, same, x, y) {
  if (nb(0, -1) === same) { if (hash(x, y, 9) < 0.35) { g.fillStyle = 'rgba(245,250,255,0.85)'; g.beginPath(); g.ellipse(px + cs * hash(x, y, 3), py + cs * 0.4, cs * 0.3, cs * 0.14, 0, 0, TAU); g.fill(); } return; }
  g.fillStyle = '#f4f8fb';
  g.beginPath(); g.moveTo(px, py);
  g.lineTo(px + cs, py);
  for (let i = 4; i >= 0; i--) g.lineTo(px + cs * i / 4, py + cs * (0.24 + 0.1 * hash(x * 5 + i, y, 4)));
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(170,200,225,0.5)'; g.fillRect(px, py + cs * 0.02, cs, cs * 0.04);
}

function realCell(P) {
  return (g, grid, x, y, cs, layer) => {
    const v = grid[y * W + x], px = x * cs, py = y * cs, nb = nbOf(grid, x, y);
    if (layer === 'shadow') {
      if (v === T.BRICK || v === T.STEEL) { g.fillStyle = P.shadow; g.fillRect(px + cs * 0.16, py + cs * 0.22, cs, cs); }
      else if (v === T.TREES) { g.fillStyle = P.shadow; g.beginPath(); g.ellipse(px + cs * 0.72, py + cs * 0.8, cs * 0.62, cs * 0.5, 0, 0, TAU); g.fill(); }
      return;
    }
    if (layer === 'trees') { if (v === T.TREES) P.tree(g, px, py, cs, x, y); return; }
    const bw = Math.max(1, cs * 0.07);
    if (v === T.BRICK) {
      const B = P.brick;
      g.fillStyle = B.mortar; g.fillRect(px, py, cs, cs);
      const rows = 3, rh = cs / rows, gap = Math.max(1, cs * 0.035);
      for (let r = 0; r < rows; r++) {
        const off = ((y * rows + r) % 2) * cs * 0.25;
        for (let k = -1; k < 3; k++) {
          const bx0 = px + off + k * cs * 0.5, x0 = Math.max(px, bx0) + gap / 2, x1 = Math.min(px + cs, bx0 + cs * 0.5) - gap / 2;
          if (x1 <= x0) continue;
          const by = py + r * rh + gap / 2, hh = rh - gap;
          g.fillStyle = mix(B.base, hash(x * 7 + k, y * 3 + r) < 0.5 ? B.light : B.dark, hash(x + k, y + r, 2) * 0.5);
          g.fillRect(x0, by, x1 - x0, hh);
          g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x0, by, x1 - x0, Math.max(1, hh * 0.18));
          g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x0, by + hh * 0.8, x1 - x0, hh * 0.2);
        }
      }
      if (P.grime) speckle(g, px, py, cs, cs, 6, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.1)'], cs * 0.03, cs * 0.09, x * 97 + y * 13);
      bevel(g, px, py, cs, nb, T.BRICK, P.bevelLight, P.bevelDark, bw);
      if (P.snow) snowCap(g, px, py, cs, nb, T.BRICK, x, y);
    } else if (v === T.STEEL) {
      const S = P.steel;
      const gr = g.createLinearGradient(px, py, px + cs, py + cs); gr.addColorStop(0, S.light); gr.addColorStop(1, S.base);
      g.fillStyle = gr; g.fillRect(px, py, cs, cs);
      speckle(g, px, py, cs, cs, 14, S.noise, cs * 0.02, cs * 0.07, x * 31 + y * 17);
      if (S.plate) {
        g.strokeStyle = S.dark; g.lineWidth = Math.max(1, cs * 0.04); g.strokeRect(px + cs * 0.12, py + cs * 0.12, cs * 0.76, cs * 0.76);
        g.fillStyle = S.dark; for (const [a, b] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) { g.beginPath(); g.arc(px + a * cs, py + b * cs, cs * 0.05, 0, TAU); g.fill(); }
        g.fillStyle = 'rgba(255,255,255,0.35)'; for (const [a, b] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) g.fillRect(px + a * cs - cs * 0.03, py + b * cs - cs * 0.03, cs * 0.025, cs * 0.025);
      } else {
        g.strokeStyle = S.dark; g.lineWidth = Math.max(1, cs * 0.03);
        if (nb(1, 0) !== T.STEEL || x % 2) { g.beginPath(); g.moveTo(px + cs - 1, py); g.lineTo(px + cs - 1, py + cs); g.stroke(); }
        if (nb(0, 1) !== T.STEEL || y % 2) { g.beginPath(); g.moveTo(px, py + cs - 1); g.lineTo(px + cs, py + cs - 1); g.stroke(); }
      }
      if (S.rust) speckle(g, px, py, cs, cs, 8, S.rust, cs * 0.05, cs * 0.16, x * 11 + y * 71);
      bevel(g, px, py, cs, nb, T.STEEL, P.bevelLight, P.bevelDark, bw * 1.2);
      if (P.snow) snowCap(g, px, py, cs, nb, T.STEEL, x, y);
    } else if (v === T.WATER) {
      const Wt = P.water;
      g.fillStyle = Wt.deep; g.fillRect(px, py, cs, cs);
      const ew = cs * 0.28;
      const sides = [[0, -1, px, py, cs, ew, 0, 1], [0, 1, px, py + cs - ew, cs, ew, 0, -1], [-1, 0, px, py, ew, cs, 1, 0], [1, 0, px + cs - ew, py, ew, cs, -1, 0]];
      for (const [dx, dy, rx, ry, rw, rh, gx, gy] of sides) {
        if (nb(dx, dy) === T.WATER) continue;
        const x0 = gx ? (gx > 0 ? rx : rx + rw) : 0, y0 = gy ? (gy > 0 ? ry : ry + rh) : 0;
        const gr = gx ? g.createLinearGradient(x0, 0, x0 + gx * ew, 0) : g.createLinearGradient(0, y0, 0, y0 + gy * ew);
        gr.addColorStop(0, Wt.bank); gr.addColorStop(0.35, Wt.shallow); gr.addColorStop(1, rgba(Wt.deep, 0));
        g.fillStyle = gr; g.fillRect(rx, ry, rw, rh);
      }
      if (Wt.rim) { g.strokeStyle = Wt.rim; g.lineWidth = Math.max(1, cs * 0.09); edge(g, px, py, cs, nb, T.WATER); }
    } else if (v === T.ICE) {
      const I = P.ice;
      g.fillStyle = I.base; g.fillRect(px, py, cs, cs);
      g.fillStyle = I.light; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(px + cs * 0.1, py + cs); g.lineTo(px + cs * 0.45, py); g.lineTo(px + cs * 0.6, py); g.lineTo(px + cs * 0.25, py + cs); g.fill(); g.globalAlpha = 1;
      g.strokeStyle = I.crack; g.lineWidth = Math.max(1, cs * 0.025);
      g.beginPath(); const cx = px + cs * hash(x, y, 5), cy = py + cs * hash(x, y, 6);
      for (let i = 0; i < 3; i++) { g.moveTo(cx, cy); const a = hash(x, y, i + 7) * TAU; g.lineTo(cx + Math.cos(a) * cs * 0.5, cy + Math.sin(a) * cs * 0.5); }
      g.stroke();
    }
  };
}

// ---------- trees ----------
function treeBush(C) {
  return (g, px, py, cs, x, y) => {
    for (let i = 0; i < 5; i++) {
      const cx = px + cs * (0.15 + hash(x, y, i) * 0.7), cy = py + cs * (0.15 + hash(x, y, i + 10) * 0.7), r = cs * (0.34 + hash(x, y, i + 20) * 0.2);
      const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
      gr.addColorStop(0, C[2]); gr.addColorStop(0.55, C[1]); gr.addColorStop(1, C[0]);
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.fillStyle = rgba(C[2], 0.5);
      for (let k = 0; k < 4; k++) { const a = hash(x, y, i * 7 + k) * TAU, d = r * 0.5 * hash(y, x, k); g.beginPath(); g.arc(cx - r * 0.2 + Math.cos(a) * d, cy - r * 0.2 + Math.sin(a) * d, r * 0.14, 0, TAU); g.fill(); }
    }
  };
}
function treePine(g, px, py, cs, x, y) {
  const cx = px + cs * 0.5, cy = py + cs * 0.5, rot = hash(x, y) * TAU;
  for (const [R, c] of [[0.68, '#173a2c'], [0.5, '#1f4d38'], [0.32, '#2b6247']]) {
    g.fillStyle = c; g.beginPath();
    for (let i = 0; i < 18; i++) { const a = rot + i * TAU / 18, r = cs * R * (i % 2 ? 0.62 : 1); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.closePath(); g.fill();
  }
  g.fillStyle = 'rgba(248,252,255,0.9)';
  for (let i = 0; i < 6; i++) { const a = -2.3 + hash(x, y, i) * 1.6, d = cs * (0.15 + hash(x, y, i + 3) * 0.4); g.beginPath(); g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, cs * 0.12, cs * 0.07, a, 0, TAU); g.fill(); }
}
function treePalm(g, px, py, cs, x, y) {
  const cx = px + cs * 0.5, cy = py + cs * 0.5, rot = hash(x, y) * TAU;
  for (let i = 0; i < 8; i++) {
    const a = rot + i * TAU / 8 + hash(x, y, i) * 0.3, L = cs * (0.62 + hash(x, y, i + 9) * 0.18);
    const ex = cx + Math.cos(a) * L, ey = cy + Math.sin(a) * L, nx = -Math.sin(a) * cs * 0.16, ny = Math.cos(a) * cs * 0.16;
    const mx = cx + Math.cos(a) * L * 0.5, my = cy + Math.sin(a) * L * 0.5;
    g.fillStyle = i % 2 ? '#4f7f2a' : '#5f9433';
    g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(mx + nx, my + ny, ex, ey); g.quadraticCurveTo(mx - nx, my - ny, cx, cy); g.fill();
    g.strokeStyle = '#34561c'; g.lineWidth = Math.max(1, cs * 0.025); g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke();
  }
  g.fillStyle = '#6b4a2b'; g.beginPath(); g.arc(cx, cy, cs * 0.1, 0, TAU); g.fill();
}

// ---------- floors ----------
function miniFloor(g, cs) {
  const w = W * cs, h = H * cs;
  g.fillStyle = '#6a8a45'; g.fillRect(0, 0, w, h);
  blotches(g, w, h, 70, ['#7e9c52', '#5b7a3a', '#8a7a52', '#6f9148'], cs * 1.5, cs * 5, 11, 0.55);
  speckle(g, 0, 0, w, h, W * H * 14, ['rgba(40,60,20,0.35)', 'rgba(170,200,110,0.3)', 'rgba(110,90,50,0.25)'], cs * 0.04, cs * 0.12, 12);
  // little dirt paths
  g.strokeStyle = 'rgba(140,115,75,0.35)'; g.lineCap = 'round'; g.lineWidth = cs * 1.3;
  g.beginPath(); g.moveTo(w * 0.5, h); g.bezierCurveTo(w * 0.45, h * 0.6, w * 0.6, h * 0.4, w * 0.5, 0); g.stroke();
}
function modernFloor(g, cs) {
  const w = W * cs, h = H * cs;
  g.fillStyle = '#46452f'; g.fillRect(0, 0, w, h);
  blotches(g, w, h, 70, ['#3f5230', '#574a34', '#5a563c', '#374828'], cs * 2, cs * 7, 21, 0.4);
  blotches(g, w, h, 90, ['#35442a', '#5a4e3a'], cs * 0.6, cs * 1.6, 22, 0.28);
  speckle(g, 0, 0, w, h, W * H * 12, ['rgba(20,20,12,0.22)', 'rgba(140,130,95,0.14)', 'rgba(70,85,45,0.2)'], cs * 0.03, cs * 0.08, 23);
  const r = srng(24);
  for (let i = 0; i < 14; i++) { // old craters
    const x = r() * w, y = r() * h, R = cs * (0.5 + r() * 1.3);
    const gr = g.createRadialGradient(x, y, R * 0.2, x, y, R); gr.addColorStop(0, 'rgba(40,32,22,0.55)'); gr.addColorStop(0.7, 'rgba(60,50,35,0.25)'); gr.addColorStop(1, 'rgba(150,140,110,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(160,150,120,0.25)'; g.lineWidth = cs * 0.08; g.beginPath(); g.arc(x, y, R * 0.85, 0, TAU); g.stroke();
  }
}
function winterFloor(g, cs) {
  const w = W * cs, h = H * cs;
  g.fillStyle = '#e8eff5'; g.fillRect(0, 0, w, h);
  blotches(g, w, h, 80, ['#cfdce8', '#f6f9fc', '#d8e3ec', '#c4d3e2'], cs * 1.5, cs * 6, 31, 0.7);
  g.strokeStyle = 'rgba(160,185,210,0.25)'; g.lineWidth = cs * 0.12;
  const r = srng(32);
  for (let i = 0; i < 40; i++) { const x = r() * w, y = r() * h, L = cs * (2 + r() * 5); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + L / 2, y - cs * 0.4, x + L, y); g.stroke(); }
  speckle(g, 0, 0, w, h, W * H * 10, ['rgba(255,255,255,0.9)', 'rgba(170,200,230,0.4)', 'rgba(120,150,180,0.2)'], cs * 0.02, cs * 0.07, 33);
}
function desertFloor(g, cs) {
  const w = W * cs, h = H * cs;
  g.fillStyle = '#d9b77c'; g.fillRect(0, 0, w, h);
  blotches(g, w, h, 70, ['#e6c68e', '#c9a46a', '#d2ab70', '#ebd09f'], cs * 2, cs * 7, 41, 0.6);
  const r = srng(42);
  g.lineWidth = Math.max(1, cs * 0.06);
  for (let i = 0; i < 260; i++) { // wind ripples
    const x = r() * w, y = r() * h, L = cs * (1 + r() * 3), a = 0.15;
    g.strokeStyle = r() < 0.5 ? 'rgba(160,120,70,0.25)' : 'rgba(255,240,210,0.35)';
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + L / 2, y + cs * a * 3, x + L, y); g.stroke();
  }
  speckle(g, 0, 0, w, h, W * H * 12, ['rgba(120,90,50,0.3)', 'rgba(255,245,220,0.35)', 'rgba(90,70,40,0.25)'], cs * 0.02, cs * 0.08, 43);
  for (let i = 0; i < 40; i++) { const x = r() * w, y = r() * h, s = cs * (0.08 + r() * 0.18); g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(x + s * 0.4, y + s * 0.5, s, s * 0.7, 0, 0, TAU); g.fill(); g.fillStyle = '#9a8062'; g.beginPath(); g.ellipse(x, y, s, s * 0.7, r(), 0, TAU); g.fill(); }
}

// ---------- modern main battle tank (top-down) ----------
const SCHEMES = {
  woodland: { base: '#6f7a4a', camo: ['#4a5530', '#8a7c52', '#3a4028'], tint: 0.42, tread: '#262624', enemy: '#34363a' },
  winter: { base: '#e3e8ec', camo: ['#a3acb4', '#c2cad1', '#86909a'], tint: 0.34, tread: '#34383c', enemy: '#4a4f57' },
  desert: { base: '#c7ab78', camo: ['#9c7f52', '#dcc496', '#8a6d45'], tint: 0.36, tread: '#3a342b', enemy: '#4a3f36' },
};
function shade(g, x0, y0, x1, y1, c) { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, lighten(c, 0.18)); gr.addColorStop(1, darken(c, 0.25)); return gr; }
function camo(g, pathFn, u, colors, seed, alpha = 0.9) {
  g.save(); pathFn(); g.clip();
  const r = srng(seed);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = rgba(colors[i % colors.length], alpha);
    const cx = r() * 16 * u, cy = r() * 16 * u, rx = (1 + r() * 2.2) * u, ry = (0.6 + r() * 1.4) * u;
    g.beginPath(); g.ellipse(cx, cy, rx, ry, r() * 3, 0, TAU); g.fill();
  }
  g.restore();
}
export function modernTank(g, style, color, S, frame, scheme = 'woodland') {
  const u = S / 16, sc = SCHEMES[scheme];
  const boss = style === 'boss', ifv = style === 'pscout' || style === 'fast', heavy = style === 'pheavy' || style === 'armor' || boss;
  const eng = style === 'pengineer', enemy = !style.startsWith('p') && style !== 'bot';
  const body = enemy ? mix(sc.enemy || '#3b3d40', color, 0.18) : mix(sc.base, color, sc.tint);
  const dark = darken(body, 0.45);
  g.lineJoin = 'round';
  // tracks
  const tw = heavy ? 3.4 : 3.0;
  for (const side of [0, 1]) {
    const x = side ? 16 - 0.3 - tw : 0.3;
    g.fillStyle = sc.tread; rr(g, x * u, 0.7 * u, tw * u, 14.6 * u, u * 0.7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 17; i++) { const yy = (0.9 + i * 0.86 + (frame ? 0.43 : 0)) * u; if (yy > 15 * u) continue; g.fillRect((x + 0.15) * u, yy, (tw - 0.3) * u, 0.32 * u); }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect((x + tw * 0.45) * u, 0.9 * u, 0.12 * tw * u, 14.2 * u);
  }
  // hull
  const hx = ifv ? 3.3 : heavy ? 2.6 : 2.9;
  const hull = [[hx + 0.6, 1.8], [16 - hx - 0.6, 1.8], [16 - hx, 3.6], [16 - hx, 14.8], [hx, 14.8], [hx, 3.6]];
  const hullPath = () => poly(g, hull, u);
  hullPath(); g.fillStyle = shade(g, 0, 0, 16 * u, 16 * u, body); g.fill();
  camo(g, hullPath, u, sc.camo, style.length * 13 + 5, 0.55);
  g.strokeStyle = rgba(dark, 0.9); g.lineWidth = u * 0.22; hullPath(); g.stroke();
  // side skirts
  g.fillStyle = rgba(darken(body, 0.15), 0.95);
  for (const x of [hx - 0.9, 16 - hx - 0.2]) { g.fillRect(x * u, 3.2 * u, 1.1 * u, 10.8 * u); g.strokeStyle = rgba(dark, 0.7); g.lineWidth = u * 0.1; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x * u, (3.2 + i * 2.7) * u); g.lineTo((x + 1.1) * u, (3.2 + i * 2.7) * u); g.stroke(); } }
  // front glacis line & lights
  g.strokeStyle = rgba(lighten(body, 0.4), 0.6); g.lineWidth = u * 0.15; g.beginPath(); g.moveTo((hx + 0.6) * u, 2.1 * u); g.lineTo((16 - hx - 0.6) * u, 2.1 * u); g.stroke();
  g.fillStyle = '#fff6d0'; for (const x of [hx + 0.9, 16 - hx - 1.4]) g.fillRect(x * u, 2.3 * u, 0.5 * u, 0.3 * u);
  // engine deck grille
  g.fillStyle = rgba(darken(body, 0.5), 0.85); g.fillRect((hx + 1.2) * u, 12.2 * u, (16 - 2 * hx - 2.4) * u, 2.1 * u);
  g.strokeStyle = rgba(lighten(body, 0.25), 0.45); g.lineWidth = u * 0.1;
  for (let i = 0; i < 7; i++) { const xx = (hx + 1.4 + i * (16 - 2 * hx - 2.8) / 6) * u; g.beginPath(); g.moveTo(xx, 12.3 * u); g.lineTo(xx, 14.2 * u); g.stroke(); }
  g.fillStyle = '#1b1b1b'; g.fillRect((hx + 0.2) * u, 14.2 * u, 1.1 * u, 0.5 * u); g.fillRect((16 - hx - 1.3) * u, 14.2 * u, 1.1 * u, 0.5 * u);
  if (eng) { // dozer blade + crane
    g.fillStyle = shade(g, 0, 0, 0, 2 * u, '#8a8a80'); rr(g, 0.4 * u, -0.1 * u, 15.2 * u, 1.5 * u, u * 0.3); g.fill();
    g.strokeStyle = '#2d2d28'; g.lineWidth = u * 0.15; g.stroke();
    g.fillStyle = '#e0b000'; for (let i = 0; i < 6; i++) g.fillRect((1 + i * 2.5) * u, 0.1 * u, 1.2 * u, 0.35 * u);
    g.strokeStyle = '#d7b000'; g.lineWidth = u * 0.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(11.5 * u, 13 * u); g.lineTo(13.4 * u, 9 * u); g.stroke(); g.lineCap = 'butt';
  }
  if (heavy) { // ERA blocks on hull front
    g.fillStyle = rgba(darken(body, 0.1), 1); g.strokeStyle = rgba(dark, 0.9); g.lineWidth = u * 0.08;
    for (let i = 0; i < 6; i++) { const bx = (hx + 0.9 + i * (16 - 2 * hx - 1.8) / 6) * u; g.fillRect(bx, 2.6 * u, 1.3 * u, 0.9 * u); g.strokeRect(bx, 2.6 * u, 1.3 * u, 0.9 * u); }
  }
  // turret
  const tcy = boss ? 8.4 : 8.8;
  const tur = ifv ? [[5.2, 6.2], [10.8, 6.2], [11.4, 7.4], [11.4, 11.6], [4.6, 11.6], [4.6, 7.4]]
    : heavy ? [[4.3, 4.7], [11.7, 4.7], [13.1, 7.2], [12.8, 12.7], [3.2, 12.7], [2.9, 7.2]]
      : [[4.8, 5.1], [11.2, 5.1], [12.5, 7.4], [12.1, 12.3], [3.9, 12.3], [3.5, 7.4]];
  // barrel(s) first (under turret front)
  const bar = (bx, bw, top) => {
    const gb = g.createLinearGradient(bx * u, 0, (bx + bw) * u, 0);
    gb.addColorStop(0, darken(body, 0.35)); gb.addColorStop(0.45, lighten(body, 0.25)); gb.addColorStop(1, darken(body, 0.45));
    g.fillStyle = gb; g.fillRect(bx * u, top * u, bw * u, (6 - top) * u);
    g.fillStyle = darken(body, 0.2); g.fillRect((bx - bw * 0.2) * u, (top + (6 - top) * 0.38) * u, bw * 1.4 * u, 1.3 * u); // fume extractor
    g.fillStyle = darken(body, 0.35); g.fillRect((bx - bw * 0.12) * u, top * u, bw * 1.24 * u, 0.7 * u); // muzzle
    g.fillStyle = '#111'; g.fillRect((bx + bw * 0.25) * u, top * u, bw * 0.5 * u, 0.25 * u);
  };
  if (boss) { bar(5.9, 1.2, -3.2); bar(8.9, 1.2, -3.2); }
  else if (ifv) bar(7.6, 0.8, -1.8);
  else if (style === 'power') bar(7.35, 1.3, -4.2);
  else if (eng) bar(7.4, 1.2, 1.6);
  else bar(7.4, 1.2, -3);
  const turPath = () => poly(g, tur, u, 0, tcy - 8.8);
  turPath(); g.fillStyle = shade(g, 3 * u, 5 * u, 13 * u, 13 * u, lighten(body, 0.05)); g.fill();
  camo(g, turPath, u, sc.camo, style.length * 29 + 1, 0.6);
  g.strokeStyle = rgba(dark, 0.95); g.lineWidth = u * 0.25; turPath(); g.stroke();
  g.strokeStyle = rgba(lighten(body, 0.5), 0.35); g.lineWidth = u * 0.12; g.beginPath(); g.moveTo(tur[0][0] * u, (tur[0][1] + tcy - 8.8 + 0.25) * u); g.lineTo(tur[1][0] * u, (tur[1][1] + tcy - 8.8 + 0.25) * u); g.stroke();
  if (heavy) {
    g.fillStyle = darken(body, 0.08); g.strokeStyle = rgba(dark, 0.8); g.lineWidth = u * 0.07;
    for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) { const bx = (4.8 + i * 1.3) * u, by = (tcy - 3.6 + r * 0.95) * u; g.fillRect(bx, by, 1.15 * u, 0.85 * u); g.strokeRect(bx, by, 1.15 * u, 0.85 * u); }
  }
  // hatches & optics
  const cy = tcy + 1.8;
  g.fillStyle = darken(body, 0.3); g.beginPath(); g.arc(10 * u, cy * u, 1.15 * u, 0, TAU); g.fill();
  g.fillStyle = lighten(body, 0.15); g.beginPath(); g.arc(10 * u, cy * u, 0.8 * u, 0, TAU); g.fill();
  g.fillStyle = '#1a2a33'; g.fillRect(9.6 * u, (cy - 1.3) * u, 0.8 * u, 0.4 * u);
  g.fillStyle = darken(body, 0.25); rr(g, 5 * u, (cy - 0.7) * u, 1.8 * u, 1.6 * u, u * 0.3); g.fill();
  // smoke dischargers
  g.fillStyle = '#2a2a26';
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) { g.beginPath(); g.arc((8 + side * (3.4 + i * 0.45)) * u, (tcy - 2.6 + i * 0.5) * u, 0.28 * u, 0, TAU); g.fill(); }
  if (enemy) { g.fillStyle = rgba(color, 0.9); g.fillRect((hx + 0.3) * u, 5 * u, 0.6 * u, 7 * u); g.fillRect((16 - hx - 0.9) * u, 5 * u, 0.6 * u, 7 * u); }
  // recognition panel in player colour
  g.fillStyle = color; g.fillRect(6.3 * u, (tcy + 1.0) * u, 3.4 * u, 1.9 * u);
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = u * 0.12; g.strokeRect(6.3 * u, (tcy + 1.0) * u, 3.4 * u, 1.9 * u);
  // antenna
  g.strokeStyle = 'rgba(20,20,20,0.7)'; g.lineWidth = u * 0.1; g.beginPath(); g.moveTo(4.2 * u, (tcy + 3.2) * u); g.lineTo(2.2 * u, (tcy + 6.8) * u); g.stroke();
  if (ifv) { g.fillStyle = darken(body, 0.2); g.fillRect(11.2 * u, (tcy - 1) * u, 1.3 * u, 3 * u); g.fillStyle = '#222'; g.fillRect(11.35 * u, (tcy - 1) * u, 1 * u, 0.4 * u); }
}

// ---------- bunker base, crates, shells ----------
function bunkerBase(P) {
  return (g, cs, R, color, alive, t) => {
    const n = 14, rr0 = R * 0.9;
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n; g.save(); g.translate(Math.cos(a) * rr0, Math.sin(a) * rr0); g.rotate(a + Math.PI / 2);
      g.fillStyle = 'rgba(0,0,0,0.25)'; rr(g, -R * 0.2 + R * 0.05, -R * 0.12 + R * 0.06, R * 0.4, R * 0.24, R * 0.08); g.fill();
      const gr = g.createLinearGradient(0, -R * 0.12, 0, R * 0.12); gr.addColorStop(0, lighten(P.bag, 0.25)); gr.addColorStop(1, darken(P.bag, 0.2));
      g.fillStyle = gr; rr(g, -R * 0.2, -R * 0.12, R * 0.4, R * 0.24, R * 0.08); g.fill(); g.restore();
    }
    g.fillStyle = P.pad; g.beginPath(); g.arc(0, 0, R * 0.7, 0, TAU); g.fill();
    if (alive) {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-R * 0.36, -R * 0.26, R * 0.8, R * 0.62);
      const gr = g.createLinearGradient(-R * 0.4, 0, R * 0.4, 0); gr.addColorStop(0, lighten(P.roof, 0.15)); gr.addColorStop(0.5, P.roof); gr.addColorStop(0.5, darken(P.roof, 0.15)); gr.addColorStop(1, darken(P.roof, 0.3));
      g.fillStyle = gr; g.fillRect(-R * 0.42, -R * 0.32, R * 0.8, R * 0.6);
      g.fillStyle = color; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.09 : R * 0.2; g.lineTo(Math.cos(a) * r - R * 0.02, Math.sin(a) * r - R * 0.02); } g.fill();
      g.strokeStyle = '#ddd'; g.lineWidth = cs * 0.05; g.beginPath(); g.moveTo(R * 0.45, R * 0.4); g.lineTo(R * 0.45, -R * 0.55); g.stroke();
      g.fillStyle = color; g.beginPath(); g.moveTo(R * 0.45, -R * 0.55);
      for (let i = 0; i <= 5; i++) g.lineTo(R * (0.45 + i * 0.07), -R * 0.55 + Math.sin(t * 6 + i) * R * 0.04);
      for (let i = 5; i >= 0; i--) g.lineTo(R * (0.45 + i * 0.07), -R * 0.32 + Math.sin(t * 6 + i) * R * 0.04);
      g.fill();
      g.fillStyle = Math.sin(t * 5) > 0 ? '#ff3b30' : '#551010'; g.beginPath(); g.arc(-R * 0.3, R * 0.2, R * 0.05, 0, TAU); g.fill();
    } else {
      g.fillStyle = '#2b2622'; g.beginPath(); for (let i = 0; i < 9; i++) { const a = i * TAU / 9, r = R * (0.3 + hash(i, 1) * 0.3); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill();
      g.fillStyle = `rgba(255,${120 + Math.sin(t * 13) * 60 | 0},20,0.8)`; g.beginPath(); g.arc(Math.sin(t * 7) * R * 0.05, 0, R * (0.12 + Math.sin(t * 11) * 0.03), 0, TAU); g.fill();
    }
  };
}
function cratePickup(P) {
  return (g, cx, cy, s, color, cs, type) => {
    const x = cx - s / 2, y = cy - s / 2;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + s * 0.08, y + s * 0.1, s, s);
    const gr = g.createLinearGradient(x, y, x + s, y + s); gr.addColorStop(0, lighten(P.crate, 0.15)); gr.addColorStop(1, darken(P.crate, 0.2));
    g.fillStyle = gr; g.fillRect(x, y, s, s);
    g.strokeStyle = darken(P.crate, 0.45); g.lineWidth = Math.max(1, s * 0.05); g.strokeRect(x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88);
    g.beginPath(); g.moveTo(x + s * 0.08, y + s * 0.08); g.lineTo(x + s * 0.92, y + s * 0.92); g.stroke();
    g.fillStyle = 'rgba(245,240,225,0.92)'; rr(g, cx - s * 0.3, cy - s * 0.3, s * 0.6, s * 0.6, s * 0.08); g.fill();
    drawIcon(g, type, cx, cy, s * 0.52, darken(color, 0.25), false);
  };
}
function shellBullet(tracer) {
  return (g, x, y, vx, vy, color, heavy, cs) => {
    const sp = Math.hypot(vx, vy) || 1, dx = vx / sp, dy = vy / sp;
    const L = cs * (heavy ? 1.1 : 0.9);
    g.lineCap = 'round';
    if (tracer) {
      g.globalCompositeOperation = 'lighter';
      const gr = g.createLinearGradient(x - dx * L, y - dy * L, x, y); gr.addColorStop(0, 'rgba(255,140,40,0)'); gr.addColorStop(1, 'rgba(255,200,90,0.9)');
      g.strokeStyle = gr; g.lineWidth = cs * (heavy ? 0.22 : 0.16); g.beginPath(); g.moveTo(x - dx * L, y - dy * L); g.lineTo(x, y); g.stroke();
      g.fillStyle = 'rgba(255,230,160,0.35)'; g.beginPath(); g.arc(x, y, cs * 0.3, 0, TAU); g.fill();
      g.fillStyle = '#fffbe8'; g.beginPath(); g.arc(x, y, cs * (heavy ? 0.12 : 0.09), 0, TAU); g.fill();
    } else {
      g.strokeStyle = 'rgba(230,230,220,0.45)'; g.lineWidth = cs * 0.12; g.beginPath(); g.moveTo(x - dx * L * 0.8, y - dy * L * 0.8); g.lineTo(x, y); g.stroke();
      g.fillStyle = '#c9a23a'; g.beginPath(); g.ellipse(x, y, cs * (heavy ? 0.2 : 0.15), cs * 0.1, Math.atan2(dy, dx), 0, TAU); g.fill();
      g.fillStyle = '#6b4c10'; g.beginPath(); g.arc(x - dx * cs * 0.08, y - dy * cs * 0.08, cs * 0.06, 0, TAU); g.fill();
    }
  };
}
function woodFrame(color, inner) {
  return (g, cs) => {
    const b = cs * 0.45;
    g.fillStyle = color; g.fillRect(-b, -b, W * cs + b * 2, H * cs + b * 2);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(1, cs * 0.05);
    for (let i = 0; i < 3; i++) g.strokeRect(-b + i * b / 3, -b + i * b / 3, W * cs + b * 2 - i * 2 * b / 3, H * cs + b * 2 - i * 2 * b / 3);
    g.fillStyle = inner || 'rgba(0,0,0,0.35)'; g.fillRect(-cs * 0.08, -cs * 0.08, W * cs + cs * 0.16, H * cs + cs * 0.16);
  };
}

// ======================================================================
// MINIATURE toy tank
// ======================================================================
function toyTank(g, style, color, S, frame) {
  const u = S / 16, col = mix(color, '#7a7a70', 0.18);
  g.lineJoin = 'round';
  const boss = style === 'boss', slim = style === 'pscout' || style === 'fast', wide = style === 'pheavy' || style === 'armor' || boss;
  const tw = wide ? 3.6 : 3.1;
  for (const side of [0, 1]) {
    const x = side ? 16 - 0.5 - tw : 0.5;
    const gr = g.createLinearGradient(x * u, 0, (x + tw) * u, 0); gr.addColorStop(0, '#55554f'); gr.addColorStop(0.5, '#3a3a36'); gr.addColorStop(1, '#262623');
    g.fillStyle = gr; rr(g, x * u, 0.6 * u, tw * u, 14.8 * u, u * 1.3); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 9; i++) { const yy = (1.2 + i * 1.65 + (frame ? 0.8 : 0)) * u; if (yy > 14.8 * u) continue; g.fillRect((x + 0.35) * u, yy, (tw - 0.7) * u, 0.45 * u); }
  }
  const hx = slim ? 4.2 : wide ? 3.3 : 3.7, hw = 16 - hx * 2;
  let gr = g.createLinearGradient(hx * u, 2 * u, (16 - hx) * u, 15 * u); gr.addColorStop(0, lighten(col, 0.35)); gr.addColorStop(0.5, col); gr.addColorStop(1, darken(col, 0.35));
  g.fillStyle = gr; rr(g, hx * u, 2 * u, hw * u, 12.8 * u, u * 1.8); g.fill();
  g.strokeStyle = darken(col, 0.55); g.lineWidth = u * 0.3; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.28)'; rr(g, (hx + 0.6) * u, 2.5 * u, (hw - 1.2) * u, 1.1 * u, u * 0.5); g.fill();
  g.fillStyle = darken(col, 0.3); for (let i = 0; i < 4; i++) g.fillRect((hx + 1 + i * (hw - 2) / 3.5) * u, 13 * u, 0.9 * u, 1.2 * u);
  if (style === 'pengineer') { g.fillStyle = '#f2c230'; g.fillRect(4.8 * u, 11.3 * u, 6.4 * u, 1.2 * u); g.fillStyle = '#222'; for (let i = 0; i < 4; i++) g.fillRect((5.2 + i * 1.6) * u, 11.3 * u, 0.6 * u, 1.2 * u); }
  const barrel = (bx, bw, top) => {
    const gb = g.createLinearGradient(bx * u, 0, (bx + bw) * u, 0); gb.addColorStop(0, darken(col, 0.3)); gb.addColorStop(0.4, lighten(col, 0.45)); gb.addColorStop(1, darken(col, 0.4));
    g.fillStyle = gb; rr(g, bx * u, top * u, bw * u, (8.5 - top) * u, u * 0.5); g.fill();
    g.fillStyle = darken(col, 0.45); g.fillRect((bx - 0.15) * u, top * u, (bw + 0.3) * u, 0.8 * u);
  };
  if (style === 'pheavy' || boss) { barrel(5.5, 1.7, 0); barrel(8.8, 1.7, 0); }
  else if (style === 'power') barrel(6.9, 2.2, -0.8);
  else if (slim) barrel(7.35, 1.3, -0.3);
  else if (style === 'pengineer') barrel(7.1, 1.8, 2.2);
  else barrel(7.1, 1.8, 0.2);
  const tr = boss ? 3.8 : wide ? 3.5 : slim ? 2.7 : 3.2;
  gr = g.createRadialGradient(6.8 * u, 7.6 * u, u * 0.3, 8 * u, 9 * u, tr * u); gr.addColorStop(0, lighten(col, 0.55)); gr.addColorStop(0.5, col); gr.addColorStop(1, darken(col, 0.35));
  g.fillStyle = gr; g.beginPath(); g.arc(8 * u, 9 * u, tr * u, 0, TAU); g.fill();
  g.strokeStyle = darken(col, 0.55); g.lineWidth = u * 0.3; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(7 * u, 7.8 * u, tr * 0.35 * u, tr * 0.2 * u, -0.6, 0, TAU); g.fill();
  g.fillStyle = darken(col, 0.35); g.beginPath(); g.arc(9.2 * u, 10.2 * u, 0.8 * u, 0, TAU); g.fill();
  g.fillStyle = '#f5f1e6'; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = (i % 2 ? 0.28 : 0.65) * u; g.lineTo(6.6 * u + Math.cos(a) * r, 10.6 * u + Math.sin(a) * r); } g.fill();
  if (boss) { g.fillStyle = darken(col, 0.3); for (const [sx, sy] of [[2, 3], [14, 3], [2, 13], [14, 13]]) { g.beginPath(); g.arc(sx * u, sy * u, 0.8 * u, 0, TAU); g.fill(); } }
}

// ======================================================================
// PIXEL REMASTER
// ======================================================================
function pixelCell(g, grid, x, y, cs, layer) {
  if (layer === 'shadow') return;
  const v = grid[y * W + x], px = x * cs, py = y * cs, p = cs / 16;
  const R = (ix, iy, w, h, c) => { g.fillStyle = c; g.fillRect(Math.floor(px + ix * p), Math.floor(py + iy * p), Math.ceil(w * p), Math.ceil(h * p)); };
  if (layer === 'trees') {
    if (v !== T.TREES) return;
    for (let iy = 0; iy < 16; iy++) for (let ix = 0; ix < 16; ix++) {
      const h = hash(x * 16 + ix, y * 16 + iy);
      const edgeCut = (ix === 0 || iy === 0 || ix === 15 || iy === 15) && h < 0.35;
      if (edgeCut) continue;
      R(ix, iy, 1, 1, (ix + iy) % 2 ? (h < 0.3 ? '#58c858' : '#1c7c1c') : (h < 0.2 ? '#8ce88c' : '#0c4c0c'));
    }
    return;
  }
  if (v === T.BRICK) {
    R(0, 0, 16, 16, '#4a4a4a');
    for (let ry = 0; ry < 4; ry++) {
      const off = ((ry + y * 4) % 2) * 4;
      for (let bx = -8 + off; bx < 16; bx += 8) {
        const x0 = Math.max(0, bx), x1 = Math.min(15, bx + 6); if (x1 < x0) continue;
        R(x0, ry * 4, x1 - x0 + 1, 3, '#b8471d');
        R(x0, ry * 4, x1 - x0 + 1, 1, '#e98a52');
        R(x0, ry * 4 + 2, x1 - x0 + 1, 1, '#7a2c0c');
      }
    }
  } else if (v === T.STEEL) {
    R(0, 0, 16, 16, '#bcbcbc'); R(0, 0, 16, 1, '#fcfcfc'); R(0, 0, 1, 16, '#fcfcfc'); R(0, 15, 16, 1, '#5c5c5c'); R(15, 0, 1, 16, '#5c5c5c');
    R(4, 4, 8, 8, '#fcfcfc'); R(5, 11, 7, 1, '#7c7c7c'); R(11, 5, 1, 7, '#7c7c7c');
  } else if (v === T.WATER) {
    R(0, 0, 16, 16, '#2c44d8');
    for (let iy = 0; iy < 16; iy += 2) for (let ix = (iy / 2) % 2; ix < 16; ix += 4) R(ix, iy, 1, 1, '#1c30a8');
  } else if (v === T.ICE) {
    R(0, 0, 16, 16, '#d8dce8');
    for (let iy = 0; iy < 16; iy++) for (let ix = 0; ix < 16; ix++) { if ((ix + iy) % 8 === 0) R(ix, iy, 1, 1, '#a4c4fc'); else if ((ix - iy + 16) % 8 === 3) R(ix, iy, 1, 1, '#fcfcfc'); }
  }
}
function pixelFloor(g, cs) {
  g.fillStyle = '#0d0d15'; g.fillRect(0, 0, W * cs, H * cs);
  const p = cs / 16; g.fillStyle = '#16162a';
  for (let y = 0; y < H * 16; y += 4) for (let x = (y / 4) % 2 * 2; x < W * 16; x += 4) g.fillRect(Math.floor(x * p), Math.floor(y * p), Math.ceil(p), Math.ceil(p));
}
function pixelWater(g, cs, f) {
  const p = cs / 16; g.fillStyle = '#8cacfc';
  for (const row of [3, 10]) for (let k = 0; k < 2; k++) { const x0 = (k * 8 + f * 2 + row) % 16; for (let i = 0; i < 3; i++) g.fillRect(Math.floor(((x0 + i) % 16) * p), Math.floor(row * p), Math.ceil(p), Math.ceil(p)); }
}
function pixelTank(g, style, color, S, frame) {
  const p = S / 16, grid = [];
  for (let i = 0; i < 16; i++) grid.push(new Array(16).fill(null));
  const boss = style === 'boss', slim = style === 'pscout' || style === 'fast', wide = style === 'pheavy' || style === 'armor' || boss;
  const pal = { k: '#141414', t: '#3a3a3a', T: '#707070', d: darken(color, 0.45), m: color, l: lighten(color, 0.35), w: lighten(color, 0.75), y: '#ffd23f' };
  const L0 = slim ? 1 : 0, tw = wide ? 4 : 3;
  for (let y = 1; y < 15; y++) for (const side of [0, 1]) for (let i = 0; i < tw; i++) {
    const x = side ? 15 - L0 - i : L0 + i;
    grid[y][x] = i === 0 ? 'k' : ((y + frame + i) % 2 ? 't' : 'T');
  }
  const h0 = L0 + tw, h1 = 15 - L0 - tw;
  for (let y = 3; y < 14; y++) for (let x = h0; x <= h1; x++) grid[y][x] = y === 3 || x === h0 ? 'l' : (y === 13 || x === h1 ? 'd' : 'm');
  if (style === 'pengineer') for (let x = h0 + 1; x < h1; x++) grid[12][x] = x % 2 ? 'y' : 'k';
  const top = style === 'power' ? 0 : style === 'pengineer' ? 3 : 1;
  const cols = style === 'pheavy' || boss ? [[5, 6], [9, 10]] : [[7, 8]];
  for (const [a, b] of cols) for (let y = top; y < 8; y++) { grid[y][a] = 'w'; grid[y][b] = 'l'; }
  const r = boss ? 3.9 : wide ? 3.6 : slim ? 2.7 : 3.2;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 8.5, d = Math.hypot(dx, dy);
    if (d <= r) grid[y][x] = d > r - 1 ? 'd' : (dx + dy < -1.5 ? 'w' : (dx + dy < 0.5 ? 'l' : 'm'));
  }
  if (style === 'armor' || boss) { grid[8][7] = grid[8][8] = grid[9][7] = grid[9][8] = 'k'; }
  if (boss) for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]]) grid[y][x] = 'l';
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const c = grid[y][x]; if (!c) continue; g.fillStyle = pal[c]; g.fillRect(Math.floor(x * p), Math.floor(y * p), Math.ceil(p), Math.ceil(p)); }
}
const PIX_STAR = [
  '................', '.......yy.......', '.......yy.......', '......yyyy......', '......yyyy......', 'yyyyyyyyyyyyyyyy', '.yyyyyyyyyyyyyy.', '..yyyyyyyyyyyy..',
  '...yyyyyyyyyy...', '...yyyyyyyyyy...', '..yyyyy..yyyyy..', '..yyyy....yyyy..', '.yyy........yyy.', '.yy..........yy.', '................', '................'];
function pixelBase(g, cs, R, color, alive, t) {
  const p = cs / 8; g.save(); g.translate(-cs, -cs);
  g.fillStyle = '#141414'; g.fillRect(0, 0, 16 * p, 16 * p);
  const c = alive ? color : '#5c5c5c', d = alive ? darken(color, 0.4) : '#3a3a3a';
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (PIX_STAR[y][x] === 'y') { g.fillStyle = (x + y) % 5 === 0 ? d : c; g.fillRect(Math.floor(x * p), Math.floor(y * p), Math.ceil(p), Math.ceil(p)); }
  if (!alive) { g.fillStyle = '#141414'; for (let i = 0; i < 30; i++) g.fillRect(Math.floor(((i * 7) % 16) * p), Math.floor(((i * 11) % 16) * p), Math.ceil(p * 2), Math.ceil(p)); }
  g.restore();
}
function pixelPickup(g, cx, cy, s, color, cs, type) {
  const p = Math.max(1, cs / 16), x = Math.floor(cx - s / 2), y = Math.floor(cy - s / 2);
  g.fillStyle = '#141414'; g.fillRect(x, y, s, s);
  g.fillStyle = color; g.fillRect(x, y, s, p); g.fillRect(x, y + s - p, s, p); g.fillRect(x, y, p, s); g.fillRect(x + s - p, y, p, s);
  drawIcon(g, type, cx, cy, s * 0.75, color, false);
}
function pixelBullet(g, x, y, vx, vy, color, heavy, cs) {
  const p = cs / 16, s = (heavy ? 4 : 3) * p;
  g.fillStyle = color; g.fillRect(Math.floor(x - s / 2 - p), Math.floor(y - s / 2 - p), Math.ceil(s + 2 * p), Math.ceil(s + 2 * p));
  g.fillStyle = '#fcfcfc'; g.fillRect(Math.floor(x - s / 2), Math.floor(y - s / 2), Math.ceil(s), Math.ceil(s));
}
function pixelFrame(g, cs) {
  const b = cs * 0.5; g.fillStyle = '#6c6c6c'; g.fillRect(-b, -b, W * cs + 2 * b, H * cs + 2 * b);
  g.fillStyle = '#9c9c9c'; g.fillRect(-b, -b, W * cs + 2 * b, cs * 0.12); g.fillRect(-b, -b, cs * 0.12, H * cs + 2 * b);
}

// ======================================================================
// BLUEPRINT
// ======================================================================
const INK = 'rgba(232,242,255,0.9)';
function bpFloor(g, cs) {
  const w = W * cs, h = H * cs;
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7); gr.addColorStop(0, '#1b4f96'); gr.addColorStop(1, '#123a73');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  speckle(g, 0, 0, w, h, W * H * 6, ['rgba(255,255,255,0.05)', 'rgba(0,0,40,0.08)'], cs * 0.03, cs * 0.12, 51);
  g.lineWidth = 1;
  for (let x = 0; x <= W; x++) { g.strokeStyle = x % 4 ? 'rgba(170,205,255,0.13)' : 'rgba(200,225,255,0.28)'; g.beginPath(); g.moveTo(x * cs + 0.5, 0); g.lineTo(x * cs + 0.5, h); g.stroke(); }
  for (let y = 0; y <= H; y++) { g.strokeStyle = y % 4 ? 'rgba(170,205,255,0.13)' : 'rgba(200,225,255,0.28)'; g.beginPath(); g.moveTo(0, y * cs + 0.5); g.lineTo(w, y * cs + 0.5); g.stroke(); }
}
function bpCell(g, grid, x, y, cs, layer) {
  if (layer === 'shadow') return;
  const v = grid[y * W + x], px = x * cs, py = y * cs, nb = nbOf(grid, x, y), lw = Math.max(1, cs * 0.045);
  g.lineCap = 'round';
  if (layer === 'trees') {
    if (v !== T.TREES) return;
    g.strokeStyle = 'rgba(150,255,200,0.85)'; g.lineWidth = lw;
    g.beginPath(); g.arc(px + cs / 2, py + cs / 2, cs * 0.42, 0, TAU); g.stroke();
    g.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + hash(x, y); g.moveTo(px + cs / 2, py + cs / 2); g.lineTo(px + cs / 2 + Math.cos(a) * cs * 0.3, py + cs / 2 + Math.sin(a) * cs * 0.3); } g.stroke();
    return;
  }
  if (v === T.BRICK) {
    g.fillStyle = 'rgba(18,58,115,0.6)'; g.fillRect(px, py, cs, cs);
    g.strokeStyle = 'rgba(232,242,255,0.55)'; g.lineWidth = Math.max(1, lw * 0.7);
    g.beginPath(); g.moveTo(px, py + cs / 2); g.lineTo(px + cs, py + cs / 2);
    const o = (y % 2) * cs / 2; g.moveTo(px + ((o + cs / 2) % cs), py); g.lineTo(px + ((o + cs / 2) % cs), py + cs / 2); g.moveTo(px + o, py + cs / 2); g.lineTo(px + o, py + cs); g.stroke();
    g.strokeStyle = INK; g.lineWidth = lw * 1.4; edge(g, px, py, cs, nb, T.BRICK);
  } else if (v === T.STEEL) {
    g.fillStyle = 'rgba(18,58,115,0.7)'; g.fillRect(px, py, cs, cs);
    g.save(); g.beginPath(); g.rect(px, py, cs, cs); g.clip();
    g.strokeStyle = 'rgba(232,242,255,0.5)'; g.lineWidth = Math.max(1, lw * 0.6);
    g.beginPath(); for (let i = -1; i <= 4; i++) { g.moveTo(px + i * cs / 4, py + cs); g.lineTo(px + i * cs / 4 + cs, py); } g.stroke();
    g.restore();
    g.strokeStyle = INK; g.lineWidth = lw * 1.6; edge(g, px, py, cs, nb, T.STEEL);
  } else if (v === T.WATER) {
    g.strokeStyle = 'rgba(140,210,255,0.8)'; g.lineWidth = lw;
    for (let k = 0; k < 2; k++) { g.beginPath(); for (let i = 0; i <= 8; i++) { const xx = px + i * cs / 8, yy = py + cs * (0.3 + k * 0.4) + Math.sin(i + x * 2) * cs * 0.07; i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); } g.stroke(); }
    g.setLineDash([cs * 0.12, cs * 0.1]); g.strokeStyle = 'rgba(140,210,255,0.9)'; edge(g, px, py, cs, nb, T.WATER); g.setLineDash([]);
  } else if (v === T.ICE) {
    g.fillStyle = 'rgba(210,235,255,0.5)';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) g.fillRect(px + (i + 0.4) * cs / 4, py + (j + 0.4) * cs / 4, Math.max(1, cs * 0.04), Math.max(1, cs * 0.04));
  }
}
function bpTank(g, style, color, S, frame) {
  const u = S / 16, ink = lighten(color, 0.3);
  const boss = style === 'boss', slim = style === 'pscout' || style === 'fast', wide = style === 'pheavy' || style === 'armor' || boss;
  g.strokeStyle = ink; g.lineWidth = u * 0.35; g.fillStyle = 'rgba(18,58,115,0.88)'; g.lineJoin = 'round';
  const tw = wide ? 3.6 : 3;
  for (const side of [0, 1]) {
    const x = side ? 16 - 0.6 - tw : 0.6;
    g.fillRect(x * u, 0.6 * u, tw * u, 14.8 * u); g.strokeRect(x * u, 0.6 * u, tw * u, 14.8 * u);
    g.lineWidth = u * 0.18; g.beginPath(); for (let i = 0; i < 8; i++) { const yy = (1.5 + i * 1.8 + (frame ? 0.9 : 0)) * u; if (yy < 15 * u) { g.moveTo(x * u, yy); g.lineTo((x + tw) * u, yy); } } g.stroke(); g.lineWidth = u * 0.35;
  }
  const hx = slim ? 4.3 : wide ? 3.4 : 3.8;
  g.fillRect(hx * u, 2.2 * u, (16 - 2 * hx) * u, 12.4 * u); g.strokeRect(hx * u, 2.2 * u, (16 - 2 * hx) * u, 12.4 * u);
  const bar = (bx, bw, top) => { g.fillRect(bx * u, top * u, bw * u, (8.5 - top) * u); g.strokeRect(bx * u, top * u, bw * u, (8.5 - top) * u); };
  if (style === 'pheavy' || boss) { bar(5.6, 1.6, 0.2); bar(8.8, 1.6, 0.2); } else if (style === 'power') bar(6.9, 2.2, -0.6); else if (slim) bar(7.35, 1.3, -0.2); else if (style === 'pengineer') bar(7.1, 1.8, 2.2); else bar(7.1, 1.8, 0.4);
  const tr = boss ? 3.6 : wide ? 3.4 : slim ? 2.6 : 3.1;
  g.beginPath(); g.arc(8 * u, 9 * u, tr * u, 0, TAU); g.fill(); g.stroke();
  g.lineWidth = u * 0.15; g.setLineDash([u * 0.6, u * 0.4]); g.strokeStyle = 'rgba(232,242,255,0.6)';
  g.beginPath(); g.moveTo(8 * u, -0.5 * u); g.lineTo(8 * u, 16 * u); g.moveTo(2 * u, 9 * u); g.lineTo(14 * u, 9 * u); g.stroke(); g.setLineDash([]);
  if (style === 'pengineer') { g.strokeStyle = ink; g.strokeRect(5 * u, 11.5 * u, 6 * u, 1.5 * u); }
}
function bpBase(g, cs, R, color, alive, t) {
  g.strokeStyle = alive ? lighten(color, 0.3) : 'rgba(232,242,255,0.3)'; g.lineWidth = cs * 0.06; g.fillStyle = 'rgba(18,58,115,0.9)';
  hex(g, R); g.fill(); g.stroke();
  g.setLineDash([cs * 0.2, cs * 0.15]); g.lineDashOffset = -t * cs; g.beginPath(); g.arc(0, 0, R * 1.15, 0, TAU); g.stroke(); g.setLineDash([]);
  g.fillStyle = g.strokeStyle; g.font = `700 ${cs * 0.6}px 'Rajdhani', monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(alive ? 'HQ' : 'X', 0, cs * 0.03);
}
function bpPickup(g, cx, cy, s, color, cs, type) {
  g.strokeStyle = lighten(color, 0.3); g.lineWidth = cs * 0.06; g.fillStyle = 'rgba(18,58,115,0.9)';
  g.setLineDash([cs * 0.2, cs * 0.12]); rr(g, cx - s / 2, cy - s / 2, s, s, cs * 0.2); g.fill(); g.stroke(); g.setLineDash([]);
  drawIcon(g, type, cx, cy, s * 0.75, lighten(color, 0.3), false);
}
function bpBullet(g, x, y, vx, vy, color, heavy, cs) {
  const sp = Math.hypot(vx, vy) || 1, dx = vx / sp, dy = vy / sp;
  g.strokeStyle = 'rgba(232,242,255,0.7)'; g.lineWidth = Math.max(1, cs * 0.05); g.setLineDash([cs * 0.15, cs * 0.12]);
  g.beginPath(); g.moveTo(x - dx * cs * 1.4, y - dy * cs * 1.4); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
  g.strokeStyle = lighten(color, 0.3); g.lineWidth = Math.max(1, cs * 0.07); g.beginPath(); g.arc(x, y, cs * (heavy ? 0.22 : 0.16), 0, TAU); g.stroke();
}
function bpFrame(g, cs) {
  g.strokeStyle = 'rgba(232,242,255,0.85)'; g.lineWidth = Math.max(1, cs * 0.06);
  g.strokeRect(-cs * 0.2, -cs * 0.2, W * cs + cs * 0.4, H * cs + cs * 0.4);
  g.lineWidth = Math.max(1, cs * 0.03); g.strokeRect(-cs * 0.35, -cs * 0.35, W * cs + cs * 0.7, H * cs + cs * 0.7);
  g.fillStyle = 'rgba(232,242,255,0.7)'; g.font = `600 ${cs * 0.32}px monospace`; g.textAlign = 'right'; g.textBaseline = 'top';
  g.fillText('NEON TANKS · BATTLEFIELD PLAN · SHEET 01 · SCALE 1:35', W * cs, H * cs + cs * 0.24);
}

// ---------- water overlays for realistic themes ----------
function softWater(color, alpha) {
  return (g, cs, f) => {
    g.strokeStyle = rgba(color, alpha); g.lineWidth = Math.max(1, cs * 0.04); g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { const xx = ((k * 0.37 + f / 8) % 1) * cs, yy = (0.2 + k * 0.3) * cs; g.beginPath(); g.arc(xx, yy, cs * 0.18, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
  };
}
function floeWater(g, cs, f) {
  g.fillStyle = 'rgba(235,245,252,0.75)';
  for (let k = 0; k < 2; k++) { const xx = ((k * 0.5 + f / 16) % 1) * cs, yy = (0.3 + k * 0.4) * cs; g.beginPath(); g.ellipse(xx, yy, cs * 0.14, cs * 0.08, k, 0, TAU); g.fill(); }
}
function sparkleWater(g, cs, f) {
  g.fillStyle = 'rgba(255,255,240,0.8)';
  for (let k = 0; k < 2; k++) if ((f + k * 3) % 8 < 2) { const s = cs * 0.06; g.fillRect(cs * (0.25 + k * 0.45), cs * (0.3 + k * 0.3), s, s); }
  softWater('#ffffff', 0.18)(g, cs, f);
}

// ---------- post effects ----------
function grade(color, a, op = 'soft-light') { return (g, cw, ch) => { g.save(); g.globalCompositeOperation = op; g.fillStyle = rgba(color, a); g.fillRect(0, 0, cw, ch); g.restore(); }; }
function tiltShift(g, cw, ch, r) {
  const band = Math.floor(ch * 0.26), k = 7;
  const sw = Math.ceil(cw / k), sh = Math.ceil(band / k);
  const c = r.cache('tilt', () => { const x = document.createElement('canvas'); return x; });
  if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }
  const cg = c.getContext('2d'); cg.imageSmoothingEnabled = true; g.imageSmoothingEnabled = true;
  for (const top of [true, false]) {
    const y0 = top ? 0 : ch - band;
    cg.clearRect(0, 0, sw, sh); cg.drawImage(g.canvas, 0, y0, cw, band, 0, 0, sw, sh);
    const steps = [[0, 0.45, 0.95], [0.45, 0.72, 0.6], [0.72, 1, 0.28]];
    for (const [a, b, al] of steps) {
      const fa = top ? a : 1 - b, fb = top ? b : 1 - a;
      g.globalAlpha = al; g.drawImage(c, 0, fa * sh, sw, (fb - fa) * sh, 0, y0 + fa * band, cw, (fb - fa) * band);
    }
  }
  g.globalAlpha = 1;
  grade('#ffb870', 0.14)(g, cw, ch);
}
function scanlines(g, cw, ch, r) {
  const pat = r.cache('scan', () => { const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d'); x.fillStyle = 'rgba(0,0,0,0.16)'; x.fillRect(0, 3, 4, 1); return c; });
  g.save(); g.fillStyle = g.createPattern(pat, 'repeat'); g.fillRect(0, 0, cw, ch); g.restore();
}


// ======================================================================
// SPECIAL TERRAIN (boost pads, teleporters, bridges, barrels, mines) — painted per style family
// ======================================================================
const SPECIAL = new Set([T.BOOST, T.TELE, T.BRIDGE, T.BARREL, T.MINE]);
function padCenter(grid, x, y, v) { // which quarter of a 2×2 pad this cell is
  let lx = 0, ly = 0;
  for (let k = x - 1; k >= 0 && grid[y * W + k] === v; k--) lx++;
  for (let k = y - 1; k >= 0 && grid[k * W + x] === v; k--) ly++;
  return [x - (lx % 2) + 1, y - (ly % 2) + 1];
}
export function paintSpecial(g, grid, x, y, cs, layer, fam, P) {
  const v = grid[y * W + x], px = x * cs, py = y * cs, nb = nbOf(grid, x, y);
  if (!SPECIAL.has(v)) return false;
  if (layer === 'trees') return true;
  if (layer === 'shadow') {
    if (v === T.BARREL && fam === 'real') { g.fillStyle = P.shadow; g.beginPath(); g.ellipse(px + cs * 0.62, py + cs * 0.66, cs * 0.44, cs * 0.4, 0, 0, TAU); g.fill(); }
    return true;
  }
  const px16 = cs / 16, R = (ix, iy, w, h, c) => { g.fillStyle = c; g.fillRect(Math.floor(px + ix * px16), Math.floor(py + iy * px16), Math.ceil(w * px16), Math.ceil(h * px16)); };
  const lw = Math.max(1, cs * 0.06);
  if (v === T.BOOST) {
    if (fam === 'pixel') { R(0, 0, 16, 16, '#101030'); for (const o of [2, 8]) for (let i = 0; i < 4; i++) { R(4 + i, o + i, 2, 1, '#fcd000'); R(10 - i, o + i, 2, 1, '#fcd000'); } return true; }
    if (fam === 'bp') { g.strokeStyle = 'rgba(232,242,255,0.8)'; g.lineWidth = lw; g.setLineDash([cs * 0.1, cs * 0.08]); g.strokeRect(px + 1, py + 1, cs - 2, cs - 2); g.setLineDash([]); }
    else { g.fillStyle = fam === 'neon' ? '#0a1630' : '#55595e'; g.fillRect(px, py, cs, cs); if (fam === 'real') { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(px, py, cs, cs * 0.1); } }
    const col = fam === 'neon' ? '#3de0ff' : fam === 'bp' ? 'rgba(232,242,255,0.9)' : '#f2c230';
    g.save(); g.strokeStyle = col; g.lineWidth = Math.max(1.5, cs * 0.1); g.lineCap = 'round'; g.lineJoin = 'round';
    if (fam === 'neon') { g.shadowColor = col; g.shadowBlur = cs * 0.4; }
    for (const o of [0.3, 0.65]) { g.beginPath(); g.moveTo(px + cs * 0.25, py + cs * (o + 0.15)); g.lineTo(px + cs * 0.5, py + cs * o); g.lineTo(px + cs * 0.75, py + cs * (o + 0.15)); g.stroke(); }
    g.restore();
    return true;
  }
  if (v === T.TELE) {
    const [ccx, ccy] = padCenter(grid, x, y, T.TELE), cxp = ccx * cs, cyp = ccy * cs;
    g.save(); g.beginPath(); g.rect(px, py, cs, cs); g.clip();
    if (fam === 'pixel') { R(0, 0, 16, 16, '#1c0c3c'); g.restore(); g.save(); g.beginPath(); g.rect(px, py, cs, cs); g.clip(); g.strokeStyle = '#b86bff'; g.lineWidth = Math.max(2, cs * 0.18); g.beginPath(); g.arc(cxp, cyp, cs * 0.75, 0, TAU); g.stroke(); g.restore(); return true; }
    if (fam !== 'bp') { g.fillStyle = fam === 'neon' ? '#140a26' : '#7d8288'; g.fillRect(px, py, cs, cs); }
    const col = fam === 'neon' ? '#b36bff' : fam === 'bp' ? 'rgba(232,242,255,0.9)' : '#3d9bff';
    if (fam === 'real') { g.fillStyle = '#2b2f36'; g.beginPath(); g.arc(cxp, cyp, cs * 0.82, 0, TAU); g.fill(); const gr = g.createRadialGradient(cxp, cyp, 0, cxp, cyp, cs * 0.7); gr.addColorStop(0, 'rgba(120,200,255,0.9)'); gr.addColorStop(1, 'rgba(30,80,160,0.2)'); g.fillStyle = gr; g.beginPath(); g.arc(cxp, cyp, cs * 0.7, 0, TAU); g.fill(); }
    g.strokeStyle = col; g.lineWidth = Math.max(1.5, cs * 0.1); if (fam === 'neon') { g.shadowColor = col; g.shadowBlur = cs * 0.5; }
    g.beginPath(); g.arc(cxp, cyp, cs * 0.82, 0, TAU); g.stroke();
    g.lineWidth = Math.max(1, cs * 0.05); g.beginPath(); g.arc(cxp, cyp, cs * 0.5, 0, TAU); g.stroke();
    g.restore();
    return true;
  }
  if (v === T.BRIDGE) {
    const horiz = nb(0, -1) === T.WATER || nb(0, 1) === T.WATER; // traffic runs left-right
    if (fam === 'pixel') {
      R(0, 0, 16, 16, '#2c44d8');
      for (let i = 0; i < 16; i += 4) horiz ? R(i, 1, 3, 14, '#a0582c') : R(1, i, 14, 3, '#a0582c');
      horiz ? (R(0, 0, 16, 2, '#5c2c0c'), R(0, 14, 16, 2, '#5c2c0c')) : (R(0, 0, 2, 16, '#5c2c0c'), R(14, 0, 2, 16, '#5c2c0c'));
      return true;
    }
    if (fam === 'neon') { g.fillStyle = '#041a36'; g.fillRect(px, py, cs, cs); }
    else if (fam === 'real') { g.fillStyle = P.water.deep; g.fillRect(px, py, cs, cs); }
    const wood = fam === 'neon' ? '#2a1a10' : fam === 'bp' ? 'rgba(18,58,115,0.9)' : (P.bridge || '#8a6a44');
    const n = 4;
    for (let i = 0; i < n; i++) {
      g.fillStyle = fam === 'real' ? mix(wood, i % 2 ? '#000000' : '#ffffff', 0.08 + hash(x, y, i) * 0.08) : wood;
      if (horiz) g.fillRect(px + i * cs / n + cs * 0.02, py + cs * 0.06, cs / n - cs * 0.04, cs * 0.88); else g.fillRect(px + cs * 0.06, py + i * cs / n + cs * 0.02, cs * 0.88, cs / n - cs * 0.04);
    }
    const rail = fam === 'neon' ? '#ff9b3d' : fam === 'bp' ? 'rgba(232,242,255,0.9)' : darken(wood, 0.45);
    g.save(); g.strokeStyle = rail; g.lineWidth = Math.max(1.5, cs * 0.09); if (fam === 'neon') { g.shadowColor = rail; g.shadowBlur = cs * 0.4; }
    g.beginPath();
    if (horiz) { if (nb(0, -1) !== T.BRIDGE) { g.moveTo(px, py + lw); g.lineTo(px + cs, py + lw); } if (nb(0, 1) !== T.BRIDGE) { g.moveTo(px, py + cs - lw); g.lineTo(px + cs, py + cs - lw); } }
    else { if (nb(-1, 0) !== T.BRIDGE) { g.moveTo(px + lw, py); g.lineTo(px + lw, py + cs); } if (nb(1, 0) !== T.BRIDGE) { g.moveTo(px + cs - lw, py); g.lineTo(px + cs - lw, py + cs); } }
    g.stroke(); g.restore();
    if (P && P.snow) { g.fillStyle = 'rgba(245,250,255,0.6)'; g.fillRect(px + cs * 0.2, py + cs * 0.3, cs * 0.3, cs * 0.15); }
    return true;
  }
  if (v === T.BARREL) {
    const cx = px + cs / 2, cy = py + cs / 2, r = cs * 0.42;
    if (fam === 'pixel') { R(2, 2, 12, 12, '#6a1010'); R(3, 3, 10, 10, '#d02c2c'); R(4, 4, 4, 2, '#ff8080'); R(6, 6, 4, 4, '#fcd000'); R(7, 7, 2, 2, '#000'); return true; }
    if (fam === 'bp') { g.strokeStyle = '#ff9a9a'; g.lineWidth = lw; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(cx - r * 0.5, cy - r * 0.5); g.lineTo(cx + r * 0.5, cy + r * 0.5); g.moveTo(cx + r * 0.5, cy - r * 0.5); g.lineTo(cx - r * 0.5, cy + r * 0.5); g.stroke(); return true; }
    g.save();
    if (fam === 'neon') { g.shadowColor = '#ff3b30'; g.shadowBlur = cs * 0.5; }
    const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    gr.addColorStop(0, fam === 'neon' ? '#ff8a80' : '#e0513f'); gr.addColorStop(1, fam === 'neon' ? '#7a0c0c' : '#7a1c12');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); g.restore();
    g.strokeStyle = fam === 'neon' ? '#ff5a4f' : '#4a0f0a'; g.lineWidth = Math.max(1, cs * 0.05); g.beginPath(); g.arc(cx, cy, r * 0.78, 0, TAU); g.stroke();
    g.fillStyle = '#f2c230'; g.beginPath(); g.moveTo(cx, cy - r * 0.42); g.lineTo(cx + r * 0.38, cy + r * 0.28); g.lineTo(cx - r * 0.38, cy + r * 0.28); g.closePath(); g.fill();
    g.fillStyle = '#1a1a1a'; g.fillRect(cx - r * 0.05, cy - r * 0.18, r * 0.1, r * 0.26); g.fillRect(cx - r * 0.05, cy + r * 0.12, r * 0.1, r * 0.08);
    return true;
  }
  if (v === T.MINE) {
    const cx = px + cs / 2, cy = py + cs / 2, r = cs * 0.22;
    if (fam === 'pixel') { R(6, 6, 4, 4, '#3a3a3a'); R(5, 7, 6, 2, '#3a3a3a'); R(7, 5, 2, 6, '#3a3a3a'); return true; }
    if (fam === 'bp') { g.strokeStyle = 'rgba(255,154,154,0.9)'; g.lineWidth = lw; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.moveTo(cx - r * 1.5, cy); g.lineTo(cx + r * 1.5, cy); g.moveTo(cx, cy - r * 1.5); g.lineTo(cx, cy + r * 1.5); g.stroke(); return true; }
    g.fillStyle = fam === 'neon' ? '#150a1e' : 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(cx + (fam === 'real' ? r * 0.2 : 0), cy + (fam === 'real' ? r * 0.25 : 0), r * 1.15, 0, TAU); g.fill();
    g.fillStyle = fam === 'neon' ? '#2a1a3a' : (P.mine || '#4d5236'); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    g.strokeStyle = fam === 'neon' ? '#ff4fd8' : 'rgba(0,0,0,0.5)'; g.lineWidth = Math.max(1, cs * 0.04); g.stroke();
    g.fillStyle = fam === 'neon' ? '#ff4fd8' : '#2a2c1c'; for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + 0.6; g.beginPath(); g.arc(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.14, 0, TAU); g.fill(); }
    return true;
  }
  return false;
}
const withSpecial = (cell, fam, P) => (g, grid, x, y, cs, layer) => { if (!paintSpecial(g, grid, x, y, cs, layer, fam, P)) cell(g, grid, x, y, cs, layer); };

// ======================================================================
// THEME TABLE
// ======================================================================
const realFx = (o) => ({ add: false, fire: true, light: 0.5, trackFade: 0.015, exhaust: 'smoke', ...o });
const P_MINI = { shadow: 'rgba(20,25,10,0.38)', bevelLight: 'rgba(255,240,210,0.35)', bevelDark: 'rgba(0,0,0,0.3)', grime: false,
  brick: { base: '#b0583a', light: '#c9704c', dark: '#8a4028', mortar: '#d8c9a8' },
  steel: { base: '#8f8f88', light: '#c2c2ba', dark: 'rgba(60,60,55,0.7)', noise: ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.12)'], plate: false },
  water: { deep: '#2c6f8e', shallow: '#4fa0b8', bank: '#6b5436' }, ice: { base: '#d8eef6', light: '#ffffff', crack: 'rgba(120,170,200,0.7)' },
  tree: treeBush(['#1f4a1a', '#3d7a2e', '#8cc95a']), bridge: '#b0835a', mine: '#56603a' };
const P_MODERN = { shadow: 'rgba(15,15,8,0.45)', bevelLight: 'rgba(255,245,225,0.18)', bevelDark: 'rgba(0,0,0,0.35)', grime: true,
  brick: { base: '#8a4b36', light: '#a0624a', dark: '#5f3122', mortar: '#8d8577' },
  steel: { base: '#7d7d76', light: '#a8a8a0', dark: 'rgba(40,40,36,0.7)', noise: ['rgba(0,0,0,0.18)', 'rgba(255,255,255,0.1)', 'rgba(90,70,50,0.2)'], plate: false, rust: ['rgba(110,60,30,0.35)', 'rgba(60,40,25,0.3)'] },
  water: { deep: '#26413f', shallow: '#3c5d58', bank: '#4b3f2c' }, ice: { base: '#8fa3aa', light: '#c9d8de', crack: 'rgba(50,65,72,0.7)' },
  tree: treeBush(['#1d2e14', '#35502a', '#6f8c47']), bridge: '#7a5c3c', mine: '#4d5236' };
const P_WINTER = { shadow: 'rgba(60,85,115,0.3)', bevelLight: 'rgba(255,255,255,0.3)', bevelDark: 'rgba(30,45,65,0.3)', grime: false, snow: true,
  brick: { base: '#7d746c', light: '#958b82', dark: '#5e5650', mortar: '#b8b4b0' },
  steel: { base: '#8c96a0', light: '#b7c0c8', dark: 'rgba(50,60,70,0.6)', noise: ['rgba(255,255,255,0.25)', 'rgba(40,50,60,0.15)'], plate: false },
  water: { deep: '#1d3a52', shallow: '#2d5470', bank: '#dfe9f1', rim: 'rgba(245,250,255,0.95)' }, ice: { base: '#bfe3f2', light: '#ffffff', crack: 'rgba(90,140,170,0.8)' },
  tree: treePine, bridge: '#6f5a48', mine: '#5a6068' };
const P_DESERT = { shadow: 'rgba(90,60,25,0.35)', bevelLight: 'rgba(255,240,200,0.35)', bevelDark: 'rgba(60,35,10,0.35)', grime: true,
  brick: { base: '#c08a52', light: '#d6a468', dark: '#9c6b3c', mortar: '#e2c89a' },
  steel: { base: '#6e5442', light: '#8f7258', dark: 'rgba(40,25,15,0.7)', noise: ['rgba(0,0,0,0.15)', 'rgba(255,220,180,0.12)'], plate: true, rust: ['rgba(150,70,30,0.45)', 'rgba(90,45,20,0.35)'] },
  water: { deep: '#1f7f86', shallow: '#3fb2a8', bank: '#c9a46a' }, ice: { base: '#e3d6bb', light: '#f6efe0', crack: 'rgba(150,120,80,0.7)' },
  tree: treePalm, bridge: '#9c7448', mine: '#6e5a3e' };

const mkReal = (id, name, desc, o) => ({ id, name, desc, cell: withSpecial(realCell(o.P), 'real', o.P), fam: 'real', tankShadow: 0.4, waterBlend: 'source-over', vignette: 0.5, label: { font: "700 {s}px 'Rajdhani', system-ui", big: `400 {s}px ${o.font || "'Russo One'"}, system-ui`, outline: true }, ...o });

export const THEMES = {
  neon: { ...NEON, cell: withSpecial(neonCell, 'neon'), fam: 'neon' },
  miniature: mkReal('miniature', 'Miniature', 'Tabletop diorama with tilt-shift', {
    P: P_MINI, bg: '#1b140e', word: 'MINIATURE', floor: miniFloor, tank: toyTank, frame: woodFrame('#5a3b22'),
    water: softWater('#ffffff', 0.35), base: bunkerBase({ bag: '#c2ae82', pad: '#8a7a55', roof: '#6f7a4a' }), pickup: cratePickup({ crate: '#a8773f' }),
    bullet: shellBullet(false), post: tiltShift, vignette: 0.6, halo: 'rgba(20,15,5,0.75)',
    fx: realFx({ light: 0.45, smoke: '#4a4a4a', chip: '#b0583a', steel: '#fff2c0', track: 'rgba(60,50,30,0.18)', trackFade: 0.02, dust: '#9a8a60' }),
  }),
  pixel: {
    id: 'pixel', name: 'Pixel Remaster', desc: 'The 1990 look, remastered', pixel: true, word: 'PIXEL',
    bg: '#000000', floor: pixelFloor, cell: withSpecial(pixelCell, 'pixel'), fam: 'pixel', tank: pixelTank, frame: pixelFrame, water: pixelWater, waterBlend: 'source-over',
    base: pixelBase, pickup: pixelPickup, bullet: pixelBullet, tankShadow: 0, vignette: 0.35, post: scanlines,
    fx: { add: true, fire: true, square: true, light: 0.55, smoke: '#5a5a5a', chip: '#b8471d', steel: '#fcfcfc', track: 'rgba(150,150,150,0.16)', trackFade: 0.07, dust: '#a8a8a8', dustChance: 0.6, dustSize: 0.55 },
    label: { font: "700 {s}px 'Rajdhani', monospace", big: "400 {s}px 'Press Start 2P', monospace", outline: true },
  },
  winter: mkReal('winter', 'Winter Front', 'Snowfield, frozen rivers, snowfall', {
    P: P_WINTER, bg: '#b9c8d6', word: 'WINTER', floor: winterFloor, tank: (g, s, c, S, f) => modernTank(g, s, c, S, f, 'winter'), frame: woodFrame('#2b3a4a', 'rgba(255,255,255,0.2)'),
    water: floeWater, base: bunkerBase({ bag: '#e4e8ea', pad: '#c9d4dd', roof: '#8c969e' }), pickup: cratePickup({ crate: '#8f9aa3' }),
    bullet: shellBullet(false), post: grade('#9cc8ff', 0.16), weather: 'snow', tankShadow: 0.3, halo: 'rgba(15,25,40,0.85)', markers: true,
    fx: realFx({ smoke: '#59616a', chip: '#8a8078', steel: '#fff6d8', track: 'rgba(120,145,175,0.26)', trackFade: 0.008, dust: '#ffffff' }),
  }),
  desert: mkReal('desert', 'Desert Storm', 'Dunes, oases and sandstorms', {
    P: P_DESERT, bg: '#1c140b', word: 'DESERT', font: "'Black Ops One'", floor: desertFloor, tank: (g, s, c, S, f) => modernTank(g, s, c, S, f, 'desert'), frame: woodFrame('#5a4128'),
    water: sparkleWater, base: bunkerBase({ bag: '#d8bf8a', pad: '#b69665', roof: '#9c7f52' }), pickup: cratePickup({ crate: '#b08a55' }),
    bullet: shellBullet(true), post: grade('#ffb45a', 0.14), weather: 'sand', halo: 'rgba(30,18,5,0.85)', markers: true,
    fx: realFx({ smoke: '#4d4238', chip: '#c08a52', steel: '#fff2c0', track: 'rgba(120,88,52,0.32)', trackFade: 0.01, dust: '#d6b57c' }),
  }),
  blueprint: {
    id: 'blueprint', name: 'Blueprint', desc: 'Tactical command-room plans', word: 'BLUEPRINT',
    bg: '#0b2446', floor: bpFloor, cell: withSpecial(bpCell, 'bp'), fam: 'bp', tank: bpTank, frame: bpFrame, water: null,
    base: bpBase, pickup: bpPickup, bullet: bpBullet, tankShadow: 0, vignette: 0.45,
    fx: { add: false, sketch: true, light: 0, smoke: '#cfe3ff', chip: '#e6f0ff', steel: '#ffffff', track: 'rgba(210,230,255,0.2)', trackFade: 0.03, dust: '#cfe3ff', dustChance: 0.35 },
    label: { font: "600 {s}px 'Share Tech Mono', monospace", big: "400 {s}px 'Share Tech Mono', monospace", outline: false },
  },
  modern: mkReal('modern', 'Modern Warfare', 'Realistic battlefield & main battle tanks', {
    P: P_MODERN, bg: '#0e0f0b', word: 'MODERN', font: "'Black Ops One'", floor: modernFloor, tank: (g, s, c, S, f) => modernTank(g, s, c, S, f, 'woodland'), frame: woodFrame('#23241c', 'rgba(0,0,0,0.5)'),
    water: softWater('#cfe0d8', 0.2), base: bunkerBase({ bag: '#a89878', pad: '#5c5440', roof: '#4b5632' }), pickup: cratePickup({ crate: '#55613a' }),
    bullet: shellBullet(true), post: grade('#ffd9a0', 0.08), tankShadow: 0.5, halo: 'rgba(0,0,0,0.9)', markers: true,
    fx: realFx({ smoke: '#2e2e2c', chip: '#7a4a36', steel: '#ffe9a8', track: 'rgba(38,30,20,0.32)', trackFade: 0.012, dust: '#7d6b50' }),
  }),
};
export const THEME_ORDER = ['neon', 'modern', 'miniature', 'pixel', 'winter', 'desert', 'blueprint'];
