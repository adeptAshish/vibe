import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { Server } from 'socket.io';
import { customAlphabet } from 'nanoid';
import { Room } from './game.js';
import { GENRES, GENRE_NAMES, DIFFICULTIES } from './words.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const makeCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);

const app = express();
app.use(compression());

function lanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

// Expose the server's LAN URLs so the lobby can build a shareable invite link
// that works for other devices (never localhost).
app.get('/api/network', (_req, res) => {
  const addrs = lanAddresses();
  const urls = addrs.map((a) => `http://${a}:${PORT}`);
  res.json({ port: PORT, addresses: addrs, urls, primary: urls[0] || null });
});

// Expose static word-bank metadata for the lobby UI.
app.get('/api/genres', (_req, res) => {
  const payload = GENRE_NAMES.map((name) => ({
    name,
    emoji: GENRES[name].emoji,
    counts: {
      giowa: GENRES[name].giowa.length,
      fun: GENRES[name].fun.length,
      smartpants: GENRES[name].smartpants.length,
    },
  }));
  res.json({ genres: payload, difficulties: DIFFICULTIES });
});

// Serve the built client (production).
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(200).send('Sketchsy server running. Build the client with `npm run build`.');
  });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

/** @type {Map<string, Room>} */
const rooms = new Map();

function getRoom(code) {
  return rooms.get((code || '').toUpperCase());
}

function isHost(room, socketId) {
  return room && room.hostId === socketId;
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;

  const currentRoom = () => getRoom(socket.data.roomCode);

  socket.on('room:create', ({ name, avatar, settings }, cb) => {
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const room = new Room(code, io);
    if (settings) room.settings = { ...room.settings, ...settings };
    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;
    room.addPlayer({ id: socket.id, name, avatar });
    room.broadcastState();
    cb && cb({ ok: true, code, you: socket.id });
  });

  socket.on('room:join', ({ code, name, avatar }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: 'Room not found.' });
    if (room.players.size >= room.settings.maxPlayers) return cb && cb({ error: 'Room is full.' });

    socket.join(room.code);
    socket.data.roomCode = room.code;
    room.addPlayer({ id: socket.id, name, avatar });
    room.broadcastState();
    // Send the current canvas to the late joiner.
    if (room.strokes.length) socket.emit('draw:init', { strokes: room.strokes });
    cb && cb({ ok: true, code: room.code, you: socket.id });
  });

  socket.on('room:updateSettings', (settings) => {
    const room = currentRoom();
    if (!room || !isHost(room, socket.id)) return;
    room.updateSettings(settings);
  });

  socket.on('room:addCustomList', (list, cb) => {
    const room = currentRoom();
    if (!room || !isHost(room, socket.id)) return cb && cb({ error: 'Only the host can add lists.' });
    const words = Array.isArray(list.words)
      ? list.words.map((w) => String(w).trim()).filter(Boolean)
      : [];
    if (words.length < 3) return cb && cb({ error: 'Add at least 3 words.' });
    const entry = { id: makeCode(), name: list.name || 'Custom', words };
    room.addCustomList(entry);
    cb && cb({ ok: true, list: entry });
  });

  socket.on('player:setGenre', ({ genre }) => {
    const room = currentRoom();
    if (room) room.setPreferredGenre(socket.id, genre);
  });

  socket.on('player:updateAvatar', ({ avatar }) => {
    const room = currentRoom();
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p) {
      p.avatar = avatar;
      room.broadcastState();
    }
  });

  socket.on('game:start', (_data, cb) => {
    const room = currentRoom();
    if (!room || !isHost(room, socket.id)) return cb && cb({ error: 'Only the host can start.' });
    const res = room.startGame();
    cb && cb(res);
  });

  socket.on('game:chooseWord', ({ word }) => {
    const room = currentRoom();
    if (room) room.chooseWord(socket.id, word);
  });

  socket.on('game:returnToLobby', () => {
    const room = currentRoom();
    if (room && isHost(room, socket.id)) room.returnToLobby();
  });

  socket.on('chat:guess', ({ text }) => {
    const room = currentRoom();
    if (!room) return;
    const result = room.handleGuess(socket.id, text);
    if (result.type === 'guess' || result.type === 'chat') {
      // Broadcast normal chatter to everyone except correct guessers should still see it.
      room.channel().emit('chat:message', {
        type: 'guess',
        name: result.name,
        text: result.text,
        avatar: result.avatar,
        playerId: result.playerId,
      });
    }
  });

  // ---- drawing relays ----
  socket.on('draw:stroke', (stroke) => {
    const room = currentRoom();
    if (!room || socket.id !== room.currentDrawerId) return;
    room.addStroke(stroke);
    socket.to(room.code).emit('draw:stroke', stroke);
  });

  socket.on('draw:clear', () => {
    const room = currentRoom();
    if (!room || socket.id !== room.currentDrawerId) return;
    room.clearStrokes();
    room.channel().emit('draw:clear');
  });

  socket.on('draw:undo', () => {
    const room = currentRoom();
    if (!room || socket.id !== room.currentDrawerId) return;
    room.undoStroke();
    room.channel().emit('draw:replace', { strokes: room.strokes });
  });

  const exitRoom = () => {
    const room = currentRoom();
    if (!room) return;
    room.removePlayer(socket.id);
    if (room.players.size === 0) {
      room.clearTimers();
      rooms.delete(room.code);
    }
  };

  socket.on('room:leave', (_data, cb) => {
    const room = currentRoom();
    if (room) socket.leave(room.code);
    exitRoom();
    socket.data.roomCode = null;
    cb && cb({ ok: true });
  });

  socket.on('disconnect', () => {
    exitRoom();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log('\n  🎨  Sketchsy server is live!\n');
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  Network:  http://${a}:${PORT}   <-- share this on your WiFi`);
  console.log('\n  Players on the same WiFi can open a Network URL to join.');

  // If friends get "connection timed out" on the Network URL, Windows Firewall
  // is almost always blocking inbound traffic to Node. Print the one-line fix.
  if (process.platform === 'win32') {
    console.log('\n  ⚠️  Friends seeing "can\'t reach this page" / timeout?');
    console.log('     Windows Firewall is likely blocking it. In an ADMIN PowerShell, run once:\n');
    console.log(`       New-NetFirewallRule -DisplayName "Sketchsy (TCP ${PORT})" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${PORT} -Profile Private,Domain\n`);
    console.log('     Then have them reload the Network URL. (Make sure everyone is on the same WiFi.)');
  } else {
    console.log(`\n  ⚠️  If friends can't connect, allow inbound TCP ${PORT} through your firewall.`);
  }
  console.log('');
});
