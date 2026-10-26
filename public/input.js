// Keyboard (rebindable, 2 local players), gamepads and touch -> {d: dir(-1..3), f: fire, a: ability}
export const ACTIONS = ['up', 'down', 'left', 'right', 'fire', 'ability'];
export const ACTION_LABELS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', fire: 'Fire', ability: 'Ability' };
const DIR_OF = { up: 0, right: 1, down: 2, left: 3 };
export const DEFAULT_BINDS = [
  { up: ['KeyW', ''], down: ['KeyS', ''], left: ['KeyA', ''], right: ['KeyD', ''], fire: ['Space', 'KeyF'], ability: ['ShiftLeft', 'KeyE'] },
  { up: ['ArrowUp', ''], down: ['ArrowDown', ''], left: ['ArrowLeft', ''], right: ['ArrowRight', ''], fire: ['Enter', 'Numpad0'], ability: ['ShiftRight', 'Slash'] },
];
const RESERVED = new Set(['Escape', 'Tab']);

export function keyLabel(code) {
  if (!code) return '—';
  const map = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', Enter: 'Enter', NumpadEnter: 'Num Enter', Slash: '/', Period: '.', Comma: ',',
    Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Backspace: 'Bksp' };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

function loadBinds() {
  try {
    const b = JSON.parse(localStorage.getItem('nt_binds'));
    if (Array.isArray(b) && b.length === 2) return b.map((pl, i) => { const o = {}; for (const a of ACTIONS) o[a] = Array.isArray(pl[a]) ? [pl[a][0] || '', pl[a][1] || ''] : DEFAULT_BINDS[i][a].slice(); return o; });
  } catch (e) {}
  return DEFAULT_BINDS.map(p => JSON.parse(JSON.stringify(p)));
}

const fresh = () => ({ dirKeys: [], fire: new Set(), abil: new Set() });
// Stick angle -> one of 4 directions. Near a diagonal the current direction wins, so it doesn't flicker.
const AXIS = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
function dirOf(dx, dy, prev) {
  const cand = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  if (prev < 0 || prev === cand) return cand;
  let diff = Math.abs(Math.atan2(dy, dx) - AXIS[prev]); if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff < Math.PI / 4 + 0.2 ? prev : cand;
}

export class Input {
  constructor() {
    this.enabled = false; this.p2 = false; this.capture = null;
    this.binds = loadBinds(); this.rebuild();
    this.st = [fresh(), fresh()];
    this.touch = { d: -1, f: false, a: false };
    addEventListener('keydown', e => {
      if (this.capture) { e.preventDefault(); e.stopPropagation(); this.capture(e.code); return; }
      if (!this.enabled || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      const hits = this.map.get(e.code); if (!hits) return;
      e.preventDefault();
      for (const [pl, act] of hits) {
        const s = this.st[this.p2 ? pl : 0];
        if (act in DIR_OF) { s.dirKeys = s.dirKeys.filter(k => k[0] !== e.code); s.dirKeys.push([e.code, DIR_OF[act]]); }
        else if (act === 'fire') s.fire.add(e.code); else s.abil.add(e.code);
      }
    }, true);
    addEventListener('keyup', e => {
      for (const s of this.st) { s.dirKeys = s.dirKeys.filter(k => k[0] !== e.code); s.fire.delete(e.code); s.abil.delete(e.code); }
    });
    addEventListener('blur', () => this.reset());
  }

  reset() { this.st = [fresh(), fresh()]; }
  setP2(on) { this.p2 = !!on; this.reset(); }

  rebuild() {
    this.map = new Map();
    this.binds.forEach((pl, i) => { for (const a of ACTIONS) for (const code of pl[a]) if (code) { if (!this.map.has(code)) this.map.set(code, []); this.map.get(code).push([i, a]); } });
  }
  setBind(player, action, slot, code) {
    if (code && RESERVED.has(code)) return false;
    if (code) for (const pl of this.binds) for (const a of ACTIONS) for (let k = 0; k < 2; k++) if (pl[a][k] === code) pl[a][k] = '';
    this.binds[player][action][slot] = code || '';
    this.save(); return true;
  }
  resetBinds() { this.binds = DEFAULT_BINDS.map(p => JSON.parse(JSON.stringify(p))); this.save(); }
  save() { this.rebuild(); try { localStorage.setItem('nt_binds', JSON.stringify(this.binds)); } catch (e) {} this.reset(); }

  read(i = 0) {
    const s = this.st[i];
    let d = s.dirKeys.length ? s.dirKeys[s.dirKeys.length - 1][1] : -1, f = s.fire.size > 0, a = s.abil.size > 0;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const p = pads[i];
    if (p) {
      const b = k => p.buttons[k] && p.buttons[k].pressed;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (b(12)) d = 0; else if (b(13)) d = 2; else if (b(14)) d = 3; else if (b(15)) d = 1;
      else if (Math.hypot(ax, ay) > 0.45) d = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 1 : 3) : (ay > 0 ? 2 : 0);
      if (b(0) || b(7) || b(5)) f = true;
      if (b(1) || b(2) || b(6) || b(4)) a = true;
    }
    if (i === 0) { if (this.touch.d >= 0) d = this.touch.d; f = f || this.touch.f; a = a || this.touch.a; }
    return { d, f, a };
  }

