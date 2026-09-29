// App glue: screens, lobby, host/client loops, HUD
import { TICK, CLASSES, CLASS_KEYS, MODES, PLAYER_COLORS, TEAM_MAIN, MAX_PLAYERS } from './const.js';
import { Game } from './game.js';
import { Renderer, tankIcon } from './render.js';
import { Input } from './input.js';
import { Net, makeRoomCode, saveLevel, loadLevel, listLevels } from './net.js';
import { Editor, mapPreview } from './editor.js';
import { decodeMap } from './levels.js';
import { initAudio, playEvents, startMusic, setVolume, sfx } from './audio.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 12);

const S = {
  me: { id: uid(), name: store.get('nt_name', ''), cls: store.get('nt_cls', 'striker') },
  screen: 'menu', net: null, isHost: false, online: false, code: '',
  lobby: { mode: 'classic', map: null, bots: true, started: false, players: [] },
  game: null, paused: false, peers: new Map(),
  snaps: [], mapStr: '', clientEv: [], localEv: [], clockOff: null, netMode: 'pending', rtt: 0,
  pendingMap: null, fromEditor: false, endShown: false,
};
if (!CLASSES[S.me.cls]) S.me.cls = 'striker';

const renderer = new Renderer($('#view'));
const input = new Input();
const isTouch = matchMedia('(hover: none)').matches || 'ontouchstart' in window;
if (isTouch) { $('#touch').classList.remove('hidden'); input.bindTouch($('#touch')); }

// ---------- toast ----------
let toastT = 0;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

// ---------- screens ----------
function show(name) {
  S.screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === name));
  input.enabled = name === 'game';
  $('#bg').style.display = name === 'game' || name === 'editor' ? 'none' : 'block';
  if (name === 'game') { renderer.resize(); }
  if (name === 'editor') editor.show();
}

// ---------- class pickers ----------
function renderClassPicker(el, compact) {
  el.innerHTML = '';
  CLASS_KEYS.forEach((k, i) => {
    const c = CLASSES[k];
    const d = document.createElement('div'); d.className = 'cls' + (S.me.cls === k ? ' sel' : '');
    d.appendChild(tankIcon('p' + k, PLAYER_COLORS[[0, 1, 2, 4][i]], 108));
    d.insertAdjacentHTML('beforeend', `<div class="n">${c.name}</div><div class="d">${c.desc}</div>`);
    d.onclick = () => { S.me.cls = k; store.set('nt_cls', k); sfx('click'); refreshPickers(); onClassChange(); };
    el.appendChild(d);
  });
}
function refreshPickers() { renderClassPicker($('#classPicker'), false); renderClassPicker($('#classPicker2'), true); }
function onClassChange() {
  if (S.isHost) { if (S.game) S.game.setClass(S.me.id, S.me.cls); renderLobby(); broadcastLobby(); }
  else if (S.net) S.net.sendToHost({ y: 'cls', cls: S.me.cls }, true);
}

// ---------- menu ----------
$('#nameInput').value = S.me.name;
$('#nameInput').addEventListener('input', e => { S.me.name = e.target.value.trim().slice(0, 16); store.set('nt_name', S.me.name); });
function requireName() {
  if (!S.me.name) { S.me.name = 'Tanker' + Math.floor(100 + Math.random() * 900); $('#nameInput').value = S.me.name; store.set('nt_name', S.me.name); }
  initAudio(); startMusic();
}
$('#btnSolo').onclick = () => { requireName(); S.isHost = true; S.online = false; S.code = ''; enterLobby(); };
$('#btnCreate').onclick = createRoom;
$('#btnJoin').onclick = () => joinRoom($('#joinCode').value.trim().toUpperCase());
$('#joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#btnEditor').onclick = () => { initAudio(); show('editor'); };
$('#btnMaps').onclick = () => openMaps();
$('#volMusic').value = store.get('nt_music', '0.22'); $('#volSfx').value = store.get('nt_sfx', '0.5');
setVolume('music', +$('#volMusic').value); setVolume('sfx', +$('#volSfx').value);
$('#volMusic').oninput = e => { setVolume('music', +e.target.value); store.set('nt_music', e.target.value); };
$('#volSfx').oninput = e => { setVolume('sfx', +e.target.value); store.set('nt_sfx', e.target.value); };

