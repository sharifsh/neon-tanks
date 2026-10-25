// In-browser level editor
import { W, H, T, SIZES, setMapSize, sizeKey } from './const.js';
import { getLayout, reservedMask, applyLayout, generateMap, encodeMap, decodeMap, checkConnectivity } from './levels.js';
import { paintCell, paintFloor } from './render.js';

const TOOLS = [
  { t: T.BRICK, n: 'Brick' }, { t: T.STEEL, n: 'Steel' }, { t: T.WATER, n: 'Water' },
  { t: T.TREES, n: 'Forest' }, { t: T.ICE, n: 'Ice' },
  { t: T.BRIDGE, n: 'Bridge — drive over water; explosions collapse it' }, { t: T.BOOST, n: 'Speed pad' },
  { t: T.TELE, n: 'Teleporter — use the 2×2 brush; pads link in pairs' }, { t: T.BARREL, n: 'Explosive barrel' }, { t: T.MINE, n: 'Land mine' },
  { t: T.EMPTY, n: 'Erase' },
];

export class Editor {
  constructor(root, { onBack, onTest, onSave }) {
    this.root = root; this.cb = { onBack, onTest, onSave };
    this.canvas = root.querySelector('#edCanvas'); this.g = this.canvas.getContext('2d');
    this.layoutType = 'C'; this.grid = new Uint8Array(W * H); this.tool = T.BRICK;
    this.mirror = root.querySelector('#edMirror'); this.big = root.querySelector('#edBig');
    this.layoutSel = root.querySelector('#edLayout'); this.sizeSel = root.querySelector('#edSize');
    this.w = W; this.h = H;
    this.sizeSel.onchange = () => { [this.w, this.h] = SIZES[this.sizeSel.value]; this.useSize(); this.grid = generateMap(this.layoutType, (Math.random() * 1e6) | 0, 2).grid; this.setLayout(); this.resize(); };
    this.buildTools();
    this.newMap();
    this.layoutSel.onchange = () => { this.layoutType = this.layoutSel.value; this.setLayout(); };
    root.querySelector('#edBack').onclick = () => { this.saveDraft(); onBack(); };
    root.querySelector('#edRandom').onclick = () => { this.useSize(); const m = generateMap(this.layoutType, (Math.random() * 1e6) | 0, 2); this.grid = m.grid; this.repaint(null); this.draw(); };
    root.querySelector('#edClear').onclick = () => { this.useSize(); this.grid = new Uint8Array(W * H); this.setLayout(); };
    root.querySelector('#edTest').onclick = () => this.cb.onTest(this.encode());
    root.querySelector('#edSave').onclick = () => this.cb.onSave(this.encode(), this.valid());
    let painting = 0;
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('pointerdown', e => { painting = e.button === 2 ? 2 : 1; this.canvas.setPointerCapture(e.pointerId); this.paintAt(e, painting); });
    this.canvas.addEventListener('pointermove', e => { if (painting) this.paintAt(e, painting); else this.hoverAt(e); });
    const stop = () => { painting = 0; this.saveDraft(); };
    this.canvas.addEventListener('pointerup', stop); this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    addEventListener('resize', () => { if (root.classList.contains('active')) this.resize(); });
  }

