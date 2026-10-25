// Synthesized sound + music, with a separate sound pack and soundtrack for every visual style.
// Everything is generated with WebAudio at runtime — no audio files.
let ctx = null, comp = null, sfxGain = null, musicGain = null, noiseBuf = null, verb = null, sfxVerb = null, musVerb = null;
let musicOn = true, lastPlay = {}, pack = 'neon';
const settings = { sfx: 0.5, music: 0.22 };
const SFX_GAIN = { neon: 1, modern: 0.75, miniature: 1.3, pixel: 1.8, winter: 0.8, desert: 0.9, blueprint: 1.5 };
const sfxLevel = () => settings.sfx * (SFX_GAIN[pack] || 1);
const REVERB = { neon: [0.12, 0.32], modern: [0.22, 0.25], miniature: [0.1, 0.15], pixel: [0, 0.05], winter: [0.45, 0.6], desert: [0.18, 0.3], blueprint: [0.15, 0.35] };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  buildGraph(new (window.AudioContext || window.webkitAudioContext)());
}
function buildGraph(c) {
  ctx = c;
  comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 1; sfxGain.connect(comp);
  musicGain = ctx.createGain(); musicGain.gain.value = 1; musicGain.connect(comp);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // shared reverb (generated impulse response)
  verb = ctx.createConvolver();
  const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  verb.buffer = ir; verb.connect(comp);
  sfxVerb = ctx.createGain(); sfxGain.connect(sfxVerb); sfxVerb.connect(verb);
  musVerb = ctx.createGain(); musicGain.connect(musVerb); musVerb.connect(verb);
  applyReverb();
}
function applyReverb() { if (!ctx) return; if (!(ctx instanceof OfflineAudioContext)) { musicGain.gain.value = musicLevel(); sfxGain.gain.value = sfxLevel(); } const [a, b] = REVERB[pack] || [0.1, 0.2]; sfxVerb.gain.value = a; musVerb.gain.value = b; }

export function setVolume(kind, v) {
  settings[kind] = v;
  if (kind === 'sfx' && sfxGain) sfxGain.gain.value = sfxLevel();
  if (kind === 'music' && musicGain) musicGain.gain.value = musicLevel();
}
export function setAudioTheme(id) {
  if (!PACKS[id]) id = 'neon';
  if (id === pack) return;
  pack = id; applyReverb();
  if (ctx && musicTimer) { // cross-fade to the new soundtrack
    const g = musicGain.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0.0001, now + 0.35);
    g.linearRampToValueAtTime(Math.max(0.0001, musicLevel()), now + 1.2);
    step = 0; next = now + 0.4;
  }
}

// ---------- building blocks ----------
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function tone(type, f0, f1, dur, vol = 0.3, delay = 0, o = {}) {
  const t = (o.at ?? ctx.currentTime) + delay;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(f0, t); if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (o.glide || dur));
  if (o.detune) osc.detune.value = o.detune;
  const a = o.attack || 0.004;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = osc;
  if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(o.lp, t); if (o.lpEnd) f.frequency.exponentialRampToValueAtTime(o.lpEnd, t + dur); f.Q.value = o.q || 0.8; node.connect(f); node = f; }
  node.connect(g); g.connect(o.dest || sfxGain); osc.start(t); osc.stop(t + dur + 0.05);
}
function noise(dur, vol = 0.4, freq = 1200, q = 0.7, delay = 0, type = 'lowpass', o = {}) {
  const t = (o.at ?? ctx.currentTime) + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, o.fEnd || freq * 0.2), t + dur); f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (o.attack || 0.003)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.loop = true; s.connect(f); f.connect(g); g.connect(o.dest || sfxGain); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}
function bell(f, dur, vol, delay = 0, o = {}) { // inharmonic partials = bell / chime / metal
  const parts = o.parts || [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.12]];
  for (const [r, a] of parts) tone('sine', f * r, 0, dur / Math.sqrt(r), vol * a, delay, o);
}
function pluck(f, dur, vol, delay = 0, o = {}) { tone('sawtooth', f, 0, dur, vol, delay, { lp: o.lp || 2600, lpEnd: 200, ...o }); }
function kick(vol, delay = 0, o = {}) { tone('sine', o.f0 || 140, o.f1 || 40, o.dur || 0.22, vol, delay, { glide: 0.12, ...o }); }
function hat(vol, delay = 0, o = {}) { noise(o.dur || 0.05, vol, o.f || 7000, 0.8, delay, 'highpass', o); }
function snare(vol, delay = 0, o = {}) { noise(o.dur || 0.16, vol, o.f || 1800, 0.9, delay, 'bandpass', o); tone('triangle', 220, 160, 0.08, vol * 0.5, delay, o); }

