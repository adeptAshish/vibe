/* client3d.js — Hexion 3D browser client (Three.js).
   The lobby, sidebar, trading, dev cards, timer and dice logic mirror the 2D client.
   The board is rendered as a real 3D island you can orbit, zoom, and pan. */

const socket = io();
const $ = (id) => document.getElementById(id);
const lobby = $('lobby');
const gameScreen = $('game');

let state = null;
let myName = '';
let isHost = false;
let roomCode = '';
let placementMode = null;
let prevResources = null;
let lastDiceKey = null;
let timerInterval = null;

// Graphics settings — "extreme" enables the heavy eye-candy (shadows, full sea
// waves, dense tiles, dolphins, kraken, hi-res render). Defaults to Simple so the
// game runs smoothly; the player opts in to Extreme from the top-right button.
const gfx = { extreme: localStorage.getItem('hexionExtreme') === '1', night: false };
let creatingDecor = false; // true while building decorative (persistent) islands

// Per-build density multiplier — Simple mode thins out heavy decorative props so
// the scene stays light. Extreme restores the full count. Read at build time.
function denseCount(n, floor = 1) { return gfx.extreme ? n : Math.max(floor, Math.round(n * 0.35)); }

const RES_LABEL = { brick: 'Brick', lumber: 'Lumber', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
const RES_ICON = { brick: '🧱', lumber: '🌲', wool: '🐑', grain: '🌾', ore: '⛰️', desert: '🏜️' };
const RES_COLORS = { brick: '#c0563a', lumber: '#2e7d32', wool: '#9ccc65', grain: '#f4c430', ore: '#78909c', desert: '#d9c9a3' };
// richer 3D terrain colors
const RES_3D = { lumber: 0x2f8c24, wool: 0x95d04b, grain: 0xf4bd12, brick: 0xc54826, ore: 0x6f8898, desert: 0xe4c984 };
const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

const RULEBOOK_HTML = `
  <h3>🎯 Goal</h3>
  <p>Be first to reach <b>10 victory points</b> (VP).</p>
  <h3>🏗️ Build costs</h3>
  <ul>
    <li>🛣️ <b>Road</b>: <span class="cost">1 🌲 + 1 🧱</span></li>
    <li>🛖 <b>Settlement</b>: <span class="cost">1 🌲 + 1 🧱 + 1 🐑 + 1 🌾</span> · 1 VP</li>
    <li>🏛️ <b>City</b>: <span class="cost">3 ⛰️ + 2 🌾</span> · 2 VP (upgrades a settlement)</li>
    <li>📜 <b>Dev card</b>: <span class="cost">1 ⛰️ + 1 🐑 + 1 🌾</span></li>
  </ul>
  <h3>🎲 On your turn</h3>
  <ul>
    <li>Roll the dice — tiles with that number produce resources to adjacent settlements (1) and cities (2).</li>
    <li>Then build, buy dev cards, and trade in any order.</li>
    <li>End your turn when done.</li>
  </ul>
  <h3>🥷 The robber (roll of 7)</h3>
  <ul>
    <li>Anyone with 8+ cards discards half.</li>
    <li>Move the robber onto a tile to block it, and steal 1 card from an adjacent player.</li>
  </ul>
  <h3>🔄 Trading</h3>
  <ul>
    <li><b>Bank</b>: 4:1, or 3:1 / 2:1 at matching ports.</li>
    <li><b>Players</b>: offer a trade; anyone may accept.</li>
  </ul>
  <h3>📜 Development cards</h3>
  <ul>
    <li>⚔️ <b>Knight</b>: move the robber & steal. 3+ played = <b>Largest Army</b> (2 VP).</li>
    <li>🛣️ <b>Road Building</b>: 2 free roads.</li>
    <li>🌾 <b>Year of Plenty</b>: take any 2 resources.</li>
    <li>💰 <b>Monopoly</b>: name a resource; take all of it from everyone.</li>
    <li>🏆 <b>Victory Point</b>: +1 VP (hidden).</li>
  </ul>
  <h3>🏅 Bonus points</h3>
  <ul>
    <li>🛣️ <b>Longest Road</b> (5+ continuous): 2 VP</li>
    <li>⚔️ <b>Largest Army</b> (3+ knights): 2 VP</li>
  </ul>
`;

// ===================================================================
// LOBBY (identical behavior to the 2D version)
// ===================================================================
$('nameInput').value = localStorage.getItem('hexionName') || '';

$('createBtn').onclick = () => {
  myName = $('nameInput').value.trim() || 'Host';
  localStorage.setItem('hexionName', myName);
  socket.emit('createRoom', { name: myName }, (res) => { if (res.ok) { isHost = true; roomCode = res.code; } });
};
$('joinBtn').onclick = () => {
  myName = $('nameInput').value.trim() || 'Player';
  localStorage.setItem('hexionName', myName);
  const code = $('codeInput').value.trim().toUpperCase();
  if (!code) { showLobbyError('Enter a room code'); return; }
  socket.emit('joinRoom', { name: myName, code }, (res) => { if (res.ok) { isHost = false; roomCode = res.code; } else showLobbyError(res.error); });
};
$('addBotBtn').onclick = () => socket.emit('addBot', {}, () => {});
$('randomizeBtn').onclick = () => socket.emit('randomizeMap', {}, () => {});
$('timerSelect').onchange = () => socket.emit('setTimer', { seconds: Number($('timerSelect').value) }, () => {});
$('startBtn').onclick = () => socket.emit('startGame', {}, (res) => { if (!res.ok) showLobbyError(res.error); });
$('backBtn').onclick = () => { if (confirm('Leave the game and return to the home screen?')) { socket.emit('leaveRoom'); location.reload(); } };

// ---- Invite link (host shares a LAN URL with the room code baked in) ----
let inviteBase = '';
$('inviteBtn').onclick = async () => {
  const link = `${inviteBase || window.location.origin}/?code=${roomCode}`;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = link; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
  const btn = $('inviteBtn'); const old = btn.textContent;
  btn.textContent = '✅ Link copied!';
  setTimeout(() => { btn.textContent = old; }, 1600);
};

// ---- Auto-join when opened from an invite link (?code=ABCD) ----
(function autoJoinFromUrl() {
  const code = new URLSearchParams(location.search).get('code');
  if (!code) return;
  $('codeInput').value = code.toUpperCase().slice(0, 4);
  if (($('nameInput').value || '').trim()) $('joinBtn').click(); // name known → jump in
  else $('nameInput').focus();                                   // else just enter a name
})();

// ---- Dock collapse / expand ----
$('dockToggle').onclick = () => {
  const dock = $('dock');
  const collapsed = dock.dataset.collapsed === '1';
  if (collapsed) {
    dock.style.setProperty('height', '244px', 'important');
    dock.classList.remove('collapsed'); dock.dataset.collapsed = '0';
    $('dockToggle').textContent = '▾';
  } else {
    dock.style.setProperty('height', '14px', 'important');
    dock.classList.add('collapsed'); dock.dataset.collapsed = '1';
    $('dockToggle').textContent = '▴';
  }
};

// ---- Night mode (persisted) — also switches the 3D scene ----
function applyNight(on) {
  document.body.classList.toggle('night', on);
  const btn = $('nightToggle');
  if (btn) btn.textContent = on ? '☀️' : '🌙';
  localStorage.setItem('hexionNight', on ? '1' : '0');
  if (three.scene) applySceneNight(on);
}
if ($('nightToggle')) {
  $('nightToggle').onclick = () => applyNight(!document.body.classList.contains('night'));
}

// ---- Graphics quality toggle (Extreme vs Simple) ----
function showGfxLoading(extreme) {
  const el = $('gfxLoading');
  if (!el) return;
  const txt = $('gfxLoadingText');
  if (txt) txt.textContent = extreme ? 'Loading high detail…' : 'Switching to simple…';
  el.classList.remove('hidden');
}
function hideGfxLoading() { const el = $('gfxLoading'); if (el) el.classList.add('hidden'); }

// Apply the cheap GPU/material settings (no scene rebuild).
function applyGfxSettings(extreme) {
  // shadow mapping + render resolution are the biggest GPU costs — Extreme only
  if (three.renderer) {
    three.renderer.shadowMap.enabled = extreme;
    three.renderer.setPixelRatio(extreme ? Math.min(2, window.devicePixelRatio) : 1);
  }
  if (three.sunLight) three.sunLight.castShadow = extreme;
  // hide the leaping dolphins immediately when leaving Extreme
  if (three.dolphinPods) three.dolphinPods.forEach((pod) => pod.members.forEach((m) => { if (!extreme) m.visible = false; }));
  // (sea waves now animate in both modes so the ocean always reads as water)
}

function applyGfx(extreme) {
  gfx.extreme = extreme;
  localStorage.setItem('hexionExtreme', extreme ? '1' : '0');
  const btn = $('gfxToggle');
  if (btn) btn.textContent = extreme ? '✨ Extreme' : '○ Simple';
  if (!three.scene) return; // scene not built yet; effects applied in initThree

  // Rebuilding terrain (prop density) is the heavy, frame-blocking work. Show a
  // loading veil first, then defer the rebuild two frames so the veil paints
  // before the main thread stalls — no more "frozen screen" on toggle.
  const needsRebuild = three.boardKey && state && state.board;
  const finish = () => {
    applyGfxSettings(extreme);
    if (needsRebuild) {
      three.boardKey = null; ensureBoard(); updateDynamic();
      // the rebuild recreates the placement markers hidden — restore them so
      // an in-progress settlement/road placement keeps its clickable orbs.
      updateMarkerVisibility();
    }
    refreshNightEffects();
    hideGfxLoading();
  };
  if (needsRebuild) {
    showGfxLoading(extreme);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  } else {
    finish();
  }
}
if ($('gfxToggle')) {
  $('gfxToggle').onclick = () => applyGfx(!gfx.extreme);
  $('gfxToggle').textContent = gfx.extreme ? '✨ Extreme' : '○ Simple';
}

// ---- Rulebook (book-opening) ----
$('rulebookTab').onclick = () => { $('rulebook').classList.remove('hidden'); };
$('rulebookClose').onclick = () => { $('rulebook').classList.add('hidden'); };
$('rulebookBody').innerHTML = RULEBOOK_HTML;
$('winPlayAgain').onclick = () => location.reload();

function showLobbyError(msg) { $('lobbyError').textContent = msg || ''; }

socket.on('lobby', (room) => {
  roomCode = room.code;
  inviteBase = room.lanUrl || window.location.origin;
  $('lobbyEntry').classList.add('hidden');
  $('lobbyWaiting').classList.remove('hidden');
  $('lobbyCard').classList.add('wide');
  $('roomCode').textContent = room.code;
  isHost = room.host === socket.id;
  $('hostControls').classList.toggle('hidden', !isHost);
  $('waitMsg').classList.toggle('hidden', isHost);
  if (room.turnSeconds != null) $('timerSelect').value = String(room.turnSeconds);
  if (room.previewBoard) drawPreview(room.previewBoard);

  const colors = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71'];
  $('playerList').innerHTML = room.players.map((p, i) => `
    <li>
      <span class="swatch" style="background:${colors[i]}"></span>
      <span>${escapeHtml(p.name)}</span>
      ${p.isBot ? `<span class="bot-tag">🤖 bot ${isHost ? `· <a href="#" data-bot="${p.id}" class="rmbot">remove</a>` : ''}</span>` : ''}
    </li>`).join('');
  document.querySelectorAll('.rmbot').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); socket.emit('removeBot', { id: a.dataset.bot }, () => {}); };
  });
  $('startBtn').disabled = room.players.length < 2;
});

// Render a flat top-down preview of the board (hexes + ports) on the lobby canvas.
function drawPreview(board) {
  const pc = $('previewCanvas');
  if (!pc) return;
  const c = pc.getContext('2d');
  c.clearRect(0, 0, pc.width, pc.height);
  c.save();
  // canvas is full board resolution (720x640) — draw 1:1

  // ports as little boats with ratio badges
  board.ports.forEach((port) => {
    const bx = port.bx != null ? port.bx : port.x;
    const by = port.by != null ? port.by : port.y;
    (port.anchors || []).forEach((a) => {
      c.strokeStyle = 'rgba(245,236,215,.5)';
      c.lineWidth = 2; c.beginPath(); c.moveTo(bx, by); c.lineTo(a.x, a.y); c.stroke();
    });
    c.beginPath(); c.arc(bx, by, 13, 0, Math.PI * 2);
    c.fillStyle = '#7a4a23'; c.fill();
    c.fillStyle = '#f7efdc';
    c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(port.type === '3:1' ? '3:1' : '2:1', bx, by);
  });

  // hexes
  board.hexes.forEach((hex) => {
    c.beginPath();
    hex.vertices.forEach((vid, i) => {
      const v = board.vertices[vid];
      if (i === 0) c.moveTo(v.x, v.y); else c.lineTo(v.x, v.y);
    });
    c.closePath();
    c.fillStyle = RES_COLORS[hex.resource];
    c.fill();
    c.lineWidth = 3; c.strokeStyle = '#15425f'; c.stroke();

    c.font = '24px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(RES_ICON[hex.resource], hex.cx, hex.cy - (hex.number ? 18 : 0));

    if (hex.number) {
      c.beginPath(); c.arc(hex.cx, hex.cy + 10, 15, 0, Math.PI * 2);
      c.fillStyle = '#f5ecd7'; c.fill();
      const hot = hex.number === 6 || hex.number === 8;
      c.fillStyle = hot ? '#c0392b' : '#333';
      c.font = `bold ${hot ? 16 : 14}px sans-serif`;
      c.fillText(hex.number, hex.cx, hex.cy + 10);
    }
  });

  c.restore();
  showDifficulty(board);
}