function setPendingMap(m) {
  S.pendingMap = m;
  const chip = $('#mapChip');
  if (!m) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  chip.innerHTML = `<span>Map selected: <b>${esc(m.name)}</b></span><button title="Clear">✕</button>`;
  chip.querySelector('button').onclick = () => setPendingMap(null);
}

async function createRoom() {
  requireName();
  const code = makeRoomCode();
  const btn = $('#btnCreate'); btn.disabled = true; btn.textContent = 'Opening room…';
  try {
    S.isHost = true; S.online = true; S.code = code;
    S.net = new Net({ code, me: S.me, isHost: true, on: hostHandlers });
    await S.net.connect();
    history.replaceState(null, '', '?room=' + code);
    enterLobby();
  } catch (e) { toast(e.message || 'Could not create room'); S.net = null; S.online = false; }
  btn.disabled = false; btn.textContent = 'Create Online Room';
}

async function joinRoom(code) {
  if (!/^[A-Z0-9]{5}$/.test(code)) { toast('Enter the 5-character room code'); return; }
  requireName();
  const btn = $('#btnJoin'); btn.disabled = true; btn.textContent = '…';
  try {
    S.isHost = false; S.online = true; S.code = code;
    S.lobby = { mode: 'classic', map: null, bots: true, started: false, players: [] };
    S.net = new Net({ code, me: S.me, isHost: false, on: clientHandlers });
    await S.net.connect();
    history.replaceState(null, '', '?room=' + code);
    enterLobby();
  } catch (e) { toast(e.message || 'Could not join'); S.net = null; }
  btn.disabled = false; btn.textContent = 'Join';
}

function leaveAll(msg) {
  if (S.net) S.net.close();
  S.net = null; S.game = null; S.online = false; S.isHost = false; S.paused = false; S.endShown = false;
  S.peers.clear(); S.snaps = []; S.mapStr = ''; S.clockOff = null;
  S.lobby = { mode: 'classic', map: null, bots: true, started: false, players: [] };
  $('#pauseMenu').classList.add('hidden'); $('#endMenu').classList.add('hidden');
  history.replaceState(null, '', location.pathname);
  if (msg) toast(msg);
  if (S.fromEditor) { S.fromEditor = false; show('editor'); } else show('menu');
}

// ---------- lobby ----------
function enterLobby() {
  if (S.isHost) {
    S.lobby = { mode: S.lobby.mode || 'classic', map: S.pendingMap, bots: true, started: false, players: [] };
    if (S.pendingMap) { const L = decodeMap(S.pendingMap.data).layout; if (MODES[S.lobby.mode].layout !== L) S.lobby.mode = L === 'A' ? 'battle' : 'classic'; }
  }
  refreshPickers(); renderLobby(); show('lobby');
}

function lobbyPlayers() {
  if (!S.isHost) return S.lobby.players;
  const list = [{ id: S.me.id, name: S.me.name, cls: S.me.cls, net: 'host' }];
  if (S.net) for (const p of S.net.peers.values()) list.push({ id: p.id, name: p.name, cls: p.cls, net: p.mode });
  return list;
}
function lobbyState() {
  return { mode: S.lobby.mode, mapName: S.lobby.map ? S.lobby.map.name : '', bots: S.lobby.bots, started: S.lobby.started, players: lobbyPlayers() };
}
function broadcastLobby() {
  if (!S.isHost || !S.net) return;
  const l = lobbyState();
  for (const id of S.net.peers.keys()) S.net.sendTo(id, { y: 'lobby', l }, true);
}
setInterval(() => { if (S.isHost && S.net) broadcastLobby(); }, 3000);