// ---------- sound packs ----------
const NEON_SFX = {
  shot: () => { tone('square', 880, 220, 0.09, 0.08); noise(0.06, 0.12, 3000); },
  heavy: () => { tone('sawtooth', 300, 60, 0.18, 0.14); noise(0.12, 0.2, 1500); },
  boom: s => { noise(0.5 + s * 0.15, 0.5 * Math.min(1.5, s), 900 + s * 200); tone('sine', 120, 30, 0.4 + s * 0.1, 0.4); },
  brick: () => noise(0.12, 0.25, 1800, 1, 0, 'bandpass'),
  steel: () => { tone('triangle', 1800, 1400, 0.12, 0.12); tone('sine', 2600, 2400, 0.08, 0.06); },
  hit: () => { tone('square', 400, 120, 0.1, 0.12); noise(0.08, 0.15, 2500); },
  spawn: () => tone('sine', 300, 900, 0.3, 0.06),
  pick: () => [523, 659, 784, 1046].forEach((f, i) => tone('square', f, 0, 0.09, 0.08, i * 0.06)),
  puSpawn: () => { tone('triangle', 1200, 1600, 0.15, 0.06); tone('triangle', 1600, 2000, 0.15, 0.05, 0.1); },
  build: () => { noise(0.15, 0.25, 700); tone('square', 200, 260, 0.1, 0.08); },
  freeze: () => { tone('sine', 1400, 300, 0.4, 0.12); noise(0.3, 0.1, 6000, 1, 0, 'highpass'); },
  deflect: () => tone('triangle', 2200, 900, 0.12, 0.1),
  spread: () => tone('sawtooth', 700, 200, 0.15, 0.12),
  dash: () => { noise(0.4, 0.25, 4000, 1, 0, 'bandpass'); tone('sawtooth', 200, 600, 0.3, 0.06); },
  shield: () => tone('sine', 300, 1200, 0.35, 0.12),
  alarm: () => { for (let i = 0; i < 3; i++) tone('square', 880, 660, 0.18, 0.08, i * 0.24); },
  coreDown: () => { noise(1.4, 0.6, 600); tone('sawtooth', 200, 30, 1.4, 0.3); },
  stage: () => [392, 523, 659, 784].forEach((f, i) => tone('triangle', f, 0, 0.15, 0.1, i * 0.1)),
  win: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone('square', f, 0, 0.14, 0.08, i * 0.1)),
  gameover: () => [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f * 0.9, 0.35, 0.12, i * 0.3)),
  boss: () => { tone('sawtooth', 80, 50, 1.2, 0.25); tone('sawtooth', 82, 51, 1.2, 0.2); noise(0.8, 0.2, 400); },
  ring: () => tone('sawtooth', 500, 150, 0.3, 0.1),
  flag: () => { tone('square', 660, 0, 0.1, 0.1); tone('square', 990, 0, 0.12, 0.1, 0.1); },
  capture: () => [523, 784, 1046, 1318].forEach((f, i) => tone('sawtooth', f, 0, 0.2, 0.09, i * 0.08)),
  click: () => tone('square', 1200, 0, 0.04, 0.05),
};

