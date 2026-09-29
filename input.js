// Keyboard, gamepad and touch input -> {d: dir(-1..3), f: fire, a: ability}
const KEYDIR = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
const FIRE = new Set(['Space', 'KeyJ', 'Enter', 'NumpadEnter', 'KeyZ']);
const ABIL = new Set(['ShiftLeft', 'ShiftRight', 'KeyK', 'KeyE', 'KeyX']);

export class Input {
  constructor() {
    this.stack = []; this.held = new Set(); this.fire = false; this.abil = false; this.enabled = false;
    this.touch = { d: -1, f: false, a: false };
    addEventListener('keydown', e => {
      if (!this.enabled || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      this.held.add(e.code);
      if (e.code in KEYDIR) { const d = KEYDIR[e.code]; this.stack = this.stack.filter(x => x !== d); this.stack.push(d); e.preventDefault(); }
      if (FIRE.has(e.code)) { this.fire = true; e.preventDefault(); }
      if (ABIL.has(e.code)) { this.abil = true; e.preventDefault(); }
    });
    addEventListener('keyup', e => {
      this.held.delete(e.code);
      if (e.code in KEYDIR) { const d = KEYDIR[e.code]; if (!Object.entries(KEYDIR).some(([k, v]) => v === d && k !== e.code && this.held.has(k))) this.stack = this.stack.filter(x => x !== d); }
      if (FIRE.has(e.code)) this.fire = false;
      if (ABIL.has(e.code)) this.abil = false;
    });
    addEventListener('blur', () => { this.stack = []; this.held.clear(); this.fire = this.abil = false; });
  }

  read() {
    let d = this.stack.length ? this.stack[this.stack.length - 1] : -1, f = this.fire, a = this.abil;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const b = i => p.buttons[i] && p.buttons[i].pressed;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (b(12)) d = 0; else if (b(13)) d = 2; else if (b(14)) d = 3; else if (b(15)) d = 1;
      else if (Math.hypot(ax, ay) > 0.45) d = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 1 : 3) : (ay > 0 ? 2 : 0);
      if (b(0) || b(7) || b(5)) f = true;
      if (b(1) || b(2) || b(6) || b(4)) a = true;
      break;
    }
    if (this.touch.d >= 0) d = this.touch.d;
    f = f || this.touch.f; a = a || this.touch.a;
    return { d, f, a };
  }

  bindTouch(root) {
    const stick = root.querySelector('.stick'), knob = root.querySelector('.knob');
    const fireBtn = root.querySelector('.tfire'), abBtn = root.querySelector('.tabil');
    let sid = null, cx = 0, cy = 0;
    stick.addEventListener('touchstart', e => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(t); e.preventDefault(); }, { passive: false });
    const move = t => {
      const dx = t.clientX - cx, dy = t.clientY - cy, dist = Math.hypot(dx, dy), R = stick.clientWidth / 2;
      const k = Math.min(1, dist / R);
      knob.style.transform = `translate(${dx / (dist || 1) * k * R * 0.6}px, ${dy / (dist || 1) * k * R * 0.6}px)`;
      this.touch.d = dist < R * 0.25 ? -1 : (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
    };
    stick.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === sid) move(t); e.preventDefault(); }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; this.touch.d = -1; knob.style.transform = ''; } };
    stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
    const hold = (el, key) => {
      el.addEventListener('touchstart', e => { this.touch[key] = true; el.classList.add('on'); e.preventDefault(); }, { passive: false });
      const up = () => { this.touch[key] = false; el.classList.remove('on'); };
      el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    };
    hold(fireBtn, 'f'); hold(abBtn, 'a');
  }
}
