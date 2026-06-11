/* client.js — Hexion-2D browser client.
   Handles the lobby, renders the board on a canvas, and sends actions to the server. */

const socket = io();

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const lobby = $('lobby');
const gameScreen = $('game');
const canvas = $('board');
const ctx = canvas.getContext('2d');

let state = null;       // latest game state from server
let myName = '';
let isHost = false;
let roomCode = '';
let hoverTarget = null; // { kind:'vertex'|'edge'|'hex', id }

const RES_COLORS = {
  brick: '#c0563a', lumber: '#2e7d32', wool: '#9ccc65',
  grain: '#f4c430', ore: '#78909c', desert: '#d9c9a3',
};
const RES_LABEL = { brick: 'Brick', lumber: 'Lumber', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
const RES_ICON = { brick: '🧱', lumber: '🌲', wool: '🐑', grain: '🌾', ore: '⛰️', desert: '🏜️' };
// Two-tone terrain gradients (center -> rim) for a richer, less flat look
const RES_GRAD = {
  lumber: ['#4a9a38', '#1d4f15'],
  wool:   ['#bfe87a', '#7cb342'],
  grain:  ['#f7d65a', '#cf9c1c'],
  brick:  ['#d8714e', '#933824'],
  ore:    ['#9fb3bd', '#516a77'],
  desert: ['#ecd9a9', '#c9ad75'],
};
// Small scattered motif icons to texture each terrain
const RES_MOTIF = { lumber: '🌲', wool: '🐑', grain: '🌾', brick: '🧱', ore: '🪨', desert: '🌵' };
const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// Camera for zoom/pan (world units == canvas internal px at scale 1)
const cam = { scale: 1, ox: 0, oy: 0 };
const MIN_SCALE = 0.6, MAX_SCALE = 3;

let prevResources = null;   // to animate resource gains
let lastDiceKey = null;     // to trigger the dice animation once per roll
let timerInterval = null;   // local countdown ticker

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
// LOBBY
// ===================================================================
$('nameInput').value = localStorage.getItem('hexionName') || '';

$('createBtn').onclick = () => {
  myName = $('nameInput').value.trim() || 'Host';
  localStorage.setItem('hexionName', myName);
  socket.emit('createRoom', { name: myName }, (res) => {
    if (res.ok) { isHost = true; roomCode = res.code; }
  });
};

$('joinBtn').onclick = () => {
  myName = $('nameInput').value.trim() || 'Player';
  localStorage.setItem('hexionName', myName);
  const code = $('codeInput').value.trim().toUpperCase();
  if (!code) { showLobbyError('Enter a room code'); return; }
  socket.emit('joinRoom', { name: myName, code }, (res) => {
    if (res.ok) { isHost = false; roomCode = res.code; }
    else showLobbyError(res.error);
  });
};

$('addBotBtn').onclick = () => socket.emit('addBot', {}, () => {});
$('randomizeBtn').onclick = () => socket.emit('randomizeMap', {}, () => {});
$('timerSelect').onchange = () => socket.emit('setTimer', { seconds: Number($('timerSelect').value) }, () => {});
$('startBtn').onclick = () => socket.emit('startGame', {}, (res) => {
  if (!res.ok) showLobbyError(res.error);
});

$('backBtn').onclick = () => {
  if (confirm('Leave the game and return to the home screen?')) {
    socket.emit('leaveRoom');
    location.reload();
  }
};

// ---- Dock collapse / expand ----
$('dockToggle').onclick = () => {
  const dock = $('dock');
  const collapsed = dock.dataset.collapsed === '1';
  if (collapsed) {
    dock.style.setProperty('height', '244px', 'important');
    dock.classList.remove('collapsed');
    dock.dataset.collapsed = '0';
    $('dockToggle').textContent = '▾';
  } else {
    dock.style.setProperty('height', '14px', 'important');
    dock.classList.add('collapsed');
    dock.dataset.collapsed = '1';
    $('dockToggle').textContent = '▴';
  }
};

// ---- Night mode (persisted) ----
function applyNight(on) {
  document.body.classList.toggle('night', on);
  const btn = $('nightToggle');
  if (btn) btn.textContent = on ? '☀️' : '🌙';
  localStorage.setItem('hexionNight', on ? '1' : '0');
}
if ($('nightToggle')) {
  $('nightToggle').onclick = () => applyNight(!document.body.classList.contains('night'));
}
applyNight(localStorage.getItem('hexionNight') === '1');

// ---- Rulebook ----
$('rulebookTab').onclick = () => { $('rulebook').classList.remove('hidden'); };
$('rulebookClose').onclick = () => { $('rulebook').classList.add('hidden'); };
$('rulebookBody').innerHTML = RULEBOOK_HTML;
$('winPlayAgain').onclick = () => location.reload();

function showLobbyError(msg) { $('lobbyError').textContent = msg || ''; }

socket.on('lobby', (room) => {
  roomCode = room.code;
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

// Render the lobby map preview (hexes + ports only) on its own canvas.
function drawPreview(board) {
  const pc = $('previewCanvas');
  const pctx = pc.getContext('2d');
  pctx.clearRect(0, 0, pc.width, pc.height);
  // canvas is full board resolution (720x640) — draw 1:1
  pctx.save();
  renderPorts(pctx, board);
  renderHexes(pctx, board, board.robber);
  pctx.restore();
  showDifficulty(board);
}

// Estimate map difficulty/swinginess: high-pip tiles (6/8) clustered together,
// or many high numbers adjacent, make the map more luck-dependent ("harder").
function computeDifficulty(board) {
  const PIP = { 2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1 };
  let redAdjacency = 0; // 6/8 tiles touching each other (forbidden in balanced maps)
  let highClusters = 0; // adjacent tiles both >=4 pips
  board.hexes.forEach((h) => {
    if (!h.number) return;
    // find neighboring hexes (share 2 vertices)
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
  let label, cls, stars;
  if (score <= 2) { label = 'Balanced & fair'; cls = 'easy'; stars = '★☆☆'; }
  else if (score <= 6) { label = 'Balanced'; cls = 'balanced'; stars = '★★☆'; }
  else { label = 'Swingy / Hard'; cls = 'hard'; stars = '★★★'; }
  return { label, cls, stars, score };
}

function showDifficulty(board) {
  const el = $('difficultyBadge');
  if (!el) return;
  const d = computeDifficulty(board);
  el.className = `difficulty-badge ${d.cls}`;
  el.style.display = 'inline-flex';
  el.innerHTML = `<span class="diff-dot" style="background:currentColor"></span>Difficulty: ${d.label} <span class="diff-stars">${d.stars}</span>`;
}

socket.on('gameStarted', () => {
  lobby.classList.add('hidden');
  gameScreen.classList.remove('hidden');
});

// ===================================================================
// GAME STATE
// ===================================================================
socket.on('state', (s) => {
  const prev = state;
  state = s;
  lobby.classList.add('hidden');
  gameScreen.classList.remove('hidden');

  // Auto-fit the camera once when the game first appears.
  if (!prev) fitBoard();
  // Dice roll animation: fire when a new roll appears.
  if (s.dice) {
    const key = `${s.turn}:${s.dice[0]}:${s.dice[1]}:${s.hasRolled}`;
    if (key !== lastDiceKey && (!prev || !prev.dice || prev.dice[0] !== s.dice[0] || prev.dice[1] !== s.dice[1] || prev.turn !== s.turn)) {
      showDiceFx(s.dice);
    }
    lastDiceKey = key;
  } else {
    lastDiceKey = null;
  }

  render();
  updateTimer();

  // Winner celebration
  if (s.phase === 'over' && s.winner != null) {
    if (!(prev && prev.phase === 'over')) celebrate(s.players[s.winner].name);
  }
});

const me = () => (state ? state.players[state.youAre] : null);
const myTurn = () => state && state.turn === state.youAre;

// ===================================================================
// CANVAS RENDERING
// ===================================================================
function render() {
  if (!state) return;
  drawBoard();
  drawBanner();
  drawPlayers();
  drawRoll();
  drawHand();
  drawActions();
  drawDevCards();
  drawBonuses();
  drawLog();
  handlePassivePrompts();
  canvas.classList.toggle('placing', !!placementMode);
  // server-driven modals
  if (state.tradeOffer) handleTradeOffer();
  else if (currentModal === 'trade') closeModal();
}

function drawBoard() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(cam.ox, cam.oy);
  ctx.scale(cam.scale, cam.scale);

  const b = state.board;
  renderPorts(ctx, b);
  renderHexes(ctx, b, state.robber);

  // Roads
  Object.entries(state.roads).forEach(([eid, owner]) => {
    drawRoad(b.edges[eid], state.players[owner].color);
  });

  // Buildings
  Object.entries(state.buildings).forEach(([vid, bld]) => {
    drawBuilding(b.vertices[vid], bld, state.players[bld.owner].color);
  });

  // Hover highlights for valid placement
  drawHover();
  ctx.restore();
}

// ---- Shared renderers (used by both the game board and the lobby preview) ----
function renderHexes(c, board, robberHex) {
  board.hexes.forEach((hex) => drawHexOn(c, board, hex, robberHex));
}

function renderPorts(c, board) {
  board.ports.forEach((port) => drawPortOn(c, board, port));
}

function drawPortOn(c, board, port) {
  const bx = port.bx, by = port.by;
  const anchors = port.anchors || [];

  // ropes from the boat to the two coastal CORNERS
  c.strokeStyle = 'rgba(245,236,215,.55)';
  c.lineWidth = 2;
  c.setLineDash([4, 3]);
  anchors.forEach((a) => {
    c.beginPath();
    c.moveTo(bx, by);
    c.lineTo(a.x, a.y);
    c.stroke();
  });
  c.setLineDash([]);

  // little corner pegs so it clearly reads as "on the corners"
  anchors.forEach((a) => {
    c.beginPath();
    c.arc(a.x, a.y, 4, 0, Math.PI * 2);
    c.fillStyle = '#f5ecd7';
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = '#7a5a35';
    c.stroke();
  });

  // boat hull
  c.save();
  c.translate(bx, by);
  c.beginPath();
  c.moveTo(-17, -2);
  c.lineTo(17, -2);
  c.quadraticCurveTo(13, 11, 0, 12);
  c.quadraticCurveTo(-13, 11, -17, -2);
  c.closePath();
  c.fillStyle = '#7a4a23';
  c.fill();
  c.lineWidth = 1.5;
  c.strokeStyle = '#4a2c12';
  c.stroke();

  // ratio badge / sail
  const isAny = port.type === '3:1';
  c.beginPath();
  roundRect(c, -19, -22, 38, 18, 6);
  c.fillStyle = '#f7efdc';
  c.fill();
  c.lineWidth = 2.5;
  c.strokeStyle = isAny ? '#7a6a4a' : RES_COLORS[port.type];
  c.stroke();

  c.fillStyle = '#23303a';
  c.font = 'bold 11px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const label = isAny ? '3:1' : '2:1';
  c.fillText(`${label} ${isAny ? '' : RES_ICON[port.type]}`, 0, -13);
  c.restore();
}

function drawHexOn(c, board, hex, robberHex) {
  // hex path
  c.beginPath();
  hex.vertices.forEach((vid, i) => {
    const v = board.vertices[vid];
    if (i === 0) c.moveTo(v.x, v.y);
    else c.lineTo(v.x, v.y);
  });
  c.closePath();

  // terrain gradient fill (lighter top-left -> darker rim) for depth
  const grad = RES_GRAD[hex.resource] || ['#cccccc', '#888888'];
  const g = c.createRadialGradient(hex.cx - 14, hex.cy - 16, 8, hex.cx, hex.cy, 62);
  g.addColorStop(0, grad[0]);
  g.addColorStop(1, grad[1]);
  c.save();
  c.shadowColor = 'rgba(0,0,0,.35)';
  c.shadowBlur = 8;
  c.shadowOffsetY = 3;
  c.fillStyle = g;
  c.fill();
  c.restore();

  // scattered terrain motif (clipped to the hex) for texture
  c.save();
  c.clip();
  c.globalAlpha = 0.5;
  c.font = '13px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const motif = RES_MOTIF[hex.resource];
  if (motif) {
    const spots = [
      [-22, -10], [20, -14], [-14, 16], [16, 14], [0, -24], [-26, 12], [26, 6],
    ];
    spots.forEach(([ox, oy], i) => {
      if ((hex.id + i) % 3 === 0 && hex.number) return; // thin out near token
      c.fillText(motif, hex.cx + ox, hex.cy + oy);
    });
  }
  c.globalAlpha = 1;
  c.restore();

  // crisp coastline border
  c.lineWidth = 3;
  c.strokeStyle = 'rgba(20,55,80,.85)';
  c.stroke();
  // subtle inner highlight
  c.lineWidth = 1.2;
  c.strokeStyle = 'rgba(255,255,255,.18)';
  c.stroke();

  // Number token (clean disc with shadow)
  if (hex.number) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,.4)';
    c.shadowBlur = 6;
    c.shadowOffsetY = 2;
    c.beginPath();
    c.arc(hex.cx, hex.cy, 18, 0, Math.PI * 2);
    const tg = c.createRadialGradient(hex.cx - 5, hex.cy - 6, 2, hex.cx, hex.cy, 18);
    tg.addColorStop(0, '#fffdf5');
    tg.addColorStop(1, '#e7d8b4');
    c.fillStyle = tg;
    c.fill();
    c.restore();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,.35)';
    c.stroke();

    const hot = hex.number === 6 || hex.number === 8;
    c.fillStyle = hot ? '#c0392b' : '#2a2a2a';
    c.font = `bold ${hot ? 18 : 16}px Georgia, serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(hex.number, hex.cx, hex.cy - 2);
    const pips = { 2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1 }[hex.number] || 0;
    c.fillStyle = hot ? '#c0392b' : '#666';
    c.font = '9px sans-serif';
    c.fillText('•'.repeat(pips), hex.cx, hex.cy + 11);
  } else if (hex.resource === 'desert') {
    // desert keeps a sun motif center
    c.font = '28px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('🌵', hex.cx, hex.cy);
  }

  // Robber
  if (robberHex === hex.id) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,.5)';
    c.shadowBlur = 8;
    c.font = '30px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('🥷', hex.cx, hex.cy - (hex.number ? 22 : 0));
    c.restore();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
}

function drawHex(hex) {
  drawHexOn(ctx, state.board, hex, state.robber);
}

function drawRoad(edge, color) {
  const b = state.board;
  const v1 = b.vertices[edge.v1];
  const v2 = b.vertices[edge.v2];
  ctx.beginPath();
  ctx.moveTo(v1.x, v1.y);
  ctx.lineTo(v2.x, v2.y);
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,.3)';
  ctx.stroke();
}

function drawBuilding(v, bld, color) {
  ctx.save();
  ctx.translate(v.x, v.y);
  if (bld.type === 'settlement') {
    ctx.beginPath();
    ctx.moveTo(-9, 6); ctx.lineTo(-9, -3); ctx.lineTo(0, -11); ctx.lineTo(9, -3); ctx.lineTo(9, 6);
    ctx.closePath();
  } else {
    ctx.beginPath();
    ctx.rect(-11, -2, 22, 11);
    ctx.moveTo(-11, -2); ctx.lineTo(-11, -9); ctx.lineTo(-2, -9); ctx.lineTo(-2, -2);
    ctx.moveTo(-2, -2); ctx.lineTo(4, -14); ctx.lineTo(11, -9); ctx.lineTo(11, -2);
    ctx.closePath();
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.restore();
}

function drawHover() {
  if (!hoverTarget) return;
  const b = state.board;
  ctx.save();
  if (hoverTarget.kind === 'vertex') {
    const v = b.vertices[hoverTarget.id];
    ctx.beginPath();
    ctx.arc(v.x, v.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fill();
  } else if (hoverTarget.kind === 'edge') {
    const e = b.edges[hoverTarget.id];
    const v1 = b.vertices[e.v1], v2 = b.vertices[e.v2];
    ctx.beginPath();
    ctx.moveTo(v1.x, v1.y); ctx.lineTo(v2.x, v2.y);
    ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.stroke();
  } else if (hoverTarget.kind === 'hex') {
    const h = b.hexes[hoverTarget.id];
    ctx.beginPath();
    ctx.arc(h.cx, h.cy, 30, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}

// ===================================================================
// SIDEBAR PANELS
// ===================================================================
function drawBanner() {
  const banner = $('banner');
  const cur = state.players[state.turn];
  let msg = '';
  if (state.phase === 'over') {
    msg = `🎉 ${state.players[state.winner].name} wins!`;
  } else if (state.phase === 'setup1' || state.phase === 'setup2') {
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
    msg = myTurn() ? `Your turn${state.dice ? ` · rolled ${state.dice[0]+state.dice[1]}` : ''}` : `${cur.name}'s turn…`;
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

// Dedicated circular roll-dice button (separate from turn actions).
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

// ---- Turn timer (top bar) ----
function updateTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const el = $('turnTimer');
  const timer = state && state.timer;
  if (!timer || !timer.deadline || state.phase === 'over') {
    el.classList.add('hidden');
    return;
  }
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

// ---- Dice roll animation ----
function showDiceFx(dice) {
  const fx = $('diceFx');
  $('die1').textContent = DICE_FACES[dice[0]];
  $('die2').textContent = DICE_FACES[dice[1]];
  fx.classList.remove('hidden');
  // restart the CSS animation
  fx.querySelectorAll('span').forEach((s) => { s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; });
  clearTimeout(showDiceFx._t);
  showDiceFx._t = setTimeout(() => fx.classList.add('hidden'), 1400);
}

// ---- Winner celebration: confetti party poppers + congrats text ----
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

  // Party poppers: bursts from bottom-left and bottom-right corners
  function burst(x, y, dirX) {
    for (let i = 0; i < 90; i++) {
      const ang = (-Math.PI / 2) + dirX * (Math.random() * 0.8) - 0.4;
      const speed = 8 + Math.random() * 12;
      pieces.push({
        x, y,
        vx: Math.cos(ang) * speed + dirX * 4,
        vy: Math.sin(ang) * speed - Math.random() * 4,
        size: 5 + Math.random() * 7,
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        life: 1,
      });
    }
  }
  // continuous gentle rain too
  function rain() {
    for (let i = 0; i < 4; i++) {
      pieces.push({
        x: Math.random() * W(), y: -10,
        vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
        size: 5 + Math.random() * 6, color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, life: 1,
      });
    }
  }

  burst(40, H() - 20, 1);
  burst(W() - 40, H() - 20, -1);
  let popTimer = 0;
  let running = true;

  function frame() {
    if (!running) return;
    c.clearRect(0, 0, W(), H());
    popTimer++;
    if (popTimer % 70 === 0) { burst(40, H() - 20, 1); burst(W() - 40, H() - 20, -1); }
    rain();
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      p.vy += 0.25; // gravity
      p.vx *= 0.99;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      c.save();
      c.translate(p.x, p.y); c.rotate(p.rot);
      c.fillStyle = p.color;
      c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      c.restore();
      if (p.y > H() + 20) pieces.splice(i, 1);
    }
    requestAnimationFrame(frame);
  }
  frame();
  // stop after a while to save CPU but keep the overlay
  runConfetti._stop && clearTimeout(runConfetti._stop);
  runConfetti._stop = setTimeout(() => { running = false; }, 12000);
}

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

// ===================================================================
// ACTIONS
// ===================================================================
function act(type, payload) {
  socket.emit('action', { type, payload }, (res) => {
    if (res && !res.ok) flash(res.error);
  });
}

function flash(msg) {
  const banner = $('banner');
  const prev = banner.textContent;
  banner.textContent = '⚠️ ' + msg;
  banner.style.color = '#ffb3a0';
  setTimeout(() => { banner.style.color = ''; render(); }, 1400);
}

// ---- Placement mode (settlement / city / road) ----
let placementMode = null; // 'settlement' | 'city' | 'road' | 'setupSettlement' | 'setupRoad' | 'robber'

function startPlacement(mode) {
  placementMode = mode;
  flash(`Click the board to place your ${mode}.`);
}

function handlePassivePrompts() {
  // clear leftover setup placement once setup is over
  const setupSub = state.subPhase === 'setupSettlement' || state.subPhase === 'setupRoad';
  if (!setupSub && (placementMode === 'setupSettlement' || placementMode === 'setupRoad')) placementMode = null;
  if (state.subPhase === 'roll' && placementMode && placementMode !== 'robber') placementMode = null;

  // auto-enter placement mode for required setup / robber steps
  if (!myTurn() && !(state.subPhase === 'robber' && state.robberMover === state.youAre) &&
      !(state.subPhase === 'discard' && state.pendingDiscards[state.youAre])) {
    if (placementMode && !['robber'].includes(placementMode)) placementMode = null;
  }
  if (state.subPhase === 'setupSettlement' && myTurn()) placementMode = 'setupSettlement';
  else if (state.subPhase === 'setupRoad' && myTurn()) placementMode = 'setupRoad';
  else if (state.subPhase === 'robber' && state.robberMover === state.youAre) placementMode = 'robber';
  else if (state.subPhase === 'discard' && state.pendingDiscards[state.youAre]) openDiscardModal();
}

// ===================================================================
// CANVAS INTERACTION
// ===================================================================
// Canvas pixel coords (accounts for CSS scaling of the element)
function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

// Convert a canvas pixel position to world (board) coordinates via the camera.
function worldPos(e) {
  const p = canvasPos(e);
  return { x: (p.x - cam.ox) / cam.scale, y: (p.y - cam.oy) / cam.scale };
}

function nearestVertex(pos, maxDist = 16) {
  let best = null, bd = maxDist;
  state.board.vertices.forEach((v) => {
    const d = Math.hypot(v.x - pos.x, v.y - pos.y);
    if (d < bd) { bd = d; best = v.id; }
  });
  return best;
}

function nearestEdge(pos, maxDist = 14) {
  let best = null, bd = maxDist;
  state.board.edges.forEach((e) => {
    const d = Math.hypot(e.x - pos.x, e.y - pos.y);
    if (d < bd) { bd = d; best = e.id; }
  });
  return best;
}

function nearestHex(pos, maxDist = 45) {
  let best = null, bd = maxDist;
  state.board.hexes.forEach((h) => {
    const d = Math.hypot(h.cx - pos.x, h.cy - pos.y);
    if (d < bd) { bd = d; best = h.id; }
  });
  return best;
}

// ---- Pointer: drag to pan, click to place ----
let dragging = false, dragMoved = false, dragStart = null, camStart = null;

canvas.addEventListener('pointerdown', (e) => {
  if (!state) return;
  dragging = true; dragMoved = false;
  dragStart = { x: e.clientX, y: e.clientY };
  camStart = { ox: cam.ox, oy: cam.oy };
  canvas.classList.add('grabbing');
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!state) return;
  if (dragging) {
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true;
    if (dragMoved) {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
      cam.ox = camStart.ox + dx * sx;
      cam.oy = camStart.oy + dy * sy;
      drawBoard();
    }
    return;
  }
  // hover preview while in placement mode
  if (!placementMode) { if (hoverTarget) { hoverTarget = null; drawBoard(); } return; }
  const pos = worldPos(e);
  let t = null;
  if (placementMode === 'road' || placementMode === 'setupRoad') {
    const id = nearestEdge(pos); if (id != null) t = { kind: 'edge', id };
  } else if (placementMode === 'robber') {
    const id = nearestHex(pos); if (id != null) t = { kind: 'hex', id };
  } else {
    const id = nearestVertex(pos); if (id != null) t = { kind: 'vertex', id };
  }
  if (JSON.stringify(t) !== JSON.stringify(hoverTarget)) { hoverTarget = t; drawBoard(); }
});

canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('grabbing');
  const wasDrag = dragMoved;
  dragging = false; dragMoved = false;
  if (!state || wasDrag) return; // a pan, not a click
  handleBoardClick(e);
});

function handleBoardClick(e) {
  const pos = worldPos(e);
  if (placementMode === 'setupSettlement') {
    const v = nearestVertex(pos); if (v != null) act('placeSetupSettlement', { vertex: v });
  } else if (placementMode === 'setupRoad') {
    const ed = nearestEdge(pos); if (ed != null) act('placeSetupRoad', { edge: ed });
  } else if (placementMode === 'settlement') {
    const v = nearestVertex(pos); if (v != null) { act('build', { buildType: 'settlement', target: v }); placementMode = null; }
  } else if (placementMode === 'city') {
    const v = nearestVertex(pos); if (v != null) { act('build', { buildType: 'city', target: v }); placementMode = null; }
  } else if (placementMode === 'road') {
    const ed = nearestEdge(pos); if (ed != null) { act('build', { buildType: 'road', target: ed }); if (state.freeRoads <= 1) placementMode = null; }
  } else if (placementMode === 'robber') {
    const h = nearestHex(pos); if (h != null) chooseRobberTarget(h);
  }
  hoverTarget = null;
}

// ---- Zoom (wheel + buttons) ----
function zoomAt(cx, cy, factor) {
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale * factor));
  const k = newScale / cam.scale;
  // keep the point under the cursor fixed
  cam.ox = cx - (cx - cam.ox) * k;
  cam.oy = cy - (cy - cam.oy) * k;
  cam.scale = newScale;
  drawBoard();
}