const PACKS = {
  neon: NEON_SFX,
  // realistic battlefield: cannon cracks, rumbling explosions, clanging armour, radio beeps, sirens
  modern: {
    shot: () => { noise(0.05, 0.35, 5000, 0.7, 0, 'highpass'); noise(0.35, 0.45, 900, 0.7); tone('sine', 110, 40, 0.25, 0.4); },
    heavy: () => { noise(0.06, 0.4, 4000, 0.7, 0, 'highpass'); noise(0.55, 0.55, 700, 0.7); tone('sine', 80, 28, 0.4, 0.5); },
    boom: s => { noise(0.9 + s * 0.3, 0.6 * Math.min(1.5, s), 500 + s * 120, 0.7, 0, 'lowpass', { fEnd: 60 }); tone('sine', 70, 22, 0.8 + s * 0.2, 0.55); noise(0.08, 0.35, 3000, 0.8, 0, 'highpass'); for (let i = 0; i < 4; i++) noise(0.06, 0.08, 2500, 2, 0.15 + i * 0.07 + Math.random() * 0.05, 'bandpass'); },
    brick: () => { for (let i = 0; i < 4; i++) noise(0.05, 0.16, 1200 + Math.random() * 1500, 2, i * 0.035, 'bandpass'); noise(0.25, 0.12, 400); },
    steel: () => bell(420 + Math.random() * 60, 0.5, 0.1, 0, { parts: [[1, 1], [2.32, 0.7], [4.25, 0.45], [6.8, 0.25]] }),
    hit: () => { bell(260, 0.4, 0.12, 0, { parts: [[1, 1], [2.1, 0.6], [3.7, 0.4]] }); noise(0.1, 0.2, 2200, 1, 0, 'bandpass'); },
    spawn: () => { noise(0.4, 0.08, 300, 0.7, 0, 'lowpass', { attack: 0.15 }); tone('sawtooth', 55, 70, 0.5, 0.05, 0, { lp: 300, attack: 0.1 }); },
    pick: () => { tone('square', 1320, 0, 0.06, 0.05, 0, { lp: 2500 }); tone('square', 1760, 0, 0.08, 0.05, 0.08, { lp: 2500 }); noise(0.12, 0.05, 3000, 1, 0.02, 'bandpass'); },
    puSpawn: () => { noise(0.25, 0.05, 2000, 3, 0, 'bandpass'); tone('square', 980, 0, 0.05, 0.03, 0.1, { lp: 2000 }); },
    build: () => { noise(0.2, 0.3, 500); for (let i = 0; i < 3; i++) noise(0.04, 0.12, 1800, 3, i * 0.06, 'bandpass'); },
    alarm: () => { tone('sawtooth', 500, 900, 0.6, 0.07, 0, { lp: 1800, glide: 0.6 }); tone('sawtooth', 900, 500, 0.6, 0.07, 0.6, { lp: 1800, glide: 0.6 }); },
    coreDown: () => { noise(2.2, 0.7, 400, 0.7, 0, 'lowpass', { fEnd: 40 }); tone('sine', 60, 20, 2, 0.5); },
    stage: () => { noise(0.25, 0.06, 2500, 1, 0, 'bandpass'); tone('sine', 1000, 0, 0.12, 0.06, 0.25); tone('sine', 1000, 0, 0.12, 0.06, 0.45); },
    win: () => [[62, 0], [66, 0.18], [69, 0.36], [74, 0.54]].forEach(([m, d]) => { tone('sawtooth', mtof(m), 0, 0.5, 0.06, d, { lp: 1600, attack: 0.03 }); tone('sawtooth', mtof(m), 0, 0.5, 0.05, d, { lp: 1600, attack: 0.03, detune: 8 }); }),
    gameover: () => [[62, 0], [60, 0.4], [57, 0.8], [50, 1.2]].forEach(([m, d]) => tone('sawtooth', mtof(m), 0, 0.7, 0.07, d, { lp: 900, attack: 0.05 })),
    boss: () => { tone('sawtooth', 45, 40, 2, 0.25, 0, { lp: 300, attack: 0.4 }); noise(1.6, 0.25, 250, 0.7, 0, 'lowpass', { attack: 0.5 }); tone('sawtooth', 500, 900, 0.6, 0.05, 0.3, { lp: 1500 }); },
    spread: () => { for (let i = 0; i < 3; i++) { noise(0.25, 0.25, 900, 0.7, i * 0.05); tone('sine', 110, 40, 0.2, 0.2, i * 0.05); } },
    dash: () => { tone('sawtooth', 60, 110, 0.8, 0.12, 0, { lp: 500 }); noise(0.6, 0.12, 800, 0.7, 0, 'lowpass', { attack: 0.1 }); },
    shield: () => { tone('sine', 200, 600, 0.5, 0.08); noise(0.4, 0.05, 5000, 2, 0, 'bandpass'); },
    click: () => noise(0.03, 0.12, 3000, 2, 0, 'bandpass'),
  },
  // tabletop toys: pops, wooden clacks, tin tinks, xylophone jingles
  miniature: {
    shot: () => { tone('sine', 900, 250, 0.08, 0.14); noise(0.02, 0.15, 4000, 1, 0, 'highpass'); },
    heavy: () => { tone('sine', 500, 120, 0.14, 0.18); noise(0.04, 0.2, 2500); },
    boom: s => { noise(0.3 + s * 0.08, 0.35, 1800, 0.8, 0, 'lowpass', { fEnd: 200 }); tone('sine', 300, 60, 0.25, 0.25); tone('triangle', 900, 1400, 0.12, 0.05, 0.12); },
    brick: () => { tone('triangle', 1400 + Math.random() * 400, 0, 0.05, 0.14); tone('triangle', 1000 + Math.random() * 300, 0, 0.05, 0.1, 0.04); },
    steel: () => bell(1800, 0.25, 0.08),
    hit: () => { tone('triangle', 700, 400, 0.1, 0.14); tone('sine', 1400, 0, 0.08, 0.06); },
    spawn: () => tone('sine', 400, 1200, 0.18, 0.08),
    pick: () => [72, 76, 79, 84].forEach((m, i) => { tone('sine', mtof(m), 0, 0.3, 0.12, i * 0.07); tone('sine', mtof(m) * 4, 0, 0.08, 0.03, i * 0.07); }),
    puSpawn: () => { tone('sine', 1568, 0, 0.2, 0.06); tone('sine', 2093, 0, 0.2, 0.05, 0.08); },
    build: () => { for (let i = 0; i < 3; i++) tone('triangle', 800 - i * 150, 0, 0.06, 0.12, i * 0.07); },
    alarm: () => { for (let i = 0; i < 4; i++) tone('square', i % 2 ? 660 : 880, 0, 0.14, 0.05, i * 0.16, { lp: 2000 }); },
    stage: () => [60, 64, 67, 72].forEach((m, i) => { tone('sine', mtof(m), 0, 0.35, 0.12, i * 0.1); tone('sine', mtof(m) * 4, 0, 0.1, 0.03, i * 0.1); }),
    win: () => [67, 72, 76, 79, 76, 84].forEach((m, i) => { tone('sine', mtof(m), 0, 0.3, 0.12, i * 0.1); tone('sine', mtof(m) * 4, 0, 0.08, 0.03, i * 0.1); }),
    gameover: () => { tone('sine', 400, 150, 0.9, 0.12, 0, { glide: 0.9 }); tone('sine', 403, 151, 0.9, 0.08, 0, { glide: 0.9 }); },
    boss: () => { tone('square', 110, 0, 0.3, 0.08, 0, { lp: 900 }); tone('square', 104, 0, 0.3, 0.08, 0.35, { lp: 900 }); tone('square', 98, 0, 0.6, 0.08, 0.7, { lp: 900 }); },
    coreDown: () => { noise(0.6, 0.3, 1500); [67, 63, 60, 55].forEach((m, i) => tone('triangle', mtof(m), 0, 0.3, 0.1, 0.2 + i * 0.18)); },
    click: () => tone('triangle', 1600, 0, 0.03, 0.08),
  },
  // 8-bit console: pulse, triangle and noise channels only
  pixel: {
    shot: () => tone('square', 1200, 300, 0.07, 0.07),
    heavy: () => { tone('square', 700, 150, 0.1, 0.08); noise(0.06, 0.1, 3000); },
    boom: s => { const d = 0.35 + s * 0.12; noise(d, 0.35, 3000, 0.5, 0, 'lowpass', { fEnd: 150 }); tone('triangle', 200, 40, d, 0.2); },
    brick: () => noise(0.06, 0.2, 2500, 0.5),
    steel: () => tone('square', 2000, 0, 0.05, 0.05),
    hit: () => { tone('square', 500, 200, 0.08, 0.08); noise(0.05, 0.12, 4000); },
    spawn: () => [0, 4, 7, 12].forEach((n, i) => tone('square', mtof(60 + n), 0, 0.04, 0.04, i * 0.03)),
    pick: () => [72, 76, 79, 84, 88].forEach((m, i) => tone('square', mtof(m), 0, 0.05, 0.06, i * 0.04)),
    puSpawn: () => [84, 91].forEach((m, i) => tone('square', mtof(m), 0, 0.05, 0.04, i * 0.05)),
    build: () => [48, 55].forEach((m, i) => tone('square', mtof(m), 0, 0.06, 0.07, i * 0.05)),
    alarm: () => { for (let i = 0; i < 6; i++) tone('square', i % 2 ? 988 : 1318, 0, 0.08, 0.05, i * 0.09); },
    stage: () => [60, 64, 67, 72, 67, 72].forEach((m, i) => tone('square', mtof(m), 0, 0.09, 0.06, i * 0.08)),
    win: () => [72, 72, 72, 76, 79, 76, 79, 84].forEach((m, i) => tone('square', mtof(m), 0, 0.1, 0.06, i * 0.09)),
    gameover: () => [67, 66, 65, 64, 52].forEach((m, i) => tone('square', mtof(m), 0, 0.22, 0.06, i * 0.22)),
    boss: () => { for (let i = 0; i < 8; i++) tone('triangle', mtof(36 + (i % 2)), 0, 0.12, 0.2, i * 0.12); },
    coreDown: () => { noise(1.2, 0.35, 2500, 0.5, 0, 'lowpass', { fEnd: 80 }); [60, 55, 52, 48].forEach((m, i) => tone('square', mtof(m), 0, 0.2, 0.05, i * 0.2)); },
    freeze: () => [96, 91, 88, 84].forEach((m, i) => tone('square', mtof(m), 0, 0.05, 0.04, i * 0.04)),
    deflect: () => tone('square', 1800, 2400, 0.06, 0.05),
    spread: () => tone('square', 900, 200, 0.12, 0.08),
    dash: () => { for (let i = 0; i < 6; i++) tone('square', 200 + i * 80, 0, 0.04, 0.05, i * 0.03); },
    shield: () => [60, 67, 72, 79].forEach((m, i) => tone('triangle', mtof(m), 0, 0.08, 0.1, i * 0.04)),
    ring: () => noise(0.2, 0.15, 5000),
    flag: () => [76, 84].forEach((m, i) => tone('square', mtof(m), 0, 0.06, 0.06, i * 0.06)),
    capture: () => [72, 76, 79, 84, 79, 84].forEach((m, i) => tone('square', mtof(m), 0, 0.07, 0.06, i * 0.06)),
    click: () => tone('square', 1500, 0, 0.03, 0.04),
  },
  // cold, echoing: muffled cannons, crunching ice, glassy chimes
  winter: {
    shot: () => { noise(0.3, 0.3, 700, 0.7); tone('sine', 120, 45, 0.25, 0.3); noise(0.05, 0.08, 6000, 1, 0, 'highpass'); },
    heavy: () => { noise(0.45, 0.4, 550, 0.7); tone('sine', 90, 35, 0.35, 0.4); },
    boom: s => { noise(1 + s * 0.3, 0.5 * Math.min(1.5, s), 450, 0.7, 0, 'lowpass', { fEnd: 50 }); tone('sine', 65, 22, 0.9, 0.5); noise(0.5, 0.06, 6000, 1, 0.1, 'highpass'); },
    brick: () => { noise(0.18, 0.2, 900, 1.5, 0, 'bandpass'); noise(0.1, 0.08, 5000, 1, 0.03, 'highpass'); },
    steel: () => bell(1760, 0.9, 0.06),
    hit: () => { bell(880, 0.6, 0.08); noise(0.1, 0.15, 1500, 1, 0, 'bandpass'); },
    spawn: () => bell(1318, 1, 0.05),
    pick: () => [76, 79, 83, 88].forEach((m, i) => bell(mtof(m), 1.2, 0.05, i * 0.08)),
    puSpawn: () => { for (let i = 0; i < 5; i++) noise(0.06, 0.05, 8000, 3, i * 0.05, 'bandpass'); },
    build: () => { noise(0.25, 0.25, 600); noise(0.15, 0.08, 4000, 1, 0.05, 'highpass'); },
    freeze: () => { [96, 91, 88].forEach((m, i) => bell(mtof(m), 1.4, 0.04, i * 0.07)); noise(0.8, 0.06, 7000, 1, 0, 'highpass'); },
    alarm: () => { for (let i = 0; i < 3; i++) tone('triangle', 740, 620, 0.35, 0.08, i * 0.4); },
    stage: () => [64, 71, 76, 79].forEach((m, i) => bell(mtof(m), 1.6, 0.05, i * 0.14)),
    win: () => [64, 67, 71, 76, 79, 83].forEach((m, i) => bell(mtof(m), 1.6, 0.05, i * 0.12)),
    gameover: () => [76, 72, 69, 64].forEach((m, i) => bell(mtof(m), 2, 0.05, i * 0.35)),
    boss: () => { tone('sawtooth', 55, 0, 2.5, 0.12, 0, { lp: 260, attack: 0.8 }); tone('sawtooth', 58, 0, 2.5, 0.1, 0, { lp: 260, attack: 0.8 }); noise(2, 0.1, 300, 0.7, 0, 'lowpass', { attack: 0.8 }); },
    click: () => bell(2637, 0.2, 0.03),
  },
  // dry heat: sharp cracks, sand hiss, oud-like plucks
  desert: {
    shot: () => { noise(0.04, 0.35, 4500, 0.7, 0, 'highpass'); noise(0.22, 0.35, 1100); tone('sine', 140, 50, 0.18, 0.3); },
    heavy: () => { noise(0.05, 0.4, 3500, 0.7, 0, 'highpass'); noise(0.4, 0.45, 800); tone('sine', 100, 35, 0.3, 0.4); },
    boom: s => { noise(0.7 + s * 0.25, 0.55 * Math.min(1.5, s), 700, 0.7, 0, 'lowpass', { fEnd: 60 }); tone('sine', 75, 25, 0.7, 0.5); noise(1.2, 0.08, 3500, 0.7, 0.2, 'bandpass', { attack: 0.2 }); },
    brick: () => { noise(0.12, 0.2, 1400, 1.2, 0, 'bandpass'); noise(0.4, 0.06, 3000, 0.7, 0.05, 'bandpass', { attack: 0.05 }); },
    steel: () => bell(640, 0.45, 0.08, 0, { parts: [[1, 1], [2.4, 0.6], [4.1, 0.3]] }),
    hit: () => { bell(330, 0.35, 0.1, 0, { parts: [[1, 1], [2.2, 0.5]] }); noise(0.08, 0.18, 2000, 1, 0, 'bandpass'); },
    spawn: () => noise(0.5, 0.08, 2500, 0.8, 0, 'bandpass', { attack: 0.2 }),
    pick: () => [62, 63, 66, 67, 69].forEach((m, i) => pluck(mtof(m + 12), 0.3, 0.1, i * 0.06)),
    puSpawn: () => pluck(mtof(81), 0.3, 0.07),
    build: () => { noise(0.3, 0.28, 600); pluck(mtof(50), 0.2, 0.1); },
    alarm: () => { for (let i = 0; i < 3; i++) tone('sawtooth', 700, 520, 0.3, 0.07, i * 0.35, { lp: 2000 }); },
    stage: () => [62, 63, 66, 69, 74].forEach((m, i) => pluck(mtof(m), 0.45, 0.12, i * 0.09)),
    win: () => [62, 66, 69, 74, 72, 74].forEach((m, i) => pluck(mtof(m + 12), 0.45, 0.12, i * 0.1)),
    gameover: () => [69, 67, 66, 63, 62].forEach((m, i) => pluck(mtof(m), 0.6, 0.12, i * 0.25)),
    boss: () => { tone('sawtooth', 73, 0, 2, 0.15, 0, { lp: 350, attack: 0.3 }); for (let i = 0; i < 4; i++) kick(0.4, i * 0.3, { f0: 110, f1: 45 }); },
    click: () => pluck(mtof(86), 0.08, 0.05),
  },
  // drafting table: soft ticks, pencil scratches, clean chimes
  blueprint: {
    shot: () => tone('sine', 1500, 900, 0.05, 0.08),
    heavy: () => tone('sine', 1000, 500, 0.08, 0.1),
    boom: s => { tone('sine', 180, 60, 0.35 + s * 0.08, 0.3); noise(0.3 + s * 0.1, 0.12, 2500, 1.5, 0, 'bandpass'); },
    brick: () => noise(0.09, 0.15, 3500, 2.5, 0, 'bandpass'),
    steel: () => tone('sine', 2400, 0, 0.12, 0.06),
    hit: () => { tone('sine', 800, 500, 0.08, 0.1); noise(0.06, 0.08, 4000, 2, 0, 'bandpass'); },
    spawn: () => tone('sine', 600, 1200, 0.12, 0.05),
    pick: () => [79, 86].forEach((m, i) => tone('sine', mtof(m), 0, 0.4, 0.08, i * 0.09)),
    puSpawn: () => tone('sine', mtof(91), 0, 0.2, 0.04),
    build: () => { for (let i = 0; i < 3; i++) noise(0.05, 0.1, 3000, 3, i * 0.05, 'bandpass'); },
    alarm: () => { for (let i = 0; i < 3; i++) tone('sine', 1320, 0, 0.12, 0.08, i * 0.2); },
    stage: () => [72, 79, 84].forEach((m, i) => tone('sine', mtof(m), 0, 0.5, 0.07, i * 0.12)),
    win: () => [72, 76, 79, 84, 88].forEach((m, i) => tone('sine', mtof(m), 0, 0.5, 0.07, i * 0.1)),
    gameover: () => [79, 74, 71, 67].forEach((m, i) => tone('sine', mtof(m), 0, 0.6, 0.07, i * 0.25)),
    boss: () => { tone('sine', 110, 0, 1.2, 0.2, 0, { attack: 0.3 }); tone('sine', 116, 0, 1.2, 0.15, 0, { attack: 0.3 }); },
    click: () => tone('sine', 2000, 0, 0.03, 0.05),
  },
};