  // Touch: put a thumb down anywhere on the left half and the stick appears under it (it follows the
  // thumb if it slides too far). Anything on the right half fires; ABL is its own button.
  bindTouch(root) {
    const stick = root.querySelector('.stick'), knob = root.querySelector('.knob');
    const left = root.querySelector('.tzone-l'), right = root.querySelector('.tzone-r');
    const fireBtn = root.querySelector('.tfire'), abBtn = root.querySelector('.tabil');
    let sid = null, cx = 0, cy = 0;
    const fires = new Set();
    const R = () => stick.offsetWidth / 2 || 60;
    const place = (x, y) => {
      const z = left.getBoundingClientRect(), o = root.getBoundingClientRect(), r = R();
      cx = Math.max(z.left + r * 0.7, Math.min(z.right - r * 0.4, x)); cy = Math.max(z.top + r * 0.7, Math.min(z.bottom - r * 0.5, y));
      stick.style.left = (cx - o.left - r) + 'px'; stick.style.top = (cy - o.top - r) + 'px'; stick.style.bottom = 'auto';
    };
    const move = t => {
      let dx = t.clientX - cx, dy = t.clientY - cy, dist = Math.hypot(dx, dy);
      const r = R();
      if (dist > r * 1.15) { const k = (dist - r * 1.15) / dist; place(cx + dx * k, cy + dy * k); dx = t.clientX - cx; dy = t.clientY - cy; dist = Math.hypot(dx, dy); }
      const k = Math.min(1, dist / r);
      knob.style.transform = `translate(${dx / (dist || 1) * k * r * 0.6}px, ${dy / (dist || 1) * k * r * 0.6}px)`;
      this.touch.d = dist < Math.max(9, r * 0.2) ? -1 : dirOf(dx, dy, this.touch.d);
      stick.dataset.d = this.touch.d;
    };
    const start = e => {
      if (sid !== null) return;
      const t = e.changedTouches[0]; sid = t.identifier;
      place(t.clientX, t.clientY); stick.classList.add('active'); move(t); e.preventDefault();
    };
    const drag = e => { for (const t of e.changedTouches) if (t.identifier === sid) move(t); e.preventDefault(); };
    const end = e => {
      for (const t of e.changedTouches) if (t.identifier === sid) {
        sid = null; this.touch.d = -1; knob.style.transform = ''; stick.classList.remove('active');
        stick.style.left = stick.style.top = stick.style.bottom = ''; delete stick.dataset.d;
      }
    };
    left.addEventListener('touchstart', start, { passive: false });
    left.addEventListener('touchmove', drag, { passive: false });
    left.addEventListener('touchend', end); left.addEventListener('touchcancel', end);
    const fireSet = () => { this.touch.f = fires.size > 0; fireBtn.classList.toggle('on', this.touch.f); };
    right.addEventListener('touchstart', e => { for (const t of e.changedTouches) fires.add(t.identifier); fireSet(); e.preventDefault(); }, { passive: false });
    right.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    const fireUp = e => { for (const t of e.changedTouches) fires.delete(t.identifier); fireSet(); };
    right.addEventListener('touchend', fireUp); right.addEventListener('touchcancel', fireUp);
    abBtn.addEventListener('touchstart', e => { this.touch.a = true; abBtn.classList.add('on'); e.preventDefault(); }, { passive: false });
    const abUp = () => { this.touch.a = false; abBtn.classList.remove('on'); };
    abBtn.addEventListener('touchend', abUp); abBtn.addEventListener('touchcancel', abUp);
    this.releaseTouch = () => { sid = null; fires.clear(); this.touch = { d: -1, f: false, a: false }; knob.style.transform = ''; stick.classList.remove('active'); stick.style.left = stick.style.top = stick.style.bottom = ''; fireBtn.classList.remove('on'); abBtn.classList.remove('on'); };
  }
}