// In-game mini map (bottom-right). Top-down board that ROTATES with the 3D camera
// so the player can always orient even when tile numbers are hidden by props.
function drawMiniMap() {
  const cv = $('miniMap');
  if (!cv || !state || !state.board) return;
  const b = state.board;
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);

  // fit the board to the canvas (radius from board centre, in board pixels). Use a
  // generous margin so tiles never spill past the rounded panel, even when rotated.
  const MARGIN = 18;
  let maxR = 0;
  b.hexes.forEach((h) => h.vertices.forEach((vid) => {
    const v = b.vertices[vid];
    maxR = Math.max(maxR, Math.hypot(v.x - BC.x, v.y - BC.y));
  }));
  const scale = (Math.min(W, H) / 2 - MARGIN) / (maxR || 1);

  // clip everything to a rounded rect so nothing overfills the panel
  c.save();
  roundRect(c, 1, 1, W - 2, H - 2, 9);
  c.clip();

  // rotate so the camera's heading stays at the bottom of the map (viewer ≈ bottom)
  const ang = three.controls ? three.controls.getAzimuthalAngle() : 0;
  c.save();
  c.translate(W / 2, H / 2);
  c.rotate(ang);

  // hex tiles
  b.hexes.forEach((hex) => {
    c.beginPath();
    hex.vertices.forEach((vid, i) => {
      const v = b.vertices[vid];
      const x = (v.x - BC.x) * scale, y = (v.y - BC.y) * scale;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.closePath();
    c.fillStyle = RES_COLORS[hex.resource];
    c.fill();
    c.lineWidth = 1; c.strokeStyle = 'rgba(8,30,46,.7)'; c.stroke();
  });

  // robber marker
  if (state.robber != null && b.hexes[state.robber]) {
    const r = b.hexes[state.robber];
    const x = (r.cx - BC.x) * scale, y = (r.cy - BC.y) * scale;
    c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2);
    c.fillStyle = 'rgba(18,18,22,.9)'; c.fill();
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.6)'; c.stroke();
  }

  // numbers — counter-rotate each label so it stays upright and readable
  b.hexes.forEach((hex) => {
    if (!hex.number) return;
    const x = (hex.cx - BC.x) * scale, y = (hex.cy - BC.y) * scale;
    c.save();
    c.translate(x, y);
    c.rotate(-ang);
    const hot = hex.number === 6 || hex.number === 8;
    c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2);
    c.fillStyle = 'rgba(245,236,215,.94)'; c.fill();
    c.fillStyle = hot ? '#c0392b' : '#222';
    c.font = `bold ${hot ? 9 : 8}px sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(hex.number, 0, 0);
    c.restore();
  });

  c.restore();   // undo rotate/translate
  c.restore();   // undo clip

  // fixed viewer indicator (a little triangle at the bottom = "you / camera")
  c.fillStyle = 'rgba(255,255,255,.92)';
  c.beginPath();
  c.moveTo(W / 2, H - 4);
  c.lineTo(W / 2 - 7, H - 14);
  c.lineTo(W / 2 + 7, H - 14);
  c.closePath();
  c.fill();
}

// Estimate map difficulty/swinginess from clustering of high-production tiles.
function computeDifficulty(board) {
  const PIP = { 2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1 };
  let redAdjacency = 0, highClusters = 0;
  board.hexes.forEach((h) => {
    if (!h.number) return;
    board.hexes.forEach((o) => {
      if (o.id <= h.id || !o.number) return;
      const shared = h.vertices.filter((v) => o.vertices.includes(v)).length;
      if (shared < 2) return;
      const hot = (n) => n === 6 || n === 8;
      if (hot(h.number) && hot(o.number)) redAdjacency++;
      if ((PIP[h.number] >= 4) && (PIP[o.number] >= 4)) highClusters++;
    });
  });
  const score = redAdjacency * 3 + highClusters;
  if (score <= 2) return { label: 'Balanced & fair', cls: 'easy', stars: '★☆☆' };
  if (score <= 6) return { label: 'Balanced', cls: 'balanced', stars: '★★☆' };
  return { label: 'Swingy / Hard', cls: 'hard', stars: '★★★' };
}

function showDifficulty(board) {
  const el = $('difficultyBadge');
  if (!el) return;
  const d = computeDifficulty(board);
  el.className = `difficulty-badge ${d.cls}`;
  el.style.display = 'inline-flex';
  el.innerHTML = `<span class="diff-dot" style="background:currentColor"></span>Difficulty: ${d.label} <span class="diff-stars">${d.stars}</span>`;
}

socket.on('gameStarted', () => { lobby.classList.add('hidden'); gameScreen.classList.remove('hidden'); });

// ===================================================================
// STATE
// ===================================================================
socket.on('state', (s) => {
  const prev = state;
  state = s;
  lobby.classList.add('hidden');
  gameScreen.classList.remove('hidden');

  if (!three.renderer) initThree();
  ensureBoard();
  updateDynamic();

  if (s.dice) {
    const key = `${s.turn}:${s.dice[0]}:${s.dice[1]}:${s.hasRolled}`;
    if (key !== lastDiceKey && (!prev || !prev.dice || prev.dice[0] !== s.dice[0] || prev.dice[1] !== s.dice[1] || prev.turn !== s.turn)) showDiceFx(s.dice);
    lastDiceKey = key;
  } else lastDiceKey = null;

  drawBanner(); drawPlayers(); drawRoll(); drawHand(); drawActions(); drawDevCards(); drawBonuses(); drawLog();
  handlePassivePrompts();
  updateMarkerVisibility();
  updateTimer();
  if (state.tradeOffer) handleTradeOffer();
  else if (currentModal === 'trade') closeModal();

  if (s.phase === 'over' && s.winner != null) {
    if (!(prev && prev.phase === 'over')) celebrate(s.players[s.winner].name);
  }
});

const me = () => (state ? state.players[state.youAre] : null);
const myTurn = () => state && state.turn === state.youAre;

// ===================================================================
// THREE.JS SETUP
// ===================================================================
const three = {
  renderer: null, scene: null, camera: null, controls: null,
  boardGroup: null, pieceGroup: null, markerGroup: null,
  vertexMarkers: [], edgeMarkers: [], hexMeshes: [],
  boardKey: null, raycaster: null,
};
const S = 0.06;      // px -> world units
const TILE_H = 0.7;  // tile top (where pieces/props sit)
const TILE_BOTTOM = -2.6; // tiles extend deep into the sea (submerged island look)
const SEA_Y = -0.7;  // waterline
let BC = { x: 360, y: 320 }; // board center (px)

const TX = (x) => (x - BC.x) * S;
const TZ = (y) => (y - BC.y) * S;

function initThree() {
  const host = $('three');
  const scene = new THREE.Scene();
  // pleasant SUNNY day with a relaxing light-blue ocean (see applySceneNight for the full palette)
  scene.background = new THREE.Color('#8fd0ec');
  scene.fog = new THREE.Fog('#bfe3f4', 62, 158);

  const camera = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 500);
  camera.position.set(0, 26, 24);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Shadows are refreshed on a throttle (see animate) instead of every frame —
  // a big GPU saving with a static sun and only small moving props.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  host.appendChild(renderer.domElement);

  // lights — warm sunshine, balanced (not blown-out)
  const hemi = new THREE.HemisphereLight(0xc6e6f6, 0x647358, 0.77);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffeccb, 0.87);
  sun.position.set(18, 38, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  // Allow a SOFT amount of shadow self-shadowing ("acne") back onto the flat tile
  // tops — it adds subtle surface texture the board looked bland without. We keep
  // just a touch of bias so the banding stays faint instead of harsh/sharp.
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  scene.add(sun);
  three.hemi = hemi; three.sunLight = sun;

  // visible sun/moon orb in the sky (seen when the player orbits the map)
  const sunOrb = new THREE.Mesh(
    new THREE.SphereGeometry(4.5, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffeec2 })
  );
  sunOrb.position.set(34, 30, -34);
  scene.add(sunOrb);
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(7, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.24 })
  );
  sunGlow.position.copy(sunOrb.position);
  scene.add(sunGlow);
  three.sunOrb = sunOrb; three.sunGlow = sunGlow;

  // animated sea (vertex-displaced waves) — metalness gives moon/sun reflections.
  // 60×60 (was 100×100) is plenty for smooth swells and far cheaper to displace.
  const seaGeo = new THREE.PlaneGeometry(400, 400, 72, 72);
  const sea = new THREE.Mesh(
    seaGeo,
    new THREE.MeshStandardMaterial({ color: 0x3399cf, roughness: 0.34, metalness: 0.55, flatShading: true })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_Y; // waterline — tiles dip below this so the island looks submerged
  sea.receiveShadow = true;
  scene.add(sea);
  three.sea = sea;
  three.seaBase = seaGeo.attributes.position.array.slice(); // store original positions

  // decorative far-off islands + circling birds for atmosphere
  three.torches = [];
  creatingDecor = true;
  addDecor(scene);
  creatingDecor = false;

  // drifting clouds in the sky (day & night)
  buildClouds(scene);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 12;
  controls.maxDistance = 70;
  controls.maxPolarAngle = Math.PI / 2.15; // don't go under the board
  controls.target.set(0, 0, 0);

  three.scene = scene; three.camera = camera; three.renderer = renderer; three.controls = controls;
  three.raycaster = new THREE.Raycaster();

  three.boardGroup = new THREE.Group();
  three.pieceGroup = new THREE.Group();
  three.markerGroup = new THREE.Group();
  scene.add(three.boardGroup, three.pieceGroup, three.markerGroup);

  window.addEventListener('resize', onResize);
  setupPicking(renderer.domElement);
  animate();
  $('camReset').onclick = resetCamera;

  // apply persisted night mode now that the scene exists
  applyNight(localStorage.getItem('hexionNight') === '1');
  applyGfx(gfx.extreme);
}

// A soft puffy cloud — a cluster of flattened white spheres sharing one material
// (so day/night tinting is a single color change).
function makeCloud(rng, mat) {
  const g = new THREE.Group();
  const puffs = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < puffs; i++) {
    const r = 1.6 + rng() * 2.2;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
    puff.position.set((rng() - 0.5) * 7, (rng() - 0.5) * 1.2, (rng() - 0.5) * 4);
    puff.scale.y = 0.6;
    g.add(puff);
  }
  return g;
}

// Drifting clouds high in the sky, visible day & night (tinted in applySceneNight).
function buildClouds(scene) {
  const rng = mulberry32(20240612);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 0,
    transparent: true, opacity: 0.82, flatShading: true, fog: true,
  });
  three.cloudMat = mat;
  three.clouds = [];
  const group = new THREE.Group();
  const N = 12;
  for (let i = 0; i < N; i++) {
    const cl = makeCloud(rng, mat);
    const sc = 0.8 + rng() * 1.6;
    cl.scale.setScalar(sc);
    cl.position.set((rng() - 0.5) * 150, 26 + rng() * 16, (rng() - 0.5) * 150);
    cl.userData = { speed: 0.4 + rng() * 0.8 };
    group.add(cl);
    three.clouds.push(cl);
  }
  scene.add(group);
  three.cloudGroup = group;
}

// Far-off + nearby decorative islands (some with houses & people), a lighthouse,
// circling birds, and leaping dolphins.
function addDecor(scene) {
  const decor = new THREE.Group();
  three.birds = [];
  three.dolphinPods = [];
  three.decorAnims = [];     // persistent decor animations (islanders, etc.)
  three.islandTorches = [];
  three.smallIslands = [];   // islands the kraken can swallow

  // [x, z, scale, houseCount] — some pulled in close; a couple of BIG village isles
  const islands = [
    [-21, -18, 1.1, 2], [23, -15, 1.0, 1], [19, 21, 1.1, 2],
    [-24, 19, 0.9, 0],
    [-50, -44, 2.4, 4],   // big village island
    [54, -36, 1.4, 1], [46, 48, 2.2, 3],   // another big village
    [-54, 44, 1.3, 0], [2, -66, 1.6, 1], [66, 12, 1.3, 0],
  ];
  islands.forEach(([x, z, sc, houses], idx) => {
    const g = new THREE.Group();
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(3 * sc, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xd8c188, roughness: 1, flatShading: true })
    );
    mound.scale.y = 0.5; mound.receiveShadow = true;
    g.add(mound);
    // palms (more on bigger isles)
    const palms = 1 + Math.round(sc) + (idx % 2);
    for (let p = 0; p < palms; p++) {
      const pa = (p / palms) * Math.PI * 2;
      const pr = (1.0 + (p % 2) * 0.7) * sc;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * sc, 0.22 * sc, 2.4 * sc, 6),
        new THREE.MeshStandardMaterial({ color: 0x7a5a2a, roughness: 0.9 }));
      trunk.position.set(Math.cos(pa) * pr, 1.2 * sc, Math.sin(pa) * pr);
      const fronds = new THREE.Mesh(new THREE.ConeGeometry(1.6 * sc, 1.0 * sc, 6),
        new THREE.MeshStandardMaterial({ color: 0x2e8b3a, roughness: 0.85, flatShading: true }));
      fronds.position.set(trunk.position.x, 2.6 * sc, trunk.position.z);
      g.add(trunk, fronds);
    }
    // cottages + villagers clustered into a little hamlet
    const region = [];
    for (let hI = 0; hI < houses; hI++) {
      const ha = (hI / Math.max(1, houses)) * Math.PI * 2 + idx;
      const hr = (0.6 + (hI % 2) * 0.5) * sc;
      const hx = Math.cos(ha) * hr, hz = Math.sin(ha) * hr;
      const cottage = makeCottage();
      cottage.position.set(hx, 0.4 * sc, hz); cottage.scale.setScalar(0.8 * sc);
      cottage.rotation.y = ha;
      g.add(cottage);
      region.push({ x: hx, z: hz });
    }
    // one villager per house, roaming the hamlet
    for (let vI = 0; vI < houses; vI++) {
      const villager = makeHuman(0x3a6ea5, false);
      const start = region[vI];
      villager.position.set(start.x + 0.4, 0.4 * sc, start.z + 0.4);
      villager.scale.setScalar(0.85 * sc);
      g.add(villager);
      const wk = { obj: villager, region, speed: 0.25 + (vI % 2) * 0.1, tx: start.x, tz: start.z,
        rng: mulberry32(idx * 31 + vI + 1), pause: vI * 0.5, base: { x: 0, z: 0 }, sc };
      three.decorAnims.push({ update: (t) => updateIslander(wk, t) });
    }
    g.position.set(x, SEA_Y + 0.15, z);
    decor.add(g);
    // small isles (scale <= 1.4) can be swallowed by the kraken
    if (sc <= 1.4) three.smallIslands.push({ group: g, x, z, baseY: SEA_Y + 0.15, alive: true, respawnAt: 0 });
  });

  // Lighthouse on its own islet close to the board — strong light at night.
  addLighthouse(decor);

  // The KRAKEN — a giant sea monster that surfaces around the ocean (extreme).
  addKraken(decor);

  // birds
  for (let i = 0; i < 14; i++) {
    const bird = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x33404a });
    const wingGeo = new THREE.PlaneGeometry(1.1, 0.18);
    const lw = new THREE.Mesh(wingGeo, mat); lw.position.x = -0.55;
    const rw = new THREE.Mesh(wingGeo, mat); rw.position.x = 0.55;
    bird.add(lw, rw);
    bird.userData = { lw, rw, radius: 30 + Math.random() * 28, height: 16 + Math.random() * 12,
      speed: 0.12 + Math.random() * 0.12, offset: Math.random() * Math.PI * 2, flap: Math.random() * Math.PI * 2 };
    decor.add(bird);
    three.birds.push(bird);
  }

  // dolphins — swim in synced pods of 3, leaping together (extreme mode)
  three.dolphinPods = [];
  for (let p = 0; p < 2; p++) {
    const members = [];
    for (let i = 0; i < 3; i++) { const d = makeDolphin(); decor.add(d); members.push(d); }
    const ang = Math.random() * Math.PI * 2;
    const rad = 17 + Math.random() * 9;
    three.dolphinPods.push({
      members,
      x: Math.cos(ang) * rad, z: Math.sin(ang) * rad,
      heading: Math.random() * Math.PI * 2,
      next: 2 + Math.random() * 5, jumpT: -1,
    });
  }

  scene.add(decor);
  three.decor = decor;
}

function makeCottage() {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 1, flatShading: true }));
  wall.position.y = 0.35;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.5, 4),
    new THREE.MeshStandardMaterial({ color: 0x9c4a2a, roughness: 1, flatShading: true }));
  roof.position.y = 0.95; roof.rotation.y = Math.PI / 4;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.36, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x5a3c1e }));
  door.position.set(0, 0.18, 0.41);
  // warm window glow (lights up at night)
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x3a3320, emissive: 0x000000 }));
  win.position.set(0.3, 0.42, 0.41);
  g.add(wall, roof, door, win);
  g.userData.window = win;
  three.cottageWindows = three.cottageWindows || [];
  three.cottageWindows.push(win);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeDolphin() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x5a7a90, roughness: 0.5, metalness: 0.1, flatShading: true });
  const bodyGeo = (typeof THREE.CapsuleGeometry === 'function')
    ? new THREE.CapsuleGeometry(0.22, 0.8, 4, 8)
    : new THREE.CylinderGeometry(0.18, 0.1, 1.0, 8);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.rotation.z = Math.PI / 2;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.3, 4), mat);
  tail.position.set(-0.6, 0, 0); tail.rotation.z = Math.PI / 2; tail.scale.set(1, 0.4, 1.4);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.32, 4), mat);
  fin.position.set(0.05, 0.2, 0); fin.scale.set(0.5, 1, 0.3);
  g.add(body, tail, fin);
  g.visible = false;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// A whole pod of 3 dolphins leaps together, in formation.
function updateDolphinPod(pod, t) {
  if (!gfx.extreme) { pod.members.forEach((m) => { m.visible = false; }); return; }
  // stay gone for a while after the kraken eats the pod
  if (pod.eatenUntil && t < pod.eatenUntil) { pod.members.forEach((m) => { m.visible = false; }); return; }
  if (pod.jumpT < 0) {
    if (t > pod.next) pod.jumpT = 0;
    else { pod.members.forEach((m) => { m.visible = false; }); return; }
  }
  pod.jumpT += 0.016;
  const dur = 1.2;
  const u = pod.jumpT / dur;
  if (u >= 1) {
    pod.jumpT = -1;
    pod.next = t + 6 + Math.random() * 9;
    pod.heading += (Math.random() - 0.5);
    // don't leap onto the island — if the pod drifted too close, aim back out
    const pr = Math.hypot(pod.x, pod.z);
    const minR = (three.boardRadius || 12) + 4;
    if (pr < minR) { pod.heading = Math.atan2(pod.z, pod.x); } // point outward
    pod.members.forEach((m) => { m.visible = false; });
    return;
  }
  const ch = Math.cos(pod.heading), sh = Math.sin(pod.heading);
  // perpendicular offset so they swim side-by-side in formation
  const px = -sh, pz = ch;
  const dist = u * 3.2;
  const arc = Math.sin(u * Math.PI) * 1.7;
  pod.members.forEach((m, i) => {
    const lane = (i - 1) * 0.95;          // -0.95, 0, +0.95
    const lead = (i === 1 ? 0.35 : 0);    // centre dolphin slightly ahead
    const bx = pod.x + ch * (dist - 1.6 + lead) + px * lane;
    const bz = pod.z + sh * (dist - 1.6 + lead) + pz * lane;
    m.visible = true;
    m.position.set(bx, SEA_Y - 0.2 + arc, bz);
    m.rotation.y = -pod.heading + Math.PI / 2;
    m.rotation.z = Math.cos(u * Math.PI) * 0.9;
  });
}

function updateIslander(wk, t) {
  const o = wk.obj;
  if (wk.pause > 0) {
    wk.pause -= 0.016;
    if (wk.pause <= 0) {
      // wander to a random house in the hamlet (or random spot around base)
      if (wk.region && wk.region.length) {
        const h = wk.region[Math.floor(wk.rng() * wk.region.length)];
        wk.tx = h.x + (wk.rng() - 0.5) * 1.2 * wk.sc;
        wk.tz = h.z + (wk.rng() - 0.5) * 1.2 * wk.sc;
      } else {
        wk.tx = wk.base.x + (wk.rng() - 0.5) * 4 * wk.sc;
        wk.tz = wk.base.z + (wk.rng() - 0.5) * 4 * wk.sc;
      }
    }
    return;
  }
  const ddx = wk.tx - o.position.x, ddz = wk.tz - o.position.z, d = Math.hypot(ddx, ddz);
  if (d < 0.1) { wk.pause = 1 + wk.rng() * 2; return; }
  const v = wk.speed * 0.016;
  o.position.x += (ddx / d) * v; o.position.z += (ddz / d) * v;
  faceDir(o, ddx, ddz);
}

// An old, rusty lighthouse on a small islet with a rotating beam (bright at night).
function addLighthouse(decor) {
  const g = new THREE.Group();
  const islet = new THREE.Mesh(new THREE.SphereGeometry(3.4, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x6e6458, roughness: 1, flatShading: true }));
  islet.scale.y = 0.45; islet.receiveShadow = true;

  // weathered, normal-sized tower
  const tower = new THREE.Group();
  const h = 5;
  // grimy off-white body with rust streaks (canvas texture)
  const bodyMat = new THREE.MeshStandardMaterial({ map: makeRustTexture(), roughness: 1, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.95, h, 16), bodyMat);
  body.position.y = h / 2;
  // faded red stripes
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x8a3a2c, roughness: 1, flatShading: true });
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, h * 0.3, 16), stripeMat);
  stripe.position.y = h * 0.42;
  // rusty gallery rail
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.3, 16),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1, flatShading: true }));
  gallery.position.y = h + 0.1;
  // lantern room (glows) with dark window frames
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.7, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: 0x000000, roughness: 0.4 }));
  lantern.position.y = h + 0.6;
  // window mullions around the lantern
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.04), frameMat);
    bar.position.set(Math.cos(a) * 0.5, h + 0.6, Math.sin(a) * 0.5);
    tower.add(bar);
  }
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.5, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1, flatShading: true }));
  cap.position.y = h + 1.15;
  // weathercock
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4), frameMat);
  rod.position.y = h + 1.6;
  // arched wooden door at the base
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.6, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x4a2c14, roughness: 1, flatShading: true }));
  door.position.set(0, 0.42, 0.84);
  const doorTop = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 10, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x4a2c14, roughness: 1 }));
  doorTop.rotation.x = Math.PI / 2; doorTop.position.set(0, 0.72, 0.84);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2018, metalness: 0.4, roughness: 0.6 }));
  knob.position.set(0.1, 0.42, 0.88);
  // a couple of small dark windows up the shaft
  const winMat = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.5 });
  [1.6, 2.8].forEach((wy) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.05), winMat);
    w.position.set(0, wy, 0.74); tower.add(w);
  });

  tower.add(body, stripe, gallery, lantern, cap, rod, door, doorTop, knob);
  tower.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // rotating beam: a translucent cone + a spotlight
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 15, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.rotation.z = Math.PI / 2;
  beam.position.set(7.5, h + 0.6, 0);
  const beamPivot = new THREE.Group();
  beamPivot.add(beam);

  const spot = new THREE.SpotLight(0xfff3c0, 0, 60, Math.PI / 9, 0.4, 1.2);
  spot.position.set(0, h + 0.6, 0);
  const spotTarget = new THREE.Object3D();
  spot.target = spotTarget;

  g.add(islet, tower, beamPivot, spot, spotTarget);
  g.position.set(-24, SEA_Y + 0.1, 8); // pulled in close, like the small islands
  decor.add(g);
  three.lighthouse = { group: g, beamPivot, spot, spotTarget, lantern, beam, h };
}

// Weathered rusty metal texture for the lighthouse body.
function makeRustTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#d8d2c2'; x.fillRect(0, 0, 128, 128);
  // rust streaks + grime
  for (let i = 0; i < 80; i++) {
    const rx = Math.random() * 128, ry = Math.random() * 128;
    x.fillStyle = `rgba(${120 + Math.random() * 60 | 0},${50 + Math.random() * 40 | 0},${20 + Math.random() * 20 | 0},${0.1 + Math.random() * 0.3})`;
    x.fillRect(rx, ry, 2 + Math.random() * 4, 6 + Math.random() * 30);
  }
  for (let i = 0; i < 30; i++) {
    x.fillStyle = `rgba(40,40,40,${0.05 + Math.random() * 0.15})`;
    x.beginPath(); x.arc(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 6, 0, Math.PI * 2); x.fill();
  }
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  return tex;
}

function updateLighthouse(t) {
  const lh = three.lighthouse;
  const a = t * 0.8;
  lh.beamPivot.rotation.y = a;
  // aim the spotlight where the beam points
  const tx = Math.cos(a) * 30, tz = Math.sin(a) * 30;
  lh.spotTarget.position.set(tx, SEA_Y, tz);
  const on = gfx.night;
  lh.spot.intensity = on ? (gfx.extreme ? 2.6 : 1.4) : 0;
  lh.beam.material.opacity = on ? 0.14 : 0;
  lh.lantern.material.emissive.setHex(on ? 0xfff3c0 : 0x000000);
}

// ===================================================================
// THE KRAKEN — a giant sea monster (~2x a small island)
// ===================================================================
function addKraken(decor) {
  const k = makeKraken();
  k.group.visible = false;
  decor.add(k.group);
  three.kraken = {
    ...k,
    state: 'hidden',
    timer: 2 + Math.random() * 3,    // first appearance delay (sooner — horror)
    x: 0, z: 0, y: -10, surfaceY: SEA_Y - 1.0,
    heading: 0, target: null, prog: 0,
  };
}

function makeKraken() {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x3a2350, roughness: 0.85, flatShading: true });
  const belly = new THREE.MeshStandardMaterial({ color: 0x5a3a6e, roughness: 0.9, flatShading: true });

  // mantle (head) — big bulbous body, ~2x small-island size
  const mantle = new THREE.Mesh(new THREE.SphereGeometry(2.0, 16, 14), skin);
  mantle.scale.set(1, 1.3, 1); mantle.position.y = 1.6;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.7, 12), skin);
  tip.position.y = 3.4;
  // brow ridges
  const brow = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.18, 6, 16, Math.PI), skin);
  brow.rotation.x = Math.PI / 2; brow.position.set(1.2, 2.0, 0); brow.rotation.z = -0.3;
  // glowing eyes — blood red, ever-watching
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 1.2, roughness: 0.3 });
  const eyeGeo = new THREE.SphereGeometry(0.4, 12, 12);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(1.55, 1.7, 0.75);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(1.55, 1.7, -0.75);
  // small eye lights (glow at night/extreme)
  const eyeLightL = new THREE.PointLight(0xff2a2a, 0, 8, 1.6); eyeLightL.position.set(2.1, 1.7, 0.75); eyeLightL.visible = false;
  const eyeLightR = new THREE.PointLight(0xff2a2a, 0, 8, 1.6); eyeLightR.position.set(2.1, 1.7, -0.75); eyeLightR.visible = false;

  group.add(mantle, tip, brow, eyeL, eyeR, eyeLightL, eyeLightR);

  // 8 tentacles splayed around the base
  const tentacles = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const ten = makeTentacle(skin, belly);
    ten.root.position.set(Math.cos(a) * 1.5, 0.7, Math.sin(a) * 1.5);
    ten.root.rotation.y = -a;        // point outward
    tentacles.push({ ...ten, phase: i * 0.7, baseA: a });
    group.add(ten.root);
  }

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group, mantle, tentacles, eyes: [eyeL, eyeR], eyeLights: [eyeLightL, eyeLightR], eyeMat };
}

// A segmented tentacle (chain of tapering cylinders) that can curl/wave.
function makeTentacle(skin, belly) {
  const root = new THREE.Group();
  let parent = root;
  const segs = 6;
  const segLen = 0.85;
  const baseR = 0.36;
  const segGroups = [];
  for (let i = 0; i < segs; i++) {
    const sg = new THREE.Group();
    const r0 = baseR * (1 - i / segs * 0.85);
    const r1 = baseR * (1 - (i + 1) / segs * 0.85);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.03, r1), Math.max(0.04, r0), segLen, 8),
      i % 2 ? belly : skin);
    seg.rotation.z = -Math.PI / 2;   // lay the cylinder along +x
    seg.position.x = segLen / 2;
    sg.add(seg);
    const next = new THREE.Group(); next.position.x = segLen;
    sg.add(next);
    parent.add(sg);
    parent = next;
    segGroups.push(sg);
  }
  return { root, segGroups };
}

function updateKraken(t) {
  const K = three.kraken;
  if (!K) return;
  const g = K.group;

  // Only roams in extreme mode; otherwise stay hidden.
  if (!gfx.extreme) { if (K.state !== 'hidden') { K.state = 'hidden'; K.y = -10; g.visible = false; } }

  // respawn any swallowed islands after their timer
  if (three.smallIslands) three.smallIslands.forEach((isl) => {
    if (!isl.alive && t > isl.respawnAt) {
      isl.alive = true; isl.group.visible = true; isl.group.position.y = isl.baseY; isl.group.scale.setScalar(1);
    }
  });

  const dt = 0.016;
  switch (K.state) {
    case 'hidden': {
      g.visible = false;
      if (!gfx.extreme) return;
      K.timer -= dt;
      if (K.timer <= 0) {
        // pick an appearance: ~45% attack a small island, else just surface
        const targets = (three.smallIslands || []).filter((s) => s.alive);
        if (targets.length && Math.random() < 0.6) {
          K.target = targets[Math.floor(Math.random() * targets.length)];
          // surface right beside the island
          const ang = Math.random() * Math.PI * 2;
          K.x = K.target.x + Math.cos(ang) * 5;
          K.z = K.target.z + Math.sin(ang) * 5;
          K.mode = 'attack';
        } else {
          K.target = null; K.mode = 'roam';
          // sometimes near the board, sometimes far out
          const near = Math.random() < 0.5;
          const r = near ? 16 + Math.random() * 8 : 32 + Math.random() * 18;
          const ang = Math.random() * Math.PI * 2;
          K.x = Math.cos(ang) * r; K.z = Math.sin(ang) * r;
        }
        K.y = -10; K.prog = 0;
        // never surface under the island or inside a ship
        avoidObstacles(K, KRAKEN_R);
        K.heading = Math.atan2(-(K.target ? K.target.z - K.z : -K.z), (K.target ? K.target.x - K.x : -K.x));
        g.position.set(K.x, K.y, K.z);
        g.rotation.y = K.heading;
        g.visible = true;
        K.state = 'rising';
      }
      break;
    }
    case 'rising': {
      K.prog += dt / 2.4;
      K.y = -10 + (K.surfaceY + 10) * easeOut(Math.min(1, K.prog));
      g.position.y = K.y;
      if (K.prog >= 1) { K.state = K.mode === 'attack' ? 'attacking' : 'surface'; K.timer = 4 + Math.random() * 5; }
      break;
    }
    case 'surface': {
      K.timer -= dt;
      // gentle drift + bob on the surface
      g.position.y = K.surfaceY + Math.sin(t * 1.2) * 0.25;
      K.x += Math.cos(K.heading) * 0.02; K.z += Math.sin(K.heading) * 0.02;
      // bounce off the island / ships when drifting into them
      if (avoidObstacles(K, KRAKEN_R)) K.heading += Math.PI * 0.6;
      g.position.x = K.x; g.position.z = K.z;
      if (K.timer <= 0) { K.state = 'submerging'; K.prog = 0; }
      break;
    }
    case 'attacking': {
      // lunge toward the island, then drag it under
      const isl = K.target;
      if (!isl || !isl.alive) { K.state = 'submerging'; K.prog = 0; break; }
      const dx = isl.x - K.x, dz = isl.z - K.z; const d = Math.hypot(dx, dz);
      g.position.y = K.surfaceY + Math.sin(t * 2) * 0.3;
      if (d > 3.2) {
        K.x += (dx / d) * 0.06; K.z += (dz / d) * 0.06;
        avoidObstacles(K, KRAKEN_R); // shove past ships / stay off the board
        K.heading = Math.atan2(dz, dx); g.rotation.y = K.heading;
        g.position.x = K.x; g.position.z = K.z;
      } else {
        // grab! sink the island and the kraken together
        K.prog += dt / 2.5;
        const s = Math.max(0, 1 - K.prog);
        isl.group.position.y = isl.baseY - K.prog * 3.5;
        isl.group.scale.setScalar(s);
        g.position.y = K.surfaceY - K.prog * 3.0;
        if (K.prog >= 1) {
          isl.alive = false; isl.group.visible = false;
          isl.respawnAt = t + 18 + Math.random() * 14;
          K.state = 'hidden'; K.timer = 4 + Math.random() * 6;
        }
      }
      break;
    }
    case 'submerging': {
      K.prog += dt / 2.2;
      g.position.y = K.surfaceY - (K.surfaceY + 10) * easeIn(Math.min(1, K.prog));
      if (K.prog >= 1) { K.state = 'hidden'; K.timer = 4 + Math.random() * 6; g.visible = false; }
      break;
    }
  }

  // animate tentacles + eyes whenever visible
  if (g.visible) {
    // devour any dolphins it can reach while near the surface
    if (K.state === 'surface' || K.state === 'attacking' || K.state === 'rising') krakenEatDolphins(K, t);
    K.tentacles.forEach((ten) => {
      ten.segGroups.forEach((sg, i) => {
        // reach outward first, then curl down at the tips (menacing splay)
        const curl = (i < 2 ? 0.06 : -0.12 - (i - 2) * 0.09);
        const wave = Math.sin(t * 2.4 + ten.phase + i * 0.55) * (0.16 + i * 0.04);
        sg.rotation.z = curl + wave;
        sg.rotation.y = Math.sin(t * 1.5 + ten.phase + i * 0.4) * 0.12;
      });
    });
    const glow = true; // blood-red eyes always burn (horror)
    if (glow) {
      K.eyeMat.emissive.setHex(0xff1a1a);
      K.eyeMat.emissiveIntensity = 1.0 + Math.sin(t * 6) * 0.4; // ominous pulse
      K.eyeLights.forEach((l) => { l.visible = gfx.extreme; l.intensity = gfx.extreme ? (1.4 + Math.sin(t * 6) * 0.5) : 0; });
    }
  }
}

function easeOut(u) { return 1 - Math.pow(1 - u, 3); }
function easeIn(u) { return u * u * u; }

// ---- Sea-creature awareness / collision ----
const KRAKEN_R = 3.0; // kraken body radius (mantle + reach), world units

// Keep a sea creature of the given radius out from under the island and clear of
// the moored ships. Mutates obj.x / obj.z in place. Returns true if it was pushed
// (so callers can re-aim). `softBoats` lets the kraken nudge boats instead of
// being fully blocked when it is actively attacking past them.
function avoidObstacles(o, selfR, opts = {}) {
  let pushed = false;
  // 1) never swim under the board — clamp outside the island ring
  const cd = Math.hypot(o.x, o.z);
  const minR = (three.boardRadius || 12) + selfR;
  if (cd < minR) {
    const s = minR / (cd || 0.0001);
    o.x *= s; o.z *= s; pushed = true;
  }
  // 2) collide with the moored ships
  if (three.boats) {
    for (const b of three.boats) {
      const dx = o.x - b.position.x, dz = o.z - b.position.z;
      const d = Math.hypot(dx, dz);
      const minB = selfR + 1.6; // ship half-width
      if (d < minB && d > 0.0001) {
        const push = minB - d;
        o.x += (dx / d) * push; o.z += (dz / d) * push;
        pushed = true;
      }
    }
  }
  return pushed;
}

// The kraken devours any dolphin it touches. Hides the whole pod, sends it to
// flee far away, and keeps it gone for a while before it dares resurface.
function krakenEatDolphins(K, t) {
  if (!three.dolphinPods) return;
  const eatR = KRAKEN_R + 0.8;
  three.dolphinPods.forEach((pod) => {
    if (pod.eatenUntil && t < pod.eatenUntil) return;
    const hit = pod.members.some((m) => m.visible &&
      Math.hypot(m.position.x - K.x, m.position.z - K.z) < eatR);
    if (hit) {
      pod.members.forEach((m) => { m.visible = false; });
      pod.jumpT = -1;
      pod.eatenUntil = t + 16 + Math.random() * 12;
      pod.next = pod.eatenUntil + 1;
      // relocate the (surviving) pod far from the kraken, still off the board
      const ang = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 16;
      pod.x = Math.cos(ang) * r; pod.z = Math.sin(ang) * r;
    }
  });
}


// Switch the 3D scene between day and night looks.
function applySceneNight(on) {
  gfx.night = on;
  if (!three.scene) return;
  if (on) {
    // CALM MOONLIT NIGHT — deep blue but bright enough to read the board, with a
    // shimmering moonlit ocean.
    three.scene.background = new THREE.Color('#15294a');
    three.scene.fog = new THREE.Fog('#15294a', 58, 158);
    if (three.hemi) { three.hemi.color.set(0x7e98c0); if (three.hemi.groundColor) three.hemi.groundColor.set(0x303a52); three.hemi.intensity = 0.88; }
    three.hemiBase = 0.88;
    if (three.sunLight) { three.sunLight.color.set(0xbccfee); three.sunLight.intensity = 0.8; } // soft cool moonlight on the board
    if (three.sea) { three.sea.material.color.set(0x1d4274); three.sea.material.metalness = 0.7; three.sea.material.roughness = 0.16; }
    if (three.sunOrb) three.sunOrb.material.color.set(0xf4f8ff);   // bright pale moon
    if (three.sunGlow) { three.sunGlow.material.color.set(0xd6e6ff); three.sunGlow.material.opacity = 0.42; }
    if (three.cloudMat) { three.cloudMat.color.set(0x5a6c8c); three.cloudMat.opacity = 0.72; } // dim moonlit clouds
  } else {
    // SUNNY DAY — clear bright sky & relaxing light-blue ocean
    three.scene.background = new THREE.Color('#8fd0ec');
    three.scene.fog = new THREE.Fog('#bfe3f4', 62, 158);
    if (three.hemi) { three.hemi.color.set(0xc6e6f6); if (three.hemi.groundColor) three.hemi.groundColor.set(0x647358); three.hemi.intensity = 0.77; }
    three.hemiBase = 0.77;
    if (three.sunLight) { three.sunLight.color.set(0xffeccb); three.sunLight.intensity = 0.87; }
    if (three.sea) { three.sea.material.color.set(0x3399cf); three.sea.material.metalness = 0.55; three.sea.material.roughness = 0.34; }
    if (three.sunOrb) three.sunOrb.material.color.set(0xfff0c6);   // warm sun
    if (three.sunGlow) { three.sunGlow.material.color.set(0xffe2a0); three.sunGlow.material.opacity = 0.24; }
    if (three.cloudMat) { three.cloudMat.color.set(0xffffff); three.cloudMat.opacity = 0.82; } // bright daytime clouds
  }
  refreshNightEffects();
}

// Apply night/extreme-gated glows: torches, bar neon, cottage windows.
function refreshNightEffects() {
  const on = gfx.night;
  if (three.torches) three.torches.forEach((to) => {
    // nothing burns during the day — kiln/desert campfires and handheld torches
    // all only light up at night.
    if (to.flame) to.flame.visible = on;
    if (to.glow) {
      to.glow.visible = on; // hide the orange glow mesh entirely by day
      if (to.glow.material && to.glow.material.emissive) to.glow.material.emissive.setHex(on ? 0xff7a1a : 0x000000);
    }
    if (to.light) to.light.visible = on && gfx.extreme;
  });
  if (three.cottageWindows) three.cottageWindows.forEach((w) => w.material.emissive.setHex(on ? 0xffcf7a : 0x000000));
  if (three.barNeon) three.barNeon.forEach((n) => {
    n.mesh.material.emissive.setHex(on ? n.color : 0x000000);
    n.mesh.material.emissiveIntensity = on ? 1.4 : 0;
    if (n.light) { n.light.visible = on; n.light.intensity = on ? (gfx.extreme ? 1.6 : 0.8) : 0; }
  });
}

function onResize() {
  const host = $('three');
  if (!three.renderer) return;
  three.camera.aspect = host.clientWidth / host.clientHeight;
  three.camera.updateProjectionMatrix();
  three.renderer.setSize(host.clientWidth, host.clientHeight);
}

function resetCamera() {
  three.camera.position.set(0, 26, 24);
  three.controls.target.set(0, 0, 0);
  three.controls.update();
}

function animate() {
  requestAnimationFrame(animate);
  const t = performance.now() / 1000;
  const frame = (three.frame = (three.frame || 0) + 1);

  // animate sea waves — always on so the ocean reads as water (not a flat
  // color); update every 2nd frame to keep the per-vertex cost cheap.
  if (three.sea && three.seaBase && (frame & 1) === 0) {
    const pos = three.sea.geometry.attributes.position;
    const base = three.seaBase;
    const spd = gfx.night ? 4.4 : 3.0;     // wave speed
    const amp = gfx.night ? 0.34 : 0.30;   // crest height
    const amp2 = gfx.night ? 0.30 : 0.26;
    const chop = gfx.night ? 0.20 : 0.14;  // cross-chop
    const rip = gfx.night ? 0.10 : 0.08;   // fine high-frequency ripples (surface texture)
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const z = Math.sin(x * 0.22 + t * spd) * amp
              + Math.cos(y * 0.26 + t * (spd * 0.82)) * amp2
              + Math.sin((x + y) * 0.13 + t * (spd * 1.25)) * chop
              + Math.sin(x * 0.62 - y * 0.55 + t * (spd * 1.9)) * rip
              + Math.cos((x - y) * 0.78 + t * (spd * 2.3)) * rip * 0.7;
      pos.array[i * 3 + 2] = z;
    }
    pos.needsUpdate = true;
    // NOTE: the sea material uses flatShading, so normals are derived in the
    // fragment shader — no need for the expensive per-frame computeVertexNormals().
  }

  // bob + drift the port boats on the waves
  if (three.boats) {
    const wob = gfx.night ? 1.5 : 1.0;
    three.boats.forEach((boat, i) => {
      const ph = boat.userData.phase || 0;
      boat.position.y = (SEA_Y + 0.22) + Math.sin(t * 2.0 + ph) * 0.14 * wob; // ride the waterline
      boat.rotation.z = Math.sin(t * 1.6 + ph) * 0.13 * wob;
      boat.rotation.x = Math.cos(t * 1.3 + ph) * 0.09 * wob;
      const sway = Math.sin(t * 0.8 + ph) * 0.4;
      boat.position.x = boat.userData.bx + Math.cos(boat.userData.outAng) * sway;
      boat.position.z = boat.userData.bz + Math.sin(boat.userData.outAng) * sway;
    });
  }

  // recompute the hanging mooring ropes from each boat's current deck position
  if (three.ropes) three.ropes.forEach((r) => updateRope(r, t));

  // animated terrain props (sheep, farmers, falling rocks, tumbleweed…)
  if (three.animProps) three.animProps.forEach((p) => p.update(t));
  if (three.decorAnims) three.decorAnims.forEach((p) => p.update(t));

  // lighthouse rotating beam
  if (three.lighthouse) updateLighthouse(t);

  // the kraken
  if (three.kraken) updateKraken(t);

  // dolphins leaping in synced pods (extreme only)
  if (three.dolphinPods) three.dolphinPods.forEach((pod) => updateDolphinPod(pod, t));

  // torch flame flicker
  if (three.torches) three.torches.forEach((to) => {
    if (to.flame) to.flame.scale.setScalar(0.85 + Math.sin(t * 18 + to.ph) * 0.18);
    if (to.light && to.light.visible) to.light.intensity = to.baseI * (0.8 + Math.sin(t * 16 + to.ph) * 0.25);
  });

  // drifting clouds (slowly cross the sky, wrap around)
  if (three.clouds) three.clouds.forEach((cl) => {
    cl.position.x += cl.userData.speed * 0.016;
    if (cl.position.x > 90) cl.position.x = -90;
  });

  // circle + flap the birds
  if (three.birds) {
    three.birds.forEach((bird) => {
      const u = bird.userData;
      const a = u.offset + t * u.speed;
      bird.position.set(Math.cos(a) * u.radius, u.height + Math.sin(t + u.offset) * 1.2, Math.sin(a) * u.radius);
      bird.rotation.y = -a + Math.PI / 2;
      const flap = Math.sin(t * 8 + u.flap) * 0.5;
      u.lw.rotation.z = flap; u.rw.rotation.z = -flap;
    });
  }

  three.controls.update();
  // mini map — redraw every other frame so it stays in sync with camera rotation
  if ((frame & 1) === 0 && gameScreen && !gameScreen.classList.contains('hidden')) drawMiniMap();
  // Refresh shadows on a throttle in Extreme (every 4th frame) — the props that
  // move are tiny, so 15Hz shadow updates are visually indistinguishable yet
  // cut the shadow-pass GPU cost ~75%. Simple mode skips shadows entirely.
  if (three.renderer) {
    three.renderer.shadowMap.needsUpdate = gfx.extreme && (frame & 3) === 0;
  }
  three.renderer.render(three.scene, three.camera);
}

// ===================================================================
// BOARD GEOMETRY (built once per game)
// ===================================================================

// Build a rocky cliff + sandy beach under the tiles so the island sits in the
// water and the ocean laps against its walls (instead of the board hovering).
function ensureBoard() {
  const board = state.board;
  const key = board.hexes.map((h) => `${h.resource}${h.number}`).join('') + '|' + board.robber;
  if (three.boardKey === key) return;
  three.boardKey = key;
  if (board.center) BC = board.center;

  // board radius (farthest tile corner from centre) — sea creatures stay outside it
  let maxR = 0;
  board.hexes.forEach((h) => h.vertices.forEach((vid) => {
    const v = board.vertices[vid];
    maxR = Math.max(maxR, Math.hypot(TX(v.x), TZ(v.y)));
  }));
  three.boardRadius = maxR + 0.8;

  // clear
  clearGroup(three.boardGroup);
  clearGroup(three.markerGroup);
  three.vertexMarkers = []; three.edgeMarkers = []; three.hexMeshes = [];
  three.boats = [];
  three.animProps = [];   // animated terrain props: { update(t) }
  three.ropes = [];       // hanging boat ropes to recompute each frame
  three.torches = (three.torches || []).filter((to) => to.island); // keep island torches
  three.barNeon = [];     // rebuilt with the saloon

  // hexes
  board.hexes.forEach((hex) => {
    const mesh = buildHexMesh(hex);
    mesh.userData = { hid: hex.id };
    mesh.castShadow = true; mesh.receiveShadow = true;
    three.boardGroup.add(mesh);
    three.hexMeshes.push(mesh);

    // number token — a flat disc STUCK to the tile's top face. It is depth-tested
    // (depthTest on) so 3D props sitting on the tile naturally obscure it. Large
    // centerpiece props are biased toward the tile edges (see buildTerrain) so the
    // number stays partly readable, while small decor may cover it.
    if (hex.number) {
      const tex = tokenTexture(hex.number);
      const disc = new THREE.Mesh(
        new THREE.PlaneGeometry(HEX_R() * 0.6, HEX_R() * 0.6),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
      );
      disc.rotation.x = -Math.PI / 2;            // lay flat on the tile top
      disc.position.set(TX(hex.cx), TILE_H + 0.04, TZ(hex.cy));
      disc.renderOrder = 1;                       // draw just above the tile face
      three.boardGroup.add(disc);
    }
  });

  // Rich, clustered terrain (forests, herds, mountains, farms, saloon…)
  buildTerrain(board);

  // ports (animated boat + floating label)
  board.ports.forEach((port) => {
    const boat = makeBoat(port);
    const bx = TX(port.bx), bz = TZ(port.by);
    boat.position.set(bx, 0.2, bz);
    // point the bow out to sea so the broadside (sails) faces the board/viewer
    boat.rotation.y = Math.atan2(-bz, bx) + Math.PI / 2;
    boat.userData = { bx, bz, phase: Math.random() * Math.PI * 2, outAng: Math.atan2(bz, bx) };
    three.boardGroup.add(boat);
    three.boats.push(boat);

    const label = makeLabelSprite(
      port.type === '3:1' ? '3:1' : `2:1 ${RES_ICON[port.type]}`,
      port.type === '3:1' ? '#7a6a4a' : RES_COLORS[port.type]
    );
    label.position.set(bx, 2.0, bz);
    three.boardGroup.add(label);

    // hanging mooring ropes: catenary curves from the boat's deck cleats to the
    // two coastal corner pegs. They sag and sway as the boat bobs.
    const ROPE_N = 14;
    port.anchors.forEach((a, ai) => {
      const end = new THREE.Vector3(TX(a.x), TILE_H + 0.05, TZ(a.y));
      // corner peg the rope ties to
      const peg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.07, 0.22, 6),
        new THREE.MeshStandardMaterial({ color: 0x5a4326, roughness: 0.9 })
      );
      peg.position.set(end.x, TILE_H + 0.08, end.z);
      three.boardGroup.add(peg);

      const pts = new Array(ROPE_N).fill(0).map(() => new THREE.Vector3());
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xc9b48a, transparent: true, opacity: 0.85 }));
      line.frustumCulled = false;
      three.boardGroup.add(line);
      // cleat offset on the boat deck (left/right of mast), in boat-local space
      const cleat = new THREE.Vector3(ai === 0 ? 0.5 : -0.5, 0.5, ai === 0 ? 0.32 : -0.32);
      three.ropes.push({ line, boat, end, cleat, n: ROPE_N, phase: Math.random() * 6 });
    });
  });

  // markers (vertices + edges) for placement — rendered ON TOP of all terrain
  // (depthTest off) so you can always see/aim at spots even behind a mountain.
  board.vertices.forEach((v) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xeaffd0, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false })
    );
    m.position.set(TX(v.x), TILE_H + 0.55, TZ(v.y));
    m.userData = { vid: v.id };
    m.visible = false;
    m.renderOrder = 950;
    three.markerGroup.add(m);
    three.vertexMarkers.push(m);
  });
  board.edges.forEach((e) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false })
    );
    m.position.set(TX(e.x), TILE_H + 0.5, TZ(e.y));
    m.userData = { eid: e.id };
    m.visible = false;
    m.renderOrder = 950;
    three.markerGroup.add(m);
    three.edgeMarkers.push(m);
  });

  // Newly built terrain humans carry torches whose flames default to OFF. Apply
  // the current night/extreme state now so handheld torches light up at night
  // (this also covers starting a game with night mode already persisted).
  refreshNightEffects();

  resetCamera();
}

function HEX_R() { return (state.board.hexSize || 60) * S; }

// Build a hexagonal prism mesh from the hex's actual corner vertices.
function buildHexMesh(hex) {
  const board = state.board;
  const corners = hex.vertices.map((vid) => board.vertices[vid]);
  const cx = TX(hex.cx), cz = TZ(hex.cy);
  const top = TILE_H;
  const bottom = TILE_BOTTOM; // dip deep below the waterline

  const positions = [];
  const pushTri = (ax, ay, az, bx, by, bz, dx, dy, dz) => positions.push(ax, ay, az, bx, by, bz, dx, dy, dz);

  // top face (fan from center)
  for (let i = 0; i < 6; i++) {
    const a = corners[i], b = corners[(i + 1) % 6];
    pushTri(cx, top, cz, TX(a.x), top, TZ(a.y), TX(b.x), top, TZ(b.y));
  }
  // side walls (extend down to the sea floor so the island looks submerged)
  for (let i = 0; i < 6; i++) {
    const a = corners[i], b = corners[(i + 1) % 6];
    const ax = TX(a.x), az = TZ(a.y), bx = TX(b.x), bz = TZ(b.y);
    pushTri(ax, top, az, ax, bottom, az, bx, bottom, bz);
    pushTri(ax, top, az, bx, bottom, bz, bx, top, bz);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // planar UVs (mapped from each vertex's position within the tile) so the subtle
  // ground texture sits flat on the top face.
  const uvs = [];
  const R2 = HEX_R() * 2;
  for (let i = 0; i < positions.length; i += 3) {
    uvs.push((positions[i] - cx) / R2 + 0.5, (positions[i + 2] - cz) / R2 + 0.5);
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  // base tint comes from the texture; gentle mottling keeps the tile from looking flat
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tileTexture(hex.resource), roughness: 0.72, flatShading: true, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

// ===================================================================
// RICH CLUSTERED TERRAIN
// ===================================================================
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// hexes that share exactly 2 vertices are neighbors (share an edge)
function hexesAdjacent(hi, hj) {
  return hi.vertices.filter((v) => hj.vertices.includes(v)).length === 2;
}

// Union adjacent same-resource hexes into clusters.
function computeClusters(board) {
  const n = board.hexes.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = board.hexes[i], b = board.hexes[j];
    if (a.resource === b.resource && hexesAdjacent(a, b)) parent[find(i)] = find(j);
  }
  const groups = {};
  for (let i = 0; i < n; i++) (groups[find(i)] ||= []).push(i);
  return Object.values(groups);
}

// midpoints (world) of edges shared between two hexes in the same cluster
function clusterSharedMids(board, idxs) {
  const mids = [];
  for (let a = 0; a < idxs.length; a++) for (let b = a + 1; b < idxs.length; b++) {
    const hi = board.hexes[idxs[a]], hj = board.hexes[idxs[b]];
    const sh = hi.vertices.filter((v) => hj.vertices.includes(v));
    if (sh.length === 2) {
      const v1 = board.vertices[sh[0]], v2 = board.vertices[sh[1]];
      mids.push({ x: (TX(v1.x) + TX(v2.x)) / 2, z: (TZ(v1.y) + TZ(v2.y)) / 2 });
    }
  }
  return mids;
}

// random point inside a hex (world coords)
function hexRandPoint(hex, rng, spread = 0.78) {
  const cx = TX(hex.cx), cz = TZ(hex.cy), r = HEX_R() * spread;
  let px, pz;
  do { px = rng() * 2 - 1; pz = rng() * 2 - 1; } while (px * px + pz * pz > 1);
  return { x: cx + px * r * 0.82, z: cz + pz * r * 0.82, cx, cz };
}

// A point biased toward the tile EDGES (an annulus that avoids the centre). Used
// to keep large centerpiece props (big peaks, furnaces, kilns) off the middle of
// the tile so the flat number disc underneath stays partly readable.
function hexEdgePoint(hex, rng, minR = 0.45, maxR = 0.72) {
  const cx = TX(hex.cx), cz = TZ(hex.cy);
  const ang = rng() * Math.PI * 2;
  const rad = HEX_R() * (minR + rng() * (maxR - minR));
  return { x: cx + Math.cos(ang) * rad, z: cz + Math.sin(ang) * rad, cx, cz };
}

// Nudge a centroid outward from a tile centre toward an edge by a fixed fraction
// of the hex radius, at a random angle — keeps cluster centerpieces off-centre.
function nudgeToEdge(cx, cz, rng, frac = 0.5) {
  const ang = rng() * Math.PI * 2;
  const rad = HEX_R() * frac;
  return { x: cx + Math.cos(ang) * rad, z: cz + Math.sin(ang) * rad };
}

function regMesh(obj) { obj.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return obj; }

function buildTerrain(board) {
  const clusters = computeClusters(board);
  three.crossings = [];                 // road-crossing decorations to manage
  three.terrainProps = three.terrainProps || []; // props that roads can clear
  three.terrainProps.length = 0;
  clusters.forEach((idxs) => {
    const res = board.hexes[idxs[0]].resource;
    if (res === 'lumber') buildForest(board, idxs);
    else if (res === 'wool') buildPasture(board, idxs);
    else if (res === 'grain') buildFarm(board, idxs);
    else if (res === 'ore') buildMountains(board, idxs);
    else if (res === 'brick') buildBrickworks(board, idxs);
    else if (res === 'desert') buildDesert(board, idxs);
  });
}

// Forward convention for all creatures is local +x. Point an object so its
// +x axis aims along the movement direction (dx, dz). (Fixes "side-walking".)
function faceDir(obj, dx, dz) {
  if (dx === 0 && dz === 0) return;
  obj.rotation.y = Math.atan2(-dz, dx);
}

// ---- LUMBER: dense forest, varied tree sizes, log stacks + a lumberjack ----
function buildForest(board, idxs) {
  const region = [];
  idxs.forEach((hid) => {
    const hex = board.hexes[hid];
    region.push({ x: TX(hex.cx), z: TZ(hex.cy) });
    const rng = mulberry32(hid * 911 + 7);
    const bigs = denseCount(4, 2), smalls = denseCount(14, 4);          // denser forest (Extreme)
    for (let i = 0; i < bigs + smalls; i++) {
      const big = i < bigs;
      // big trees hug the tile edges (keep the centre clear for the number disc);
      // small trees may scatter anywhere, including over the number.
      const p = big ? hexEdgePoint(hex, rng, 0.42, 0.7) : hexRandPoint(hex, rng, 0.88);
      const size = big ? 1.3 + rng() * 0.6 : 0.45 + rng() * 0.5;
      const tree = regMesh(makeTree(size, rng));
      tree.position.set(p.x, TILE_H, p.z);
      tree.rotation.y = rng() * 6.28;
      three.boardGroup.add(tree);
      three.terrainProps.push({ x: p.x, z: p.z, r: 0.4 * size, obj: tree, kind: 'tree' });
    }
    // underbrush
    for (let i = 0; i < denseCount(9, 3); i++) {
      const p = hexRandPoint(hex, rng, 0.92);
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.16 + rng() * 0.12, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 1, flatShading: true }));
      bush.position.set(p.x, TILE_H + 0.08, p.z); bush.scale.y = 0.7;
      three.boardGroup.add(bush);
    }
    // stacked logs (cut timber)
    for (let i = 0; i < 2; i++) {
      const p = hexRandPoint(hex, rng, 0.6);
      const logs = regMesh(makeLogStack(rng));
      logs.position.set(p.x, TILE_H, p.z); logs.rotation.y = rng() * 6.28;
      three.boardGroup.add(logs);
    }
  });
  // a lumberjack roaming the woods, chopping
  const lj = regMesh(makeHuman(0x4a6e2a, false));
  lj.position.set(region[0].x, TILE_H, region[0].z);
  three.boardGroup.add(lj);
  const wk = makeWalker(lj, region, 0.32, true);
  three.animProps.push({ update: (t) => updateWalker(wk, t) });
}

// A neat pile of cut logs (cross-stacked).
function makeLogStack(rng) {
  const g = new THREE.Group();
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.95, flatShading: true });
  const endMat = new THREE.MeshStandardMaterial({ color: 0xc7a06a, roughness: 0.9 });
  const logGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 8);
  const layout = [[-0.1, 0.09, 0], [0.1, 0.09, 0], [0, 0.27, 0]];
  layout.forEach(([x, y, z], i) => {
    const log = new THREE.Mesh(logGeo, [barkMat, endMat, endMat]);
    log.rotation.z = Math.PI / 2;            // lie flat, along x
    if (i === 2) log.rotation.y = 0;          // top log
    log.position.set(x, y, z);
    log.castShadow = true;
    g.add(log);
  });
  return g;
}

function makeTree(size, rng) {
  const g = new THREE.Group();
  const trunkH = 0.4 * size;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * size, 0.08 * size, trunkH, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }));
  trunk.position.y = trunkH / 2;
  g.add(trunk);
  const tiers = size > 1 ? 3 : 2;
  const green = [0x1f6b1f, 0x2e8b2e, 0x3aa83a][(rng ? Math.floor(rng() * 3) : 0)];
  for (let k = 0; k < tiers; k++) {
    const rad = (0.34 - k * 0.06) * size;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, 0.7 * size, 7),
      new THREE.MeshStandardMaterial({ color: green, roughness: 0.85, flatShading: true }));
    cone.position.y = trunkH + 0.3 * size + k * 0.32 * size;
    g.add(cone);
  }
  return g;
}

// ---- WOOL: grassy field + sheep that wander the whole cluster + a shepherd ----
function buildPasture(board, idxs) {
  const region = idxs.map((hid) => {
    const h = board.hexes[hid];
    return { x: TX(h.cx), z: TZ(h.cy) };
  });
  // grass tufts across every tile
  idxs.forEach((hid) => {
    const hex = board.hexes[hid];
    const rng = mulberry32(hid * 523 + 3);
    // dense grass carpet
    for (let i = 0; i < denseCount(60, 18); i++) {
      const p = hexRandPoint(hex, rng, 0.94);
      three.boardGroup.add(makeGrassTuft(p.x, p.z, rng));
    }
    // leafy bushes dotted around
    for (let i = 0; i < denseCount(7, 2); i++) {
      const p = hexRandPoint(hex, rng, 0.85);
      const bush = makeBush(rng);
      bush.position.set(p.x, TILE_H, p.z);
      three.boardGroup.add(bush);
    }
  });
  // sheep wandering the combined region (more when tiles merge)
  const count = Math.min(14, denseCount(4 + idxs.length * 3, 2));
  const rng = mulberry32(idxs[0] * 131 + 5);
  for (let i = 0; i < count; i++) {
    const home = region[Math.floor(rng() * region.length)];
    const sheep = regMesh(makeSheep());
    const start = { x: home.x + (rng() - 0.5) * HEX_R(), z: home.z + (rng() - 0.5) * HEX_R() };
    sheep.position.set(start.x, TILE_H, start.z);
    three.boardGroup.add(sheep);
    const st = { obj: sheep, region, rng: mulberry32(i * 99 + idxs[0]), tx: start.x, tz: start.z, grazeT: 0, speed: 0.25 + rng() * 0.15 };
    pickSheepTarget(st);
    three.animProps.push({ update: (t) => updateSheep(st, t) });
  }
  // a shepherd with a staff
  const sh = regMesh(makeHuman(0x7a5a3a, true));
  const h0 = region[0];
  sh.position.set(h0.x, TILE_H, h0.z);
  three.boardGroup.add(sh);
  const wk = makeWalker(sh, region, 0.4);
  three.animProps.push({ update: (t) => updateWalker(wk, t) });
}

function makeGrassTuft(x, z, rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4f9d3a, roughness: 1, flatShading: true });
  for (let b = 0; b < 3; b++) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16 + (rng ? rng() : 0.5) * 0.12, 4), mat);
    blade.position.set((b - 1) * 0.04, 0.09, (rng ? rng() - 0.5 : 0) * 0.05);
    blade.rotation.z = (b - 1) * 0.2;
    g.add(blade);
  }
  g.position.set(x, TILE_H, z);
  return g;
}

// A small leafy bush (a few clustered spheres).
function makeBush(rng) {
  const g = new THREE.Group();
  const greens = [0x2e7d32, 0x3aa83a, 0x256b28];
  for (let i = 0; i < 3; i++) {
    const r = 0.16 + (rng ? rng() : 0.5) * 0.12;
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 6),
      new THREE.MeshStandardMaterial({ color: greens[i % 3], roughness: 1, flatShading: true }));
    blob.position.set((i - 1) * 0.16, 0.12 + (i === 1 ? 0.08 : 0), (rng ? rng() - 0.5 : 0) * 0.16);
    blob.scale.y = 0.8; blob.castShadow = true;
    g.add(blob);
  }
  return g;
}

function makeSheep() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 1 }));
  body.scale.set(1.3, 1, 0.9); body.position.y = 0.26;
  const headPivot = new THREE.Group();
  headPivot.position.set(0.28, 0.3, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x33373a, roughness: 0.9 }));
  head.position.set(0.04, 0, 0);
  headPivot.add(head);
  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.16, 5);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x33373a });
  [[0.12, 0.12], [-0.12, 0.12], [0.12, -0.12], [-0.12, -0.12]].forEach(([x, z]) => {
    const l = new THREE.Mesh(legGeo, legMat); l.position.set(x, 0.08, z); g.add(l);
  });
  g.add(body, headPivot);
  g.userData.head = headPivot;
  return g;
}

function pickSheepTarget(st) {
  const home = st.region[Math.floor(st.rng() * st.region.length)];
  st.tx = home.x + (st.rng() - 0.5) * HEX_R() * 1.1;
  st.tz = home.z + (st.rng() - 0.5) * HEX_R() * 1.1;
  st.grazeT = 0;
}

function updateSheep(st, t) {
  const o = st.obj;
  if (st.grazeT > 0) {
    // grazing: head down, gentle bob, then resume
    st.grazeT -= 0.016;
    if (o.userData.head) o.userData.head.rotation.z = -0.9 + Math.sin(t * 4) * 0.1;
    if (st.grazeT <= 0) pickSheepTarget(st);
    return;
  }
  if (o.userData.head) o.userData.head.rotation.z = Math.max(0, (o.userData.head.rotation.z || 0) - 0.05);
  const dx = st.tx - o.position.x, dz = st.tz - o.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.12) { st.grazeT = 1.5 + st.rng() * 2.5; return; }
  const v = st.speed * 0.016;
  o.position.x += (dx / d) * v;
  o.position.z += (dz / d) * v;
  faceDir(o, dx, dz);
  o.position.y = TILE_H + Math.abs(Math.sin(t * 6 + st.tx)) * 0.03; // little hop
}

// ---- GRAIN: dense wheat rows + farmers walking & cutting ----
function buildFarm(board, idxs) {
  const region = [];
  idxs.forEach((hid) => {
    const hex = board.hexes[hid];
    const rng = mulberry32(hid * 277 + 9);
    region.push({ x: TX(hex.cx), z: TZ(hex.cy) });
    for (let i = 0; i < denseCount(48, 14); i++) {           // much denser wheat (Extreme)
      const p = hexRandPoint(hex, rng, 0.92);
      const patch = makeWheatPatch(rng);
      patch.position.set(p.x, TILE_H, p.z);
      patch.rotation.y = rng() * 6.28;
      regMesh(patch);
      three.boardGroup.add(patch);
    }
    // a few hay bales
    for (let i = 0; i < 2; i++) {
      const p = hexRandPoint(hex, rng, 0.6);
      const bale = makeHayBale();
      bale.position.set(p.x, TILE_H, p.z); bale.rotation.y = rng() * 6.28;
      regMesh(bale); three.boardGroup.add(bale);
    }
  });
  // farmers harvesting (more when tiles merge)
  const farmers = Math.min(3, 1 + idxs.length);
  for (let f = 0; f < farmers; f++) {
    const farmer = regMesh(makeHuman(0x9a3b2a, false));
    const h0 = region[f % region.length];
    farmer.position.set(h0.x, TILE_H, h0.z);
    three.boardGroup.add(farmer);
    const wk = makeWalker(farmer, region, 0.35, true);
    three.animProps.push({ update: (t) => updateWalker(wk, t) });
  }
  // a dog and a cat darting through the field, faster than the farmers
  const dog = regMesh(makePet(0x8a5a2a, true));   // dog
  dog.position.set(region[0].x, TILE_H, region[0].z);
  three.boardGroup.add(dog);
  const dwk = { obj: dog, region, rng: mulberry32(idxs[0] * 71 + 2), tx: region[0].x, tz: region[0].z, grazeT: 0, speed: 0.7, pet: true };
  pickSheepTarget(dwk);
  three.animProps.push({ update: (t) => updatePet(dwk, t) });
  const cat = regMesh(makePet(0x3a3530, false));  // cat
  cat.position.set(region[0].x, TILE_H, region[0].z);
  three.boardGroup.add(cat);
  const cwk = { obj: cat, region, rng: mulberry32(idxs[0] * 71 + 9), tx: region[0].x, tz: region[0].z, grazeT: 0, speed: 0.85, pet: true };
  pickSheepTarget(cwk);
  three.animProps.push({ update: (t) => updatePet(cwk, t) });
}

// A small four-legged pet (dog if hasTail-up). Forward = +x.
function makePet(color, isDog) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.16), mat);
  body.position.y = 0.18;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), mat);
  head.position.set(0.22, 0.24, 0);
  const ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 4), mat); ear1.position.set(0.22, 0.34, 0.05);
  const ear2 = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 4), mat); ear2.position.set(0.22, 0.34, -0.05);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5), mat);
  tail.position.set(-0.2, isDog ? 0.26 : 0.2, 0); tail.rotation.z = isDog ? -0.8 : 0.4;
  const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.16, 5);
  [[0.12, 0.06], [-0.12, 0.06], [0.12, -0.06], [-0.12, -0.06]].forEach(([x, z]) => {
    const l = new THREE.Mesh(legGeo, mat); l.position.set(x, 0.08, z); g.add(l);
  });
  g.add(body, head, ear1, ear2, tail);
  g.userData.tail = tail;
  return g;
}

function updatePet(st, t) {
  const o = st.obj;
  if (st.grazeT > 0) { st.grazeT -= 0.016; if (st.grazeT <= 0) pickSheepTarget(st); return; }
  const dx = st.tx - o.position.x, dz = st.tz - o.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) { st.grazeT = 0.4 + st.rng() * 1.2; return; }
  const v = st.speed * 0.016;
  o.position.x += (dx / d) * v;
  o.position.z += (dz / d) * v;
  faceDir(o, dx, dz);
  o.position.y = TILE_H + Math.abs(Math.sin(t * 12 + st.tx)) * 0.06; // bouncy run
  if (o.userData.tail) o.userData.tail.rotation.y = Math.sin(t * 14) * 0.5; // wag
}

function makeHayBale() {
  const g = new THREE.Group();
  const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.34, 12),
    new THREE.MeshStandardMaterial({ color: 0xd9b84a, roughness: 1, flatShading: true }));
  bale.rotation.z = Math.PI / 2; bale.position.y = 0.22; bale.castShadow = true;
  g.add(bale);
  return g;
}

function makeWheatPatch(rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe8c34a, roughness: 0.9, flatShading: true });
  const n = 6;
  for (let i = 0; i < n; i++) {
    const ox = (rng() - 0.5) * 0.22, oz = (rng() - 0.5) * 0.22;
    const h = 0.42 + rng() * 0.18;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, h, 4), mat);
    stalk.position.set(ox, h / 2, oz);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), mat);
    head.position.set(ox, h + 0.06, oz);
    g.add(stalk, head);
  }
  return g;
}

// ---- ORE: mountain ranges; adjacent ore tiles merge into one massive peak on
//          the shared edge, with small rocks tumbling + shattering on the slopes ----
function buildMountains(board, idxs) {
  // size tiers: small / large / very-large
  const TIERS = [0.85, 1.35, 2.0];
  if (idxs.length >= 2) {
    const mids = clusterSharedMids(board, idxs);
    // one VERY large peak straddling each shared edge
    mids.forEach((m, i) => addBigMountain(m.x, m.z, TIERS[2] + (i % 2) * 0.3, idxs[0] * 31 + i));
    // plus a spread of small/large peaks across the tiles for a dense range
    idxs.forEach((hid) => {
      const hex = board.hexes[hid];
      const rng = mulberry32(hid * 613 + 2);
      const peaks = denseCount(3 + Math.floor(rng() * 2), 1);
      for (let i = 0; i < peaks; i++) {
        const p = hexEdgePoint(hex, rng, 0.4, 0.72); // keep peaks off the tile centre
        const tier = TIERS[Math.floor(rng() * 2)]; // small or large
        addBigMountain(p.x, p.z, tier, hid * 97 + i);
      }
      for (let i = 0; i < denseCount(4, 1); i++) {
        const p = hexRandPoint(hex, rng, 0.9);
        const r = regMesh(makeRock(0.6 + rng() * 0.5));
        r.position.set(p.x, TILE_H, p.z); three.boardGroup.add(r);
      }
    });
  } else {
    const hex = board.hexes[idxs[0]];
    const rng = mulberry32(idxs[0] * 71 + 4);
    // a cluster of varied peaks — keep the very-large peak OFF-CENTRE (toward an
    // edge) so the tile's number disc stays partly readable underneath.
    const big = hexEdgePoint(hex, rng, 0.42, 0.62);
    addBigMountain(big.x, big.z, TIERS[2], idxs[0] * 17);
    const peaks = denseCount(4, 1);
    for (let i = 0; i < peaks; i++) {
      const p = hexEdgePoint(hex, rng, 0.4, 0.72);
      const tier = TIERS[Math.floor(rng() * 2)];
      addBigMountain(p.x, p.z, tier, idxs[0] * 53 + i);
    }
    for (let i = 0; i < denseCount(4, 1); i++) {
      const p = hexRandPoint(hex, rng, 0.9);
      const r = regMesh(makeRock(0.6 + rng() * 0.4));
      r.position.set(p.x, TILE_H, p.z); three.boardGroup.add(r);
    }
  }
}

// A crooked, craggy mountain (cone with jittered vertices + lopsided ridges).
function makeMountain(scale, seed) {
  const rng = mulberry32(seed | 0);
  const g = new THREE.Group();
  const h = 2.2 * scale;
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f7c84, roughness: 1, flatShading: true });

  // main peak — displace cone vertices so it looks crooked/rocky
  const geo = new THREE.ConeGeometry(1.05 * scale, h, 7, 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const yN = (pos.getY(i) + h / 2) / h; // 0 base .. 1 tip
    const j = (1 - yN) * 0.5 * scale;
    pos.setX(i, pos.getX(i) + (rng() - 0.5) * j);
    pos.setZ(i, pos.getZ(i) + (rng() - 0.5) * j);
    if (yN > 0.1 && yN < 0.95) pos.setY(i, pos.getY(i) + (rng() - 0.5) * 0.2 * scale);
  }
  geo.computeVertexNormals();
  const peak = new THREE.Mesh(geo, rockMat);
  peak.position.y = h / 2;
  // lean the whole peak slightly for a crooked silhouette
  peak.rotation.z = (rng() - 0.5) * 0.35;
  peak.rotation.x = (rng() - 0.5) * 0.2;
  g.add(peak);

  // a side ridge
  const ridge = new THREE.Mesh(new THREE.ConeGeometry(0.6 * scale, h * 0.62, 5, 1),
    new THREE.MeshStandardMaterial({ color: 0x5f6b73, roughness: 1, flatShading: true }));
  ridge.position.set((rng() - 0.3) * 0.6 * scale, h * 0.3, (rng() - 0.5) * 0.5 * scale);
  ridge.rotation.z = (rng() - 0.5) * 0.4;
  g.add(ridge);

  // SNOW BLANKET — a snow shell draped over the upper ~55% of the peak, with an
  // uneven lower edge so it looks like snow blanketing the rock (not a hat).
  if (scale > 0.8) {
    const snowH = h * 0.6;
    const snowR = 1.05 * scale * 0.55 * 1.16; // overhang past the rock at the snow line
    const snowGeo = new THREE.ConeGeometry(snowR, snowH, 9, 4);
    const sp = snowGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const yN = (sp.getY(i) + snowH / 2) / snowH; // 0 base .. 1 tip
      // drape: pull the bottom ring down unevenly along gullies
      if (yN < 0.25) sp.setY(i, sp.getY(i) - rng() * 0.45 * scale);
      // ripple the surface a touch
      const j = (1 - yN) * 0.12 * scale;
      sp.setX(i, sp.getX(i) + (rng() - 0.5) * j);
      sp.setZ(i, sp.getZ(i) + (rng() - 0.5) * j);
    }
    snowGeo.computeVertexNormals();
    const snow = new THREE.Mesh(snowGeo,
      new THREE.MeshStandardMaterial({ color: 0xf4f8fc, roughness: 0.7, flatShading: true }));
    // align the blanket with the leaning rock peak
    snow.position.set(peak.rotation.z * -h * 0.32, h - snowH / 2 + 0.05, 0);
    snow.rotation.z = peak.rotation.z;
    snow.rotation.x = peak.rotation.x;
    g.add(snow);
  }
  return g;
}

function addBigMountain(x, z, scale, seed) {
  const rng = mulberry32(seed | 0);
  const g = makeMountain(scale, seed);
  g.position.set(x, TILE_H, z);
  g.rotation.y = rng() * 6.28;
  regMesh(g);
  three.boardGroup.add(g);

  // falling rocks tumbling down the slope, shattering on impact
  const h = 2.2 * scale;
  const count = scale > 1.5 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const chunk = makeRock(0.5 + rng() * 0.3);
    chunk.castShadow = true;
    g.add(chunk);
    // pre-build shard fragments (hidden until impact)
    const shardMat = new THREE.MeshStandardMaterial({ color: 0x808a90, roughness: 1, flatShading: true });
    const shards = [];
    for (let s = 0; s < 5; s++) {
      const sh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.07 + rng() * 0.05), shardMat);
      sh.visible = false; g.add(sh);
      shards.push(sh);
    }
    const st = { obj: chunk, shards, top: h * 0.82, scale, rng: mulberry32(seed * 7 + i), phase: 'fall' };
    resetFallingRock(st);
    three.animProps.push({ update: (t) => updateFallingRock(st, t) });
  }
}

function resetFallingRock(st) {
  st.phase = 'fall';
  st.ang = st.rng() * 6.28;
  st.y = st.top;
  st.vy = 0;
  st.r = 0.18 * st.scale;
  st.spin = (st.rng() - 0.5) * 0.4;
  st.obj.visible = true;
  st.obj.scale.setScalar(1);
  st.shards.forEach((s) => { s.visible = false; });
  st.breakT = 0;
  st.wait = 1.0 + st.rng() * 2.5;
}

function updateFallingRock(st, t) {
  if (st.phase === 'fall') {
    st.vy -= 0.014;
    st.y += st.vy;
    st.r += 0.018 * st.scale;
    const o = st.obj;
    o.position.set(Math.cos(st.ang) * st.r, Math.max(0.06, st.y), Math.sin(st.ang) * st.r);
    o.rotation.x += st.spin; o.rotation.z += st.spin * 0.7;
    if (st.y <= 0.08) {
      // hit the ground — shatter into shards
      st.phase = 'break';
      st.breakT = 0;
      o.visible = false;
      const gx = Math.cos(st.ang) * st.r, gz = Math.sin(st.ang) * st.r;
      st.shards.forEach((s) => {
        s.visible = true;
        s.position.set(gx, 0.08, gz);
        const a = st.rng() * 6.28, sp = 0.04 + st.rng() * 0.06;
        s.userData = { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 0.06 + st.rng() * 0.05,
          rx: (st.rng() - 0.5) * 0.4, rz: (st.rng() - 0.5) * 0.4 };
      });
    }
  } else if (st.phase === 'break') {
    st.breakT += 0.016;
    st.shards.forEach((s) => {
      const u = s.userData;
      u.vy -= 0.01;
      s.position.x += u.vx; s.position.y = Math.max(0.04, s.position.y + u.vy); s.position.z += u.vz;
      s.rotation.x += u.rx; s.rotation.z += u.rz;
      u.vx *= 0.96; u.vz *= 0.96;
      s.scale.setScalar(Math.max(0, 1 - st.breakT / 1.6)); // shrink away
    });
    if (st.breakT > 1.6) { resetFallingRock(st); st.phase = 'wait'; st.waitT = 0; }
  } else if (st.phase === 'wait') {
    st.waitT = (st.waitT || 0) + 0.016;
    if (st.waitT > st.wait) resetFallingRock(st);
  }
}

function makeRock(size) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x808a90, roughness: 1, flatShading: true });
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26 * size, 0), mat);
  r.position.y = 0.2 * size; r.rotation.set(0.5, 0.8, 0.2);
  const r2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 * size, 0), mat);
  r2.position.set(0.24 * size, 0.12 * size, 0.1 * size);
  g.add(r, r2);
  return g;
}

// ---- BRICK: a kiln, brick stacks, and a worker carrying bricks ----
function buildBrickworks(board, idxs) {
  const region = idxs.map((hid) => { const h = board.hexes[hid]; return { x: TX(h.cx), z: TZ(h.cy) }; });
  // centroid of the cluster
  const cx = region.reduce((s, r) => s + r.x, 0) / region.length;
  const cz = region.reduce((s, r) => s + r.z, 0) / region.length;
  const brng = mulberry32(idxs[0] * 419 + 1);
  // big OPEN FURNACE as the centerpiece, nudged toward an edge (with the old kiln
  // beside it) so the tile number disc underneath stays partly readable.
  const fpos = nudgeToEdge(cx, cz, brng, 0.5);
  const furnace = regMesh(makeFurnace());
  furnace.position.set(fpos.x, TILE_H, fpos.z);
  furnace.scale.setScalar(idxs.length > 1 ? 1.25 : 0.95);
  three.boardGroup.add(furnace);
  const kiln = regMesh(makeKiln());
  kiln.position.set(fpos.x + HEX_R() * 0.5, TILE_H, fpos.z + HEX_R() * 0.22);
  kiln.scale.setScalar(idxs.length > 1 ? 1.3 : 1.0);
  three.boardGroup.add(kiln);

  // stacks and stacks of bricks, low brick walls, and a clay pit on each tile
  idxs.forEach((hid) => {
    const hex = board.hexes[hid];
    const rng = mulberry32(hid * 419 + 6);
    for (let i = 0; i < denseCount(12, 5); i++) {
      const p = hexRandPoint(hex, rng, 0.9);
      const stack = regMesh(makeBrickPile(rng, 6 + Math.floor(rng() * 6)));
      stack.position.set(p.x, TILE_H, p.z); stack.rotation.y = rng() * 6.28;
      three.boardGroup.add(stack);
    }
    // a couple of long stacked brick walls
    for (let i = 0; i < denseCount(3, 1); i++) {
      const p = hexRandPoint(hex, rng, 0.72);
      const wall = regMesh(makeBrickWall(rng));
      wall.position.set(p.x, TILE_H, p.z); wall.rotation.y = rng() * 6.28;
      three.boardGroup.add(wall);
    }
    // a reddish clay pit
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x8a4a30, roughness: 1, flatShading: true }));
    const pp = hexRandPoint(hex, rng, 0.55);
    pit.position.set(pp.x, TILE_H - 0.02, pp.z);
    three.boardGroup.add(pit);
  });

  // a brick TRUCK that drives between the tiles, hauling bricks to the kiln
  const truck = regMesh(makeBrickTruck());
  truck.position.set(region[0].x, TILE_H, region[0].z);
  three.boardGroup.add(truck);
  const tw = { obj: truck, region: [...region, { x: cx, z: cz }], speed: 0.55, tx: cx, tz: cz, rng: mulberry32(idxs[0] * 13 + 4), pause: 0, wheels: truck.userData.wheels };
  pickWalkerTarget(tw);
  three.animProps.push({ update: (t) => updateTruck(tw, t) });

  // a worker
  const w = regMesh(makeHuman(0xb5651d, false));
  w.position.set(region[0].x, TILE_H, region[0].z);
  three.boardGroup.add(w);
  const wk = makeWalker(w, region, 0.3, true);
  three.animProps.push({ update: (t) => updateWalker(wk, t) });
}

// A little flatbed truck loaded with bricks. Forward = +x.
function makeBrickTruck() {
  const g = new THREE.Group();
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x2f6db0, roughness: 0.7, flatShading: true });
  const bedMat = new THREE.MeshStandardMaterial({ color: 0x3a4654, roughness: 0.9, flatShading: true });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.34), cabMat);
  cab.position.set(0.26, 0.32, 0);
  const cabTop = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.3), cabMat);
  cabTop.position.set(0.26, 0.5, 0);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.4), bedMat);
  bed.position.set(-0.12, 0.26, 0);
  // brick load
  const brickMat = new THREE.MeshStandardMaterial({ color: 0xa0432a, roughness: 0.95, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.12), brickMat);
    b.position.set(-0.26 + (i % 3) * 0.15, 0.36 + Math.floor(i / 3) * 0.09, (i % 2 ? 0.08 : -0.08));
    g.add(b);
  }
  // wheels (spin while moving)
  const wheelGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x16181c });
  const wheels = [];
  [[0.24, 0.2], [0.24, -0.2], [-0.2, 0.2], [-0.2, -0.2]].forEach(([x, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2; wheel.position.set(x, 0.1, z);
    g.add(wheel); wheels.push(wheel);
  });
  g.add(cab, cabTop, bed);
  g.userData.wheels = wheels;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function updateTruck(st, t) {
  const o = st.obj;
  if (st.pause > 0) { st.pause -= 0.016; if (st.pause <= 0) pickWalkerTarget(st); return; }
  const dx = st.tx - o.position.x, dz = st.tz - o.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) { st.pause = 1.0 + st.rng() * 1.5; return; }
  const v = st.speed * 0.016;
  o.position.x += (dx / d) * v;
  o.position.z += (dz / d) * v;
  faceDir(o, dx, dz);
  if (st.wheels) st.wheels.forEach((w) => { w.rotation.y += 0.3; }); // spin
}

function makeKiln() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.8, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a4030, roughness: 1, flatShading: true }));
  body.position.y = 0.4;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x6e3324, roughness: 1, flatShading: true }));
  top.position.y = 1.0;
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
  glow.position.set(0, 0.3, 0.5);
  g.add(body, top, glow);
  // register the glow so the kiln only burns at night (off during the day)
  three.torches = three.torches || [];
  three.torches.push({ glow, ph: Math.random() * 6, island: false, campfire: true });
  return g;
}

function makeBrickPile(rng, count = 6) {
  const g = new THREE.Group();
  const mats = [0xa0432a, 0xb24c30, 0x8f3a24].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true }));
  for (let i = 0; i < count; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.16), mats[i % 3]);
    const row = Math.floor(i / 2), col = i % 2;
    b.position.set(col * 0.28 - 0.14 + (rng ? rng() - 0.5 : 0) * 0.03, 0.07 + row * 0.13, (rng ? rng() - 0.5 : 0) * 0.05);
    b.rotation.y = (rng ? rng() - 0.5 : 0) * 0.2;
    g.add(b);
  }
  return g;
}

// A long low wall of stacked, offset bricks — fills out a busy brickyard.
function makeBrickWall(rng) {
  const g = new THREE.Group();
  const mats = [0xa0432a, 0x8f3a24].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true }));
  const cols = 5, rows = 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.14), mats[(r + c) % 2]);
      b.position.set(c * 0.21 - 0.42 + (r % 2) * 0.1, 0.06 + r * 0.11, 0);
      g.add(b);
    }
  }
  return g;
}

// A big OPEN brick furnace: stepped brick body, a glowing arched mouth showing the
// fire inside, an iron lintel, and a smoking chimney. Glow stays lit; the point
// light only burns in Extreme (registered as a campfire-style torch).
function makeFurnace() {
  const g = new THREE.Group();
  const brick = new THREE.MeshStandardMaterial({ color: 0x9a4030, roughness: 1, flatShading: true });
  const brickDark = new THREE.MeshStandardMaterial({ color: 0x6e2f22, roughness: 1, flatShading: true });
  // stepped body
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.2), brick); base.position.y = 0.45;
  const mid = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.0), brick); mid.position.y = 1.15;
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.8), brickDark); top.position.y = 1.6;
  g.add(base, mid, top);
  // open arched mouth (dark recess) with a fierce glow + ember
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.22),
    new THREE.MeshBasicMaterial({ color: 0x140600 }));
  mouth.position.set(0, 0.42, 0.6);
  const fire = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95 }));
  fire.position.set(0, 0.4, 0.66);
  const ember = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd24a }));
  ember.position.set(0, 0.38, 0.62);
  // iron lintel over the mouth
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.6, roughness: 0.5 }));
  lintel.position.set(0, 0.72, 0.6);
  g.add(mouth, fire, ember, lintel);
  // brick chimney
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.1, 10), brickDark);
  chimney.position.set(0, 2.2, 0);
  g.add(chimney);
  // flickering glow light from the open mouth (Extreme only)
  const light = new THREE.PointLight(0xff7a2a, 0, 7, 1.6);
  light.position.set(0, 0.5, 0.95); light.visible = false;
  g.add(light);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  three.torches = three.torches || [];
  three.torches.push({ flame: ember, glow: fire, light, baseI: 2.4, ph: Math.random() * 6, island: false, campfire: true });
  return g;
}

// ---- DESERT: a cowboy saloon, campfire, cowboys, barrels, cactus & tumbleweed ----
function buildDesert(board, idxs) {
  const hex = board.hexes[idxs[0]];
  const cx = TX(hex.cx), cz = TZ(hex.cy);
  const saloon = regMesh(makeSaloon());
  saloon.position.set(cx - HEX_R() * 0.28, TILE_H, cz - HEX_R() * 0.12);
  saloon.rotation.y = 0.3;
  three.boardGroup.add(saloon);

  // a campfire with cowboys sitting around it
  const fire = makeCampfire();
  fire.position.set(cx + HEX_R() * 0.3, TILE_H, cz + HEX_R() * 0.28);
  three.boardGroup.add(fire);
  // two cowboys near the fire
  const cowboy1 = regMesh(makeCowboy());
  cowboy1.position.set(cx + HEX_R() * 0.3 - 0.6, TILE_H, cz + HEX_R() * 0.28);
  cowboy1.rotation.y = 0; // face +x toward fire
  three.boardGroup.add(cowboy1);
  const cowboy2 = regMesh(makeCowboy());
  cowboy2.position.set(cx + HEX_R() * 0.3 + 0.6, TILE_H, cz + HEX_R() * 0.28);
  cowboy2.rotation.y = Math.PI; // face -x toward fire
  three.boardGroup.add(cowboy2);

  // a hitching post with a horse
  const horse = makeHorse();
  horse.position.set(cx + HEX_R() * 0.05, TILE_H, cz - HEX_R() * 0.35);
  horse.rotation.y = -0.6;
  regMesh(horse); three.boardGroup.add(horse);

  // barrels + a wagon wheel for flavor
  const rng = mulberry32(idxs[0] * 53 + 1);
  for (let i = 0; i < 3; i++) {
    const barrel = makeBarrel();
    const p = hexRandPoint(hex, rng, 0.7);
    barrel.position.set(p.x, TILE_H, p.z); regMesh(barrel);
    three.boardGroup.add(barrel);
  }
  // cacti
  for (let i = 0; i < 3; i++) {
    const p = hexRandPoint(hex, rng, 0.88);
    const c = regMesh(makeCactus());
    c.position.set(p.x, TILE_H, p.z); three.boardGroup.add(c);
  }

  // tumbleweed rolling across the tile
  const tw = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0),
    new THREE.MeshStandardMaterial({ color: 0x9c8a4a, roughness: 1, flatShading: true, wireframe: true }));
  tw.castShadow = true;
  three.boardGroup.add(tw);
  const st = { obj: tw, cx, cz, r: HEX_R() * 0.7, ang: 0, rng };
  three.animProps.push({ update: (t) => {
    st.ang = (t * 0.6) % (Math.PI * 2);
    const rr = st.r * (0.4 + 0.6 * ((Math.sin(t * 0.6) + 1) / 2));
    tw.position.set(st.cx + Math.cos(st.ang) * rr, TILE_H + 0.18 + Math.abs(Math.sin(t * 5)) * 0.06, st.cz + Math.sin(st.ang) * rr);
    tw.rotation.x += 0.2; tw.rotation.z += 0.15;
  } });
}

// A campfire: stone ring + crossed logs + flickering flame + light (night/extreme).
function makeCampfire() {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a6660, roughness: 1, flatShading: true });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), stoneMat);
    stone.position.set(Math.cos(a) * 0.26, 0.05, Math.sin(a) * 0.26);
    g.add(stone);
  }
  const logMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6), logMat);
    log.rotation.z = Math.PI / 2; log.rotation.y = i * 1.0; log.position.y = 0.08;
    g.add(log);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa326 }));
  flame.position.y = 0.3;
  const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 7),
    new THREE.MeshBasicMaterial({ color: 0xffe06a }));
  flame2.position.y = 0.34;
  const light = new THREE.PointLight(0xff7a2a, 0, 6, 1.6);
  light.position.set(0, 0.4, 0); light.visible = false;
  g.add(flame, flame2, light);
  g.traverse((o) => { if (o.isMesh && o.geometry.type !== 'ConeGeometry') o.castShadow = true; });
  // register so it flickers + lights at night
  three.torches = three.torches || [];
  three.torches.push({ flame, glow: flame2, light, baseI: 2.2, ph: Math.random() * 6, island: false, campfire: true });
  return g;
}

function makeBarrel() {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 1, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 12), woodMat);
  body.position.y = 0.21;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.015, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0x33373a }));
  band.rotation.x = Math.PI / 2; band.position.y = 0.32;
  const band2 = band.clone(); band2.position.y = 0.1;
  g.add(body, band, band2);
  g.castShadow = true;
  return g;
}

function makeHorse() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.22), mat);
  body.position.y = 0.5;
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.16), mat);
  neck.position.set(0.3, 0.66, 0); neck.rotation.z = -0.5;
  const headM = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.13), mat);
  headM.position.set(0.46, 0.78, 0);
  const legGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6);
  [[0.22, 0.1], [0.22, -0.1], [-0.22, 0.1], [-0.22, -0.1]].forEach(([x, z]) => {
    const l = new THREE.Mesh(legGeo, mat); l.position.set(x, 0.2, z); g.add(l);
  });
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x2a1c12 }));
  tail.position.set(-0.32, 0.5, 0); tail.rotation.z = 0.7;
  g.add(body, neck, headM, tail);
  g.scale.setScalar(0.9);
  return g;
}

function makeSaloon() {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x9c6b3a, roughness: 1, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.1), wallMat);
  body.position.y = 0.5;
  // false front facade
  const facade = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 0.12), new THREE.MeshStandardMaterial({ color: 0xb07c45, roughness: 1, flatShading: true }));
  facade.position.set(0, 0.75, 0.56);
  // roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.2), new THREE.MeshStandardMaterial({ color: 0x6e4a28, roughness: 1 }));
  roof.position.y = 1.05;
  // porch posts + awning
  const awning = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.5), new THREE.MeshStandardMaterial({ color: 0x7a542e, roughness: 1 }));
  awning.position.set(0, 0.62, 0.82);
  const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5a3c1e });
  [-0.7, 0.7].forEach((x) => { const p = new THREE.Mesh(postGeo, postMat); p.position.set(x, 0.3, 1.0); g.add(p); });
  // swinging doors
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a2c12, roughness: 1 });
  [-0.16, 0.16].forEach((x) => { const d = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5, 0.05), doorMat); d.position.set(x, 0.3, 0.58); g.add(d); });
  // neon "🍺 BAR" sign mounted on the false-front facade (glows at night)
  const signTex = makeNeonSignTexture('🍺 BAR');
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.5 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.06), [
    new THREE.MeshStandardMaterial({ color: 0x1a1320 }), new THREE.MeshStandardMaterial({ color: 0x1a1320 }),
    new THREE.MeshStandardMaterial({ color: 0x1a1320 }), new THREE.MeshStandardMaterial({ color: 0x1a1320 }),
    signMat, new THREE.MeshStandardMaterial({ color: 0x120c18 }),
  ]);
  sign.position.set(0, 1.2, 0.63); sign.castShadow = true;
  // neon tube trim around the awning
  const tube = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x2a1030, emissive: 0x000000, emissiveIntensity: 0 }));
  tube.position.set(0, 0.55, 0.9); tube.rotation.x = Math.PI / 2; tube.scale.set(1.4, 1, 1);
  // warm light spilling from the bar
  const barLight = new THREE.PointLight(0xff5aa0, 0, 9, 1.6);
  barLight.position.set(0, 0.9, 1.0); barLight.visible = false;
  g.add(body, facade, roof, awning, sign, tube, barLight);

  three.barNeon = three.barNeon || [];
  // the sign's emissive lives on signMat (the front face of the multi-material box)
  three.barNeon.push({ mesh: { material: signMat }, color: 0xff3da6, light: barLight });
  three.barNeon.push({ mesh: tube, color: 0x36e0ff, light: null });
  return g;
}

// Glowing neon sign texture (bright text on dark).
function makeNeonSignTexture(text) {
  const c = document.createElement('canvas');
  c.width = 384; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#140d1c'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#ff3da6'; x.lineWidth = 6; x.strokeRect(8, 8, c.width - 16, c.height - 16);
  x.shadowColor = '#ff7ad0'; x.shadowBlur = 24;
  x.fillStyle = '#ffd1ec'; x.font = 'bold 70px Georgia, serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, c.width / 2, c.height / 2 + 6);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  return tex;
}

function makeCowboy() {
  const g = makeHuman(0x6a4a2a, false);
  // add a hat brim + crown
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x3a2a16, roughness: 1, flatShading: true });
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 10), hatMat);
  brim.position.y = 0.78;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.12, 8), hatMat);
  crown.position.y = 0.85;
  g.add(brim, crown);
  return g;
}

function makeCactus() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3d8b4a, roughness: 0.9, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.7, 8), mat);
  body.position.y = 0.35;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6), mat);
  arm.position.set(0.18, 0.45, 0); arm.rotation.z = -0.6;
  g.add(body, arm);
  return g;
}

// ---- a reusable low-poly human (shirt color); arm pivot swings for work ----
function makeHuman(shirt, hasStaff) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0a878, roughness: 1 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x3a4654, roughness: 1 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 1, flatShading: true });
  // forward = +x. legs/arms sit on the sides (±z); a nose marks the front (+x).
  const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6);
  const lLeg = new THREE.Mesh(legGeo, pants); lLeg.position.set(0, 0.15, -0.07);
  const rLeg = new THREE.Mesh(legGeo, pants); rLeg.position.set(0, 0.15, 0.07);
  // torso
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.34, 8), shirtMat);
  torso.position.y = 0.47;
  // head + nose (front)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), skin);
  head.position.y = 0.74;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 6), skin);
  nose.position.set(0.1, 0.74, 0); nose.rotation.z = -Math.PI / 2;
  // right working arm — on the +z side, swings to mimic chopping
  const armPivot = new THREE.Group(); armPivot.position.set(0, 0.6, 0.13);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 6), shirtMat);
  arm.position.y = -0.14; armPivot.add(arm);
  if (hasStaff) {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5), new THREE.MeshStandardMaterial({ color: 0x6b4423 }));
    staff.position.set(0.04, -0.18, 0); armPivot.add(staff);
  }
  // left arm — on the -z side, holds a torch that lights up at night
  const lArmPivot = new THREE.Group(); lArmPivot.position.set(0, 0.6, -0.13);
  const lArm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 6), shirtMat);
  lArm.position.y = -0.14; lArmPivot.add(lArm);
  lArmPivot.rotation.z = -0.5; // raise the torch a bit
  addTorch(lArmPivot);
  g.add(lLeg, rLeg, torso, head, nose, armPivot, lArmPivot);
  g.userData = { arm: armPivot, lLeg, rLeg };
  g.scale.setScalar(0.9);
  return g;
}

// Attach a handheld torch (stick + flame + glow + optional light) to a parent.
// Registered in three.torches so night/extreme can toggle the flame & lighting.
function addTorch(parent) {
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 5),
    new THREE.MeshStandardMaterial({ color: 0x5a3a1c }));
  stick.position.set(0, -0.3, 0.06);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 7),
    new THREE.MeshBasicMaterial({ color: 0xffa53a }));
  flame.position.set(0, -0.46, 0.06);
  flame.visible = false;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0x000000, transparent: true, opacity: 0.5 }));
  glow.position.copy(flame.position);
  const light = new THREE.PointLight(0xff8a3a, 0, 4.5, 1.8);
  light.position.copy(flame.position); light.visible = false;
  parent.add(stick, flame, glow, light);
  three.torches = three.torches || [];
  three.torches.push({ flame, glow, light, baseI: 1.4, ph: Math.random() * 6, island: creatingDecor });
}

// walker: roams a region (array of {x,z}); `working` makes the arm swing like cutting
function makeWalker(obj, region, speed, working) {
  const st = { obj, region, speed: speed || 0.35, working: !!working, tx: obj.position.x, tz: obj.position.z, rng: mulberry32((obj.id || 1) * 13 + region.length), pause: 0 };
  pickWalkerTarget(st);
  return st;
}
function pickWalkerTarget(st) {
  const h = st.region[Math.floor(st.rng() * st.region.length)];
  st.tx = h.x + (st.rng() - 0.5) * HEX_R() * 1.2;
  st.tz = h.z + (st.rng() - 0.5) * HEX_R() * 1.2;
}
function updateWalker(st, t) {
  const o = st.obj;
  if (st.pause > 0) {
    st.pause -= 0.016;
    if (st.working && o.userData.arm) o.userData.arm.rotation.z = -1.4 + Math.sin(t * 9) * 1.2; // chop/cut
    if (st.pause <= 0) pickWalkerTarget(st);
    return;
  }
  const dx = st.tx - o.position.x, dz = st.tz - o.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.1) { st.pause = 1.2 + st.rng() * 1.8; return; }
  const v = st.speed * 0.016;
  o.position.x += (dx / d) * v;
  o.position.z += (dz / d) * v;
  faceDir(o, dx, dz);
  o.position.y = TILE_H + Math.abs(Math.sin(t * 7)) * 0.04;
  // leg + arm swing (forward = +x, so swing about local z)
  if (o.userData.lLeg) { o.userData.lLeg.rotation.z = Math.sin(t * 8) * 0.5; o.userData.rLeg.rotation.z = -Math.sin(t * 8) * 0.5; }
  if (o.userData.arm) o.userData.arm.rotation.z = Math.sin(t * 8) * 0.3;
}

// hanging mooring rope: recompute its catenary each frame from the boat's deck
function updateRope(r, t) {
  const b = r.boat, c = r.cleat;
  const cy = Math.cos(b.rotation.y), sy = Math.sin(b.rotation.y);
  const sx = b.position.x + (c.x * cy - c.z * sy);
  const syp = b.position.y + c.y;
  const sz = b.position.z + (c.x * sy + c.z * cy);
  const ex = r.end.x, ey = r.end.y, ez = r.end.z;
  const pos = r.line.geometry.attributes.position;
  const dist = Math.hypot(ex - sx, ez - sz);
  const sag = Math.min(0.7, dist * 0.24) + 0.12 + Math.sin(t * 1.6 + r.phase) * 0.05;
  for (let i = 0; i < r.n; i++) {
    const u = i / (r.n - 1);
    const x = sx + (ex - sx) * u;
    const z = sz + (ez - sz) * u;
    const y = syp + (ey - syp) * u - Math.sin(Math.PI * u) * sag;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
}

// A big, spooky PIRATE ship for ports — dark hull, tattered sails, a Jolly
// Roger flag, cannons, lanterns, and a skull figurehead.
function makeBoat(port) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.95, flatShading: true });
  const hullMat2 = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.95, flatShading: true });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 1, flatShading: true });
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xcfc4ae, roughness: 1, flatShading: true, side: THREE.DoubleSide });

  // deep curved hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 1.15), hullMat);
  hull.position.y = 0.05;
  const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 0.85), hullMat2);
  lowerHull.position.y = -0.34;
  // gold trim stripe
  const trim = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.08, 1.17),
    new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.6, metalness: 0.3 }));
  trim.position.y = 0.28;
  // raised stern castle
  const stern = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 1.05), hullMat);
  stern.position.set(-1.0, 0.55, 0);
  const sternRail = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 1.07), deckMat);
  sternRail.position.set(-1.0, 0.92, 0);
  // pointed bowsprit + skull figurehead
  const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 6), hullMat2);
  bowsprit.rotation.z = -Math.PI / 2.3; bowsprit.position.set(1.5, 0.45, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.8 }));
  skull.position.set(1.45, 0.25, 0);
  // deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 1.0), deckMat);
  deck.position.y = 0.42;

  // cannons poking from the sides
  const cannonMat = new THREE.MeshStandardMaterial({ color: 0x16181c, metalness: 0.5, roughness: 0.5 });
  [-0.6, 0, 0.6].forEach((cxp) => {
    [-0.6, 0.6].forEach((side) => {
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 8), cannonMat);
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(cxp, 0.18, side); cannon.scale.z = side > 0 ? 1 : 1;
      g.add(cannon);
    });
  });

  // masts with tattered square sails + rigging
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 1 });
  const sails = [];
  const makeMast = (mx, height) => {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, height, 8), mastMat);
    mast.position.set(mx, 0.42 + height / 2, 0);
    g.add(mast);
    // yardarm
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), mastMat);
    yard.rotation.x = Math.PI / 2; yard.position.set(mx, 0.42 + height * 0.78, 0);
    g.add(yard);
    // tattered sail — bigger, billowed, weathered off-white
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.25, height * 0.62, 6, 4), sailMat);
    sail.position.set(mx, 0.42 + height * 0.52, 0.04);
    sail.rotation.y = Math.PI / 2;
    // billow the sail (bulge toward the bow) + ragged bottom edge
    const sp = sail.geometry.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const u = sp.getX(i), v = sp.getY(i);
      sp.setZ(i, Math.cos(u * 1.6) * 0.18 + Math.sin(v * 3) * 0.04);
      if (v < -height * 0.24) sp.setY(i, v + (Math.random() - 0.5) * 0.12); // tattered hem
    }
    sp.needsUpdate = true; sail.geometry.computeVertexNormals();
    g.add(sail); sails.push(sail);
  };
  makeMast(0.45, 1.7);
  makeMast(-0.35, 1.4);

  // Jolly Roger flag (skull on black)
  const flagTex = makeJollyRogerTexture();
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28),
    new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 1 }));
  flag.position.set(0.45, 0.42 + 1.7 + 0.05, 0); flag.rotation.y = Math.PI / 2;
  g.add(flag);

  // swinging lanterns (glow at night)
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0x3a2a12, emissive: 0x000000, roughness: 0.5 });
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), lanternMat);
  lantern.position.set(-1.0, 1.05, 0.4);
  g.add(lantern);
  three.barNeon = three.barNeon || [];
  three.barNeon.push({ mesh: lantern, color: 0xffb84a, light: null });

  g.add(hull, lowerHull, trim, stern, sternRail, bowsprit, skull, deck);
  g.scale.setScalar(1.0); // normal pirate-ship size
  return g;
}

// Jolly Roger (skull & crossbones) flag texture.
function makeJollyRogerTexture() {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#0a0a0c'; x.fillRect(0, 0, 96, 64);
  x.fillStyle = '#e8e6df';
  // skull
  x.beginPath(); x.arc(48, 26, 13, 0, Math.PI * 2); x.fill();
  x.fillRect(40, 26, 16, 12);
  // eyes
  x.fillStyle = '#0a0a0c';
  x.beginPath(); x.arc(43, 24, 3.5, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.arc(53, 24, 3.5, 0, Math.PI * 2); x.fill();
  // crossbones
  x.strokeStyle = '#e8e6df'; x.lineWidth = 5;
  x.beginPath(); x.moveTo(30, 44); x.lineTo(66, 56); x.moveTo(66, 44); x.lineTo(30, 56); x.stroke();
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  return tex;
}

// ===================================================================
// DYNAMIC PIECES (rebuilt each state)
// ===================================================================
function updateDynamic() {
  clearGroup(three.pieceGroup);
  const board = state.board;

  // reset forest trees to visible; roads through forest will clear a path
  if (three.terrainProps) three.terrainProps.forEach((p) => { if (p.kind === 'tree' && p.obj) p.obj.visible = true; });

  // roads — each road reacts to the terrain it crosses
  Object.entries(state.roads).forEach(([eid, owner]) => {
    const e = board.edges[eid];
    const v1 = board.vertices[e.v1], v2 = board.vertices[e.v2];
    const x1 = TX(v1.x), z1 = TZ(v1.y), x2 = TX(v2.x), z2 = TZ(v2.y);
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ang = -Math.atan2(z2 - z1, x2 - x1);

    // what terrain does this edge border?
    const resis = (e.hexes || []).map((h) => board.hexes[h] && board.hexes[h].resource);
    const crossesOre = resis.includes('ore');
    const crossesForest = resis.includes('lumber');

    // a dirt path strip laid under every road (a worn track)
    const path = new THREE.Mesh(
      new THREE.BoxGeometry(len * 0.95, 0.04, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x7a5a36, roughness: 1 })
    );
    path.position.set(mx, TILE_H + 0.03, mz);
    path.rotation.y = ang;
    path.receiveShadow = true;
    three.pieceGroup.add(path);

    // the road itself (player-colored)
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(len * 0.82, 0.3, 0.42),
      new THREE.MeshStandardMaterial({ color: playerColor(owner), roughness: 0.6 })
    );
    road.position.set(mx, TILE_H + 0.16, mz);
    road.rotation.y = ang;
    road.castShadow = true;
    three.pieceGroup.add(road);

    // ORE: dig a tunnel — a stone archway the road passes through
    if (crossesOre) three.pieceGroup.add(makeTunnelArch(mx, mz, ang));

    // FOREST: clear a path — hide trees within a corridor around the road
    if (crossesForest && three.terrainProps) {
      three.terrainProps.forEach((p) => {
        if (p.kind !== 'tree' || !p.obj) return;
        if (distToSegment(p.x, p.z, x1, z1, x2, z2) < 0.7) p.obj.visible = false;
      });
      // a couple of cut stumps beside the cleared path
      [0.35, -0.35].forEach((off) => {
        const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 7),
          new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 1, flatShading: true }));
        stump.position.set(mx + Math.cos(ang) * 0 - Math.sin(ang) * off, TILE_H + 0.07, mz + Math.sin(ang) * 0 + Math.cos(ang) * off);
        three.pieceGroup.add(stump);
      });
    }
  });

  // buildings
  Object.entries(state.buildings).forEach(([vid, bld]) => {
    const v = board.vertices[vid];
    const piece = bld.type === 'city' ? makeCity(playerColor(bld.owner)) : makeHouse(playerColor(bld.owner));
    piece.position.set(TX(v.x), TILE_H, TZ(v.y));
    three.pieceGroup.add(piece);
  });

  // robber
  const rb = board.hexes[state.robber];
  if (rb) {
    const robber = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.7, 1.6, 16),
      new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.5 })
    );
    robber.position.set(TX(rb.cx) + 1.2, TILE_H + 0.8, TZ(rb.cy));
    robber.castShadow = true;
    three.pieceGroup.add(robber);
  }
}

function makeHouse(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), mat);
  base.position.y = 0.3; base.castShadow = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.5, 4), mat);
  roof.position.y = 0.85; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  g.add(base, roof);
  return g;
}

// distance from point (px,pz) to line segment (ax,az)-(bx,bz)
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let tt = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  tt = Math.max(0, Math.min(1, tt));
  const cx = ax + tt * dx, cz = az + tt * dz;
  return Math.hypot(px - cx, pz - cz);
}

// A stone tunnel archway the road passes through (for roads crossing ore).
function makeTunnelArch(mx, mz, ang) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x6f7c84, roughness: 1, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 1 });
  // two pillars either side of the road
  [[0, 0.45], [0, -0.45]].forEach(([fx, side]) => {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.7, 0.28), stone);
    pillar.position.set(-Math.sin(ang) * side, TILE_H + 0.35, Math.cos(ang) * side);
    pillar.castShadow = true;
    g.add(pillar);
  });
  // arch lintel across the top
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 1.3), stone);
  lintel.position.set(0, TILE_H + 0.78, 0);
  lintel.rotation.y = ang;
  // dark tunnel mouth
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), dark);
  mouth.position.set(Math.cos(ang) * 0.16, TILE_H + 0.35, Math.sin(ang) * 0.16);
  mouth.rotation.y = ang + Math.PI / 2;
  g.add(lintel, mouth);
  g.position.set(mx, 0, mz);
  return g;
}

function makeCity(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 1.0), mat);
  base.position.set(0, 0.35, 0); base.castShadow = true;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.7), mat);
  tower.position.set(0.35, 0.85, 0); tower.castShadow = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 4), mat);
  roof.position.set(0.35, 1.5, 0); roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  g.add(base, tower, roof);
  return g;
}

function playerColor(idx) { return new THREE.Color(state.players[idx].color); }

function updateMarkerVisibility() {
  const showV = ['settlement', 'city', 'setupSettlement'].includes(placementMode);
  const showE = ['road', 'setupRoad'].includes(placementMode);
  three.vertexMarkers.forEach((m) => { m.visible = showV; });
  three.edgeMarkers.forEach((m) => { m.visible = showE; });
  $('three').classList.toggle('placing', !!placementMode);
}

// ===================================================================
// PICKING (click vs orbit-drag)
// ===================================================================
function setupPicking(dom) {
  let down = null;
  dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  dom.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = Date.now() - down.t < 500;
    down = null;
    if (moved > 6 || !quick) return; // it was an orbit/pan drag
    onPick(e);
  });
}

function onPick(e) {
  if (!state || !placementMode) return;
  const dom = three.renderer.domElement;
  const rect = dom.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  three.raycaster.setFromCamera(ndc, three.camera);

  if (placementMode === 'setupSettlement' || placementMode === 'settlement' || placementMode === 'city') {
    const hit = three.raycaster.intersectObjects(three.vertexMarkers.filter((m) => m.visible))[0];
    if (!hit) return;
    const vid = hit.object.userData.vid;
    if (placementMode === 'setupSettlement') act('placeSetupSettlement', { vertex: vid });
    else { act('build', { buildType: placementMode, target: vid }); placementMode = null; }
  } else if (placementMode === 'setupRoad' || placementMode === 'road') {
    const hit = three.raycaster.intersectObjects(three.edgeMarkers.filter((m) => m.visible))[0];
    if (!hit) return;
    const eid = hit.object.userData.eid;
    if (placementMode === 'setupRoad') act('placeSetupRoad', { edge: eid });
    else { act('build', { buildType: 'road', target: eid }); if (state.freeRoads <= 1) placementMode = null; }
  } else if (placementMode === 'robber') {
    const hit = three.raycaster.intersectObjects(three.hexMeshes)[0];
    if (!hit) return;
    chooseRobberTarget(hit.object.userData.hid);
  }
  updateMarkerVisibility();
}

// ===================================================================
// TEXTURE HELPERS
// ===================================================================

// Subtle per-resource ground texture for the tile tops — gentle organic mottling
// (soft lighter/darker patches + fine speckle) so tiles don't read as flat, bland
// color. Deliberately blobby (no straight lines) to avoid the old shadow-acne look.
const _tileTexCache = {};
function clamp8(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function tileTexture(resource) {
  if (_tileTexCache[resource]) return _tileTexCache[resource];
  const base = RES_3D[resource] != null ? RES_3D[resource] : 0x88aabb;
  const r = (base >> 16) & 255, g = (base >> 8) & 255, b = base & 255;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = `rgb(${r},${g},${b})`;
  x.fillRect(0, 0, 128, 128);
  const rng = mulberry32(resource.length * 9173 + r * 7 + g * 13 + b * 17);
  // soft mottled patches
  for (let i = 0; i < 80; i++) {
    const px = rng() * 128, py = rng() * 128, rad = 6 + rng() * 24;
    const d = 14 + rng() * 14;
    const sign = rng() < 0.5 ? 1 : -1;
    const cr = clamp8(r + sign * d), cg = clamp8(g + sign * d), cb = clamp8(b + sign * d);
    const grad = x.createRadialGradient(px, py, 0, px, py, rad);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.16)`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    x.fillStyle = grad;
    x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  // fine speckle grain
  for (let i = 0; i < 500; i++) {
    const px = rng() * 128, py = rng() * 128;
    x.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    x.fillRect(px, py, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  _tileTexCache[resource] = t;
  return t;
}

function tokenTexture(number) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2);
  x.fillStyle = '#f3e6c4'; x.fill();
  x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,.35)'; x.stroke();
  const hot = number === 6 || number === 8;
  x.fillStyle = hot ? '#c0392b' : '#2a2a2a';
  x.font = `bold ${hot ? 64 : 56}px Georgia, serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(number, 64, 56);
  const pips = { 2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1 }[number] || 0;
  x.font = '20px sans-serif';
  x.fillText('•'.repeat(pips), 64, 100);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}

function makeLabelSprite(text, accent) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  roundRect(x, 28, 34, 200, 60, 16);
  x.fillStyle = '#f7efdc'; x.fill();
  x.lineWidth = 6; x.strokeStyle = accent; x.stroke();
  x.fillStyle = '#23303a'; x.font = 'bold 40px sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 66);
  const t = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true }));
  spr.scale.set(3.4, 1.7, 1);
  return spr;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function clearGroup(g) {
  if (!g) return;
  while (g.children.length) {
    const c = g.children.pop();
    if (c.geometry) c.geometry.dispose();
    if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose && c.material.dispose(); }
  }
}

// ===================================================================
// SIDEBAR (mirrors the 2D client)
// ===================================================================
function drawBanner() {
  const banner = $('banner');
  const cur = state.players[state.turn];
  let msg = '';
  if (state.phase === 'over') msg = `🎉 ${state.players[state.winner].name} wins!`;
  else if (state.phase === 'setup1' || state.phase === 'setup2') {
    const what = state.subPhase === 'setupSettlement' ? 'a settlement' : 'a road';
    msg = myTurn() ? `Setup: place ${what}` : `${cur.name} is placing ${what}…`;
  } else if (state.subPhase === 'discard') {
    const need = state.pendingDiscards[state.youAre];
    msg = need ? `Discard ${need} cards (rolled 7)` : 'Players are discarding…';
  } else if (state.subPhase === 'robber') {
    msg = state.robberMover === state.youAre ? 'Move the robber — click a hex' : `${state.players[state.robberMover].name} is moving the robber…`;
  } else if (state.subPhase === 'roll') {
    msg = myTurn() ? 'Your turn — roll the dice' : `${cur.name}'s turn (rolling)…`;
  } else {
    msg = myTurn() ? `Your turn${state.dice ? ` · rolled ${state.dice[0] + state.dice[1]}` : ''}` : `${cur.name}'s turn…`;
  }
  if (state.freeRoads > 0 && myTurn()) msg += ` · ${state.freeRoads} free road(s)`;
  banner.textContent = msg;
}

