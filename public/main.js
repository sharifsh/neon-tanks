// App glue: screens, lobby, host/client loops, HUD, host migration, spectators, local P2
import { W as MAP_W, H as MAP_H, SIZE_NAMES, sizeKey, TICK, CLASSES, CLASS_KEYS, MODES, PLAYER_COLORS, TEAM_MAIN, MAX_PLAYERS, DIFFICULTIES } from './const.js';
import { Game } from './game.js';
import { Renderer, tankIcon, setGlobalTheme, getTheme } from './render.js';
import { THEMES, THEME_ORDER } from './themes.js';
import { Input, ACTIONS, ACTION_LABELS, keyLabel } from './input.js';
import { Net, makeRoomCode, saveLevel, loadLevel, listLevels } from './net.js';
import { Editor, mapPreview } from './editor.js';
import { decodeMap, generateMap, mapLayout, mapDims } from './levels.js';
import { builtinMaps } from './maps.js';
import { initAudio, playEvents, startMusic, setVolume, sfx, setAudioTheme, setEngine, audioDebug } from './audio.js';
import { Full, FREE, SITE_URL, APP_STORE_URL, PLAY_STORE_URL, modeFree, diffFree, themeFree, classFree, mapFree } from './store.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/gi, '').slice(0, 12);
const P2 = id => id + ':2';

const savedTheme = THEMES[store.get('nt_theme', 'neon')] ? store.get('nt_theme', 'neon') : 'neon';
let activeTheme = savedTheme;
function curTheme() { return activeTheme; }
const myTheme = () => (THEMES[store.get('nt_theme', 'neon')] ? store.get('nt_theme', 'neon') : 'neon');
const S = {
  me: { id: uid(), name: store.get('nt_name', ''), cls: store.get('nt_cls', 'striker') },
  p2: { on: false, name: store.get('nt_p2name', ''), cls: store.get('nt_p2cls', 'scout') },
  role: 'player',
  screen: 'menu', net: null, isHost: false, online: false, code: '',
  lobby: newLobby(),
  game: null, paused: false, peers: new Map(),
  snaps: [], mapStr: '', clientEv: [], localEv: [], clockOff: null, rtt: 0,
  pendingMap: null, fromEditor: false, endShown: false, checkpoint: null, migrating: false,
};
const LAYOUT_MODE = { C: 'classic', A: 'battle', D: 'deathmatch', U: 'duel' };
// a new game starts from the player's last choices (mode, map size, conditions, bots, difficulty)
function pick(v, ok, d) { return ok.includes(v) ? v : d; }
function newLobby() {
  return {
    theme: curTheme(), mode: pick(store.get('nt_mode', 'classic'), Object.keys(MODES), 'classic'), map: null,
    size: pick(store.get('nt_size', 'auto'), ['auto', 'S', 'M', 'L'], 'auto'), atmo: pick(store.get('nt_atmo', 'default'), ['default', 'clear', 'night', 'fog'], 'default'),
    zone: store.get('nt_zone', '0') === '1', bots: store.get('nt_bots', '1') === '1', difficulty: pick(store.get('nt_diff', 'easy'), Object.keys(DIFFICULTIES), 'easy'),
    started: false, players: [], spectators: [], order: [],
  };
}
if (!CLASSES[S.me.cls]) S.me.cls = 'striker';
if (!CLASSES[S.p2.cls]) S.p2.cls = 'scout';
const localIds = () => new Set([S.me.id, P2(S.me.id)]);

// in an online room as a guest, the host's style is used for everyone
const styleLocked = () => !!(S.net && !S.isHost);
setGlobalTheme(savedTheme);
const renderer = new Renderer($('#view'));
const input = new Input();
const isTouch = matchMedia('(hover: none)').matches || 'ontouchstart' in window;
if (isTouch) { $('#touch').classList.remove('hidden'); input.bindTouch($('#touch')); }

// ---------- phone layout ----------
// Phones (short side up to 520 CSS px): slim HUD over the map and a zoomed view that follows your tank.
// The map's edges stay clear of the notch, the home indicator and the HUD. In portrait (website only)
// the controls sit on a deck below the map.
const ZOOM_ORDER = ['close', 'near', 'fit'];
const ZOOM_NAMES = { close: 'Close view', near: 'Closer view', fit: 'Whole map' };
let zoom = ZOOM_ORDER.includes(store.get('nt_zoom', 'close')) ? store.get('nt_zoom', 'close') : 'close';
renderer.setZoom(zoom);
const safeProbe = document.createElement('div');
safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.appendChild(safeProbe);
function safeArea() { const c = getComputedStyle(safeProbe), n = v => parseFloat(v) || 0; return { t: n(c.paddingTop), r: n(c.paddingRight), b: n(c.paddingBottom), l: n(c.paddingLeft) }; }
const isCompact = () => Math.min(innerWidth, innerHeight) <= 520;
// body.compact = phone (any screen), body.portrait = phone held upright. Menus and the game both use them.
function applyDeviceClasses() {
  const compact = isCompact(), portrait = compact && innerHeight > innerWidth;
  document.body.classList.toggle('compact', compact);
  document.body.classList.toggle('portrait', portrait);
  return { compact, portrait };
}
applyDeviceClasses();
// Touch-only devices hide keyboard bindings and keyboard two-player until a keyboard or controller shows up.
if (matchMedia('(hover: none) and (pointer: coarse)').matches) {
  document.body.classList.add('touch-only');
  const hasKeys = () => document.body.classList.remove('touch-only');
  addEventListener('keydown', e => { if (!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.key && e.key.length < 12) hasKeys(); });
  addEventListener('gamepadconnected', hasKeys);
}
function layoutGame() {
  const { compact, portrait } = applyDeviceClasses();
  $('#btnZoom').classList.toggle('hidden', !compact);
  showPeekBtns(compact && zoom !== 'fit');
  if (!compact) endPeek();
  if (!compact) { renderer.setFrame(null); return; }
  const sa = safeArea(), top = Math.max(sa.t, $('#hudTop').getBoundingClientRect().bottom);
  let bottom = sa.b;
  const chips = $('#hudBottom');
  if (chips.childElementCount) bottom = Math.max(bottom, innerHeight - chips.getBoundingClientRect().top + 2);
  if (portrait && isTouch) bottom = Math.max(bottom, innerHeight - $('#touch .tdeck').getBoundingClientRect().top);
  renderer.setFrame({ compact: true, top, bottom, left: sa.l, right: sa.r });
}
function setZoom(z, announce) {
  zoom = z; store.set('nt_zoom', z); renderer.setZoom(z);
  $('#btnZoom').classList.toggle('zout', ZOOM_ORDER[(ZOOM_ORDER.indexOf(z) + 1) % ZOOM_ORDER.length] === 'fit');
  showPeekBtns(isCompact() && z !== 'fit');
  endPeek();
  if (announce) toast(ZOOM_NAMES[z], 1200);
}
$('#btnZoom').onclick = () => setZoom(ZOOM_ORDER[(ZOOM_ORDER.indexOf(zoom) + 1) % ZOOM_ORDER.length], true);
// Map buttons (top right, and the round one just above FIRE): a quick look at the whole map. Tap: the whole
// map for a moment, then back to your tank (tap again to go back sooner). Hold: the whole map until you let go.
// They only show while the view is zoomed in.
const peekBtns = [$('#btnMap'), $('#touch .tpeek')];
function showPeekBtns(on) { for (const b of peekBtns) b.classList.toggle('hidden', !on); }
let peekTimer = 0, peekDown = 0, peekPointer = null;
function setPeek(on) { renderer.peek = on; for (const b of peekBtns) b.classList.toggle('on', on); }
function endPeek() { clearTimeout(peekTimer); peekTimer = 0; peekDown = 0; peekPointer = null; setPeek(false); }
for (const b of peekBtns) {
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (peekDown && e.pointerId !== peekPointer) return; // another finger already holds a map button
    try { b.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: the up event still arrives in most cases */ }
    if (renderer.peek && peekTimer) { endPeek(); return; }
    clearTimeout(peekTimer); peekTimer = 0;
    peekDown = e.timeStamp || performance.now(); peekPointer = e.pointerId; setPeek(true);
  });
  // the button keeps the pointer until it lifts, so letting go over the map or an overlay still counts;
  // tap or hold is judged by when the finger actually went down and up, not by when a busy frame got to it
  const up = e => {
    if (!peekDown || e.pointerId !== peekPointer) return;
    const held = (e.timeStamp || performance.now()) - peekDown; peekDown = 0; peekPointer = null;
    if (held > 400) endPeek(); else peekTimer = setTimeout(endPeek, 2500);
  };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
}
peekBtns[1].addEventListener('touchstart', e => e.preventDefault(), { passive: false }); // no long-press loupe while held
setZoom(zoom);
// Phone browsers (not the app): go full screen on the first touch in a game so the address and navigation
// bars don't take space. Works in Chrome on Android; Safari on iPhone has no full screen for web pages.
let fsAsked = false;
$('#game').addEventListener('touchend', () => {
  if (fsAsked || Full.native || !isCompact()) return;
  fsAsked = true;
  const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
  try { const r = req.call(el, { navigationUI: 'hide' }); if (r && r.catch) r.catch(() => {}); } catch (e) {}
}, { passive: true });
// Slower phones: if most frames run long for a few seconds, draw at a lower resolution (not below 1.5x).
const perf = { n: 0, slow: 0 };
function watchPerf(dt) {
  if (document.hidden || S.paused || window.__noAdapt || renderer.dprCap <= 1.5 || (devicePixelRatio || 1) <= 1.5) return;
  perf.n++; if (dt > 0.024) perf.slow++;
  if (perf.n < 240) return;
  if (perf.slow > 150) { renderer.setDprCap(Math.max(1.5, Math.min(devicePixelRatio, renderer.dprCap) - 0.75)); console.info('Neon Tanks: render scale lowered to', renderer.dprCap); }
  perf.n = perf.slow = 0;
}

// ---------- toast ----------
let toastT = 0;
// links shared from the app must point at the website, not the app's local origin
const shareBase = () => (Full.native || !/^https?:$/.test(location.protocol) ? SITE_URL + '/' : location.origin + location.pathname);
// ---------- free / full ----------
// In an online room the host's copy decides what the room can use.
const roomFull = () => (S.net && !S.isHost ? !!(S.lobby && S.lobby.full) : Full.owned);
const canClass = c => classFree(c) || Full.owned || roomFull();
const canTheme = t => themeFree(t) || Full.owned;
// player slots in an online room: 3 when the host has the free version, 8 with the full version
const roomCap = () => (roomFull() ? MAX_PLAYERS : FREE.players);
const capMsg = () => S.isHost ? `Free rooms hold ${FREE.players} players. With the full version up to ${MAX_PLAYERS} can play in your room.` : `This room was made with the free version, so it holds ${FREE.players} players. Rooms hosted with the full version hold ${MAX_PLAYERS}.`;
const lock = '<span class="lock" title="Full version">🔒</span>';
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