export function sfx(name, strength = 1) {
  if (!ctx || ctx.state !== 'running') return;
  const now = performance.now();
  const gap = { shot: 40, brick: 30, steel: 40, boom: 50, hit: 40 }[name] || 60;
  if (lastPlay[name] && now - lastPlay[name] < gap) return;
  lastPlay[name] = now;
  const fn = (PACKS[pack] && PACKS[pack][name]) || NEON_SFX[name];
  if (fn) fn(strength);
}

export function playEvents(evs) {
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

// ---------- engine hum while your own tank moves (one voice per style) ----------
const ENGINES = {
  neon: { kind: 'synth', wave: 'sawtooth', f: 52, lp: 260, trem: 9, depth: 0.3, vol: 0.05 },
  pixel: { kind: 'synth', wave: 'square', f: 55, lp: 650, trem: 15, depth: 0.7, vol: 0.028 },
  miniature: { kind: 'synth', wave: 'triangle', f: 92, lp: 1100, trem: 21, depth: 0.55, vol: 0.04 },
  blueprint: { kind: 'synth', wave: 'sine', f: 68, lp: 500, trem: 6, depth: 0.25, vol: 0.06 },
  modern: { kind: 'diesel', f: 38, lp: 170, trem: 11, depth: 0.5, vol: 0.1 },
  winter: { kind: 'diesel', f: 40, lp: 180, trem: 10, depth: 0.5, vol: 0.09 },
  desert: { kind: 'diesel', f: 36, lp: 160, trem: 12, depth: 0.5, vol: 0.1 },
};
let eng = null;
function buildEngine() {
  const c = ENGINES[pack] || ENGINES.neon;
  const out = ctx.createGain(); out.gain.value = 0; out.connect(sfxGain);
  const trem = ctx.createGain(); trem.gain.value = 1 - c.depth / 2; trem.connect(out);
  const lfo = ctx.createOscillator(); lfo.frequency.value = c.trem;
  const lfoAmt = ctx.createGain(); lfoAmt.gain.value = c.depth / 2; lfo.connect(lfoAmt); lfoAmt.connect(trem.gain);
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = c.lp; filt.Q.value = 0.9; filt.connect(trem);
  const oscs = [], nodes = [lfo];
  if (c.kind === 'diesel') {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; src.connect(filt); nodes.push(src);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = c.f; const og = ctx.createGain(); og.gain.value = 0.7; o.connect(og); og.connect(filt); oscs.push([o, c.f]); nodes.push(o);
  } else {
    for (const [mul, v] of [[1, 1], [1.012, 0.6]]) { const o = ctx.createOscillator(); o.type = c.wave; o.frequency.value = c.f * mul; const og = ctx.createGain(); og.gain.value = v; o.connect(og); og.connect(filt); oscs.push([o, c.f * mul]); nodes.push(o); }
  }
  nodes.forEach(n => n.start());
  return { pack, cfg: c, out, filt, oscs, nodes, on: false, boost: 1 };
}
function stopEngine() {
  if (!eng) return;
  const e = eng; eng = null;
  e.out.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
  setTimeout(() => { e.nodes.forEach(n => { try { n.stop(); } catch (x) {} }); e.out.disconnect(); }, 400);
}
// Called every frame: moving = one of your tanks is driving; boost > 1 while dashing.
export function setEngine(moving, boost = 1) {
  if (!ctx || ctx.state !== 'running') return;
  if (eng && eng.pack !== pack) stopEngine();
  if (!eng) { if (!moving) return; eng = buildEngine(); }
  if (moving === eng.on && boost === eng.boost) return;
  eng.on = moving; eng.boost = boost;
  const now = ctx.currentTime, k = moving ? boost : 0.85;
  eng.out.gain.cancelScheduledValues(now);
  eng.out.gain.setTargetAtTime(moving ? eng.cfg.vol : 0, now, moving ? 0.05 : 0.12);
  for (const [o, f] of eng.oscs) o.frequency.setTargetAtTime(f * k, now, 0.15);
  eng.filt.frequency.setTargetAtTime(eng.cfg.lp * (moving ? boost : 0.8), now, 0.15);
}

// ---------- soundtracks (step sequencer, 16 steps per bar) ----------
const M = { at: 0 }; // shared options object reused per note
const mo = (t, extra) => ({ at: t, dest: musicGain, ...extra });
const seq = str => str.trim().split(/\s+/).map(x => x === '.' ? 0 : +x);

// Neon soundtrack material (A minor): chord voicings, a 32-bar progression and two melody phrases
const NEON_CH = {
  Am: { r: 45, v: [57, 60, 64] }, F: { r: 41, v: [57, 60, 65] }, C: { r: 48, v: [55, 60, 64] },
  G: { r: 43, v: [55, 59, 62] }, Em: { r: 40, v: [55, 59, 64] },
};
const NEON_PROG = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G',
  'F', 'G', 'Em', 'Am', 'F', 'G', 'Em', 'Am', 'Am', 'F', 'Am', 'F', 'F', 'G', 'Am', 'G'];