function drawPlayers() {
  $('players').innerHTML = state.players.map((p, i) => {
    const badges = [];
    if (p.hasLongestRoad) badges.push('🛣️');
    if (p.hasLargestArmy) badges.push('⚔️');
    return `
    <div class="pcard ${i === state.turn ? 'active' : ''}" style="border-left-color:${p.color}">
      <span class="swatch" style="background:${p.color}"></span>
      <span class="pname">${escapeHtml(p.name)}${i === state.youAre ? ' (you)' : ''}${p.isBot ? ' 🤖' : ''}</span>
      <span class="pstats">
        <span class="vp-pill">${i === state.youAre ? p.vp : p.publicVp} VP</span>
        <span class="badges">${badges.join('')}</span><br>
        🃏 ${p.totalCards} · 📜 ${p.totalDev} · ⚔️ ${p.playedKnights}
      </span>
    </div>`;
  }).join('');
}

function drawHand() {
  const m = me();
  const box = $('handCards');
  if (!m || !m.resources) { box.innerHTML = '<div class="card-empty">—</div>'; prevResources = null; return; }
  const order = ['lumber', 'brick', 'wool', 'grain', 'ore'];
  const html = order.map((r) => {
    const n = m.resources[r] || 0;
    if (n === 0) return '';
    const gained = prevResources && n > (prevResources[r] || 0);
    return `
      <div class="card${gained ? ' bump' : ''}" title="${RES_LABEL[r]}">
        <div class="card-strip" style="background:${RES_COLORS[r]}"></div>
        <div class="card-top">${RES_LABEL[r]}</div>
        <div class="card-emoji">${RES_ICON[r]}</div>
        <div class="card-name">${RES_LABEL[r]}</div>
        <div class="card-count">${n}</div>
      </div>`;
  }).join('');
  box.innerHTML = html || '<div class="card-empty">No resources yet</div>';
  prevResources = { ...m.resources };
}