// ---------- screens ----------
function show(name) {
  S.screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === name));
  input.enabled = name === 'game';
  $('#bg').style.display = name === 'game' || name === 'editor' ? 'none' : 'block';
  if (name === 'game') { S.chipKey = ''; fsAsked = false; endPeek(); renderer.resetCamera(); layoutGame(); renderer.resize(); } else { if (input.releaseTouch) input.releaseTouch(); endPeek(); }
  if (name === 'editor') editor.show();
}

// ---------- class pickers ----------
function renderClassPicker(el, compact, who = 'me') {
  el.innerHTML = '';
  const cur = who === 'p2' ? S.p2.cls : S.me.cls;
  CLASS_KEYS.forEach((k, i) => {
    const c = CLASSES[k];
    const ok = canClass(k);
    const d = document.createElement('div'); d.className = 'cls' + (cur === k ? ' sel' : '') + (ok ? '' : ' locked-full');
    d.appendChild(tankIcon('p' + k, PLAYER_COLORS[[0, 1, 2, 4][i]], 108));
    const bar = (label, v) => `<span class="st"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></span>`;
    d.insertAdjacentHTML('beforeend', `<div class="n">${ok ? '' : lock}${c.name}</div>${compact ? '' : `<div class="stats">${bar('Speed', c.speed / 6.6)}${bar('Armor', c.hp / 3)}</div><div class="d">${c.desc}</div>`}`);
    d.dataset.cls = k;
    d.onclick = () => {
      sfx('click');
      if (!ok) { openFull(`The ${c.name} is part of the full version.`); return; }
      if (who === 'p2') { S.p2.cls = k; store.set('nt_p2cls', k); }
      else { S.me.cls = k; store.set('nt_cls', k); }
      refreshPickers(); onClassChange();
    };
    el.appendChild(d);
  });
}
function refreshPickers() {
  renderClassPicker($('#classPicker'), false); renderClassPicker($('#classPicker2'), true); renderClassPicker($('#classPickerP2'), true, 'p2');
}
function onClassChange() {
  if (S.screen === 'setup') renderSetup();
  if (S.isHost) {
    if (S.game) { S.game.setClass(S.me.id, S.me.cls); S.game.setClass(P2(S.me.id), S.p2.cls); }
    renderLobby(); broadcastLobby();
  } else if (S.net) S.net.sendToHost({ y: 'cls', cls: S.me.cls, p2: S.p2.on ? { name: p2Name(), cls: S.p2.cls } : null }, true);
}
const p2Name = () => (S.p2.name || (S.me.name ? S.me.name + ' 2' : 'Player 2')).slice(0, 16);

// ---------- menu ----------
$('#nameInput').value = S.me.name;
$('#nameInput').addEventListener('input', e => { S.me.name = e.target.value.trim().slice(0, 16); store.set('nt_name', S.me.name); });
function requireName() {
  if (!S.me.name) { S.me.name = 'Tanker' + Math.floor(100 + Math.random() * 900); $('#nameInput').value = S.me.name; store.set('nt_name', S.me.name); }
  initAudio(); startMusic();
}
$('#btnSolo').onclick = () => openSetup('solo');
$('#btnCreate').onclick = () => openSetup('room');
$('#btnSettings').onclick = () => { renderStick(); $('#settingsModal').classList.remove('hidden'); };
$('#btnHelp').onclick = () => { renderStick(); $('#helpModal').classList.remove('hidden'); };
$('#btnJoin').onclick = () => joinRoom($('#joinCode').value.trim().toUpperCase());
$('#joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#btnEditor').onclick = () => { initAudio(); show('editor'); };
$('#btnMaps').onclick = () => openMaps();
$('#volMusic').value = store.get('nt_music', '0.22'); $('#volSfx').value = store.get('nt_sfx', '0.5');
setVolume('music', +$('#volMusic').value); setVolume('sfx', +$('#volSfx').value);
$('#volMusic').oninput = e => { setVolume('music', +e.target.value); store.set('nt_music', e.target.value); };
$('#volSfx').oninput = e => { setVolume('sfx', +e.target.value); store.set('nt_sfx', e.target.value); };

// ---------- joystick: fixed at the bottom left (default) or following the thumb ----------
const STICK_NOTE = { fixed: 'The joystick stays at the bottom left. Put your thumb on it to steer.', float: 'The joystick appears wherever your thumb touches the left side, and follows it.' };
const STICK_HELP = { fixed: 'slide your thumb on the joystick at the bottom left', float: 'put your left thumb down anywhere on the left side and slide it' };
input.stickMode = store.get('nt_stick', 'fixed') === 'float' ? 'float' : 'fixed';
function renderStick() {
  document.querySelectorAll('.stick-seg button').forEach(b => { const on = b.dataset.stick === input.stickMode; b.classList.toggle('sel', on); b.setAttribute('aria-checked', String(on)); });
  document.querySelectorAll('.stick-note').forEach(n => { n.textContent = STICK_NOTE[input.stickMode]; });
  document.querySelectorAll('.help-stick').forEach(n => { n.textContent = STICK_HELP[input.stickMode]; });
  document.body.classList.toggle('stick-fixed', input.stickMode === 'fixed');
}
document.querySelectorAll('.stick-seg button').forEach(b => {
  b.onclick = () => { sfx('click'); input.stickMode = b.dataset.stick === 'float' ? 'float' : 'fixed'; store.set('nt_stick', input.stickMode); if (input.releaseTouch) input.releaseTouch(); renderStick(); };
});
renderStick();

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
  const why = lobbyBlocker();
  if (why) { openFull(why); return; }
  const code = makeRoomCode();
  const btn = $('#setupNext'); btn.disabled = true; btn.textContent = 'Opening room…';
  try {
    S.isHost = true; S.online = true; S.code = code; S.role = 'player';
    S.net = new Net({ code, me: S.me, isHost: true, on: hostHandlers });
    await S.net.connect();
    history.replaceState(null, '', '?room=' + code);
    enterLobby();
  } catch (e) { toast(e.message || 'Could not create room'); S.net = null; S.online = false; }
  btn.disabled = false; renderSetup();
}

async function joinRoom(code) {
  if (!/^[A-Z0-9]{5}$/.test(code)) { toast('Enter the 5-character room code'); return; }
  requireName();
  const btn = $('#btnJoin'); btn.disabled = true; btn.textContent = '…';
  try {
    S.isHost = false; S.online = true; S.code = code; S.role = 'player';
    S.lobby = newLobby();
    S.net = new Net({ code, me: S.me, isHost: false, on: clientHandlers });
    await S.net.connect();
    history.replaceState(null, '', '?room=' + code);
    enterLobby();
  } catch (e) { toast(e.message || 'Could not join'); S.net = null; }
  btn.disabled = false; btn.textContent = 'Join';
}

function leaveAll(msg) {
  if (S.net) S.net.close();
  S.net = null; S.game = null; S.online = false; S.isHost = false; S.paused = false; S.endShown = false; S.role = 'player';
  S.peers.clear(); S.snaps = []; S.mapStr = ''; S.clockOff = null; S.checkpoint = null; S.migrating = false;
  if (curTheme() !== myTheme()) applyTheme(myTheme(), false);
  S.lobby = newLobby();
  enforceOwnership();
  $('#pauseMenu').classList.add('hidden'); $('#endMenu').classList.add('hidden');
  history.replaceState(null, '', location.pathname);
  if (msg) toast(msg, 3500);
  if (S.fromEditor) { S.fromEditor = false; show('editor'); } else show('menu');
}

// ---------- local player 2 ----------
function setP2(on) {
  if (on) {
    if (S.role === 'spectator') { toast('Spectators cannot add a second player'); return; }
    if (S.isHost && playerCount() >= roomCap()) { toast(S.online && !roomFull() ? `No free slot for Player 2 — free rooms hold ${FREE.players} players` : 'No free slot for Player 2'); return; }
  }
  S.p2.on = on; input.setP2(on);
  if (S.isHost) {
    if (S.game) { if (on) S.game.addPlayer({ id: P2(S.me.id), name: p2Name(), cls: S.p2.cls }); else S.game.removePlayer(P2(S.me.id)); }
    broadcastLobby();
  } else if (S.net) S.net.sendToHost({ y: 'p2', on, name: p2Name(), cls: S.p2.cls }, true);
  renderLobby(); if (S.screen === 'setup') renderSetup();
}
$('#btnAddP2').onclick = () => setP2(true);
$('#btnRemoveP2').onclick = () => setP2(false);
$('#p2Name').addEventListener('input', e => {
  S.p2.name = e.target.value.trim().slice(0, 16); store.set('nt_p2name', S.p2.name);
  if (S.p2.on) { if (S.isHost) { const p = S.game && S.game.players.get(P2(S.me.id)); if (p) p.name = p2Name(); broadcastLobby(); renderLobby(); } else if (S.net) S.net.sendToHost({ y: 'p2', on: true, name: p2Name(), cls: S.p2.cls }, true); }
});
function keysSummary(i) { const b = input.binds[i]; return `${['up', 'left', 'down', 'right'].map(a => keyLabel(b[a][0])).join(' ')} move · ${keyLabel(b.fire[0])} fire · ${keyLabel(b.ability[0])} ability`; }

// ---------- controls modal ----------
function openControls() { renderControls(); $('#controlsModal').classList.remove('hidden'); }
function renderControls() {
  const g = $('#ctrlGrid'); g.innerHTML = '<div></div><div class="h">PLAYER 1</div><div class="h">PLAYER 2</div>';
  for (const a of ACTIONS) {
    g.insertAdjacentHTML('beforeend', `<div class="a">${ACTION_LABELS[a]}</div>`);
    for (let pl = 0; pl < 2; pl++) {
      const cell = document.createElement('div'); cell.className = 'keys';
      for (let slot = 0; slot < 2; slot++) {
        const code = input.binds[pl][a][slot];
        const b = document.createElement('button'); b.className = 'keybtn' + (code ? '' : ' empty'); b.textContent = keyLabel(code);
        b.onclick = () => {
          document.querySelectorAll('.keybtn.wait').forEach(x => x.classList.remove('wait'));
          b.classList.add('wait'); b.textContent = 'Press a key…';
          input.capture = key => {
            input.capture = null;
            if (key === 'Escape') { renderControls(); return; }
            if (key === 'Backspace' || key === 'Delete') input.setBind(pl, a, slot, '');
            else if (!input.setBind(pl, a, slot, key)) toast('That key is reserved');
            renderControls(); renderLobbyKeys();
          };
        };
        cell.appendChild(b);
      }
      g.appendChild(cell);
    }
  }
}
$('#ctrlReset').onclick = () => { input.resetBinds(); renderControls(); renderLobbyKeys(); toast('Controls reset'); };
for (const id of ['#btnControls', '#btnControls2', '#btnControls3']) $(id).onclick = openControls;
function renderLobbyKeys() { $('#p2Keys').textContent = `P1: ${keysSummary(0)}  |  P2: ${keysSummary(1)}`; }

// ---------- lobby ----------
function enterLobby() {
  if (S.isHost) { S.lobby.theme = curTheme(); enforceLobby(); }
  wiz.edit = false;
  $('#p2Name').value = S.p2.name;
  placeP2('room'); refreshPickers(); renderLobby(); show('lobby');
}