const NEON_MEL_A = [ // [step, note, length in steps] per bar, over Am F C G
  [[0, 76, 6], [6, 74, 2], [8, 72, 8]],
  [[0, 72, 4], [4, 74, 4], [8, 76, 6], [14, 79, 2]],
  [[0, 79, 6], [6, 76, 2], [8, 74, 8]],
  [[0, 74, 4], [4, 72, 4], [8, 71, 8]],
];
const NEON_MEL_B = [ // over F G Em Am
  [[0, 81, 8], [8, 79, 4], [12, 77, 4]],
  [[0, 79, 6], [6, 77, 2], [8, 74, 8]],
  [[0, 76, 8], [8, 74, 4], [12, 71, 4]],
  [[0, 72, 12]],
];
const musicLevel = () => (musicOn ? settings.music * ((SONGS[pack] && SONGS[pack].gain) || 1) : 0);
const SONGS = {
  // relaxed synthwave: warm pads, rolling bass, soft triangle arps and a sparse lead.
  // 32-bar arrangement (intro, two melody sections, breakdown, build) so it doesn't loop every few seconds.
  neon: { gain: 1.15, bpm: 98, play(s, t, sd) {
    const bar = Math.floor(s / 16) % 32, i = s % 16;
    const sec = bar < 8 ? 'intro' : bar < 16 ? 'a' : bar < 24 ? 'b' : bar < 28 ? 'break' : 'build';
    const c = NEON_CH[NEON_PROG[bar]];
    // pad: two slightly detuned, filtered saws per chord tone
    if (i === 0) for (const n of c.v) {
      const v = sec === 'break' ? 0.02 : 0.017, lp = sec === 'break' ? 1500 : 1000;
      tone('sawtooth', mtof(n), 0, sd * 16.4, v, 0, mo(t, { lp, attack: 0.45 }));
      tone('sawtooth', mtof(n), 0, sd * 16.4, v, 0, mo(t, { lp, attack: 0.45, detune: 9 }));
    }
    // bass: root/octave eighths (held sub in the breakdown)
    if (sec === 'break') { if (i === 0) tone('sine', mtof(c.r), 0, sd * 16, 0.11, 0, mo(t, { attack: 0.25 })); }
    else if (bar >= 2 && i % 2 === 0) {
      const up = i % 4 === 2;
      tone('sawtooth', mtof(c.r + (up ? 12 : 0)), 0, sd * 1.7, up ? 0.05 : 0.075, 0, mo(t, { lp: 520, lpEnd: 160 }));
    }
    // arpeggio
    if (bar >= 4 && sec !== 'build' && i % 2 === 0) {
      const pat = sec === 'b' ? [0, 2, 1, 2] : [0, 1, 2, 1], n = c.v[pat[(i / 2) % 4]] + 12;
      tone('triangle', mtof(n), 0, sd * 1.8, sec === 'break' ? 0.032 : 0.024, 0, mo(t, { lp: 2400, lpEnd: 900 }));
    }
    // lead melody with a soft echo
    const mel = sec === 'a' ? NEON_MEL_A[bar % 4] : sec === 'b' ? NEON_MEL_B[bar % 4] : null;
    if (mel) for (const [st, n, len] of mel) if (st === i) {
      const d = sd * len * 1.1;
      tone('triangle', mtof(n), 0, d, 0.042, 0, mo(t, { lp: 3000, attack: 0.02 }));
      tone('triangle', mtof(n), 0, d, 0.026, 0, mo(t, { lp: 3000, attack: 0.02, detune: 7 }));
      tone('triangle', mtof(n), 0, d, 0.014, sd * 3, mo(t, { lp: 1600, attack: 0.02 }));
    }
    // drums: kick and clap only in the full sections, quiet hats, a riser before each new section
    const full = sec === 'a' || sec === 'b' || (sec === 'build' && bar >= 29);
    if ((full && (i === 0 || i === 8)) || (sec === 'intro' && bar >= 4 && i === 0)) kick(0.28, 0, mo(t, { f0: 120, f1: 42, dur: 0.24 }));
    if (full && (i === 4 || i === 12)) { snare(0.045, 0, mo(t, { f: 1700, dur: 0.14 })); noise(0.05, 0.03, 5000, 0.7, 0, 'highpass', mo(t)); }
    if ((bar >= 2 && sec !== 'break') && i % 4 === 2) hat(0.02, 0, mo(t, { f: 8500, dur: 0.035 }));
    if (sec === 'b' && i % 2 === 1) hat(0.008, 0, mo(t, { f: 9500, dur: 0.02 }));
    if ((bar === 7 || bar === 15 || bar === 27) && i === 0) noise(sd * 16, 0.035, 700, 0.8, 0, 'bandpass', mo(t, { attack: sd * 14, fEnd: 5000 }));
    if ((bar === 8 || bar === 16 || bar === 28) && i === 0) noise(1.4, 0.04, 7000, 0.5, 0, 'highpass', mo(t));
    if (bar === 31 && i >= 8 && i % 2 === 0) snare(0.02 + (i - 8) * 0.006, 0, mo(t, { f: 1900, dur: 0.08 }));
  } },
  // tense military: taiko hits, low string ostinato, snare rolls, drones
  modern: { gain: 0.65, bpm: 96, play(s, t, sd) {
    const bar = Math.floor(s / 16), i = s % 16, roots = [38, 34, 41, 36], root = roots[bar % 4];
    const ost = [0, 0, 12, 0, 0, 0, 13, 0, 0, 0, 12, 0, 7, 0, 3, 0];
    if (i % 2 === 0) { tone('sawtooth', mtof(root + ost[i]), 0, sd * 1.6, 0.06, 0, mo(t, { lp: 900, lpEnd: 300 })); tone('sawtooth', mtof(root + ost[i]), 0, sd * 1.6, 0.04, 0, mo(t, { lp: 900, lpEnd: 300, detune: 9 })); }
    if (i === 0) { tone('sawtooth', mtof(root), 0, sd * 16, 0.05, 0, mo(t, { lp: 420, attack: 0.4 })); tone('sawtooth', mtof(root + 7), 0, sd * 16, 0.03, 0, mo(t, { lp: 420, attack: 0.4 })); }
    if ([0, 3, 8, 11].includes(i)) { kick(0.45, 0, mo(t, { f0: 90, f1: 32, dur: 0.45 })); noise(0.25, 0.08, 300, 0.7, 0, 'lowpass', mo(t)); }
    if (i === 4 || i === 12) snare(0.07, 0, mo(t, { f: 1500 }));
    if (bar % 2 === 1 && i >= 12) snare(0.05 + (i - 12) * 0.02, 0, mo(t, { f: 1700, dur: 0.08 }));
    if (bar % 4 === 3 && i === 0) { tone('sawtooth', mtof(root + 24), 0, sd * 6, 0.05, 0, mo(t, { lp: 1400, attack: 0.08 })); tone('sawtooth', mtof(root + 27), 0, sd * 6, 0.04, 0, mo(t, { lp: 1400, attack: 0.08 })); }
  } },
  // playful toy march: marimba melody, pizzicato oom-pah bass, brushes
  miniature: { gain: 1.6, bpm: 124, play(s, t, sd) {
    const bar = Math.floor(s / 16) % 4, i = s % 16;
    const mel = [seq('72 . 76 . 79 . 76 . 77 . 81 . 79 . . .'), seq('76 . 79 . 84 . 79 . 81 79 77 76 74 . . .'), seq('72 . 76 . 79 . 76 . 77 . 81 . 79 . 84 .'), seq('77 76 74 . 67 . . . 72 . . . . . . .')][bar];
    const roots = [48, 53, 48, 43][bar];
    const n = mel[i]; if (n) { tone('sine', mtof(n), 0, 0.35, 0.09, 0, mo(t)); tone('sine', mtof(n) * 4, 0, 0.07, 0.025, 0, mo(t)); }
    if (i === 0 || i === 8) tone('triangle', mtof(roots), 0, 0.18, 0.16, 0, mo(t));
    if (i === 4 || i === 12) { tone('triangle', mtof(roots + 7), 0, 0.14, 0.1, 0, mo(t)); tone('triangle', mtof(roots + 16), 0, 0.14, 0.05, 0, mo(t)); }
    if (i === 4 || i === 12) noise(0.12, 0.06, 3000, 0.8, 0, 'bandpass', mo(t));
    if (i % 4 === 2) hat(0.03, 0, mo(t));
  } },
  // chiptune: pulse lead, triangle bass, noise drums
  pixel: { gain: 1.35, bpm: 150, play(s, t, sd) {
    const bar = Math.floor(s / 16) % 4, i = s % 16;
    const mel = [seq('69 . 72 . 76 . 81 . 79 . 76 . 72 . 74 .'), seq('77 . 76 . 72 . 69 . 72 . 74 . 76 . . .'), seq('79 . 76 . 72 . 76 . 79 . 81 . 79 . 76 .'), seq('74 . 71 . 67 . 71 . 74 . 76 . 74 . 71 .')][bar];
    const root = [45, 41, 48, 43][bar];
    const n = mel[i]; if (n) tone('square', mtof(n), 0, sd * 1.7, 0.035, 0, mo(t, { attack: 0.002 }));
    if (i % 2 === 0) tone('triangle', mtof(root + (i % 4 === 0 ? 0 : 12)), 0, sd * 1.8, 0.14, 0, mo(t, { attack: 0.002 }));
    if (i === 0 || i === 8 || i === 10) tone('triangle', 180, 50, 0.1, 0.25, 0, mo(t, { glide: 0.08 }));
    if (i === 4 || i === 12) noise(0.12, 0.12, 5000, 0.5, 0, 'lowpass', mo(t));
    if (i % 2 === 1) noise(0.03, 0.05, 9000, 0.5, 0, 'highpass', mo(t));
  } },
  // frozen stillness: glassy bell arpeggios over a slow pad and wind
  winter: { gain: 1.45, bpm: 78, play(s, t, sd) {
    const bar = Math.floor(s / 16) % 4, i = s % 16;
    const chords = [[64, 67, 71], [60, 64, 67], [67, 71, 74], [62, 66, 69]][bar];
    if (i % 2 === 0) { const k = (i / 2) % 6, n = chords[k % 3] + (k >= 3 ? 12 : 0) + 12; bell(mtof(n), 2.2, 0.035, 0, mo(t)); }
    if (i === 0) for (const n of chords) tone('triangle', mtof(n - 12), 0, sd * 16, 0.035, 0, mo(t, { attack: 0.9, lp: 1200 }));
    if (i === 0) kick(0.18, 0, mo(t, { f0: 70, f1: 35, dur: 0.6 }));
    if (i === 0 && bar % 2 === 0) noise(sd * 30, 0.03, 900, 2, 0, 'bandpass', mo(t, { attack: sd * 12, fEnd: 400 }));
  } },
  // desert caravan: Hijaz scale plucks, darbuka rhythm, drone
  desert: { gain: 1.2, bpm: 104, play(s, t, sd) {
    const bar = Math.floor(s / 16) % 4, i = s % 16;
    const mel = [seq('62 . 63 . 66 . 67 . 69 . 67 66 67 . . .'), seq('69 . 70 . 69 . 67 . 66 . 63 . 62 . . .'), seq('74 . 72 . 70 . 69 . 67 . 69 . 66 . . .'), seq('67 66 63 . 62 . . . 62 . 63 . 62 . . .')][bar];
    const n = mel[i]; if (n) { pluck(mtof(n), 0.5, 0.07, 0, mo(t, { lp: 2200 })); pluck(mtof(n) * 1.003, 0.5, 0.04, 0.012, mo(t, { lp: 2200 })); }
    if (i === 0) { tone('sawtooth', mtof(38), 0, sd * 16, 0.05, 0, mo(t, { lp: 380, attack: 0.3 })); tone('sawtooth', mtof(45), 0, sd * 16, 0.03, 0, mo(t, { lp: 380, attack: 0.3 })); }
    if (i === 0 || i === 10) kick(0.32, 0, mo(t, { f0: 110, f1: 55, dur: 0.3 }));
    if (i === 4 || i === 6 || i === 12) noise(0.05, 0.14, 3500, 1.5, 0, 'bandpass', mo(t));
    if (i === 14) noise(0.04, 0.07, 4500, 1.5, 0, 'bandpass', mo(t));
    hat(0.015, 0, mo(t, { f: 8000, dur: 0.03 }));
  } },
  // minimal drafting-room pulses
  blueprint: { gain: 1.7, bpm: 96, play(s, t, sd) {
    const bar = Math.floor(s / 16) % 4, i = s % 16;
    const cyc = [62, 69, 65, 72, 69, 76], shift = [0, -2, 3, -4][bar];
    if (i % 2 === 0) tone('sine', mtof(cyc[(s / 2) % 6] + shift), 0, sd * 2.5, 0.05, 0, mo(t));
    if (i === 0 || i === 8) kick(0.2, 0, mo(t, { f0: 100, f1: 45, dur: 0.2 }));
    if (i % 4 === 2) hat(0.02, 0, mo(t, { f: 9000, dur: 0.02 }));
    if (i === 0 && bar % 2 === 0) for (const n of [50, 57, 64]) tone('sine', mtof(n + shift), 0, sd * 32, 0.025, 0, mo(t, { attack: 1 }));
  } },
};