// Dedicated circular roll-dice button.
function drawRoll() {
  const spot = $('rollSpot');
  if (!spot) return;
  spot.innerHTML = '';
  const canRoll = state.phase === 'play' && myTurn() && state.subPhase === 'roll';
  const b = document.createElement('button');
  if (canRoll) {
    b.className = 'roll-btn';
    b.innerHTML = `<span class="rb-die">🎲</span><span class="rb-text">ROLL</span>`;
    b.onclick = () => act('rollDice');
  } else {
    b.className = 'roll-btn disabled';
    const total = state.dice ? state.dice[0] + state.dice[1] : '—';
    b.innerHTML = state.dice
      ? `<span class="roll-result">${total}</span><span class="rb-text">${DICE_FACES[state.dice[0]]} ${DICE_FACES[state.dice[1]]}</span>`
      : `<span class="rb-die" style="opacity:.5">🎲</span><span class="rb-text">—</span>`;
  }
  spot.appendChild(b);
}

// Longest Road & Largest Army bonus cards.
function drawBonuses() {
  const box = $('bonusRow');
  if (!box) return;
  const lrHolder = state.players.findIndex((p) => p.hasLongestRoad);
  const laHolder = state.players.findIndex((p) => p.hasLargestArmy);
  const card = (emoji, name, holderIdx) => {
    const held = holderIdx >= 0;
    const mine = held && holderIdx === state.youAre;
    const holderTxt = held ? (mine ? 'You hold it' : escapeHtml(state.players[holderIdx].name)) : 'Unclaimed';
    return `
      <div class="bonus-card ${held ? 'held' : ''} ${mine ? 'mine' : ''}">
        <div class="bc-emoji">${emoji}</div>
        <div>${name}</div>
        <div class="bc-holder">${holderTxt}</div>
        <div>+2 VP</div>
      </div>`;
  };
  box.innerHTML = card('🛣️', 'Longest Road', lrHolder) + card('⚔️', 'Largest Army', laHolder);
}