function playerCount() { return lobbyPlayers().length; }
function lobbyPlayers() {
  if (!S.isHost) return S.lobby.players || [];
  const list = [];
  if (S.role !== 'spectator') {
    list.push({ id: S.me.id, name: S.me.name, cls: S.me.cls, net: 'host' });
    if (S.p2.on) list.push({ id: P2(S.me.id), name: p2Name(), cls: S.p2.cls, net: 'local' });
  }
  if (S.net) for (const p of S.net.peers.values()) {
    const hp = S.peers.get(p.id); if (!hp || hp.role !== 'player') continue;
    list.push({ id: p.id, name: p.name, cls: p.cls, net: p.mode });
    if (hp.p2) list.push({ id: P2(p.id), name: hp.p2.name, cls: hp.p2.cls, net: 'local' });
  }
  return list;
}
function lobbySpectators() {
  if (!S.isHost) return S.lobby.spectators || [];
  const list = S.role === 'spectator' ? [{ id: S.me.id, name: S.me.name }] : [];
  if (S.net) for (const p of S.net.peers.values()) { const hp = S.peers.get(p.id); if (hp && hp.role === 'spectator') list.push({ id: p.id, name: p.name }); }
  return list;
}
function lobbyState() {
  return {
    full: Full.owned, theme: curTheme(), mode: S.lobby.mode, map: S.lobby.map, size: S.lobby.size, atmo: S.lobby.atmo, zone: S.lobby.zone, bots: S.lobby.bots, difficulty: S.lobby.difficulty, started: S.lobby.started,
    players: lobbyPlayers(), spectators: lobbySpectators(), order: S.net ? [...S.net.peers.keys()] : [], hostId: S.me.id,
  };
}
function broadcastLobby() {
  if (!S.isHost || !S.net) return;
  const l = lobbyState();
  for (const id of S.net.peers.keys()) S.net.sendTo(id, { y: 'lobby', l }, true);
}
setInterval(() => { if (S.isHost && S.net) broadcastLobby(); }, 3000);

function renderLobby() {
  const L = S.isHost ? { ...S.lobby } : S.lobby;
  const players = lobbyPlayers(), specs = lobbySpectators();
  $('#roomLabel').textContent = S.online ? 'ROOM CODE' : 'OFFLINE';
  $('#roomCode').textContent = S.online ? S.code : 'SOLO';
  $('#btnCopyLink').classList.toggle('hidden', !S.online);
  const cap = S.online ? roomCap() : MAX_PLAYERS;
  $('#playerCount').textContent = `${players.length}/${cap}`;
  const slots = $('#slots'); slots.innerHTML = '';
  const pvp = MODES[L.mode].pvp && !MODES[L.mode].ffa;
  // Online rooms list every spot from the start, so the empty ones fill in as people join.
  // Free rooms add one locked row for the full version's bigger rooms.
  const spots = S.online ? Math.max(cap, players.length) : players.length;
  slots.classList.toggle('many', spots > 4); // phones: two columns for 8-player rooms
  for (let i = 0; i < spots; i++) {
    const p = players[i];
    const d = document.createElement('div');
    const color = pvp ? TEAM_MAIN[i % 2] : PLAYER_COLORS[i % 8];
    if (!p) { d.className = 'slot empty open'; d.innerHTML = `<span class="dot hollow" style="color:${color}"></span><span class="nm">Open spot</span>`; slots.appendChild(d); continue; }
    d.className = 'slot';
    const tag = { host: '<span class="net">HOST</span>', rtc: '<span class="net">P2P</span>', relay: '<span class="net relay">RELAY</span>', local: '<span class="net local">SAME PC</span>' }[p.net] || (p.net ? '<span class="net pending">…</span>' : '');
    const mine = localIds().has(p.id);
    d.innerHTML = `<span class="dot" style="color:${color}"></span><span class="nm">${esc(p.name)}${mine ? ' (you)' : ''}</span><span class="tag">${CLASSES[p.cls] ? CLASSES[p.cls].name : ''}</span>${tag}`;
    slots.appendChild(d);
  }
  if (S.online && !roomFull()) {
    const d = document.createElement('div');
    d.className = 'slot empty locked-slot';
    d.innerHTML = `<span class="lock">🔒</span>Up to ${MAX_PLAYERS} players with the full version`;
    d.title = capMsg(); d.onclick = () => openFull(capMsg());
    slots.appendChild(d);
  }
  $('#specList').classList.toggle('hidden', !specs.length);
  $('#specList').innerHTML = `👁 Spectators (${specs.length}): ${specs.map(s => `<b>${esc(s.name)}</b>`).join(', ')}`;
  const spectating = S.role === 'spectator';
  $('#specNote').classList.toggle('hidden', !spectating);
  $('#btnTakeSlot').disabled = players.length >= cap;
  $('#btnTakeSlot').textContent = players.length >= cap ? 'No free slot yet' : 'Join as player';
  $('#specNote span').innerHTML = !roomFull() && players.length >= cap ? `This free room holds ${FREE.players} players — you're <b>spectating</b>.` : `Room is full — you're <b>spectating</b>.`;
  $('#myClassBlock').classList.toggle('hidden', spectating);
  renderP2();
  updateStyleLock();
  renderGameSummary(L);
  $('#btnStart').classList.toggle('hidden', !S.isHost);
  $('#waitHost').classList.toggle('hidden', S.isHost);
  $('#waitHost').textContent = !S.isHost && L.started ? 'Game in progress — joining…' : 'Waiting for the host to start…';
}
// The room's game settings at a glance; the host taps Change to re-open that step of the setup.
function mapLabel(L) {
  if (!L.map) return `Random map${L.size && L.size !== 'auto' ? ' · ' + SIZE_NAMES[L.size] : ''}`;
  return L.map.name + (mapLayout(L.map.data) !== MODES[L.mode].layout ? ' (other layout — random used)' : '');
}
function renderGameSummary(L = S.lobby) {
  const m = MODES[L.mode] || MODES.classic, df = DIFFICULTIES[L.difficulty] || DIFFICULTIES.easy, th = THEMES[L.theme] || THEMES[curTheme()];
  const extras = [m.pvp && L.mode !== 'duel' && L.bots ? 'AI bots on' : '', L.mode === 'deathmatch' && L.zone ? 'shrinking zone' : '', L.atmo && L.atmo !== 'default' ? { clear: 'clear day', night: 'night', fog: 'fog' }[L.atmo] : ''].filter(Boolean);
  const rows = [['mode', 'Mode', m.name, m.desc], ['battle', 'Map', mapLabel(L), extras.join(' · ')], ['battle', 'Difficulty', df.name, df.desc], ['style', 'Style', th.name, S.isHost ? 'applies to everyone' : 'set by the host']];
  const box = $('#gameSummary');
  box.innerHTML = rows.map(([step, k, v, sub]) => `<div class="gs-row"><span class="k">${k}</span><span class="v">${esc(v)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>${S.isHost ? `<button class="btn small ghost" data-step="${step}">Change</button>` : ''}</div>`).join('');
  box.querySelectorAll('button').forEach(b => b.onclick = () => { sfx('click'); editSetup(b.dataset.step); });
}
$('#btnLeaveLobby').onclick = () => leaveAll();
$('#btnCopyLink').onclick = () => copy(`${shareBase()}?room=${S.code}`, 'Invite link copied — send it to your friends!');
$('#sizeSel').onchange = e => { S.lobby.size = e.target.value; store.set('nt_size', e.target.value); renderSetup(); broadcastLobby(); };
$('#atmoSel').onchange = e => { S.lobby.atmo = e.target.value; store.set('nt_atmo', e.target.value); renderSetup(); broadcastLobby(); };
$('#zoneToggle').onchange = e => { S.lobby.zone = e.target.checked; store.set('nt_zone', e.target.checked ? '1' : '0'); renderSetup(); broadcastLobby(); };
$('#botsToggle').onchange = e => { S.lobby.bots = e.target.checked; store.set('nt_bots', e.target.checked ? '1' : '0'); renderSetup(); broadcastLobby(); };
$('#btnStart').onclick = () => startGame();
$('#btnTakeSlot').onclick = requestPlay;
$('#btnJoinPlay').onclick = requestPlay;
function requestPlay() {
  if (S.isHost) {
    if (playerCount() >= roomCap()) { toast('No free slot'); return; }
    S.role = 'player'; if (S.game) S.game.addPlayer({ id: S.me.id, name: S.me.name, cls: S.me.cls });
    renderLobby(); broadcastLobby();
  } else if (S.net) S.net.sendToHost({ y: 'play' }, true);
}

function copy(text, msg) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg), () => { prompt('Copy this link:', text); });
}