function renderLobby() {
  const L = S.isHost ? { ...S.lobby, mapName: S.lobby.map ? S.lobby.map.name : '' } : S.lobby;
  const players = lobbyPlayers();
  $('#roomLabel').textContent = S.online ? 'ROOM CODE' : 'OFFLINE';
  $('#roomCode').textContent = S.online ? S.code : 'SOLO';
  $('#btnCopyLink').classList.toggle('hidden', !S.online);
  $('#playerCount').textContent = `${players.length}/${MAX_PLAYERS}`;
  const slots = $('#slots'); slots.innerHTML = '';
  const pvp = MODES[L.mode].layout === 'A';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players[i];
    const d = document.createElement('div');
    if (!p) { d.className = 'slot empty'; d.textContent = S.online ? 'open slot' : '—'; slots.appendChild(d); continue; }
    d.className = 'slot';
    const color = pvp ? TEAM_MAIN[i % 2] : PLAYER_COLORS[i % 8];
    const netTag = p.net === 'host' ? '<span class="net">HOST</span>' : p.net === 'rtc' ? '<span class="net">P2P</span>' : p.net === 'relay' ? '<span class="net relay">RELAY</span>' : p.net ? '<span class="net pending">…</span>' : '';
    d.innerHTML = `<span class="dot" style="color:${color}"></span><span class="nm">${esc(p.name)}${p.id === S.me.id ? ' (you)' : ''}</span><span class="tag">${CLASSES[p.cls] ? CLASSES[p.cls].name : ''}</span>${netTag}`;
    slots.appendChild(d);
  }
  const modes = $('#modePicker'); modes.innerHTML = '';
  for (const [k, m] of Object.entries(MODES)) {
    const d = document.createElement('div'); d.className = 'mode' + (L.mode === k ? ' sel' : '') + (S.isHost ? '' : ' locked');
    d.innerHTML = `<div class="n">${m.name}</div><div class="d">${m.desc}</div>`;
    if (S.isHost) d.onclick = () => { S.lobby.mode = k; sfx('click'); renderLobby(); broadcastLobby(); };
    modes.appendChild(d);
  }
  let mapTxt = L.mapName ? L.mapName : 'Procedural — new map every stage';
  if (S.isHost && S.lobby.map) { const lay = decodeMap(S.lobby.map.data).layout; if (lay !== MODES[L.mode].layout) mapTxt += ' (other layout — procedural used)'; }
  $('#mapName').textContent = mapTxt;
  $('#btnPickMap').classList.toggle('hidden', !S.isHost);
  $('#btnClearMap').classList.toggle('hidden', !(S.isHost && S.lobby.map));
  $('#botsRow').classList.toggle('hidden', !pvp);
  $('#botsToggle').checked = !!L.bots; $('#botsToggle').disabled = !S.isHost;
  $('#btnStart').classList.toggle('hidden', !S.isHost);
  $('#waitHost').classList.toggle('hidden', S.isHost);
  if (!S.isHost && L.started) $('#waitHost').textContent = 'Game in progress — joining…';
  else $('#waitHost').textContent = 'Waiting for the host to start…';
}
$('#btnLeaveLobby').onclick = () => leaveAll();
$('#btnCopyLink').onclick = () => copy(`${location.origin}${location.pathname}?room=${S.code}`, 'Invite link copied — send it to your friends!');
$('#btnPickMap').onclick = () => openMaps();
$('#btnClearMap').onclick = () => { S.lobby.map = null; renderLobby(); broadcastLobby(); };
$('#botsToggle').onchange = e => { S.lobby.bots = e.target.checked; broadcastLobby(); };
$('#btnStart').onclick = () => startGame();

function copy(text, msg) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg), () => { prompt('Copy this link:', text); });
}

