// index.js — Express + Socket.IO server hosting Hexion games.
// Manages lobbies/rooms, relays actions to the authoritative GameEngine,
// and drives bot turns. Friends connect to this one machine to play together.

const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { GameEngine } = require('./gameEngine');
const { generateBoard } = require('./board');
const { botStep } = require('./bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3001;

// rooms: code -> {
//   code, host, players:[{id,name,isBot,socketId}], engine, started,
//   previewBoard, turnSeconds, timer:{deadline,seconds}, timerHandle, timerKey
// }
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function lobbyState(room) {
  return {
    code: room.code,
    host: room.host,
    started: room.started,
    turnSeconds: room.turnSeconds,
    previewBoard: room.previewBoard,
    players: room.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })),
  };
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobby', lobbyState(room));
}

function broadcastGame(room) {
  if (!room.engine) return;
  const timer = room.timer || { deadline: null, seconds: room.turnSeconds };
  room.players.forEach((p, idx) => {
    if (p.isBot) return;
    if (p.socketId) {
      const st = room.engine.getState(idx);
      st.timer = timer;
      io.to(p.socketId).emit('state', st);
    }
  });
}

// ---------- Turn timer ----------
function clearTimer(room) {
  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = null;
  }
  room.timerKey = null;
  room.timer = { deadline: null, seconds: room.turnSeconds };
}

// Arm the per-turn timer only when it's a HUMAN's normal turn (roll/main).
function armTimer(room) {
  const engine = room.engine;
  if (!engine || engine.phase !== 'play') { clearTimer(room); return; }
  if (!room.turnSeconds || room.turnSeconds <= 0) { clearTimer(room); return; }

  const cur = room.players[engine.turn];
  const timedSub = engine.subPhase === 'roll' || engine.subPhase === 'main';
  if (!cur || cur.isBot || !timedSub) {
    if (room.timerHandle) { clearTimeout(room.timerHandle); room.timerHandle = null; }
    room.timerKey = null;
    room.timer = { deadline: null, seconds: room.turnSeconds };
    return;
  }

  // (Re)arm once per human turn; don't reset on every minor action in that turn.
  const key = `${engine.turn}`;
  if (room.timerKey === key && room.timerHandle) return;
  room.timerKey = key;
  if (room.timerHandle) clearTimeout(room.timerHandle);

  const ms = room.turnSeconds * 1000;
  room.timer = { deadline: Date.now() + ms, seconds: room.turnSeconds };
  room.timerHandle = setTimeout(() => onTimerExpire(room, engine.turn), ms);
}

function onTimerExpire(room, turnSnapshot) {
  const engine = room.engine;
  if (!engine || engine.phase !== 'play') return;
  if (engine.turn !== turnSnapshot) return; // turn already advanced
  const pIdx = engine.turn;
  const player = room.players[pIdx];
  if (!player || player.isBot) return;

  engine.addLog(`${engine.players[pIdx].name}'s timer expired — auto-resolving.`);
  if (engine.subPhase === 'roll') engine.rollDice(pIdx);

  // Resolve any 7-triggered discards / robber for everyone via bot logic.
  let guard = 0;
  while (engine.phase === 'play' && guard++ < 25) {
    if (engine.subPhase === 'discard') {
      Object.keys(engine.pendingDiscards).forEach((i) => botStep(engine, Number(i)));
      continue;
    }
    if (engine.subPhase === 'robber' && engine.robberMover != null) {
      botStep(engine, engine.robberMover);
      continue;
    }
    break;
  }

  if (engine.phase === 'play' && engine.turn === pIdx && engine.subPhase === 'main') {
    engine.endTurn(pIdx);
  }

  room.timerKey = null;
  broadcastGame(room);
  setTimeout(() => runBots(room), 300);
  armTimer(room);
  broadcastGame(room);
}

// Drive bots until it's a human's turn or nothing left to automate.
function runBots(room) {
  const engine = room.engine;
  if (!engine || engine.phase === 'over') {
    clearTimer(room);
    broadcastGame(room);
    return;
  }

  let acted = false;
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (!p.isBot) continue;
    // bots act on their turn, or when they must discard/move robber
    const mustDiscard = engine.subPhase === 'discard' && engine.pendingDiscards[i];
    const mustRobber = engine.subPhase === 'robber' && engine.robberMover === i;
    const isTurn = engine.turn === i;
    if (mustDiscard || mustRobber || isTurn) {
      const did = botStep(engine, i);
      if (did) {
        acted = true;
        break; // re-evaluate from scratch after each action
      }
    }
  }

  armTimer(room);
  broadcastGame(room);

  if (acted && engine.phase !== 'over') {
    // small delay so humans can follow the action
    setTimeout(() => runBots(room), 700);
  }
}

// After any human action, push state then let bots respond.
function afterAction(room) {
  armTimer(room);
  broadcastGame(room);
  setTimeout(() => runBots(room), 400);
}