// ---------- new game, step by step ----------
// Play Solo and Create Online Room walk through four short steps: mode → style → tank → map & difficulty.
// Every step starts on the player's last choice, so a returning player can just tap Next. In a room,
// the host re-opens one step from the room's summary to change it (Done goes back to the room).
const STEPS = ['mode', 'style', 'tank', 'battle'];
const STEP_TITLE = { mode: 'Choose a mode', style: 'Pick a visual style', tank: 'Choose your tank', battle: 'Map & difficulty' };
const STEP_NEXT = { style: 'Next: style', tank: 'Next: tank', battle: 'Next: map' };
const wiz = { purpose: 'solo', step: 0, edit: false };
function openSetup(purpose) {
  if (S.net) return;
  requireName();
  wiz.purpose = purpose; wiz.step = 0; wiz.edit = false;
  S.isHost = true; S.online = false; S.code = ''; S.role = 'player'; S.game = null;
  S.lobby = newLobby();
  if (S.pendingMap) applyMapChoice(S.pendingMap);
  enforceLobby();
  $('#p2Name').value = S.p2.name;
  placeP2('setup'); renderSetup(); show('setup');
}
function editSetup(step) { wiz.edit = true; wiz.step = Math.max(0, STEPS.indexOf(step)); placeP2('setup'); renderSetup(); show('setup'); }
function leaveSetupEdit() { wiz.edit = false; placeP2('room'); renderLobby(); show('lobby'); broadcastLobby(); }
function goStep(i) {
  wiz.step = Math.max(0, Math.min(STEPS.length - 1, i));
  renderSetup();
  const body = $('#setup .setup-body'); if (body) body.scrollTop = 0;
  window.scrollTo(0, 0); $('#setup').scrollTop = 0;
}
function setupNext() {
  if ($('#setupNext').disabled) return;
  sfx('click');
  if (wiz.edit) { leaveSetupEdit(); return; }
  if (wiz.step < STEPS.length - 1) { goStep(wiz.step + 1); return; }
  if (wiz.purpose === 'solo') startGame(); else createRoom();
}
function setupBack() {
  sfx('click');
  if (wiz.edit) leaveSetupEdit();
  else if (wiz.step > 0) goStep(wiz.step - 1);
  else show('menu');
}
$('#setupNext').onclick = setupNext;
$('#setupBack').onclick = setupBack;
document.querySelectorAll('#setupSteps li').forEach((li, i) => { li.onclick = () => { sfx('click'); goStep(i); }; });
// While more choices are below (a phone on its side cuts the modes list), the bottom edge fades out,
// so it's clear the list scrolls even when the cut falls exactly between two rows.
const setupBody = $('#setup .setup-body');
function setupFade() { setupBody.classList.toggle('more-below', setupBody.scrollTop + setupBody.clientHeight < setupBody.scrollHeight - 4); }
setupBody.addEventListener('scroll', setupFade, { passive: true });
addEventListener('resize', () => requestAnimationFrame(setupFade));
addEventListener('keydown', e => {
  if (S.screen !== 'setup' || input.capture || document.querySelector('.overlay:not(.hidden)')) return;
  const card = e.target.closest && e.target.closest('.mode, .sty, .cls, .mcard, .diff');
  if ((e.key === 'Enter' || e.key === ' ') && card) { e.preventDefault(); card.click(); }
  else if (e.key === 'Enter' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) { e.preventDefault(); setupNext(); }
  else if (e.key === 'Escape') setupBack();
});
function renderSetup() {
  if (!S.lobby) return;
  const step = STEPS[wiz.step], last = wiz.step === STEPS.length - 1;
  document.querySelectorAll('#setup .setup-step').forEach(el => el.classList.toggle('active', el.dataset.step === step));
  document.querySelectorAll('#setupSteps li').forEach((li, i) => { li.classList.toggle('cur', i === wiz.step); li.classList.toggle('done', i < wiz.step); });
  $('#setup').classList.toggle('editing', wiz.edit);
  $('#setupTitle').textContent = STEP_TITLE[step];
  $('#setupKicker').textContent = wiz.edit ? 'Room settings' : `${wiz.purpose === 'solo' ? 'Solo game' : 'Online room'} · step ${wiz.step + 1} of ${STEPS.length}`;
  $('#setupBack').textContent = wiz.edit ? '← Room' : wiz.step ? '← Back' : '← Menu';
  const next = $('#setupNext');
  if (!next.disabled) next.textContent = wiz.edit ? 'Done' : !last ? STEP_NEXT[STEPS[wiz.step + 1]] : wiz.purpose === 'solo' ? 'Start mission' : 'Open room';
  next.classList.toggle('go', last && !wiz.edit);
  if (step === 'mode') renderModes();
  else if (step === 'style') renderStyles();
  else if (step === 'tank') { refreshPickers(); renderP2(); }
  else renderBattle();
  const L = S.lobby, df = DIFFICULTIES[L.difficulty];
  $('#setupSummary').innerHTML = [MODES[L.mode].name, THEMES[curTheme()].name, CLASSES[S.me.cls].name, mapLabel(L), df ? df.name : ''].map((t, i) => `<span class="${i === wiz.step || (wiz.step === 3 && i === 4) ? 'cur' : ''}">${esc(t)}</span>`).join('');
  requestAnimationFrame(setupFade); // after the screen is shown and laid out
}