// ---------- host ----------
const hostHandlers = {
  peerJoin(peer) {
    S.peers.set(peer.id, { seq: -1, ev: [], lastSend: 0, lastRev: -1, mapRepeats: 0, lastFull: 0 });
    if (S.game) S.game.addPlayer({ id: peer.id, name: peer.name, cls: peer.cls });
    toast(`${peer.name} joined`); sfx('spawn');
    renderLobby(); broadcastLobby();
  },
  peerLeave(id) {
    const name = S.game && S.game.players.get(id) ? S.game.players.get(id).name : 'A player';
    S.peers.delete(id);
    if (S.game) S.game.removePlayer(id);
    toast(`${name} left`); renderLobby(); broadcastLobby();
  },
  peerMode() { renderLobby(); broadcastLobby(); },
  msg(from, m) {
    const hp = S.peers.get(from);
    if (m.y === 'in') {
      if (!hp) return;
      if (m.s > hp.seq || m.s < hp.seq - 500) { hp.seq = m.s; if (S.game) S.game.setInput(from, m); }
    } else if (m.y === 'cls') {
      const p = S.net.peers.get(from); if (p && CLASSES[m.cls]) p.cls = m.cls;
      if (S.game) S.game.setClass(from, m.cls);
      renderLobby(); broadcastLobby();
    } else if (m.y === 'ping') S.net.sendTo(from, { y: 'pong', t: m.t });
  },
};

function startGame() {
  initAudio(); startMusic();
  const map = S.lobby.map;
  const players = lobbyPlayers().map(p => ({ id: p.id, name: p.name, cls: p.cls }));
  S.game = new Game({ mode: S.lobby.mode, customMap: map ? map.data : null, customName: map ? map.name : '', seed: (Math.random() * 1e9) | 0, bots: S.lobby.bots, players });
  for (const hp of S.peers.values()) { hp.lastRev = -1; hp.ev = []; }
  S.lobby.started = true; S.endShown = false; S.paused = false; S.renderRev = -1;
  broadcastLobby();
  $('#endMenu').classList.add('hidden');
  show('game');
}

// fixed-rate simulation driven by a worker timer (keeps running in background tabs)
let lastSim = performance.now(), simAcc = 0;
function simTick() {
  const now = performance.now();
  const dt = Math.min(1, (now - lastSim) / 1000); lastSim = now;
  if (!S.isHost || !S.game || S.paused) { simAcc = 0; return; }
  S.game.setInput(S.me.id, S.screen === 'game' ? input.read() : { d: -1, f: false, a: false });
  simAcc += dt;
  let n = 0;
  while (simAcc >= TICK && n < 60) { S.game.step(TICK); simAcc -= TICK; n++; }
  const ev = S.game.drainEvents();
  if (ev.length) {
    S.localEv.push(...ev);
    for (const hp of S.peers.values()) { hp.ev.push(...ev); if (hp.ev.length > 80) hp.ev.splice(0, hp.ev.length - 80); }
  }
  if (S.net) sendSnapshots(now);
}
function sendSnapshots(now) {
  let base = null, mapStr = null;
  for (const [id, hp] of S.peers) {
    const mode = S.net.peerMode(id);
    if (mode === 'pending' || mode === 'none') continue;
    const interval = mode === 'rtc' ? 50 : 100;
    if (now - hp.lastSend < interval) continue;
    hp.lastSend = now;
    if (!base) base = S.game.snapshot(false);
    const msg = { y: 'snap', ...base, ev: hp.ev };
    if (hp.lastRev !== S.game.gridRev) { hp.lastRev = S.game.gridRev; hp.mapRepeats = 3; }
    if (hp.mapRepeats > 0 || now - hp.lastFull > 2000) { hp.mapRepeats--; hp.lastFull = now; msg.map = mapStr || (mapStr = S.game.mapString()); }
    S.net.sendTo(id, msg);
    hp.ev = [];
  }
}
try {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),1000/60)'], { type: 'text/javascript' })));
  w.onmessage = simTick;
} catch (e) { setInterval(simTick, 1000 / 60); }

// ---------- client ----------
const clientHandlers = {
  msg(from, m) {
    if (m.y === 'lobby') {
      S.lobby = m.l;
      if (m.l.started && S.screen !== 'game') { S.endShown = false; show('game'); }
      else if (!m.l.started && S.screen === 'game') { $('#endMenu').classList.add('hidden'); S.snaps = []; show('lobby'); }
      if (S.screen === 'lobby') renderLobby();
    } else if (m.y === 'snap') onSnap(m);
    else if (m.y === 'pong') S.rtt = performance.now() - m.t;
  },
  hostLeft() { leaveAll('The host left the room'); },
  error(msg) { leaveAll(msg); },
  mode(mode) { S.netMode = mode; if (mode === 'relay') toast('Direct connection blocked — using relay (slightly higher latency)'); },
};