function drawActions() {
  const box = $('actions');
  box.innerHTML = '';
  if (state.phase === 'over') { box.innerHTML = ''; return; }
  if (!myTurn()) { box.innerHTML = '<div class="card-empty">Waiting for your turn…</div>'; return; }
  if (state.subPhase === 'roll') { box.innerHTML = '<div class="card-empty">Roll the dice to begin →</div>'; return; }
  if (state.subPhase !== 'main') { box.innerHTML = '<div class="card-empty">Resolve the current step…</div>'; return; }
  box.appendChild(btn('🛖 Settlement', '', () => startPlacement('settlement')));
  box.appendChild(btn('🏛️ City', '', () => startPlacement('city')));
  box.appendChild(btn('🛣️ Road', '', () => startPlacement('road')));
  box.appendChild(btn('📜 Buy dev card', '', () => act('buyDev')));
  box.appendChild(btn('🏦 Bank trade', '', openBankTrade));
  box.appendChild(btn('🤝 Offer trade', '', openProposeTrade));
  box.appendChild(btn('➡️ End turn', 'full', () => act('endTurn')));
}

function drawDevCards() {
  const box = $('devCardRow');
  const m = me();
  box.innerHTML = '';
  if (!m || !m.dev) return;
  const playable = state.phase === 'play' && myTurn() && (state.subPhase === 'main' || state.subPhase === 'roll');
  const cards = [
    ['knight', 'Knight', '⚔️', m.dev.knight],
    ['road', 'Road Build', '🛣️', m.dev.road],
    ['plenty', 'Year/Plenty', '🌾', m.dev.plenty],
    ['monopoly', 'Monopoly', '💰', m.dev.monopoly],
    ['vp', 'Victory Pt', '🏆', m.dev.vp],
  ];
  let any = false;
  cards.forEach(([key, name, emoji, count]) => {
    if (count <= 0) return;
    any = true;
    const newCount = m.newDev ? m.newDev[key] : 0;
    const canPlay = playable && key !== 'vp' && (count - (newCount || 0)) > 0 && (key === 'knight' || state.subPhase === 'main');
    const el = document.createElement('div');
    el.className = 'card dev' + (canPlay ? ' playable' : ' dim');
    el.title = name;
    el.innerHTML = `
      <div class="card-strip" style="background:#7a4ec0"></div>
      <div class="card-top">DEV</div>
      <div class="card-emoji">${emoji}</div>
      <div class="card-name">${name}</div>
      <div class="card-count">${count}</div>`;
    if (canPlay) el.onclick = () => playDev(key);
    box.appendChild(el);
  });
  if (!any) box.innerHTML = '<div class="card-empty">None — buy one!</div>';
}