// step 1: mode
const ICON = (d, extra = '') => `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;
const MODE_ICON = {
  classic: ICON('<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>'),
  survival: ICON('<path d="M3 8c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0 3.6-1.6 5 0"/><path d="M3 13c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0 3.6-1.6 5 0"/><path d="M3 18c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0 3.6-1.6 5 0"/>'),
  battle: ICON('<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/><path d="M9.5 6.5 13 3h3v3l-3.5 3.5"/><path d="m5 14 4 4M7 17l-3 3M3 19l2 2"/>'),
  ctf: ICON('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  deathmatch: ICON('<path d="m12 2 2.2 5.6L20 6l-3.4 5L22 13l-5.6 1.4L18 20l-5-3.2L8 21l.6-5.8L3 13l5.2-2.2L5 5.5l5.6 2.2z"/>'),
  duel: ICON('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
};
const MODE_WHO = { classic: 'Co-op · 1–8 players', survival: 'Co-op · 1–8 players', battle: 'Two teams · bots fill in', ctf: 'Two teams · bots fill in', deathmatch: 'Free for all · bots join in', duel: '1 vs 1 · best of 5 rounds' };
function renderModes() {
  const box = $('#modePicker'); box.innerHTML = '';
  for (const [label, keys] of [['Co-op — defend the core together', ['classic', 'survival']], ['Versus — tank against tank', ['battle', 'ctf', 'deathmatch', 'duel']]]) {
    box.insertAdjacentHTML('beforeend', `<div class="mode-group">${label}</div>`);
    for (const k of keys) {
      const m = MODES[k], ok = modeFree(k) || roomFull();
      const d = document.createElement('div');
      d.className = 'mode' + (S.lobby.mode === k ? ' sel' : '') + (ok ? '' : ' locked-full'); d.dataset.mode = k; d.tabIndex = 0;
      d.innerHTML = `<span class="mi">${MODE_ICON[k]}</span><span class="mt"><span class="n">${ok ? '' : lock}${m.name}</span><span class="w">${MODE_WHO[k]}</span><span class="d">${m.desc}</span></span>`;
      d.onclick = () => { sfx('click'); if (!ok) { openFull(`${m.name} is part of the full version.`); return; } setMode(k); };
      d.ondblclick = () => { if (ok && !wiz.edit) setupNext(); };
      box.appendChild(d);
    }
  }
}
function setMode(k) {
  S.lobby.mode = k; store.set('nt_mode', k);
  if (S.lobby.map && mapLayout(S.lobby.map.data) !== MODES[k].layout) S.lobby.map = null; // that map is for another kind of game
  if (!MODES[k].pvp) S.lobby.zone = false;
  renderSetup(); broadcastLobby();
}

// step 2: visual style (cards built once at start-up, below)
function renderStyles() {
  const locked = styleLocked();
  document.querySelectorAll('#stylePicker .sty').forEach(el => {
    el.classList.toggle('sel', el.dataset.id === curTheme());
    el.classList.toggle('locked-full', !canTheme(el.dataset.id));
    const l = el.querySelector('.sty-lock'); if (l) l.classList.toggle('hidden', canTheme(el.dataset.id) || locked);
  });
}

// step 4: map & difficulty
const SHUFFLE = ICON('<path d="M3 7h3.5c2 0 3 1 4.2 2.7l2.6 4.6C14.5 16 15.5 17 17.5 17H21"/><path d="M3 17h3.5c1.3 0 2.2-.5 3-1.4M14.5 8.4c.8-.9 1.7-1.4 3-1.4H21"/><path d="m18 4 3 3-3 3M18 14l3 3-3 3"/>');
function applyMapChoice(m) {
  S.lobby.map = m;
  const lay = mapLayout(m.data);
  if (MODES[S.lobby.mode].layout !== lay) S.lobby.mode = LAYOUT_MODE[lay];
  if (lay === 'D') S.lobby.zone = !!m.zone;
}
function renderBattle() {
  const L = S.lobby, lay = MODES[L.mode].layout;
  const strip = $('#mapStrip'); strip.innerHTML = '';
  const cards = [{ random: true }, ...(L.map && !String(L.map.id || '').startsWith('b:') ? [L.map] : []), ...builtinMaps().filter(m => m.layout === lay)];
  for (const r of cards) {
    const ok = r.random || !r.builtin || mapFree(r) || Full.owned;
    const sel = r.random ? !L.map : !!(L.map && (L.map.id ? L.map.id === r.id : L.map.data === r.data));
    const d = document.createElement('div'); d.className = 'mcard' + (sel ? ' sel' : '') + (ok ? '' : ' locked-full') + (r.random ? ' random' : ''); d.tabIndex = 0;
    if (r.random) d.innerHTML = `<div class="mthumb">${SHUFFLE}</div><div class="n">Random</div><div class="d">New map every ${L.mode === 'classic' ? 'stage' : 'game'}</div>`;
    else {
      const th = document.createElement('div'); th.className = 'mthumb'; th.appendChild(mapPreview(r.data, 3)); d.appendChild(th);
      d.insertAdjacentHTML('beforeend', `<div class="n">${ok ? '' : lock}${esc(r.name)}</div><div class="d">${r.builtin ? SIZE_NAMES[sizeKey(...mapDims(r.data))] : 'by ' + esc(r.author || 'you')}</div>`);
      d.dataset.map = r.id || '';
    }
    d.onclick = () => {
      sfx('click');
      if (!ok) { openFull(`The map “${r.name}” is part of the full version.`); return; }
      if (r.random) S.lobby.map = null; else applyMapChoice({ id: r.id, name: r.name, data: r.data, atmo: r.atmo || 'clear', zone: !!r.zone, builtin: !!r.builtin });
      renderSetup(); broadcastLobby();
    };
    strip.appendChild(d);
  }
  const more = document.createElement('div'); more.className = 'mcard more'; more.tabIndex = 0;
  more.innerHTML = `<div class="mthumb">${ICON('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>')}</div><div class="n">More maps</div><div class="d">Community & all</div>`;
  more.onclick = () => { sfx('click'); openMaps(); };
  strip.appendChild(more);
  const sel = strip.querySelector('.mcard.sel'); if (sel && sel.scrollIntoView && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = Math.max(0, sel.offsetLeft - strip.offsetLeft - 12);
  const mapSize = L.map ? sizeKey(...mapDims(L.map.data)) : null;
  $('#sizeSel').value = mapSize || L.size || 'auto'; $('#sizeSel').disabled = !!mapSize;
  $('#sizeRow').classList.toggle('dim', !!mapSize);
  $('#atmoSel').value = L.atmo || 'default';
  $('#zoneRow').classList.toggle('hidden', L.mode !== 'deathmatch');
  $('#zoneToggle').checked = !!L.zone;
  const dp = $('#diffPicker'); dp.innerHTML = '';
  for (const [k, df] of Object.entries(DIFFICULTIES)) {
    const ok = diffFree(k) || roomFull();
    const d = document.createElement('div'); d.className = `diff ${k}` + (L.difficulty === k ? ' sel' : '') + (ok ? '' : ' locked-full'); d.tabIndex = 0;
    d.innerHTML = `<div class="n">${ok ? '' : lock}${df.name}</div><div class="d">${df.desc}</div>`;
    d.onclick = () => { sfx('click'); if (!ok) { openFull(`${df.name} difficulty is part of the full version.`); return; } S.lobby.difficulty = k; store.set('nt_diff', k); renderSetup(); broadcastLobby(); };
    dp.appendChild(d);
  }
  $('#diffDesc').textContent = DIFFICULTIES[L.difficulty] ? `${DIFFICULTIES[L.difficulty].name}: ${DIFFICULTIES[L.difficulty].desc}` : '';
  $('#botsRow').classList.toggle('hidden', !MODES[L.mode].pvp || L.mode === 'duel');
  $('#botsLabel').textContent = MODES[L.mode].ffa ? 'Add AI bots (up to 4 tanks total)' : 'Fill teams with AI bots';
  $('#botsToggle').checked = !!L.bots;
}

// Player 2 on the same keyboard sits in the Tank step during setup, and under "Your tank" in a room
function placeP2(where) { const b = $('#p2Block'), home = where === 'setup' ? $('#p2Home') : $('#p2Room'); if (b && home && b.parentElement !== home) home.appendChild(b); }
function renderP2() { $('#btnAddP2').classList.toggle('hidden', S.p2.on); $('#p2Panel').classList.toggle('hidden', !S.p2.on); renderLobbyKeys(); }

// ---------- host ----------
function addPeerPlayers(id) {
  const p = S.net.peers.get(id), hp = S.peers.get(id);
  if (!S.game || !p || !hp || hp.role !== 'player') return;
  S.game.addPlayer({ id, name: p.name, cls: p.cls });
  if (hp.p2) S.game.addPlayer({ id: P2(id), name: hp.p2.name, cls: hp.p2.cls });
}
const hostHandlers = {
  peerJoin(peer) {
    const info = peer.info || {};
    const had = S.game && S.game.players.has(peer.id); // rejoining after host migration
    const free = roomCap() - playerCount();
    const role = (had || free >= 1) && !info.spectate ? 'player' : 'spectator';
    const p2 = role === 'player' && info.p2 && (free >= 2 || (had && S.game.players.has(P2(peer.id)))) ? { name: String(info.p2.name || 'Player 2').slice(0, 16), cls: CLASSES[info.p2.cls] ? info.p2.cls : 'scout' } : null;
    S.peers.set(peer.id, { seq: -1, ev: [], lastSend: 0, lastRev: -1, mapRepeats: 0, lastFull: 0, role, p2 });
    if (!had) {
      if (S.game) addPeerPlayers(peer.id);
      toast(role !== 'spectator' ? `${peer.name} joined` : !roomFull() && !info.spectate ? `${peer.name} is spectating — free rooms hold ${FREE.players} players` : `${peer.name} is spectating (room full)`, 3500); sfx('spawn');
    } else if (!p2 && S.game) S.game.removePlayer(P2(peer.id));
    if (info.p2 && !p2) S.net.sendTo(peer.id, { y: 'note', t: 'No free slot for your Player 2', p2off: true }, true);
    renderLobby(); broadcastLobby();
  },
  peerLeave(id) {
    const name = S.net && S.game && S.game.players.get(id) ? S.game.players.get(id).name : 'A player';
    S.peers.delete(id);
    if (S.game) { S.game.removePlayer(id); S.game.removePlayer(P2(id)); }
    toast(`${name} left`); renderLobby(); broadcastLobby();
  },
  peerMode() { renderLobby(); broadcastLobby(); },
  msg(from, m) {
    const hp = S.peers.get(from);
    if (!hp) return;
    if (m.y === 'in') {
      if (hp.role !== 'player') return;
      if (m.s > hp.seq || m.s < hp.seq - 500) {
        hp.seq = m.s;
        if (S.game) { S.game.setInput(from, m); if (m.p2 && hp.p2) S.game.setInput(P2(from), { d: m.p2[0], f: m.p2[1], a: m.p2[2] }); }
      }
    } else if (m.y === 'cls') {
      const p = S.net.peers.get(from); if (p && CLASSES[m.cls]) p.cls = m.cls;
      if (S.game) S.game.setClass(from, m.cls);
      if (m.p2 && hp.p2 && CLASSES[m.p2.cls]) { hp.p2.cls = m.p2.cls; if (S.game) S.game.setClass(P2(from), m.p2.cls); }
      renderLobby(); broadcastLobby();
    } else if (m.y === 'p2') {
      if (!m.on) { hp.p2 = null; if (S.game) S.game.removePlayer(P2(from)); }
      else if (hp.p2) { hp.p2.name = String(m.name || 'Player 2').slice(0, 16); if (CLASSES[m.cls]) hp.p2.cls = m.cls; const gp = S.game && S.game.players.get(P2(from)); if (gp) gp.name = hp.p2.name; if (S.game) S.game.setClass(P2(from), hp.p2.cls); }
      else if (hp.role === 'player' && playerCount() < roomCap()) { hp.p2 = { name: String(m.name || 'Player 2').slice(0, 16), cls: CLASSES[m.cls] ? m.cls : 'scout' }; if (S.game) S.game.addPlayer({ id: P2(from), name: hp.p2.name, cls: hp.p2.cls }); }
      else S.net.sendTo(from, { y: 'note', t: 'No free slot for Player 2', p2off: true }, true);
      renderLobby(); broadcastLobby();
    } else if (m.y === 'play') {
      if (hp.role === 'player') return;
      if (playerCount() >= roomCap()) { S.net.sendTo(from, { y: 'note', t: roomFull() ? 'Still full — wait for a free slot' : `This free room holds ${FREE.players} players — wait for a free slot` }, true); return; }
      hp.role = 'player'; addPeerPlayers(from);
      renderLobby(); broadcastLobby();
    } else if (m.y === 'ping') S.net.sendTo(from, { y: 'pong', t: m.t });
  },
};

function lobbyBlocker(L = S.lobby) {
  if (Full.owned) return '';
  if (!modeFree(L.mode)) return `${MODES[L.mode].name} is part of the full version.`;
  if (!diffFree(L.difficulty)) return `${DIFFICULTIES[L.difficulty].name} difficulty is part of the full version.`;
  if (L.map && !mapFree(L.map)) return `The map “${L.map.name}” is part of the full version.`;
  return '';
}
function startGame() {
  const why = lobbyBlocker();
  if (why) { openFull(why); if (S.fromEditor && S.screen !== 'lobby') { S.fromEditor = false; S.lobby = newLobby(); } return false; }
  initAudio(); startMusic();
  const map = S.lobby.map;
  const players = lobbyPlayers().map(p => ({ id: p.id, name: p.name, cls: p.cls }));
  const useMap = map && mapLayout(map.data) === MODES[S.lobby.mode].layout ? map : null;
  const atmo = S.lobby.atmo && S.lobby.atmo !== 'default' ? S.lobby.atmo : (useMap && useMap.atmo) || 'clear';
  S.game = new Game({ mode: S.lobby.mode, customMap: useMap ? useMap.data : null, customName: useMap ? useMap.name : '', seed: (Math.random() * 1e9) | 0, bots: S.lobby.bots, difficulty: S.lobby.difficulty, players, size: S.lobby.size, atmo, zone: S.lobby.zone });
  for (const hp of S.peers.values()) { hp.lastRev = -1; hp.ev = []; }
  S.lobby.started = true; S.endShown = false; S.paused = false; S.renderRev = -1; lastCkpt = 0;
  broadcastLobby();
  $('#endMenu').classList.add('hidden');
  show('game');
}

// fixed-rate simulation driven by a worker timer (keeps running in background tabs)
let lastSim = performance.now(), simAcc = 0, lastCkpt = 0;
function simTick() {
  const now = performance.now();
  const dt = Math.min(1, (now - lastSim) / 1000); lastSim = now;
  if (!S.isHost || !S.game || S.paused) { simAcc = 0; return; }
  const active = S.screen === 'game';
  const idle = { d: -1, f: false, a: false };
  S.game.setInput(S.me.id, active ? input.read(0) : idle);
  if (S.p2.on) S.game.setInput(P2(S.me.id), active ? input.read(1) : idle);
  simAcc += dt;
  let n = 0;
  while (simAcc >= TICK && n < 60) { S.game.step(TICK); simAcc -= TICK; n++; }
  const ev = S.game.drainEvents();
  if (ev.length) {
    S.localEv.push(...ev);
    for (const hp of S.peers.values()) { hp.ev.push(...ev); if (hp.ev.length > 80) hp.ev.splice(0, hp.ev.length - 80); }
  }
  if (S.net) {
    sendSnapshots(now);
    if (now - lastCkpt > 2000 && S.peers.size) { // full-state checkpoint so anyone can take over as host
      lastCkpt = now;
      const d = S.game.serialize();
      for (const id of S.peers.keys()) S.net.sendTo(id, { y: 'ckpt', d }, true);
    }
  }
}
function sendSnapshots(now) {
  let base = null, mapStr = null;
  for (const [id, hp] of S.peers) {
    const mode = S.net.peerMode(id);
    if (mode === 'pending' || mode === 'none') continue;
    const interval = mode === 'rtc' ? (hp.role === 'spectator' ? 66 : 50) : 100;
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
  hello() { return { name: S.me.name, cls: S.me.cls, p2: S.p2.on ? { name: p2Name(), cls: S.p2.cls } : null, spectate: S.role === 'spectator' && S.wantSpectate }; },
  msg(from, m) {
    if (m.y === 'lobby') {
      const hadFull = !!(S.lobby && S.lobby.full);
      S.lobby = m.l;
      if (hadFull !== !!m.l.full) {
        if (!canClass(S.me.cls) || (S.p2.on && !canClass(S.p2.cls))) { enforceOwnership(); onClassChange(); }
        refreshPickers();
      }
      if (m.l.theme && THEMES[m.l.theme] && m.l.theme !== curTheme()) { applyTheme(m.l.theme, false); toast(`Host set the style: ${THEMES[m.l.theme].name}`); }
      const wasSpec = S.role === 'spectator';
      S.role = (m.l.spectators || []).some(s => s.id === S.me.id) ? 'spectator' : 'player';
      if (wasSpec && S.role === 'player') toast('You joined the game!');
      if (!wasSpec && S.role === 'spectator' && S.screen !== 'game') toast(m.l.full ? 'Room is full — you are spectating' : `Free rooms hold ${FREE.players} players — you are spectating`, 3500);
      if (m.l.started && S.screen !== 'game') { S.endShown = false; show('game'); }
      else if (!m.l.started && S.screen === 'game') { $('#endMenu').classList.add('hidden'); S.snaps = []; S.checkpoint = null; show('lobby'); }
      if (S.screen === 'lobby') renderLobby();
    } else if (m.y === 'snap') onSnap(m);
    else if (m.y === 'ckpt') S.checkpoint = m.d;
    else if (m.y === 'pong') S.rtt = performance.now() - m.t;
    else if (m.y === 'note') { toast(m.t); if (m.p2off) { S.p2.on = false; input.setP2(false); renderLobby(); } }
  },
  hostLeft(oldId) { onHostLeft(oldId); },
  error(msg) { leaveAll(msg); },
  mode(mode) { if (mode === 'relay') toast('Direct connection blocked — using relay (slightly higher latency)'); },
};

// ---------- host migration ----------
async function onHostLeft(oldId) {
  if (S.migrating || !S.net) return;
  S.migrating = true;
  const present = S.net.presentIds();
  const order = (S.lobby.order || []).filter(id => id !== oldId && (id === S.me.id || present.has(id)));
  const succ = order[0];
  if (!succ) { S.migrating = false; leaveAll('The host left the room'); return; }
  S.snaps = []; S.clockOff = null;
  if (succ === S.me.id) await becomeHost(oldId);
  else {
    const who = [...(S.lobby.players || []), ...(S.lobby.spectators || [])].find(p => p.id === succ);
    toast(`Host left — ${who ? who.name : 'another player'} is taking over…`, 3500);
    S.net.resetForNewHost();
  }
  S.migrating = false;
}

async function becomeHost(oldId) {
  const prev = S.lobby;
  S.isHost = true;
  S.net.on = hostHandlers;
  await S.net.promote();
  S.peers = new Map();
  S.lobby = { theme: curTheme(), mode: prev.mode, map: prev.map || null, bots: prev.bots, difficulty: prev.difficulty || 'easy', started: false, players: [], spectators: [], order: [] };
  if (prev.started && S.checkpoint) {
    try {
      S.game = Game.deserialize(S.checkpoint);
      S.game.removePlayer(oldId); S.game.removePlayer(P2(oldId));
      if (S.role === 'player' && !S.game.players.has(S.me.id) && playerCount() < roomCap()) S.game.addPlayer({ id: S.me.id, name: S.me.name, cls: S.me.cls });
      if (S.game.players.has(S.me.id)) S.role = 'player';
      S.game.setBanner('HOST MIGRATED', `${S.me.name} is now hosting`, 3);
      S.lobby.started = true; S.renderRev = -1; lastSim = performance.now(); simAcc = 0;
      // players who never reconnect get removed
      setTimeout(() => {
        if (!S.game || !S.isHost) return;
        for (const id of [...S.game.players.keys()]) { const base = id.split(':')[0]; if (base !== S.me.id && !S.peers.has(base)) S.game.removePlayer(id); }
      }, 15000);
    } catch (e) { console.error(e); S.game = null; }
  } else S.game = null;
  if (!S.game && S.screen === 'game') show('lobby');
  toast('The host left — you are now hosting this room', 4000);
  renderLobby(); broadcastLobby();
}

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
  if (S.isHost || !S.net || S.screen !== 'game' || S.role !== 'player') return;
  const i = input.read(0), j = S.p2.on ? input.read(1) : null, now = performance.now();
  const key = `${i.d}${+i.f}${+i.a}` + (j ? `${j.d}${+j.f}${+j.a}` : '');
  const minGap = S.net.mode === 'relay' ? 90 : 0, hb = S.net.mode === 'relay' ? 1000 : 400;
  if ((key !== lastInKey && now - lastInSent > minGap) || now - lastInSent > hb) {
    const msg = { y: 'in', s: ++inSeq, d: i.d, f: i.f, a: i.a };
    if (j) msg.p2 = [j.d, j.f, j.a];
    S.net.sendToHost(msg);
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
  const pvp = !!(MODES[h.mode] && MODES[h.mode].pvp);
  const dname = (DIFFICULTIES[h.diff] ? ` · ${DIFFICULTIES[h.diff].name}` : '') + (h.atmo && h.atmo !== 'clear' ? ` · ${h.atmo === 'night' ? 'Night' : 'Fog'}` : '') + (h.zone ? ' · Zone' : '');
  if (h.mode === 'classic') $('#hudLeft').innerHTML = `<span class="t">STAGE ${h.stage}</span> <span class="s">${esc(h.title || '')}${dname}</span>`;
  else if (h.mode === 'survival') $('#hudLeft').innerHTML = `<span class="t">WAVE ${h.wave}</span> <span class="s">Survival${dname}</span>`;
  else $('#hudLeft').innerHTML = `<span class="t">${MODES[h.mode].name.toUpperCase()}</span> <span class="s">${esc(h.title || '')}${dname}</span>`;
  $('#hudLeft').classList.toggle('vs', h.mode !== 'classic' && h.mode !== 'survival'); // the score board says the mode; upright phones drop the label
  const clock = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  if (h.mode === 'deathmatch') {
    const L = h.ffa && h.ffa.leader, mine = h.players.filter(p => localIds().has(p[0])).map(p => p[9]);
    $('#hudCenter').innerHTML = `<div class="team-score ffa"><span class="m">LEADER</span><span class="a">${L ? esc(L[0]) + ' ' + L[1] : '—'}</span>${mine.length ? `<span class="m">YOU</span><span class="b">${mine.join(' / ')}</span>` : ''}<span class="m">${clock(h.timeLeft)}<br>to ${h.target}</span></div>`;
  } else if (h.mode === 'duel' && h.ffa && h.ffa.duel) {
    const [a, b] = h.ffa.duel;
    $('#hudCenter').innerHTML = `<div class="team-score duel"><span style="color:${a[1]}">${esc(a[0])}</span><span class="a">${a[2]}</span><span class="m">ROUND ${h.ffa.round}<br>${clock(h.ffa.roundLeft)}</span><span class="b">${b ? b[2] : 0}</span><span style="color:${b ? b[1] : '#fff'}">${b ? esc(b[0]) : ''}</span></div>`;
  } else if (pvp) {
    const m = Math.floor(h.timeLeft / 60), s = String(h.timeLeft % 60).padStart(2, '0');
    $('#hudCenter').innerHTML = `<div class="team-score"><span class="a">${h.team[0]}</span><span class="m">${m}:${s}<br>to ${h.target}</span><span class="b">${h.team[1]}</span></div>`;
  } else $('#hudCenter').innerHTML = `<div class="enemy-count"><i></i>${h.left} enemies${h.freeze ? ' · <span style="color:#a98bff">FROZEN</span>' : ''}</div>`;
  const badge = $('#netBadge');
  const spectating = S.role === 'spectator';
  $('#btnJoinPlay').classList.toggle('hidden', !(spectating && S.online && h.players.length < roomCap()));
  if (spectating) { badge.classList.remove('hidden'); badge.className = 'badge spec'; badge.textContent = `👁 SPECTATING · ${h.players.length}/${roomCap()}`; }
  else if (S.online) {
    badge.classList.remove('hidden');
    if (S.isHost) { badge.className = 'badge'; badge.textContent = `HOST · ${h.players.length}P${lobbySpectators().length ? ' +' + lobbySpectators().length + '👁' : ''}`; }
    else { const relay = S.net && S.net.mode === 'relay'; badge.className = 'badge' + (relay ? ' relay' : ''); badge.textContent = `${relay ? 'RELAY' : 'P2P'} ${Math.round(S.rtt)}ms`; }
  } else badge.classList.add('hidden');
  const mine = localIds();
  const mini = document.body.classList.contains('compact') && h.players.length > 3; // phones: other players shrink to colour + lives/kills
  $('#hudBottom').innerHTML = h.players.map(p => {
    const [id, name, color, lives, score, power, alive, cls, team, kills, cd] = p;
    const me = mine.has(id);
    const stars = '★'.repeat(power) + '<span style="opacity:.25">' + '★'.repeat(3 - power) + '</span>';
    const cdPct = me && cd > 0 ? Math.max(0, 100 - 100 * cd / CLASSES[cls].cd) : (me ? 100 : 0);
    const stat = pvp ? `<b>${kills}</b> K` : `♥<b>${lives}</b>`;
    return `<div class="pchip${me ? ' me' : mini ? ' mini' : ''}${alive === 2 ? ' out' : ''}"><span class="bar" style="color:${color}"></span><span class="nm" style="color:${color}">${esc(name)}</span><span class="st">${stat} <span class="stars" style="color:#ffd23f">${stars}</span> <span class="sc">${score}</span></span>${me ? `<span class="cd" style="width:${cdPct}%"></span>` : ''}</div>`;
  }).join('');
  const chipKey = h.players.length + (mini ? 'm' : '') + innerWidth + 'x' + innerHeight;
  if (chipKey !== S.chipKey) { S.chipKey = chipKey; layoutGame(); }
  if ((h.status === 'over' || h.status === 'win') && !S.endShown) showEnd(h);
  if (h.status !== 'over' && h.status !== 'win' && S.endShown) { S.endShown = false; $('#endMenu').classList.add('hidden'); }
}

function showEnd(h) {
  S.endShown = true;
  const pvp = h.mode === 'battle' || h.mode === 'ctf';
  if (h.winnerName) {
    const wp = h.players.find(p => p[1] === h.winnerName);
    $('#endTitle').textContent = h.winnerName === 'DRAW' ? 'DRAW' : `${h.winnerName.toUpperCase()} WINS`;
    $('#endTitle').style.color = wp ? wp[2] : 'var(--accent)';
  } else {
    $('#endTitle').textContent = h.status === 'win' ? (h.winner === 2 ? 'DRAW' : `${h.winner ? 'CRIMSON' : 'CYAN'} WINS`) : 'GAME OVER';
    $('#endTitle').style.color = h.status === 'win' && h.winner < 2 ? TEAM_MAIN[h.winner] : '#ff4d5e';
  }
  const duelLine = h.ffa && h.ffa.duel ? `Final ${h.ffa.duel.map(d => `${d[0]} ${d[2]}`).join(' : ')}` : '';
  $('#endSub').textContent = (h.mode === 'duel' ? duelLine : h.mode === 'deathmatch' ? `Deathmatch · first to ${h.target} kills` : pvp ? `Final score ${h.team[0]} : ${h.team[1]}` : (h.mode === 'survival' ? `Survived to wave ${h.wave}` : `Reached stage ${h.stage} — ${h.title}`)) + (DIFFICULTIES[h.diff] ? ` · ${DIFFICULTIES[h.diff].name}` : '');
  const rows = [...h.players].sort((a, b) => MODES[h.mode].ffa ? (b[9] - a[9]) || (b[4] - a[4]) : b[4] - a[4]);
  $('#endTable').innerHTML = `<tr><th>#</th><th>Player</th><th>Class</th><th class="num">Kills</th><th class="num">Score</th></tr>` +
    rows.map((p, i) => `<tr><td>${i + 1}</td><td><span class="dot" style="color:${p[2]}"></span>${esc(p[1])}</td><td>${CLASSES[p[7]].name}</td><td class="num">${p[9]}</td><td class="num">${p[4]}</td></tr>`).join('');
  $('#endHost').classList.toggle('hidden', !S.isHost);
  $('#btnToLobby').textContent = S.fromEditor ? 'Back to editor' : S.online ? 'Back to room' : 'Change game';
  $('#endWait').classList.toggle('hidden', S.isHost);
  setTimeout(() => { if (S.endShown) $('#endMenu').classList.remove('hidden'); }, 1800);
}
$('#btnAgain').onclick = () => startGame();
$('#btnToLobby').onclick = () => {
  if (S.fromEditor) { leaveAll(); return; }
  S.game = null; S.lobby.started = false; S.endShown = false; $('#endMenu').classList.add('hidden');
  if (!S.online) { wiz.purpose = 'solo'; wiz.edit = false; wiz.step = 0; placeP2('setup'); renderSetup(); show('setup'); return; }
  broadcastLobby(); renderLobby(); show('lobby');
};