function onSnap(m) {
  const now = performance.now();
  if (m.map) S.mapStr = m.map;
  if (m.ev && m.ev.length) S.clientEv.push(...m.ev);
  const off = m.tm * 1000 - now;
  if (S.clockOff == null || off > S.clockOff) S.clockOff = off; else S.clockOff = S.clockOff * 0.995 + off * 0.005;
  const last = S.snaps[S.snaps.length - 1];
  if (last && m.tm <= last.tm) { if (m.tm < last.tm - 2) S.snaps = [m]; return; }
  S.snaps.push(m); if (S.snaps.length > 40) S.snaps.shift();
  if (S.screen === 'lobby' && S.lobby.started) show('game');
}

let lastInKey = '', lastInSent = 0, inSeq = 0;
setInterval(() => {
  if (S.isHost || !S.net || S.screen !== 'game') return;
  const i = input.read(), key = `${i.d}${+i.f}${+i.a}`, now = performance.now();
  const minGap = S.net.mode === 'relay' ? 90 : 0, hb = S.net.mode === 'relay' ? 1000 : 400;
  if ((key !== lastInKey && now - lastInSent > minGap) || now - lastInSent > hb) {
    S.net.sendToHost({ y: 'in', s: ++inSeq, d: i.d, f: i.f, a: i.a });
    lastInKey = key; lastInSent = now;
  }
}, 16);
setInterval(() => { if (S.net && !S.isHost) S.net.sendToHost({ y: 'ping', t: performance.now() }); }, 2000);

