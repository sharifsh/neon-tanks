// Synthesized sound effects + light synthwave music (no audio files needed)
let ctx = null, master = null, sfxGain = null, musicGain = null, noiseBuf = null;
let musicOn = true, lastPlay = {};
const settings = { sfx: 0.5, music: 0.22 };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.connect(master);
  sfxGain = ctx.createGain(); sfxGain.gain.value = settings.sfx; sfxGain.connect(comp);
  musicGain = ctx.createGain(); musicGain.gain.value = settings.music; musicGain.connect(comp);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setVolume(kind, v) {
  settings[kind] = v;
  if (kind === 'sfx' && sfxGain) sfxGain.gain.value = v;
  if (kind === 'music' && musicGain) musicGain.gain.value = v;
}

function tone(type, f0, f1, dur, vol = 0.3, delay = 0) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.4, freq = 1200, q = 0.7, delay = 0, type = 'lowpass') {
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.2), t + dur); f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(sfxGain); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

export function sfx(name, strength = 1) {
  if (!ctx || ctx.state !== 'running') return;
  const now = performance.now();
  const gap = { shot: 40, brick: 30, steel: 40, boom: 50, hit: 40 }[name] || 60;
  if (lastPlay[name] && now - lastPlay[name] < gap) return;
  lastPlay[name] = now;
  switch (name) {
    case 'shot': tone('square', 880, 220, 0.09, 0.08); noise(0.06, 0.12, 3000); break;
    case 'heavy': tone('sawtooth', 300, 60, 0.18, 0.14); noise(0.12, 0.2, 1500); break;
    case 'boom': noise(0.5 + strength * 0.15, 0.5 * Math.min(1.5, strength), 900 + strength * 200); tone('sine', 120, 30, 0.4 + strength * 0.1, 0.4); break;
    case 'brick': noise(0.12, 0.25, 1800, 1, 0, 'bandpass'); break;
    case 'steel': tone('triangle', 1800, 1400, 0.12, 0.12); tone('sine', 2600, 2400, 0.08, 0.06); break;
    case 'hit': tone('square', 400, 120, 0.1, 0.12); noise(0.08, 0.15, 2500); break;
    case 'spawn': tone('sine', 300, 900, 0.3, 0.06); break;
    case 'pick': [523, 659, 784, 1046].forEach((f, i) => tone('square', f, 0, 0.09, 0.08, i * 0.06)); break;
    case 'puSpawn': tone('triangle', 1200, 1600, 0.15, 0.06); tone('triangle', 1600, 2000, 0.15, 0.05, 0.1); break;
    case 'build': noise(0.15, 0.25, 700); tone('square', 200, 260, 0.1, 0.08); break;
    case 'freeze': tone('sine', 1400, 300, 0.4, 0.12); noise(0.3, 0.1, 6000, 1, 0, 'highpass'); break;
    case 'deflect': tone('triangle', 2200, 900, 0.12, 0.1); break;
    case 'spread': tone('sawtooth', 700, 200, 0.15, 0.12); break;
    case 'dash': noise(0.4, 0.25, 4000, 1, 0, 'bandpass'); tone('sawtooth', 200, 600, 0.3, 0.06); break;
    case 'shield': tone('sine', 300, 1200, 0.35, 0.12); break;
    case 'alarm': for (let i = 0; i < 3; i++) { tone('square', 880, 660, 0.18, 0.08, i * 0.24); } break;
    case 'coreDown': noise(1.4, 0.6, 600); tone('sawtooth', 200, 30, 1.4, 0.3); break;
    case 'stage': [392, 523, 659, 784].forEach((f, i) => tone('triangle', f, 0, 0.15, 0.1, i * 0.1)); break;
    case 'win': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone('square', f, 0, 0.14, 0.08, i * 0.1)); break;
    case 'gameover': [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f * 0.9, 0.35, 0.12, i * 0.3)); break;
    case 'boss': tone('sawtooth', 80, 50, 1.2, 0.25); tone('sawtooth', 82, 51, 1.2, 0.2); noise(0.8, 0.2, 400); break;
    case 'ring': tone('sawtooth', 500, 150, 0.3, 0.1); break;
    case 'flag': tone('square', 660, 0, 0.1, 0.1); tone('square', 990, 0, 0.12, 0.1, 0.1); break;
    case 'capture': [523, 784, 1046, 1318].forEach((f, i) => tone('sawtooth', f, 0, 0.2, 0.09, i * 0.08)); break;
    case 'click': tone('square', 1200, 0, 0.04, 0.05); break;
  }
}

export function playEvents(evs, listener) {
  for (const e of evs) {
    switch (e.k) {
      case 'shot': sfx(e.h ? 'heavy' : 'shot'); break;
      case 'boom': sfx('boom', e.s || 1); break;
      case 'brick': sfx('brick'); break;
      case 'steel': sfx('steel'); break;
      case 'hit': sfx('hit'); break;
      case 'pick': sfx('pick'); break;
      case 'build': sfx('build'); break;
      case 'spawn': sfx('spawn'); break;
      case 'sfx': sfx(e.n); break;
    }
  }
}

// --- simple generative synthwave loop ---
let musicTimer = null, step = 0;
const bass = [36, 36, 43, 43, 41, 41, 39, 43];
const arp = [0, 7, 12, 15, 12, 7, 3, 7];
export function startMusic() {
  if (!ctx || musicTimer) return;
  const bpm = 118, stepDur = 60 / bpm / 4;
  let next = ctx.currentTime + 0.1;
  musicTimer = setInterval(() => {
    if (!musicOn) return;
    while (next < ctx.currentTime + 0.3) {
      const bar = Math.floor(step / 16) % bass.length;
      const root = bass[bar];
      if (step % 4 === 0) note('sawtooth', mtof(root), next, stepDur * 3.5, 0.18, 400);
      note('square', mtof(root + 24 + arp[step % 8]), next, stepDur * 0.9, 0.035, 2500);
      if (step % 8 === 4) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; const g = ctx.createGain(); g.gain.setValueAtTime(0.12, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.12); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000; s.connect(f); f.connect(g); g.connect(musicGain); s.start(next); s.stop(next + 0.13); }
      if (step % 4 === 0) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, next); o.frequency.exponentialRampToValueAtTime(40, next + 0.15); g.gain.setValueAtTime(0.35, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.18); o.connect(g); g.connect(musicGain); o.start(next); o.stop(next + 0.2); }
      next += stepDur; step++;
    }
  }, 60);
}
function note(type, f, t, dur, vol, cut) {
  const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
  o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = cut;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(fl); fl.connect(g); g.connect(musicGain); o.start(t); o.stop(t + dur + 0.05);
}
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export function toggleMusic(on) { musicOn = on; if (musicGain) musicGain.gain.value = on ? settings.music : 0; }