// ---------- pause ----------
function togglePause(force) {
  const m = $('#pauseMenu');
  const open = force !== undefined ? force : m.classList.contains('hidden');
  m.classList.toggle('hidden', !open);
  if (!S.online && S.isHost) S.paused = open;
  $('#pauseNote').textContent = S.online ? 'Online game keeps running while this menu is open.' : '';
  updateStyleLock();
}
$('#btnPause').onclick = () => togglePause();
$('#btnResume').onclick = () => togglePause(false);
$('#btnQuit').onclick = () => leaveAll();
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || input.capture) return;
  if (!$('#controlsModal').classList.contains('hidden')) { $('#controlsModal').classList.add('hidden'); return; }
  if (S.screen === 'game' && !S.endShown) togglePause();
});
addEventListener('resize', () => {
  applyDeviceClasses();
  if (S.screen === 'game') { if (input.releaseTouch) input.releaseTouch(); layoutGame(); renderer.resize(); } // turning the phone mid-game
  resizeBg();
});

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
    let driving = false, boost = 1;
    if (view) {
      if (view.hud && view.hud.players.length > 1) view.names = Object.fromEntries(view.hud.players.map(p => [p[0], p[1]]));
      const mine = localIds();
      if (!S.paused) for (const tk of view.tk) if (tk[10] && mine.has(tk[10]) && (tk[7] & 1)) { driving = true; if (tk[7] & 64) boost = 1.35; }
      renderer.render(view, dt, mine);
      updateHud(view.hud);
    } else renderer.render(null, dt);
    setEngine(driving, boost);
    watchPerf(dt);
  } else { setEngine(false); if (S.screen !== 'editor') drawBg(dt); }
  requestAnimationFrame(frame);
}