function interpView() {
  const snaps = S.snaps; if (!snaps.length) return null;
  const delay = S.net && S.net.mode === 'relay' ? 0.2 : 0.1;
  const rt = (performance.now() + (S.clockOff || 0)) / 1000 - delay;
  let a = null, b = snaps[snaps.length - 1];
  for (let i = snaps.length - 1; i > 0; i--) if (snaps[i - 1].tm <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
  if (!a || rt >= b.tm) return { ...b, map: S.mapStr };
  const k = Math.max(0, Math.min(1, (rt - a.tm) / (b.tm - a.tm || 1)));
  const lerpList = (lb, la) => {
    const m = new Map(la.map(x => [x[0], x]));
    return lb.map(x => { const p = m.get(x[0]); if (!p) return x; if (Math.abs(p[1] - x[1]) > 300 || Math.abs(p[2] - x[2]) > 300) return x; const y = x.slice(); y[1] = p[1] + (x[1] - p[1]) * k; y[2] = p[2] + (x[2] - p[2]) * k; return y; });
  };
  return { ...b, tk: lerpList(b.tk, a.tk), b: lerpList(b.b, a.b), map: S.mapStr };
}

// ---------- HUD ----------
let hudT = 0, lastBanner = '';
function updateHud(h, force) {
  if (!h) return;
  const b = h.banner ? h.banner[0] + '|' + h.banner[1] : '';
  if (b !== lastBanner) {
    lastBanner = b;
    const el = $('#banner');
    if (h.banner) { $('#bannerText').textContent = h.banner[0]; $('#bannerSub').textContent = h.banner[1]; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
    else el.classList.remove('show');
  }
  const bb = $('#bossBar');
  if (h.boss) { bb.classList.remove('hidden'); $('#bossFill').style.width = (100 * h.boss[0] / h.boss[1]) + '%'; } else bb.classList.add('hidden');
  const now = performance.now();
  if (!force && now - hudT < 150) return; hudT = now;
  const pvp = h.mode === 'battle' || h.mode === 'ctf';
  if (h.mode === 'classic') $('#hudLeft').innerHTML = `<span class="t">STAGE ${h.stage}</span> <span class="s">${esc(h.title || '')}</span>`;
  else if (h.mode === 'survival') $('#hudLeft').innerHTML = `<span class="t">WAVE ${h.wave}</span> <span class="s">Survival</span>`;
  else $('#hudLeft').innerHTML = `<span class="t">${MODES[h.mode].name.toUpperCase()}</span> <span class="s">${esc(h.title || '')}</span>`;
  if (pvp) {
    const m = Math.floor(h.timeLeft / 60), s = String(h.timeLeft % 60).padStart(2, '0');
    $('#hudCenter').innerHTML = `<div class="team-score"><span class="a">${h.team[0]}</span><span class="m">${m}:${s}<br>to ${h.target}</span><span class="b">${h.team[1]}</span></div>`;
  } else $('#hudCenter').innerHTML = `<div class="enemy-count"><i></i>${h.left} enemies${h.freeze ? ' · <span style="color:#a98bff">FROZEN</span>' : ''}</div>`;
  const badge = $('#netBadge');
  if (S.online) {
    badge.classList.remove('hidden');
    if (S.isHost) { badge.className = 'badge'; badge.textContent = `HOST · ${S.peers.size + 1}P`; }
    else { const relay = S.net && S.net.mode === 'relay'; badge.className = 'badge' + (relay ? ' relay' : ''); badge.textContent = `${relay ? 'RELAY' : 'P2P'} ${Math.round(S.rtt)}ms`; }
  } else badge.classList.add('hidden');
  const bottom = $('#hudBottom');
  bottom.innerHTML = h.players.map(p => {
    const [id, name, color, lives, score, power, alive, cls, team, kills, cd] = p;
    const me = id === S.me.id;
    const stars = '★'.repeat(power) + '<span style="opacity:.25">' + '★'.repeat(3 - power) + '</span>';
    const cdPct = me && cd > 0 ? Math.max(0, 100 - 100 * cd / CLASSES[cls].cd) : (me ? 100 : 0);
    const stat = pvp ? `<b>${kills}</b> K` : `♥<b>${lives}</b>`;
    return `<div class="pchip${me ? ' me' : ''}${alive === 2 ? ' out' : ''}"><span class="bar" style="color:${color}"></span><span class="nm" style="color:${color}">${esc(name)}</span><span class="st">${stat} <span style="color:#ffd23f">${stars}</span> <span class="sc">${score}</span></span>${me ? `<span class="cd" style="width:${cdPct}%"></span>` : ''}</div>`;
  }).join('');
  if ((h.status === 'over' || h.status === 'win') && !S.endShown) showEnd(h);
  if (h.status !== 'over' && h.status !== 'win' && S.endShown) { S.endShown = false; $('#endMenu').classList.add('hidden'); }
}

function showEnd(h) {
  S.endShown = true;
  const pvp = h.mode === 'battle' || h.mode === 'ctf';
  $('#endTitle').textContent = h.status === 'win' ? (h.winner === 2 ? 'DRAW' : `${h.winner ? 'CRIMSON' : 'CYAN'} WINS`) : 'GAME OVER';
  $('#endTitle').style.color = h.status === 'win' && h.winner < 2 ? TEAM_MAIN[h.winner] : '#ff4d5e';
  $('#endSub').textContent = pvp ? `Final score ${h.team[0]} : ${h.team[1]}` : (h.mode === 'survival' ? `Survived to wave ${h.wave}` : `Reached stage ${h.stage} — ${h.title}`);
  const rows = [...h.players].sort((a, b) => b[4] - a[4]);
  $('#endTable').innerHTML = `<tr><th>#</th><th>Player</th><th>Class</th><th class="num">Kills</th><th class="num">Score</th></tr>` +
    rows.map((p, i) => `<tr><td>${i + 1}</td><td><span class="dot" style="color:${p[2]}"></span>${esc(p[1])}</td><td>${CLASSES[p[7]].name}</td><td class="num">${p[9]}</td><td class="num">${p[4]}</td></tr>`).join('');
  $('#endHost').classList.toggle('hidden', !S.isHost);
  $('#endWait').classList.toggle('hidden', S.isHost);
  setTimeout(() => { if (S.endShown) $('#endMenu').classList.remove('hidden'); }, 1800);
}
$('#btnAgain').onclick = () => startGame();
$('#btnToLobby').onclick = () => {
  if (S.fromEditor) { leaveAll(); return; }
  S.game = null; S.lobby.started = false; S.endShown = false; $('#endMenu').classList.add('hidden'); broadcastLobby(); renderLobby(); show('lobby');
};

// ---------- pause ----------
function togglePause(force) {
  const m = $('#pauseMenu');
  const open = force !== undefined ? force : m.classList.contains('hidden');
  m.classList.toggle('hidden', !open);
  if (!S.online && S.isHost) S.paused = open;
  $('#pauseNote').textContent = S.online ? 'Online game keeps running while this menu is open.' : '';
}
$('#btnPause').onclick = () => togglePause();
$('#btnResume').onclick = () => togglePause(false);
$('#btnQuit').onclick = () => leaveAll();
addEventListener('keydown', e => { if (e.key === 'Escape' && S.screen === 'game' && !S.endShown) togglePause(); });
addEventListener('resize', () => { if (S.screen === 'game') renderer.resize(); resizeBg(); });

// ---------- main render loop ----------
let lastFrame = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - lastFrame) / 1000); lastFrame = t;
  if (S.screen === 'game') {
    let view = null, evs;
    if (S.isHost && S.game) {
      view = S.game.snapshot(false);
      if (S.game.gridRev !== S.renderRev) { view.map = S.game.mapString(); S.renderRev = S.game.gridRev; }
      evs = S.localEv; S.localEv = [];
    } else { view = interpView(); evs = S.clientEv; S.clientEv = []; }
    if (evs.length) { renderer.addEvents(evs); playEvents(evs); }
    if (view) {
      if (view.hud && view.hud.players.length > 1) view.names = Object.fromEntries(view.hud.players.map(p => [p[0], p[1]]));
      renderer.render(view, dt, S.me.id);
      updateHud(view.hud);
    } else renderer.render(null, dt);
  } else if (S.screen !== 'editor') drawBg(dt);
  requestAnimationFrame(frame);
}