  buildTools() {
    const box = this.root.querySelector('#edTools');
    box.innerHTML = '';
    for (const tool of TOOLS) {
      const b = document.createElement('div'); b.className = 'ed-tool'; b.title = tool.n;
      const c = document.createElement('canvas'); c.width = c.height = 64; b.appendChild(c);
      const g = c.getContext('2d'); const cs = 32;
      const tmp = new Uint8Array(W * H);
      g.fillStyle = '#0b1020'; g.fillRect(0, 0, 64, 64);
      if (tool.t === T.EMPTY) { g.strokeStyle = '#ff4d5e'; g.lineWidth = 5; g.beginPath(); g.moveTo(14, 14); g.lineTo(50, 50); g.moveTo(50, 14); g.lineTo(14, 50); g.stroke(); }
      else { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) tmp[y * W + x] = tool.t; for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { paintCell(g, tmp, x, y, cs, 'tiles'); paintCell(g, tmp, x, y, cs, 'trees'); } }
      b.onclick = () => { this.tool = tool.t; box.querySelectorAll('.ed-tool').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); };
      if (tool.t === this.tool) b.classList.add('sel');
      box.appendChild(b);
    }
  }

  newMap() {
    try { const d = localStorage.getItem('nt_editor_draft'); if (d) { this.load(d); return; } } catch (e) {}
    const m = generateMap('C', 7, 1); this.grid = m.grid; this.setLayout();
  }
  useSize() { setMapSize(this.w, this.h); }
  mirrorCells(cells) {
    if (!this.mirror.checked) return;
    for (const [cx, cy] of [...cells]) cells.push([W - 1 - cx, cy]);
    if (this.layoutType === 'D' || this.layoutType === 'U') for (const [cx, cy] of [...cells]) cells.push([cx, H - 1 - cy]);
  }
  load(str) { const m = decodeMap(str); this.w = m.w; this.h = m.h; this.sizeSel.value = sizeKey(m.w, m.h); this.layoutType = m.layout; this.layoutSel.value = m.layout; this.grid = m.grid; this.setLayout(); if (this.root.classList.contains('active')) this.resize(); }
  saveDraft() { try { localStorage.setItem('nt_editor_draft', this.encode()); } catch (e) {} }
  setLayout() { this.useSize(); if (this.grid.length !== W * H) this.grid = new Uint8Array(W * H); this.layout = getLayout(this.layoutType); this.mask = reservedMask(this.layout); applyLayout(this.grid, this.layout); this.repaint(null); this.draw(); }
  encode() { this.useSize(); applyLayout(this.grid, this.layout); return encodeMap(this.layoutType, this.grid); }
  valid() { this.useSize(); return checkConnectivity(this.grid, this.layout); }

  show() { this.useSize(); this.resize(); }
  resize() {
    this.useSize();
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = r.width * dpr; this.canvas.height = r.height * dpr;
    this.cs = Math.floor(Math.min((this.canvas.width - 20 * dpr) / W, (this.canvas.height - 20 * dpr) / H));
    this.ox = Math.floor((this.canvas.width - this.cs * W) / 2); this.oy = Math.floor((this.canvas.height - this.cs * H) / 2);
    this.dpr = dpr;
    this.floor = document.createElement('canvas'); this.floor.width = W * this.cs; this.floor.height = H * this.cs;
    paintFloor(this.floor.getContext('2d'), this.cs);
    this.layer = document.createElement('canvas'); this.layer.width = W * this.cs; this.layer.height = H * this.cs;
    this.repaint(null);
    this.draw();
  }

  repaint(cells) {
    if (!this.layer) return;
    const g = this.layer.getContext('2d'), cs = this.cs;
    const region = (x0, y0, x1, y1) => {
      g.save(); g.beginPath(); g.rect(x0 * cs, y0 * cs, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs); g.clip();
      g.clearRect(x0 * cs, y0 * cs, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs);
      for (const layer of ['shadow', 'tiles', 'trees'])
        for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x1 + 1); x++) paintCell(g, this.grid, x, y, cs, layer);
      g.restore();
    };
    if (!cells) region(0, 0, W - 1, H - 1);
    else for (const [x, y] of cells) region(Math.max(0, x - 1), Math.max(0, y - 1), Math.min(W - 1, x + 1), Math.min(H - 1, y + 1));
  }

  cellAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) * this.dpr - this.ox) / this.cs, y = ((e.clientY - r.top) * this.dpr - this.oy) / this.cs;
    return [Math.floor(x), Math.floor(y)];
  }
  brushCells(x, y) {
    if (!this.big.checked) return [[x, y]];
    const bx = x - (x % 2), by = y - (y % 2);
    return [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]];
  }
  paintAt(e, mode) {
    const [x, y] = this.cellAt(e);
    const v = mode === 2 ? T.EMPTY : this.tool;
    const cells = this.brushCells(x, y);
    this.mirrorCells(cells);
    const changed = [];
    for (const [cx, cy] of cells) {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      if (this.mask[cy * W + cx]) continue;
      if (this.grid[cy * W + cx] !== v) { this.grid[cy * W + cx] = v; changed.push([cx, cy]); }
    }
    if (changed.length) this.repaint(changed);
    this.hover = [x, y]; this.draw();
  }
  hoverAt(e) { this.hover = this.cellAt(e); this.draw(); }

  draw() {
    if (!this.cs || !this.layer) return;
    const g = this.g, cs = this.cs;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#03040a'; g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.translate(this.ox, this.oy);
    g.drawImage(this.floor, 0, 0);
    // reserved zones
    for (let i = 0; i < W * H; i++) {
      const m = this.mask[i]; if (!m || m === 3) continue;
      const x = i % W, y = (i / W) | 0;
      g.fillStyle = m === 2 ? 'rgba(255,210,63,0.25)' : 'rgba(61,224,255,0.1)'; g.fillRect(x * cs, y * cs, cs, cs);
    }
    g.drawImage(this.layer, 0, 0);
    // labels
    g.font = `700 ${cs * 0.7}px Rajdhani`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const b of this.layout.bases) { g.fillStyle = this.layoutType === 'A' ? (b.team ? '#ff4d5e' : '#3de0ff') : '#ffd23f'; g.fillText('CORE', (b.x + 1) * cs, (b.y + 1) * cs); }
    g.fillStyle = 'rgba(61,224,255,0.7)';
    for (const team of this.layout.playerSpawns) for (const s of team) g.fillText('P', (s.x + 1) * cs, (s.y + 1) * cs);
    g.fillStyle = 'rgba(255,77,94,0.8)';
    for (const s of this.layout.enemySpawns) g.fillText('E', (s.x + 1) * cs, (s.y + 1) * cs);
    if (this.layoutType === 'C') { g.strokeStyle = 'rgba(255,77,94,0.35)'; g.setLineDash([4, 4]); const b = this.layout.bossSpawn; g.strokeRect(b.x * cs, b.y * cs, 4 * cs, 4 * cs); g.setLineDash([]); }
    if (this.mirror.checked) { g.strokeStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(W / 2 * cs, 0); g.lineTo(W / 2 * cs, H * cs); if (this.layoutType === 'D' || this.layoutType === 'U') { g.moveTo(0, H / 2 * cs); g.lineTo(W * cs, H / 2 * cs); } g.stroke(); }
    if (this.hover) {
      g.strokeStyle = '#ffd23f'; g.lineWidth = 2;
      const cells = this.brushCells(...this.hover);
      this.mirrorCells(cells);
      for (const [x, y] of cells) g.strokeRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
    }
    g.strokeStyle = '#3d7bff'; g.lineWidth = 2; g.strokeRect(0, 0, W * cs, H * cs);
  }
}