// ---------- animated menu background ----------
const bg = $('#bg'), bgc = bg.getContext('2d');
let bgT = 0; const bgDots = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() }));
function resizeBg() { const d = Math.min(devicePixelRatio || 1, 2); bg.width = innerWidth * d; bg.height = innerHeight * d; }
resizeBg();
function drawBg(dt) {
  bgT += dt;
  if (getTheme().id === 'neon') { drawNeonBg(dt); return; }
  const th = getTheme(), w = bg.width, h = bg.height, g = bgc;
  if (!bgTex || bgTex.key !== th.id + w + 'x' + h) buildBgTex();
  // slow cinematic pan across a battlefield painted in the current style
  const k = Math.max(w / bgTex.width, h / bgTex.height) * 1.12;
  const tw = bgTex.width * k, tht = bgTex.height * k;
  const px = (tw - w) * (0.5 + 0.5 * Math.sin(bgT * 0.035)), py = (tht - h) * (0.5 + 0.5 * Math.cos(bgT * 0.027));
  g.imageSmoothingEnabled = !th.pixel;
  g.drawImage(bgTex, -px, -py, tw, tht);
  // tanks patrolling the backdrop
  for (const u of bgUnits) {
    u.t += dt * u.v;
    const L = 1 + u.t % 1.4 - 0.2;
    const x = u.horiz ? (u.dir > 0 ? L : 1 - L) * tw - px : u.lane * tw - px;
    const y = u.horiz ? u.lane * tht - py : (u.dir > 0 ? L : 1 - L) * tht - py;
    const sz = bgTex.cs * 2 * k;
    g.save(); g.translate(x, y); g.rotate(u.horiz ? (u.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (u.dir > 0 ? Math.PI : 0));
    if (th.tankShadow) { g.globalAlpha = 0.35; g.fillStyle = '#000'; g.fillRect(-sz / 2 + sz * 0.08, -sz / 2 + sz * 0.1, sz, sz); g.globalAlpha = 1; }
    g.drawImage(u.spr, -sz / 2, -sz / 2, sz, sz); g.restore();
  }
  // weather
  if (th.weather) {
    g.save();
    for (const f of bgDots) {
      if (th.weather === 'snow') { f.y += dt * 0.05 * (0.4 + f.z); f.x += dt * 0.01 * Math.sin(bgT + f.z * 9); if (f.y > 1) f.y = 0; g.fillStyle = `rgba(255,255,255,${0.5 + f.z * 0.5})`; g.beginPath(); g.arc(f.x * w, f.y * h, 1.5 + f.z * 2.5, 0, Math.PI * 2); g.fill(); }
      else { f.x += dt * 0.25 * (0.4 + f.z); if (f.x > 1) { f.x = 0; f.y = Math.random(); } g.strokeStyle = `rgba(240,210,160,${0.2 + f.z * 0.3})`; g.lineWidth = 1 + f.z; g.beginPath(); g.moveTo(f.x * w, f.y * h); g.lineTo(f.x * w - 20 * f.z, f.y * h); g.stroke(); }
    }
    g.restore();
  }
  // legibility veil
  const veil = { winter: 'rgba(225,236,245,0.35)', blueprint: 'rgba(11,36,70,0.35)', pixel: 'rgba(0,0,0,0.35)' }[th.id] || 'rgba(0,0,0,0.5)';
  g.fillStyle = veil; g.fillRect(0, 0, w, h);
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, th.id === 'winter' ? 'rgba(40,70,100,0.35)' : 'rgba(0,0,0,0.6)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
}
let bgTex = null, bgUnits = [];
function buildBgTex() {
  const th = getTheme();
  const cs = th.pixel ? 16 : Math.min(48, Math.ceil(Math.max(bg.width / MAP_W, bg.height / MAP_H)));
  const c = document.createElement('canvas'); c.width = MAP_W * cs; c.height = MAP_H * cs; c.cs = cs; c.key = th.id + bg.width + 'x' + bg.height;
  const g = c.getContext('2d');
  th.floor(g, cs);
  const m = generateMap('C', 1990 + th.id.length, 3);
  for (const layer of ['shadow', 'tiles', 'trees']) for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) th.cell(g, m.grid, x, y, cs, layer);
  bgTex = c;
  const cols = ['#ffd23f', '#3dff8b', '#3de0ff', '#ff4d4d', '#ff9b3d'], styles = ['pstriker', 'pscout', 'pheavy', 'basic', 'fast'];
  bgUnits = [0, 1, 2, 3, 4].map(i => ({ spr: tankIcon(styles[i], cols[i], 160), horiz: i % 2 === 0, dir: i % 3 ? 1 : -1, lane: 0.18 + i * 0.16, v: 0.018 + i * 0.004, t: i * 0.37 }));
}
function drawNeonBg(dt) {

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
let mapsTab = 'builtin';
const FAMILY = { C: 'CO-OP · Classic & Survival', A: 'TEAM · Battle & Capture the Flag', D: 'DEATHMATCH', U: 'DUEL' };
function mapCard(r, builtin) {
  const ok = !builtin || mapFree(r) || Full.owned;
  const card = document.createElement('div'); card.className = 'map-card' + (ok ? '' : ' locked-full');
  card.appendChild(mapPreview(r.data, 5));
  const lay = mapLayout(r.data), sz = SIZE_NAMES[sizeKey(...mapDims(r.data))];
  const tags = [FAMILY[lay].split(' ·')[0], sz, r.atmo && r.atmo !== 'clear' ? (r.atmo === 'night' ? 'Night' : 'Fog') : '', r.zone ? 'Zone' : ''].filter(Boolean);
  card.insertAdjacentHTML('beforeend', `<div class="n">${ok ? '' : lock}${esc(r.name)}</div>${builtin ? `<div class="d">${esc(r.desc)}</div>` : `<div class="a">by ${esc(r.author || 'anonymous')}</div>`}<div class="tags">${tags.map(t => `<span>${t}</span>`).join('')}</div><div class="b"><button class="btn primary" data-a="use">Use</button><button class="btn ghost" data-a="edit">Edit copy</button>${builtin ? '' : '<button class="btn ghost" data-a="link">Link</button>'}</div>`);
  card.querySelector('[data-a=use]').onclick = () => { if (!ok) { openFull(`The map “${r.name}” is part of the full version.`); return; } useMap(r); $('#mapsModal').classList.add('hidden'); };
  card.querySelector('[data-a=edit]').onclick = () => { if (!ok) { openFull(`The map “${r.name}” is part of the full version.`); return; } $('#mapsModal').classList.add('hidden'); editor.load(r.data); if (S.screen !== 'lobby') show('editor'); };
  const ln = card.querySelector('[data-a=link]'); if (ln) ln.onclick = () => copy(`${shareBase()}?level=${r.id}`, 'Map link copied');
  return card;
}
async function openMaps(tab = mapsTab) {
  mapsTab = tab;
  document.querySelectorAll('#mapsModal .tab').forEach(b => b.classList.toggle('sel', b.dataset.tab === tab));
  const modal = $('#mapsModal'); modal.classList.remove('hidden');
  const list = $('#mapsList'); list.innerHTML = '<div class="muted">Loading…</div>';
  if (tab === 'builtin') {
    list.innerHTML = '';
    const here = S.screen === 'lobby' || S.screen === 'setup';
    const cur = MODES[(here ? S.lobby.mode : 'classic')].layout;
    const all = builtinMaps();
    for (const fam of [cur, ...'CADU'.split('').filter(f => f !== cur)]) {
      list.insertAdjacentHTML('beforeend', `<div class="maps-group">${FAMILY[fam]}${fam === cur && here ? ' — current mode' : ''}</div>`);
      for (const r of all.filter(m => m.layout === fam)) list.appendChild(mapCard(r, true));
    }
    return;
  }
  try {
    const rows = await listLevels(60);
    if (!rows.length) { list.innerHTML = '<div class="muted">No maps yet — build one in the Level Editor and share it!</div>'; return; }
    list.innerHTML = '';
    for (const r of rows) list.appendChild(mapCard(r, false));
  } catch (e) { list.innerHTML = `<div class="muted">Could not load maps: ${esc(e.message || e)}</div>`; }
}
document.querySelectorAll('#mapsModal .tab').forEach(b => b.onclick = () => openMaps(b.dataset.tab));
function useMap(r) {
  const m = { id: r.id, name: r.name, data: r.data, atmo: r.atmo || 'clear', zone: !!r.zone, builtin: !!r.builtin, author: r.author };
  if ((S.screen === 'lobby' || S.screen === 'setup') && S.isHost) {
    applyMapChoice(m);
    if (S.screen === 'setup') renderSetup(); else renderLobby();
    broadcastLobby();
  } else setPendingMap(m);
  toast(`Map selected: ${r.name}`);
}
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { input.capture = null; b.closest('.overlay').classList.add('hidden'); });