let musicTimer = null, step = 0, next = 0;
export function startMusic() {
  if (!ctx || musicTimer) return;
  next = ctx.currentTime + 0.1;
  musicTimer = setInterval(() => {
    if (!musicOn || !ctx) return;
    const song = SONGS[pack] || SONGS.neon, sd = 60 / song.bpm / 4;
    if (next < ctx.currentTime - 1) next = ctx.currentTime + 0.05; // tab was asleep
    while (next < ctx.currentTime + 0.3) { song.play(step, next, sd); next += sd; step++; }
  }, 60);
}
export function toggleMusic(on) { musicOn = on; if (musicGain) musicGain.gain.value = musicLevel(); }
export const SOUND_PACKS = Object.keys(PACKS);

// Offline render used by automated tests: returns peak / rms for one sfx or a pack's soundtrack.
export async function renderTest(id, what, seconds = 4, raw = false) {
  const saved = { ctx, comp, sfxGain, musicGain, noiseBuf, verb, sfxVerb, musVerb, pack };
  const off = new OfflineAudioContext(2, Math.floor(44100 * seconds), 44100);
  buildGraph(off); pack = id; applyReverb();
  if (what === 'music') { const song = SONGS[id], sd = 60 / song.bpm / 4; let t = 0.05, st = 0; while (t < seconds - 0.5) { song.play(st++, t, sd); t += sd; } }
  else { const fn = (PACKS[id] && PACKS[id][what]) || NEON_SFX[what]; fn(1); }
  const buf = await off.startRendering();
  ({ ctx, comp, sfxGain, musicGain, noiseBuf, verb, sfxVerb, musVerb, pack } = saved);
  if (raw) return buf;
  const ch = buf.getChannelData(0); let peak = 0, sum = 0; for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; sum += v * v; }
  return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / ch.length).toFixed(4) };
}
export const SFX_NAMES = Object.keys(NEON_SFX);