// ---------- animated menu background ----------
const bg = $('#bg'), bgc = bg.getContext('2d');
let bgT = 0; const bgDots = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() }));
function resizeBg() { const d = Math.min(devicePixelRatio || 1, 2); bg.width = innerWidth * d; bg.height = innerHeight * d; }
resizeBg();
function drawBg(dt) {
  bgT += dt;
  const w = bg.width, h = bg.height, g = bgc;
  g.fillStyle = '#05070e'; g.fillRect(0, 0, w, h);
  const hz = h * 0.58;
  const gr = g.createLinearGradient(0, hz - h * 0.3, 0, hz);
  gr.addColorStop(0, 'rgba(255,80,200,0)'); gr.addColorStop(1, 'rgba(255,80,200,0.18)');
  g.fillStyle = gr; g.fillRect(0, hz - h * 0.3, w, h * 0.3);
  g.strokeStyle = 'rgba(61,160,255,0.35)'; g.lineWidth = 1.5;
  for (let i = -20; i <= 20; i++) { g.beginPath(); g.moveTo(w / 2 + i * w * 0.02, hz); g.lineTo(w / 2 + i * w * 0.18, h); g.stroke(); }
  for (let i = 0; i < 14; i++) { const k = ((i + (bgT * 0.6) % 1) / 14); const y = hz + (h - hz) * k * k; g.globalAlpha = k; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.globalAlpha = 1;
  for (const d of bgDots) { d.y -= dt * 0.01 * (0.3 + d.z); if (d.y < 0) d.y = 1; g.fillStyle = `rgba(160,200,255,${0.2 + d.z * 0.5})`; g.fillRect(d.x * w, d.y * hz, 1.5 + d.z * 2, 1.5 + d.z * 2); }
}
requestAnimationFrame(frame);

// ---------- community maps ----------
async function openMaps() {
  const modal = $('#mapsModal'); modal.classList.remove('hidden');
  const list = $('#mapsList'); list.innerHTML = '<div class="muted">Loading…</div>';
  try {
    const rows = await listLevels(60);
    if (!rows.length) { list.innerHTML = '<div class="muted">No maps yet — build one in the Level Editor and share it!</div>'; return; }
    list.innerHTML = '';
    for (const r of rows) {
      const card = document.createElement('div'); card.className = 'map-card';
      card.appendChild(mapPreview(r.data, 5));
      const lay = decodeMap(r.data).layout === 'A' ? 'Arena' : 'Co-op';
      card.insertAdjacentHTML('beforeend', `<div class="n">${esc(r.name)}</div><div class="a">${lay} · by ${esc(r.author || 'anonymous')}</div><div class="b"><button class="btn primary" data-a="use">Use</button><button class="btn ghost" data-a="edit">Edit copy</button><button class="btn ghost" data-a="link">Link</button></div>`);
      card.querySelector('[data-a=use]').onclick = () => { useMap(r); modal.classList.add('hidden'); };
      card.querySelector('[data-a=edit]').onclick = () => { modal.classList.add('hidden'); editor.load(r.data); if (S.screen !== 'lobby') show('editor'); };
      card.querySelector('[data-a=link]').onclick = () => copy(`${location.origin}${location.pathname}?level=${r.id}`, 'Map link copied');
      list.appendChild(card);
    }
  } catch (e) { list.innerHTML = `<div class="muted">Could not load maps: ${esc(e.message || e)}</div>`; }
}
function useMap(r) {
  const m = { id: r.id, name: r.name, data: r.data };
  if (S.screen === 'lobby' && S.isHost) {
    S.lobby.map = m;
    const L = decodeMap(r.data).layout; if (MODES[S.lobby.mode].layout !== L) S.lobby.mode = L === 'A' ? 'battle' : 'classic';
    renderLobby(); broadcastLobby();
  } else setPendingMap(m);
  toast(`Map selected: ${r.name}`);
}
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.overlay').classList.add('hidden'));

// ---------- editor ----------
let editorData = null;
const editor = new Editor($('#editor'), {
  onBack: () => show('menu'),
  onTest: data => {
    requireName();
    const lay = decodeMap(data).layout;
    S.isHost = true; S.online = false; S.fromEditor = true;
    S.lobby = { mode: lay === 'A' ? 'battle' : 'classic', map: { name: 'Editor test', data }, bots: true, started: false, players: [] };
    startGame();
  },
  onSave: (data, valid) => {
    if (!valid) { toast('Map blocked: every spawn must be able to reach the core (steel/water are impassable)', 4000); return; }
    editorData = data;
    $('#saveResult').classList.add('hidden'); $('#saveGo').disabled = false;
    $('#saveModal').classList.remove('hidden'); $('#saveName').focus();
  },
});
$('#saveGo').onclick = async () => {
  const name = $('#saveName').value.trim() || 'Untitled fortress';
  requireName();
  $('#saveGo').disabled = true;
  try {
    const id = await saveLevel({ name: name.slice(0, 40), author: S.me.name.slice(0, 24), data: editorData });
    const url = `${location.origin}${location.pathname}?level=${id}`;
    const r = $('#saveResult'); r.classList.remove('hidden');
    r.innerHTML = `Published! Share this link:<br><b>${esc(url)}</b><br><button class="btn small" id="saveCopy" style="margin-top:8px">Copy link</button>`;
    $('#saveCopy').onclick = () => copy(url, 'Map link copied');
    setPendingMap({ id, name, data: editorData });
  } catch (e) { toast('Save failed: ' + (e.message || e)); $('#saveGo').disabled = false; }
};

// ---------- boot ----------
refreshPickers();
const params = new URLSearchParams(location.search);
if (params.get('level')) {
  loadLevel(params.get('level')).then(l => { setPendingMap(l); toast(`Map loaded: ${l.name}`); }).catch(() => toast('Shared map not found'));
}
if (params.get('room')) {
  const code = params.get('room').toUpperCase();
  $('#joinCode').value = code;
  if (S.me.name) toast(`Invite for room ${code} — press Join to enter`, 4000);
  else { toast('Enter your callsign, pick a class and press Join', 4000); $('#nameInput').focus(); }
}
addEventListener('pointerdown', () => initAudio(), { once: true });
window.__nt = S; // debug handle