// ---------- editor ----------
let editorData = null;
const editor = new Editor($('#editor'), {
  onBack: () => show('menu'),
  onTest: data => {
    requireName();
    const lay = mapLayout(data);
    S.isHost = true; S.online = false; S.fromEditor = true; S.role = 'player';
    S.lobby = { ...newLobby(), mode: LAYOUT_MODE[lay], map: { name: 'Editor test', data } };
    startGame();
  },
  onSave: (data, valid) => {
    if (!Full.owned && !FREE.shareMaps) { openFull('Publishing maps to the community is part of the full version. You can still build and test-play maps for free.'); return; }
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
    const url = `${shareBase()}?level=${id}`;
    const r = $('#saveResult'); r.classList.remove('hidden');
    r.innerHTML = `Published! Share this link:<br><b>${esc(url)}</b><br><button class="btn small" id="saveCopy" style="margin-top:8px">Copy link</button>`;
    $('#saveCopy').onclick = () => copy(url, 'Map link copied');
    setPendingMap({ id, name, data: editorData });
  } catch (e) { toast('Save failed: ' + (e.message || e)); $('#saveGo').disabled = false; }
};

// ---------- visual style ----------
function applyTheme(id, persist = true) {
  if (!THEMES[id]) return;
  activeTheme = id;
  if (persist) store.set('nt_theme', id);
  if (S.isHost && S.lobby) { S.lobby.theme = id; if (S.net) broadcastLobby(); }
  renderer.setTheme(id);
  setAudioTheme(id);
  for (const c of [...document.body.classList]) if (c.startsWith('theme-')) document.body.classList.remove(c);
  document.body.classList.add('theme-' + id);
  $('#logoTop').textContent = THEMES[id].word || 'NEON';
  document.title = `${(THEMES[id].word || 'NEON')[0] + (THEMES[id].word || 'NEON').slice(1).toLowerCase()} Tanks`;
  const mt = document.querySelector('meta[name=theme-color]'); if (mt) mt.content = THEMES[id].bg;
  bgTex = null;
  updateStyleLock();
  document.querySelectorAll('.sty').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
  refreshPickers();
  editor.buildTools(); if (S.screen === 'editor') editor.resize(); else editor.layer = null;
  if (S.screen === 'setup') renderSetup();
}
// style picker cards on the main page (live previews painted by each style)
// A 12×6-cell scene. The cards crop it to fit (object-fit: cover): tablets and computers show the middle
// 10 columns, a phone on its side shows nearly all of it in a wider, shorter card.
function stylePreview(th) {
  const PW = 12, PH = 6;
  const c = document.createElement('canvas'), cs = th.pixel ? 16 : 24; c.width = PW * cs; c.height = PH * cs;
  const g = c.getContext('2d');
  const f = document.createElement('canvas'); f.width = MAP_W * cs; f.height = MAP_H * cs; th.floor(f.getContext('2d'), cs);
  g.drawImage(f, 0, 0);
  const grid = new Uint8Array(MAP_W * MAP_H);
  const put = (x, y, v) => { grid[y * MAP_W + x] = v; };
  for (let y = 0; y < PH; y++) { put(0, y, 1); put(1, y, 1); put(2, y, 1); }      // brick wall on the left
  put(3, 0, 2); put(4, 0, 2);                                                     // steel
  for (const x of [9, 10, 11]) { put(x, 0, 4); put(x, 1, 4); put(x, 4, 3); put(x, 5, 3); } // trees and water on the right
  for (const layer of ['shadow', 'tiles', 'trees']) for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) th.cell(g, grid, x, y, cs, layer);
  const tk = document.createElement('canvas'); tk.width = tk.height = 3 * cs; const tg = tk.getContext('2d'); tg.translate(cs * 0.5, cs * 0.5); th.tank(tg, 'pstriker', '#ffd23f', cs * 2, 0);
  g.save(); g.translate(PW / 2 * cs, 3.2 * cs); g.rotate(Math.PI / 2); g.drawImage(tk, -1.5 * cs, -1.5 * cs); g.restore();
  return c;
}
{
  const box = $('#stylePicker');
  for (const id of THEME_ORDER) {
    const th = THEMES[id], d = document.createElement('div');
    d.className = 'sty' + (id === savedTheme ? ' sel' : ''); d.dataset.id = id; d.title = th.desc; d.tabIndex = 0;
    d.appendChild(stylePreview(th)); d.insertAdjacentHTML('beforeend', `<div class="n">${th.name}</div><div class="d">${th.desc}</div>`);
    if (!themeFree(id)) d.insertAdjacentHTML('beforeend', '<span class="sty-lock">🔒</span>');
    d.onclick = () => { if (styleLocked()) { toast('The host picks the style in this room'); return; } if (!canTheme(id)) { openFull(`The ${th.name} style is part of the full version.`); return; } applyTheme(id); sfx('click'); };
    d.ondblclick = () => { if (canTheme(id) && S.screen === 'setup' && !wiz.edit) setupNext(); };
    box.appendChild(d);
  }
}
for (const sel of document.querySelectorAll('.theme-sel')) {
  sel.innerHTML = THEME_ORDER.map(id => `<option value="${id}">${THEMES[id].name}</option>`).join('');
  sel.value = savedTheme;
  sel.onchange = e => { if (styleLocked()) { updateStyleLock(); return; } if (!canTheme(e.target.value)) { const n = THEMES[e.target.value].name; updateStyleLock(); openFull(`The ${n} style is part of the full version.`); return; } applyTheme(e.target.value); sfx('click'); toast(`Style: ${THEMES[e.target.value].name} — ${THEMES[e.target.value].desc}`); };
}

function updateStyleLock() {
  const locked = styleLocked();
  for (const sel of document.querySelectorAll('.theme-sel')) {
    for (const o of sel.options) o.textContent = (canTheme(o.value) || locked ? '' : '🔒 ') + THEMES[o.value].name;
    sel.value = activeTheme; sel.disabled = locked; sel.title = locked ? 'The host picks the style for everyone' : ''; }
  for (const el of document.querySelectorAll('.style-by-host')) el.classList.toggle('hidden', !locked);
  for (const el of document.querySelectorAll('.style-for-all')) el.classList.toggle('hidden', !(S.isHost && S.online));
}

// ---------- unlock card ----------
let fullWhy = '';
function storeLink() {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua) && PLAY_STORE_URL) return { url: PLAY_STORE_URL, label: 'Get it on Google Play' };
  return APP_STORE_URL ? { url: APP_STORE_URL, label: 'Get it on the App Store' } : null;
}
function renderFull(status) {
  const m = $('#fullModal'); if (!m) return;
  $('#fullWhy').textContent = Full.owned ? 'Thanks for your support! Everything is unlocked.' : fullWhy;
  $('#fullWhy').classList.toggle('hidden', !Full.owned && !fullWhy);
  const buy = $('#fullBuy'), link = $('#fullStore'), rest = $('#fullRestore');
  buy.classList.toggle('hidden', !Full.native || Full.owned);
  rest.classList.toggle('hidden', !Full.native);
  const sl = storeLink();
  link.classList.toggle('hidden', Full.native || !sl);
  if (sl) { link.href = sl.url; link.textContent = sl.label; }
  $('#fullWeb').classList.toggle('hidden', Full.native);
  $('#fullWeb').textContent = sl ? 'This website is the free version. Get the app to unlock everything.' : 'This website is the free version. The full version is coming soon to the App Store.';
  if (Full.native && !Full.owned) {
    const st = Full.productState;
    buy.disabled = Full.busy || st === 'loading';
    buy.textContent = Full.busy ? 'Please wait…' : st === 'ready' ? `Unlock everything — ${Full.product.priceString}` : st === 'loading' ? 'Loading price…' : 'Not available yet — tap to retry';
  }
  rest.disabled = Full.busy;
  if (status !== undefined) { $('#fullStatus').textContent = status; }
  if (Full.pending && !Full.owned) $('#fullStatus').textContent = 'Purchase pending approval. It unlocks automatically as soon as the store confirms it.';
}
function openFull(why = '') {
  fullWhy = why;
  $('#fullStatus').textContent = '';
  $('#fullModal').classList.remove('hidden');
  renderFull();
  if (Full.native && !Full.owned) Full.loadProduct(); // ask the store again each time the card opens
}
$('#fullBuy').onclick = async () => {
  if (Full.productState !== 'ready') { Full.loadProduct(); return; }
  const r = await Full.buy();
  const msg = { unlocked: '', cancelled: 'Purchase cancelled.', pending: 'Purchase pending approval. It unlocks automatically as soon as the store confirms it.', failed: `Purchase failed: ${r.message || 'please try again.'}`, unavailable: r.message || '' }[r.status];
  renderFull(msg === undefined ? '' : msg);
  if (r.ok) { toast('Full version unlocked — enjoy!', 3500); setTimeout(() => $('#fullModal').classList.add('hidden'), 1200); }
};
async function doRestore() {
  const r = await Full.restore();
  const msg = { restored: 'Purchase restored. Everything is unlocked.', none: 'No previous purchase found for this account.', failed: `Restore failed: ${r.message || 'please try again.'}`, cancelled: '' }[r.status] || '';
  renderFull(msg); if (msg) toast(msg, 3500);
}
$('#fullRestore').onclick = doRestore;
$('#btnRestore').onclick = doRestore;
$('#btnFull').onclick = () => openFull('');
function renderFullButtons() {
  $('#btnFull').textContent = Full.owned ? '★ Full version ✓' : '★ Full version';
  $('#btnFull').classList.toggle('owned', Full.owned);
  $('#btnRestore').classList.toggle('hidden', !Full.native);
}
// If the copy loses Full (refund, other Apple ID) fall back to free choices.
function enforceOwnership() {
  if (!Full.owned && !roomFull()) {
    if (!classFree(S.me.cls)) { S.me.cls = 'striker'; store.set('nt_cls', 'striker'); }
    if (!classFree(S.p2.cls)) { S.p2.cls = 'scout'; store.set('nt_p2cls', 'scout'); }
  }
  if (!canTheme(myTheme())) store.set('nt_theme', 'neon');
  if (!styleLocked() && !canTheme(curTheme())) applyTheme('neon');
  if (S.isHost && (S.screen === 'lobby' || S.screen === 'setup')) { enforceLobby(); renderLobby(); broadcastLobby(); if (S.screen === 'setup') renderSetup(); }
}
function enforceLobby() {
  if (!S.isHost || Full.owned) return;
  if (!modeFree(S.lobby.mode)) S.lobby.mode = 'classic';
  if (!diffFree(S.lobby.difficulty)) S.lobby.difficulty = 'easy';
  if (S.lobby.map && !mapFree(S.lobby.map)) S.lobby.map = null;
}
Full.onChange(why => {
  renderFull(); renderFullButtons();
  if (why === 'unlocked' || why === 'locked') {
    refreshPickers(); updateStyleLock();
    document.querySelectorAll('.sty').forEach(el => { const l = el.querySelector('.sty-lock'); if (l) l.classList.toggle('hidden', Full.owned); });
    if (S.screen === 'lobby') { if (why === 'locked') enforceOwnership(); renderLobby(); if (S.isHost) broadcastLobby(); }
    else if (why === 'locked') enforceOwnership();
    if (S.screen === 'setup') renderSetup();
  }
});

// ---------- boot ----------
await Full.init().catch(e => console.warn(e));
renderFullButtons();
document.querySelectorAll('.sty').forEach(el => { const l = el.querySelector('.sty-lock'); if (l) l.classList.toggle('hidden', Full.owned); });
if (!canTheme(savedTheme)) { store.set('nt_theme', 'neon'); }
if (!canClass(S.me.cls)) S.me.cls = 'striker';
if (!canClass(S.p2.cls)) S.p2.cls = 'scout';
applyTheme(canTheme(savedTheme) ? savedTheme : 'neon');
const params = new URLSearchParams(location.search);
if (params.get('level')) {
  loadLevel(params.get('level')).then(l => { setPendingMap(l); toast(`Map loaded: ${l.name}`); }).catch(() => toast('Shared map not found'));
}
if (params.get('room')) {
  const code = params.get('room').toUpperCase();
  $('#joinCode').value = code;
  if (S.me.name) toast(`Invite for room ${code} — press Join to enter`, 4000);
  else { toast('Enter your callsign and press Join', 4000); $('#nameInput').focus(); }
}
addEventListener('pointerdown', () => initAudio(), { once: true });
window.__nt = S; window.__input = input; window.__applyTheme = applyTheme; window.__full = Full; window.__r = renderer; window.__audio = audioDebug; // debug handles