function drawLog() {
  $('log').innerHTML = state.log.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  $('log').scrollTop = $('log').scrollHeight;
}

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls; b.textContent = label; b.onclick = onClick;
  return b;
}

// ---- timer + dice ----
function updateTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const el = $('turnTimer');
  const timer = state && state.timer;
  if (!timer || !timer.deadline || state.phase === 'over') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const total = timer.seconds || 60;
  const tick = () => {
    const remaining = Math.max(0, (timer.deadline - Date.now()) / 1000);
    const frac = Math.max(0, Math.min(1, remaining / total));
    $('ringFg').style.strokeDasharray = `${(frac * 100).toFixed(1)} 100`;
    $('timerText').textContent = Math.ceil(remaining);
    el.classList.toggle('warn', remaining <= 10);
    if (remaining <= 0 && timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  };
  tick();
  timerInterval = setInterval(tick, 250);
}

function showDiceFx(dice) {
  const fx = $('diceFx');
  $('die1').textContent = DICE_FACES[dice[0]];
  $('die2').textContent = DICE_FACES[dice[1]];
  fx.classList.remove('hidden');
  fx.querySelectorAll('span').forEach((s) => { s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; });
  clearTimeout(showDiceFx._t);
  showDiceFx._t = setTimeout(() => fx.classList.add('hidden'), 1400);
}

