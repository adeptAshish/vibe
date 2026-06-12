import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const log = (...a) => console.log('[test]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));

const mk = () => io(URL, { transports: ['websocket'] });

async function run() {
  const host = mk();
  const guest = mk();
  await wait(500);

  const state = { drawerId: null, word: null, correct: 0, ended: false, turns: 0, winner: null };

  const wire = (sock) => {
    sock.on('game:wordChoices', (d) => sock.emit('game:chooseWord', { word: d.choices[0] }));
    sock.on('game:yourWord', (d) => { state.word = d.word; });
    sock.on('game:turnBegin', () => { state.turns++; });
    sock.on('chat:message', (m) => { if (m.type === 'correct') state.correct++; });
    sock.on('game:end', (d) => { state.ended = true; state.winner = d.scores[0]; });
    sock.on('room:state', (st) => { state.drawerId = st.currentDrawerId; });
  };
  wire(host);
  wire(guest);

  const create = await emit(host, 'room:create', { name: 'Host', avatar: { skinHue: 28 } });
  const join = await emit(guest, 'room:join', { code: create.code, name: 'Guest', avatar: { skinHue: 200 } });
  host.emit('room:updateSettings', { difficulty: 'giowa', drawTime: 30, rounds: 1, mode: 'random' });
  const list = await emit(host, 'room:addCustomList', { name: 'Test', words: ['alpha', 'beta', 'gamma'] });

  let guessedFor = null;
  const guessLoop = setInterval(() => {
    if (state.word && state.word !== guessedFor && state.drawerId) {
      const guesser = state.drawerId === host.id ? guest : host;
      guesser.emit('chat:guess', { text: state.word });
      guessedFor = state.word;
    }
  }, 150);

  await emit(host, 'game:start');
  for (let i = 0; i < 80 && !state.ended; i++) await wait(250);
  clearInterval(guessLoop);

  const pass = create.ok && join.ok && list.ok && state.turns >= 2 && state.correct >= 2 && state.ended;
  log('room=', create.ok, 'join=', join.ok, 'customList=', list.ok);
  log('turns=', state.turns, 'correctGuesses=', state.correct, 'ended=', state.ended);
  log('winner=', state.winner?.name, 'score=', state.winner?.score, 'emotion=', state.winner?.emotion);
  log(pass ? 'PASS ✅' : 'FAIL ❌');

  host.close();
  guest.close();
  process.exit(pass ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