io.on('connection', (socket) => {
  socket.data.playerId = socket.id;

  socket.on('createRoom', ({ name }, cb) => {
    const code = makeCode();
    const room = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name: name || 'Host', isBot: false, socketId: socket.id }],
      engine: null,
      started: false,
      previewBoard: generateBoard(),
      turnSeconds: 0, // 0 = no timer
      timer: { deadline: null, seconds: 0 },
      timerHandle: null,
      timerKey: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    cb && cb({ ok: true, code });
    broadcastLobby(room);
  });

  socket.on('joinRoom', ({ name, code }, cb) => {
    code = (code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    if (room.started) return cb && cb({ ok: false, error: 'Game already started' });
    if (room.players.filter((p) => !p.isBot).length >= 4) return cb && cb({ ok: false, error: 'Room is full' });
    room.players.push({ id: socket.id, name: name || 'Player', isBot: false, socketId: socket.id });
    socket.join(code);
    socket.data.room = code;
    cb && cb({ ok: true, code });
    broadcastLobby(room);
  });

  socket.on('addBot', (_, cb) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id || room.started) return cb && cb({ ok: false });
    if (room.players.length >= 4) return cb && cb({ ok: false, error: 'Max 4 players' });
    const botNum = room.players.filter((p) => p.isBot).length + 1;
    room.players.push({ id: `bot-${Date.now()}-${botNum}`, name: `Bot ${botNum}`, isBot: true, socketId: null });
    broadcastLobby(room);
    cb && cb({ ok: true });
  });

  socket.on('removeBot', ({ id }, cb) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id || room.started) return cb && cb({ ok: false });
    room.players = room.players.filter((p) => !(p.isBot && p.id === id));
    broadcastLobby(room);
    cb && cb({ ok: true });
  });

  socket.on('randomizeMap', (_, cb) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id || room.started) return cb && cb({ ok: false });
    room.previewBoard = generateBoard();
    broadcastLobby(room);
    cb && cb({ ok: true });
  });

  socket.on('setTimer', ({ seconds }, cb) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id || room.started) return cb && cb({ ok: false });
    const s = Math.max(0, Math.min(600, Math.round(Number(seconds) || 0)));
    room.turnSeconds = s;
    room.timer = { deadline: null, seconds: s };
    broadcastLobby(room);
    cb && cb({ ok: true });
  });

  socket.on('startGame', (_, cb) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id) return cb && cb({ ok: false });
    if (room.players.length < 2) return cb && cb({ ok: false, error: 'Need at least 2 players (add a bot for solo play)' });
    room.engine = new GameEngine(
      room.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })),
      room.previewBoard
    );
    room.started = true;
    io.to(room.code).emit('gameStarted');
    cb && cb({ ok: true });
    afterAction(room);
  });

  // ---- In-game actions ----
  socket.on('action', ({ type, payload }, cb) => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.engine) return cb && cb({ ok: false, error: 'No active game' });
    const engine = room.engine;
    const pIdx = room.players.findIndex((p) => p.socketId === socket.id);
    if (pIdx < 0) return cb && cb({ ok: false, error: 'You are not in this game' });

    let result = { ok: false, error: 'Unknown action' };
    payload = payload || {};
    switch (type) {
      case 'placeSetupSettlement': result = engine.placeSetupSettlement(pIdx, payload.vertex); break;
      case 'placeSetupRoad': result = engine.placeSetupRoad(pIdx, payload.edge); break;
      case 'rollDice': result = engine.rollDice(pIdx); break;
      case 'build': result = engine.build(pIdx, payload.buildType, payload.target); break;
      case 'buyDev': result = engine.buyDev(pIdx); break;
      case 'playDev': result = engine.playDev(pIdx, payload.card, payload.args); break;
      case 'bankTrade': result = engine.bankTrade(pIdx, payload.give, payload.want); break;
      case 'proposeTrade': result = engine.proposeTrade(pIdx, payload.give, payload.want); break;
      case 'respondTrade': result = engine.respondTrade(pIdx, payload.accept); break;
      case 'confirmTrade': result = engine.confirmTrade(pIdx, payload.partner); break;
      case 'cancelTrade': result = engine.cancelTrade(pIdx); break;
      case 'discard': result = engine.discard(pIdx, payload.resources); break;
      case 'moveRobber': result = engine.moveRobber(pIdx, payload.hex, payload.target); break;
      case 'endTurn': result = engine.endTurn(pIdx); break;
      default: break;
    }

    if (type === 'endTurn' && result.ok) room.timerKey = null;

    cb && cb(result);
    afterAction(room);
  });

  socket.on('leaveRoom', () => handleLeave(socket));

  socket.on('disconnect', () => handleLeave(socket));
});

function handleLeave(socket) {
  const room = rooms.get(socket.data.room);
  if (!room) return;
  if (!room.started) {
    room.players = room.players.filter((p) => p.socketId !== socket.id);
    if (room.players.filter((p) => !p.isBot).length === 0) {
      clearTimer(room);
      rooms.delete(room.code);
    } else {
      if (room.host === socket.id) {
        room.host = room.players.find((p) => !p.isBot).socketId;
      }
      broadcastLobby(room);
    }
  } else {
    // keep the seat so they can reconnect
    const p = room.players.find((pl) => pl.socketId === socket.id);
    if (p) p.socketId = null;
    if (room.players.every((pl) => pl.isBot || !pl.socketId)) clearTimer(room);
  }
  socket.data.room = null;
}

function localIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  Object.values(nets).forEach((list) => {
    (list || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    });
  });
  return ips;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🎲  Hexion server running!\n');
  console.log(`  Local:    http://localhost:${PORT}`);
  localIps().forEach((ip) => console.log(`  Network:  http://${ip}:${PORT}   <- share this with friends on your Wi-Fi`));
  console.log('\n  Press Ctrl+C to stop.\n');
});