// ---- Winner celebration: confetti party poppers ----
function celebrate(name) {
  $('winName').textContent = name;
  $('winOverlay').classList.remove('hidden');
  runConfetti();
}
function runConfetti() {
  const canvas = $('confetti');
  const c = canvas.getContext('2d');
  const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  resize();
  window.addEventListener('resize', resize);
  const colors = ['#f1c40f', '#e67e22', '#e74c3c', '#2ecc71', '#3498db', '#9b59b6', '#fff'];
  const pieces = [];
  const W = () => canvas.width, H = () => canvas.height;
  function burst(x, y, dirX) {
    for (let i = 0; i < 90; i++) {
      const ang = (-Math.PI / 2) + dirX * (Math.random() * 0.8) - 0.4;
      const speed = 8 + Math.random() * 12;
      pieces.push({ x, y, vx: Math.cos(ang) * speed + dirX * 4, vy: Math.sin(ang) * speed - Math.random() * 4,
        size: 5 + Math.random() * 7, color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, life: 1 });
    }
  }
  function rain() {
    for (let i = 0; i < 4; i++) pieces.push({ x: Math.random() * W(), y: -10, vx: (Math.random() - 0.5) * 2,
      vy: 2 + Math.random() * 3, size: 5 + Math.random() * 6, color: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, life: 1 });
  }
  burst(40, H() - 20, 1); burst(W() - 40, H() - 20, -1);
  let popTimer = 0, running = true;
  function frame() {
    if (!running) return;
    c.clearRect(0, 0, W(), H());
    popTimer++;
    if (popTimer % 70 === 0) { burst(40, H() - 20, 1); burst(W() - 40, H() - 20, -1); }
    rain();
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      p.vy += 0.25; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.color;
      c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6); c.restore();
      if (p.y > H() + 20) pieces.splice(i, 1);
    }
    requestAnimationFrame(frame);
  }
  frame();
  runConfetti._stop && clearTimeout(runConfetti._stop);
  runConfetti._stop = setTimeout(() => { running = false; }, 12000);
}