// Tiny preview for map cards (works at any map size, leaves the live size untouched)
export function mapPreview(str, px = 4) {
  const m = decodeMap(str), w = m.w, h = m.h;
  const c = document.createElement('canvas'); c.width = w * px; c.height = h * px;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1020'; g.fillRect(0, 0, c.width, c.height);
  const col = { [T.BRICK]: '#c0482a', [T.STEEL]: '#9fb4c8', [T.WATER]: '#1f5fae', [T.TREES]: '#1c9c55', [T.ICE]: '#9fd0e6', [T.BOOST]: '#f2c230', [T.TELE]: '#b36bff', [T.BRIDGE]: '#8a6a44', [T.BARREL]: '#ff3b30', [T.MINE]: '#ff4fd8' };
  for (let i = 0; i < w * h; i++) { const v = m.grid[i]; if (!v) continue; g.fillStyle = col[v] || '#fff'; g.fillRect((i % w) * px, ((i / w) | 0) * px, px, px); }
  const pw = W, ph = H; setMapSize(w, h);
  const L = getLayout(m.layout); setMapSize(pw, ph);
  for (const b of L.bases) { g.fillStyle = m.layout === 'A' ? (b.team ? '#ff4d5e' : '#3de0ff') : '#ffd23f'; g.fillRect(b.x * px, b.y * px, 2 * px, 2 * px); }
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (const team of L.playerSpawns) for (const sp of team) g.fillRect(sp.x * px + px / 2, sp.y * px + px / 2, px, px);
  return c;
}