canvas.addEventListener('wheel', (e) => {
  if (!state) return;
  e.preventDefault();
  const p = canvasPos(e);
  zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

$('zoomIn').onclick = () => zoomAt(canvas.width / 2, canvas.height / 2, 1.2);
$('zoomOut').onclick = () => zoomAt(canvas.width / 2, canvas.height / 2, 1 / 1.2);
$('zoomReset').onclick = () => { fitBoard(); drawBoard(); };

// Fit the whole board (incl. port boats) into the canvas with padding.
function fitBoard() {
  if (!state || !state.board || !state.board.bounds) { cam.scale = 1; cam.ox = 0; cam.oy = 0; return; }
  const b = state.board.bounds;
  const pad = 28;
  const bw = (b.maxX - b.minX) || 1;
  const bh = (b.maxY - b.minY) || 1;
  const scale = Math.min((canvas.width - pad * 2) / bw, (canvas.height - pad * 2) / bh);
  cam.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  // center the board
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  cam.ox = canvas.width / 2 - cx * cam.scale;
  cam.oy = canvas.height / 2 - cy * cam.scale;
}

function chooseRobberTarget(hexId) {
  // find opponents with buildings on this hex
  const victims = new Set();
  state.board.hexes[hexId].vertices.forEach((vid) => {
    const b = state.buildings[vid];
    if (b && b.owner !== state.youAre) victims.add(b.owner);
  });
  const list = Array.from(victims).filter((i) => state.players[i].totalCards > 0);
  if (list.length === 0) {
    act('moveRobber', { hex: hexId, target: null });
    placementMode = null;
    return;
  }
  if (list.length === 1) {
    act('moveRobber', { hex: hexId, target: list[0] });
    placementMode = null;
    return;
  }
  // choose whom to steal from
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
    if (card === 'knight') placementMode = 'robber';
    return;
  }
  if (card === 'plenty') {
    let picks = [];
    openModal(`
      <h2>Year of Plenty</h2>
      <p class="hint">Pick 2 resources from the bank.</p>
      <div class="res-select" id="plentySel"></div>
      <div class="modal-actions">
        <button id="plentyCancel">Cancel</button>
        <button class="primary" id="plentyOk" disabled>Take</button>
      </div>
    `);
    const sel = $('plentySel');
    Object.keys(RES_LABEL).forEach((r) => {
      const b = btn(RES_LABEL[r], '', () => {
        picks.push(r);
        if (picks.length > 2) picks.shift();
        renderPlenty();
      });
      b.dataset.res = r;
      sel.appendChild(b);
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
      <h2>Monopoly</h2>
      <p class="hint">Choose a resource to take from everyone.</p>
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
    <div class="modal-actions">
      <button id="btCancel">Cancel</button>
      <button class="primary" id="btDo">Trade</button>
    </div>
  `);
  const upd = () => { $('rateHint').textContent = `Rate: ${rate($('giveRes').value)} ${RES_LABEL[$('giveRes').value]} → 1 ${RES_LABEL[$('wantRes').value]}`; };
  $('giveRes').onchange = upd; $('wantRes').onchange = upd; upd();
  $('btCancel').onclick = closeModal;
  $('btDo').onclick = () => { act('bankTrade', { give: $('giveRes').value, want: $('wantRes').value }); closeModal(); };
}

function resOptions() {
  return Object.keys(RES_LABEL).map((r) => `<option value="${r}">${RES_LABEL[r]}</option>`).join('');
}

function openProposeTrade() {
  const give = {}, want = {};
  Object.keys(RES_LABEL).forEach((r) => { give[r] = 0; want[r] = 0; });
  openModal(`
    <h2>🤝 Offer a trade</h2>
    <div class="trade-side"><div class="trade-side-label">You give</div><div class="trade-cards" id="giveCards"></div></div>
    <div class="trade-arrow">⇅</div>
    <div class="trade-side"><div class="trade-side-label">You want</div><div class="trade-cards" id="wantCards"></div></div>
    <div class="modal-actions">
      <button id="ptCancel">Cancel</button>
      <button class="primary" id="ptSend">Send offer</button>
    </div>
  `, 'wide');
  buildTradeCards($('giveCards'), give, true);
  buildTradeCards($('wantCards'), want, false);
  $('ptCancel').onclick = closeModal;
  $('ptSend').onclick = () => {
    const gTot = Object.values(give).reduce((a, b) => a + b, 0);
    const wTot = Object.values(want).reduce((a, b) => a + b, 0);
    if (gTot === 0 && wTot === 0) { return; }
    act('proposeTrade', { give, want });
    closeModal();
  };
}

// Real-card trade builder: click +/- on each resource card.
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
      <div class="counter">
        <button class="tc-minus">−</button><span class="tc-val">0</span><button class="tc-plus">+</button>
      </div>`;
    const valEl = wrap.querySelector('.tc-val');
    const badge = wrap.querySelector('.tc-count');
    const sync = () => { valEl.textContent = store[r]; badge.textContent = store[r]; };
    wrap.querySelector('.tc-minus').onclick = () => { store[r] = Math.max(0, store[r] - 1); sync(); };
    wrap.querySelector('.tc-plus').onclick = () => { if (store[r] < have) { store[r] += 1; sync(); } };
    container.appendChild(wrap);
  });
}

// kept for any legacy callers
function buildCounters(container, store) {
  Object.keys(RES_LABEL).forEach((r) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>${RES_LABEL[r]}</label>`;
    const counter = document.createElement('div');
    counter.className = 'counter';
    const minus = btn('−', '', () => { store[r] = Math.max(0, store[r] - 1); val.textContent = store[r]; });
    const val = document.createElement('span');
    val.textContent = store[r];
    const plus = btn('+', '', () => { store[r] += 1; val.textContent = store[r]; });
    counter.append(minus, val, plus);
    row.appendChild(counter);
    container.appendChild(row);
  });
}

// Incoming trade offer (for non-proposers) + proposer confirm panel
function handleTradeOffer() {
  if (!state.tradeOffer) { if (currentModal === 'trade') closeModal(); return; }
  const offer = state.tradeOffer;
  const summarize = (obj) => Object.entries(obj).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${RES_LABEL[r]}`).join(', ') || 'nothing';

  if (offer.from === state.youAre) {
    // proposer: show who accepted
    const accepters = Object.entries(offer.responses).filter(([, a]) => a).map(([i]) => Number(i));
    openModal(`
      <h2>Your trade offer</h2>
      <p class="hint">You give: ${summarize(offer.give)}<br>You want: ${summarize(offer.want)}</p>
      <p class="hint">${accepters.length ? 'Accepted by:' : 'Waiting for responses…'}</p>
      ${accepters.map((i) => `<button class="full" data-partner="${i}" style="margin-bottom:6px">Trade with ${escapeHtml(state.players[i].name)}</button>`).join('')}
      <div class="modal-actions"><button id="cancelOffer">Cancel offer</button></div>
    `, 'trade');
    document.querySelectorAll('[data-partner]').forEach((b) => {
      b.onclick = () => act('confirmTrade', { partner: Number(b.dataset.partner) });
    });
    $('cancelOffer').onclick = () => act('cancelTrade');
  } else {
    // responder
    if (offer.responses[state.youAre] !== undefined) { if (currentModal === 'trade') {/* keep */} return; }
    openModal(`
      <h2>${escapeHtml(state.players[offer.from].name)} offers a trade</h2>
      <p class="hint">They give you: ${summarize(offer.give)}<br>They want from you: ${summarize(offer.want)}</p>
      <div class="modal-actions">
        <button id="declineTrade">Decline</button>
        <button class="primary" id="acceptTrade">Accept</button>
      </div>
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
    <h2>Discard ${need} cards</h2>
    <p class="hint">You rolled too many cards on a 7.</p>
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
    const val = document.createElement('span');
    val.textContent = '0';
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
// MODAL HELPERS
// ===================================================================
let currentModal = null;
function openModal(html, tag) {
  const box = $('modalBox');
  box.innerHTML = html;
  box.classList.toggle('wide', tag === 'wide');
  $('modal').classList.remove('hidden');
  currentModal = tag || 'generic';
}
function closeModal() {
  $('modal').classList.add('hidden');
  currentModal = null;
}

// ===================================================================
// UTIL
// ===================================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