// ===================================================================
// ACTIONS / PLACEMENT
// ===================================================================
function act(type, payload) {
  socket.emit('action', { type, payload }, (res) => { if (res && !res.ok) flash(res.error); });
}

function flash(msg) {
  const banner = $('banner');
  banner.textContent = '⚠️ ' + msg;
  banner.style.color = '#ffb3a0';
  setTimeout(() => { banner.style.color = ''; if (state) drawBanner(); }, 1400);
}

function startPlacement(mode) { placementMode = mode; updateMarkerVisibility(); flash(`Click a highlighted spot to place your ${mode}.`); }

function handlePassivePrompts() {
  // clear leftover setup placement once setup is over
  const setupSub = state.subPhase === 'setupSettlement' || state.subPhase === 'setupRoad';
  if (!setupSub && (placementMode === 'setupSettlement' || placementMode === 'setupRoad')) placementMode = null;
  if (state.subPhase === 'roll' && placementMode && placementMode !== 'robber') placementMode = null;

  if (!myTurn() && !(state.subPhase === 'robber' && state.robberMover === state.youAre) &&
      !(state.subPhase === 'discard' && state.pendingDiscards[state.youAre])) {
    if (placementMode && placementMode !== 'robber') placementMode = null;
  }
  if (state.subPhase === 'setupSettlement' && myTurn()) placementMode = 'setupSettlement';
  else if (state.subPhase === 'setupRoad' && myTurn()) placementMode = 'setupRoad';
  else if (state.subPhase === 'robber' && state.robberMover === state.youAre) placementMode = 'robber';
  else if (state.subPhase === 'discard' && state.pendingDiscards[state.youAre]) openDiscardModal();
}

function chooseRobberTarget(hexId) {
  const victims = new Set();
  state.board.hexes[hexId].vertices.forEach((vid) => {
    const b = state.buildings[vid];
    if (b && b.owner !== state.youAre) victims.add(b.owner);
  });
  const list = Array.from(victims).filter((i) => state.players[i].totalCards > 0);
  if (list.length === 0) { act('moveRobber', { hex: hexId, target: null }); placementMode = null; return; }
  if (list.length === 1) { act('moveRobber', { hex: hexId, target: list[0] }); placementMode = null; return; }
  openModal(`
    <h2>Steal from whom?</h2>
    ${list.map((i) => `<button class="full" data-victim="${i}" style="margin-bottom:6px">${escapeHtml(state.players[i].name)} (${state.players[i].totalCards} cards)</button>`).join('')}
  `);
  document.querySelectorAll('[data-victim]').forEach((b) => {
    b.onclick = () => { act('moveRobber', { hex: hexId, target: Number(b.dataset.victim) }); placementMode = null; closeModal(); };
  });
}

// ===================================================================
// DEV CARDS
// ===================================================================
function playDev(card) {
  if (card === 'knight' || card === 'road') {
    act('playDev', { card });
    if (card === 'knight') { placementMode = 'robber'; updateMarkerVisibility(); }
    return;
  }
  if (card === 'plenty') {
    let picks = [];
    openModal(`
      <h2>Year of Plenty</h2>
      <p class="hint">Pick 2 resources from the bank.</p>
      <div class="res-select" id="plentySel"></div>
      <div class="modal-actions"><button id="plentyCancel">Cancel</button><button class="primary" id="plentyOk" disabled>Take</button></div>
    `);
    const sel = $('plentySel');
    Object.keys(RES_LABEL).forEach((r) => {
      const b = btn(RES_LABEL[r], '', () => { picks.push(r); if (picks.length > 2) picks.shift(); renderPlenty(); });
      b.dataset.res = r; sel.appendChild(b);
    });
    function renderPlenty() {
      sel.querySelectorAll('button').forEach((b) => {
        const count = picks.filter((p) => p === b.dataset.res).length;
        b.textContent = RES_LABEL[b.dataset.res] + (count ? ` ×${count}` : '');
        b.classList.toggle('sel', count > 0);
      });
      $('plentyOk').disabled = picks.length !== 2;
    }
    $('plentyCancel').onclick = closeModal;
    $('plentyOk').onclick = () => { act('playDev', { card: 'plenty', args: { resources: picks } }); closeModal(); };
    return;
  }
  if (card === 'monopoly') {
    openModal(`
      <h2>Monopoly</h2><p class="hint">Choose a resource to take from everyone.</p>
      <div class="res-select" id="monoSel"></div>
      <div class="modal-actions"><button id="monoCancel">Cancel</button></div>
    `);
    Object.keys(RES_LABEL).forEach((r) => {
      const b = btn(RES_LABEL[r], '', () => { act('playDev', { card: 'monopoly', args: { resource: r } }); closeModal(); });
      $('monoSel').appendChild(b);
    });
    $('monoCancel').onclick = closeModal;
  }
}

// ===================================================================
// TRADING
// ===================================================================
function openBankTrade() {
  const m = me();
  const rate = (r) => (m.ports && m.ports.includes(r)) ? 2 : (m.ports && m.ports.includes('3:1')) ? 3 : 4;
  openModal(`
    <h2>🏦 Bank / Port trade</h2>
    <div class="row"><label>Give</label><select id="giveRes">${resOptions()}</select></div>
    <div class="row"><label>Receive (1)</label><select id="wantRes">${resOptions()}</select></div>
    <p class="hint" id="rateHint"></p>
    <div class="modal-actions"><button id="btCancel">Cancel</button><button class="primary" id="btDo">Trade</button></div>
  `);
  const upd = () => { $('rateHint').textContent = `Rate: ${rate($('giveRes').value)} ${RES_LABEL[$('giveRes').value]} → 1 ${RES_LABEL[$('wantRes').value]}`; };
  $('giveRes').onchange = upd; $('wantRes').onchange = upd; upd();
  $('btCancel').onclick = closeModal;
  $('btDo').onclick = () => { act('bankTrade', { give: $('giveRes').value, want: $('wantRes').value }); closeModal(); };
}

function resOptions() { return Object.keys(RES_LABEL).map((r) => `<option value="${r}">${RES_LABEL[r]}</option>`).join(''); }

function openProposeTrade() {
  const give = {}, want = {};
  Object.keys(RES_LABEL).forEach((r) => { give[r] = 0; want[r] = 0; });
  openModal(`
    <h2>🤝 Offer a trade</h2>
    <div class="trade-side"><div class="trade-side-label">You give</div><div class="trade-cards" id="giveCards"></div></div>
    <div class="trade-arrow">⇅</div>
    <div class="trade-side"><div class="trade-side-label">You want</div><div class="trade-cards" id="wantCards"></div></div>
    <div class="modal-actions"><button id="ptCancel">Cancel</button><button class="primary" id="ptSend">Send offer</button></div>
  `, 'wide');
  buildTradeCards($('giveCards'), give, true);
  buildTradeCards($('wantCards'), want, false);
  $('ptCancel').onclick = closeModal;
  $('ptSend').onclick = () => {
    const gTot = Object.values(give).reduce((a, b) => a + b, 0);
    const wTot = Object.values(want).reduce((a, b) => a + b, 0);
    if (gTot === 0 && wTot === 0) return;
    act('proposeTrade', { give, want }); closeModal();
  };
}

function buildTradeCards(container, store, limitToHand) {
  const m = me();
  container.innerHTML = '';
  const order = ['lumber', 'brick', 'wool', 'grain', 'ore'];
  order.forEach((r) => {
    const have = limitToHand ? (m && m.resources ? m.resources[r] : 0) : 99;
    const wrap = document.createElement('div');
    wrap.className = 'trade-card-wrap';
    wrap.innerHTML = `
      <div class="card" title="${RES_LABEL[r]}">
        <div class="card-strip" style="background:${RES_COLORS[r]}"></div>
        <div class="card-emoji">${RES_ICON[r]}</div>
        <div class="card-name">${RES_LABEL[r]}</div>
        <div class="card-count tc-count">0</div>
      </div>
      <div class="counter"><button class="tc-minus">−</button><span class="tc-val">0</span><button class="tc-plus">+</button></div>`;
    const valEl = wrap.querySelector('.tc-val');
    const badge = wrap.querySelector('.tc-count');
    const sync = () => { valEl.textContent = store[r]; badge.textContent = store[r]; };
    wrap.querySelector('.tc-minus').onclick = () => { store[r] = Math.max(0, store[r] - 1); sync(); };
    wrap.querySelector('.tc-plus').onclick = () => { if (store[r] < have) { store[r] += 1; sync(); } };
    container.appendChild(wrap);
  });
}

function handleTradeOffer() {
  if (!state.tradeOffer) { if (currentModal === 'trade') closeModal(); return; }
  const offer = state.tradeOffer;
  const summarize = (obj) => Object.entries(obj).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${RES_LABEL[r]}`).join(', ') || 'nothing';
  if (offer.from === state.youAre) {
    const accepters = Object.entries(offer.responses).filter(([, a]) => a).map(([i]) => Number(i));
    openModal(`
      <h2>Your trade offer</h2>
      <p class="hint">You give: ${summarize(offer.give)}<br>You want: ${summarize(offer.want)}</p>
      <p class="hint">${accepters.length ? 'Accepted by:' : 'Waiting for responses…'}</p>
      ${accepters.map((i) => `<button class="full" data-partner="${i}" style="margin-bottom:6px">Trade with ${escapeHtml(state.players[i].name)}</button>`).join('')}
      <div class="modal-actions"><button id="cancelOffer">Cancel offer</button></div>
    `, 'trade');
    document.querySelectorAll('[data-partner]').forEach((b) => { b.onclick = () => act('confirmTrade', { partner: Number(b.dataset.partner) }); });
    $('cancelOffer').onclick = () => act('cancelTrade');
  } else {
    if (offer.responses[state.youAre] !== undefined) return;
    openModal(`
      <h2>${escapeHtml(state.players[offer.from].name)} offers a trade</h2>
      <p class="hint">They give you: ${summarize(offer.give)}<br>They want from you: ${summarize(offer.want)}</p>
      <div class="modal-actions"><button id="declineTrade">Decline</button><button class="primary" id="acceptTrade">Accept</button></div>
    `, 'trade');
    $('acceptTrade').onclick = () => act('respondTrade', { accept: true });
    $('declineTrade').onclick = () => act('respondTrade', { accept: false });
  }
}

// ===================================================================
// DISCARD
// ===================================================================
function openDiscardModal() {
  if (currentModal === 'discard') return;
  const need = state.pendingDiscards[state.youAre];
  const m = me();
  const pick = {};
  Object.keys(RES_LABEL).forEach((r) => { pick[r] = 0; });
  openModal(`
    <h2>Discard ${need} cards</h2><p class="hint">You rolled too many cards on a 7.</p>
    <div id="discCounters"></div>
    <p class="hint" id="discCount">Selected: 0 / ${need}</p>
    <div class="modal-actions"><button class="primary" id="discDo" disabled>Discard</button></div>
  `, 'discard');
  const container = $('discCounters');
  Object.keys(RES_LABEL).forEach((r) => {
    if (m.resources[r] === 0) return;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>${RES_LABEL[r]} (have ${m.resources[r]})</label>`;
    const counter = document.createElement('div');
    counter.className = 'counter';
    const val = document.createElement('span'); val.textContent = '0';
    const minus = btn('−', '', () => { pick[r] = Math.max(0, pick[r] - 1); val.textContent = pick[r]; updo(); });
    const plus = btn('+', '', () => { pick[r] = Math.min(m.resources[r], pick[r] + 1); val.textContent = pick[r]; updo(); });
    counter.append(minus, val, plus);
    row.appendChild(counter);
    container.appendChild(row);
  });
  function updo() {
    const total = Object.values(pick).reduce((a, b) => a + b, 0);
    $('discCount').textContent = `Selected: ${total} / ${need}`;
    $('discDo').disabled = total !== need;
  }
  $('discDo').onclick = () => { act('discard', { resources: pick }); closeModal(); };
}

// ===================================================================
// MODAL + UTIL
// ===================================================================
let currentModal = null;
function openModal(html, tag) {
  const box = $('modalBox');
  box.innerHTML = html;
  box.classList.toggle('wide', tag === 'wide');
  $('modal').classList.remove('hidden');
  currentModal = tag || 'generic';
}
function closeModal() { $('modal').classList.add('hidden'); currentModal = null; }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
