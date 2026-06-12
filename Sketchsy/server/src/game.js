import { getWordChoices, prefetchWords } from './wordSource.js';

const CHOOSE_TIME = 15; // seconds to pick a word
const TURN_END_PAUSE = 6000; // ms between turns to show the reveal

// Emotions the 3D avatar can express. The client maps these to animations.
export const EMOTIONS = {
  COCKY: 'cocky', // climbed in rank / leading
  HAPPY: 'happy', // gained points
  MAD: 'mad', // got overtaken / dropped in rank
  CHILL: 'chill', // last place, unbothered
  SAD: 'sad', // zero points this turn
  HYPE: 'hype', // guessed correctly fast
  NEUTRAL: 'neutral',
};

function maskWord(word) {
  return word
    .split('')
    .map((ch) => (/[a-zA-Z0-9]/.test(ch) ? '_' : ch))
    .join('');
}

export class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.hostId = null;
    this.players = new Map(); // id -> player
    this.settings = {
      mode: 'genre', // 'genre' | 'random'
      genres: ['Animals'],
      difficulty: 'fun',
      customLists: [], // [{ id, name, words }]
      rounds: 3,
      drawTime: 80,
      maxPlayers: 12,
      hintsEnabled: true,
      letYouChooseGenre: true, // players may set a preferred genre
      freshWords: true, // fetch fresh themed words online (auto-falls back offline)
    };
    this.phase = 'lobby';
    this.currentRound = 0;
    this.turnQueue = [];
    this.currentDrawerId = null;
    this.currentWord = null;
    this.maskedWord = null;
    this.revealedIndexes = new Set();
    this.usedWords = new Set();
    this.turnEndsAt = null;
    this.choices = [];
    this.strokes = [];
    this.timers = { choose: null, draw: null, hint: null, next: null };
    this.correctOrder = [];
  }

  // ---- helpers -------------------------------------------------------------
  channel() {
    return this.io.to(this.code);
  }

  clearTimers() {
    for (const k of Object.keys(this.timers)) {
      if (this.timers[k]) {
        clearTimeout(this.timers[k]);
        clearInterval(this.timers[k]);
        this.timers[k] = null;
      }
    }
  }

  publicPlayer(p) {
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      roundScore: p.roundScore,
      connected: p.connected,
      isHost: p.id === this.hostId,
      guessed: p.guessedThisTurn,
      emotion: p.emotion,
      rank: p.rank,
      preferredGenre: p.preferredGenre,
      isDrawing: p.id === this.currentDrawerId,
    };
  }

  rankedPlayers() {
    return [...this.players.values()].sort((a, b) => b.score - a.score);
  }

  recomputeRanks() {
    const ranked = this.rankedPlayers();
    ranked.forEach((p, i) => {
      p.prevRank = p.rank ?? i;
      p.rank = i;
    });
  }

  state() {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      currentRound: this.currentRound,
      totalRounds: this.settings.rounds,
      currentDrawerId: this.currentDrawerId,
      maskedWord: this.maskedWord,
      wordLength: this.currentWord ? this.currentWord.length : 0,
      turnEndsAt: this.turnEndsAt,
      players: [...this.players.values()].map((p) => this.publicPlayer(p)),
    };
  }

  broadcastState() {
    this.channel().emit('room:state', this.state());
  }

  // ---- player lifecycle ----------------------------------------------------
  addPlayer({ id, name, avatar }) {
    const isFirst = this.players.size === 0;
    const player = {
      id,
      name,
      avatar,
      score: 0,
      roundScore: 0,
      connected: true,
      guessedThisTurn: false,
      emotion: EMOTIONS.NEUTRAL,
      rank: this.players.size,
      prevRank: this.players.size,
      preferredGenre: null,
    };
    this.players.set(id, player);
    if (isFirst) this.hostId = id;
    this.recomputeRanks();
    return player;
  }

  removePlayer(id) {
    const wasHost = id === this.hostId;
    const wasDrawer = id === this.currentDrawerId;
    this.players.delete(id);
    if (wasHost && this.players.size > 0) {
      this.hostId = [...this.players.keys()][0];
    }
    // If the drawer left mid-turn, end the turn.
    if (wasDrawer && (this.phase === 'drawing' || this.phase === 'choosing')) {
      this.endTurn('The artist left! Moving on…');
      return;
    }
    this.recomputeRanks();
    this.broadcastState();
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (p) p.connected = connected;
  }

  updateSettings(partial) {
    this.settings = { ...this.settings, ...partial };
    this.broadcastState();
  }

  addCustomList(list) {
    this.settings.customLists.push(list);
    this.broadcastState();
  }

  setPreferredGenre(id, genre) {
    const p = this.players.get(id);
    if (p) p.preferredGenre = genre;
    this.broadcastState();
  }

  // ---- game flow -----------------------------------------------------------
  startGame() {
    if (this.players.size < 2) return { error: 'Need at least 2 players to start.' };
    this.usedWords.clear();
    this.currentRound = 0;
    for (const p of this.players.values()) {
      p.score = 0;
    }
    this.recomputeRanks();

    // Warm the fresh-word cache before the first turn so it isn't stale, but
    // never wait longer than a few seconds — falls back to the static corpus
    // instantly if the host is offline.
    const begin = () => this.nextRound();
    if (this.settings.freshWords) {
      Promise.race([
        prefetchWords(this.settings),
        new Promise((resolve) => setTimeout(resolve, 3500)),
      ]).finally(begin);
    } else {
      begin();
    }
    return { ok: true };
  }

  nextRound() {
    this.currentRound += 1;
    if (this.currentRound > this.settings.rounds) {
      this.endGame();
      return;
    }
    // Everyone draws once per round.
    this.turnQueue = [...this.players.keys()];
    this.startTurn();
  }

  // Choose the genre to draw words from for this turn.
  pickTurnGenre(drawer) {
    if (this.settings.mode === 'random') return null;
    if (this.settings.letYouChooseGenre && drawer && drawer.preferredGenre) {
      return [drawer.preferredGenre];
    }
    return this.settings.genres;
  }

  startTurn() {
    this.clearTimers();
    if (this.turnQueue.length === 0) {
      this.nextRound();
      return;
    }
    this.currentDrawerId = this.turnQueue.shift();
    const drawer = this.players.get(this.currentDrawerId);
    if (!drawer) {
      this.startTurn();
      return;
    }

    this.phase = 'choosing';
    this.currentWord = null;
    this.maskedWord = null;
    this.revealedIndexes = new Set();
    this.strokes = [];
    this.correctOrder = [];
    this.turnEndsAt = null;
    for (const p of this.players.values()) {
      p.guessedThisTurn = false;
      p.roundScore = 0;
      p.emotion = EMOTIONS.NEUTRAL;
    }

    const genreSettings = {
      ...this.settings,
      genres: this.pickTurnGenre(drawer) || this.settings.genres,
    };
    this.choices = getWordChoices(genreSettings, this.usedWords, 3);

    this.channel().emit('game:turnStart', {
      drawerId: this.currentDrawerId,
      drawerName: drawer.name,
      round: this.currentRound,
      totalRounds: this.settings.rounds,
      chooseTime: CHOOSE_TIME,
    });
    // Only the drawer gets the actual word choices.
    this.io.to(this.currentDrawerId).emit('game:wordChoices', { choices: this.choices, chooseTime: CHOOSE_TIME });
    this.broadcastState();

    // Auto-pick if the drawer dawdles.
    this.timers.choose = setTimeout(() => {
      if (this.phase === 'choosing') {
        const auto = this.choices[Math.floor(Math.random() * this.choices.length)];
        this.chooseWord(this.currentDrawerId, auto);
      }
    }, CHOOSE_TIME * 1000);
  }

  chooseWord(playerId, word) {
    if (playerId !== this.currentDrawerId || this.phase !== 'choosing') return;
    if (!this.choices.includes(word)) return;
    clearTimeout(this.timers.choose);

    this.currentWord = word;
    this.usedWords.add(word);
    this.maskedWord = maskWord(word);
    this.phase = 'drawing';
    this.turnEndsAt = Date.now() + this.settings.drawTime * 1000;

    this.channel().emit('game:turnBegin', {
      drawerId: this.currentDrawerId,
      maskedWord: this.maskedWord,
      wordLength: word.length,
      turnEndsAt: this.turnEndsAt,
      round: this.currentRound,
    });
    // Drawer sees the real word.
    this.io.to(this.currentDrawerId).emit('game:yourWord', { word });
    this.broadcastState();

    this.scheduleHints(word);

    this.timers.draw = setTimeout(() => this.endTurn(), this.settings.drawTime * 1000);
  }

  scheduleHints(word) {
    if (!this.settings.hintsEnabled) return;
    const letterIdx = [];
    for (let i = 0; i < word.length; i++) {
      if (/[a-zA-Z0-9]/.test(word[i])) letterIdx.push(i);
    }
    // Reveal up to ~40% of letters across the turn.
    const maxReveals = Math.max(1, Math.floor(letterIdx.length * 0.4));
    const interval = (this.settings.drawTime * 1000) / (maxReveals + 1);
    let revealed = 0;
    this.timers.hint = setInterval(() => {
      if (this.phase !== 'drawing' || revealed >= maxReveals) {
        clearInterval(this.timers.hint);
        return;
      }
      const remaining = letterIdx.filter((i) => !this.revealedIndexes.has(i));
      if (remaining.length === 0) return;
      const idx = remaining[Math.floor(Math.random() * remaining.length)];
      this.revealedIndexes.add(idx);
      revealed += 1;
      const masked = word
        .split('')
        .map((ch, i) => {
          if (!/[a-zA-Z0-9]/.test(ch)) return ch;
          return this.revealedIndexes.has(i) ? ch : '_';
        })
        .join('');
      this.maskedWord = masked;
      this.channel().emit('game:hint', { maskedWord: masked });
    }, interval);
  }

  // Returns { type: 'guess'|'correct'|'close', ... }
  handleGuess(playerId, text) {
    const p = this.players.get(playerId);
    if (!p) return { type: 'guess' };
    const raw = String(text).trim();
    if (!raw) return { type: 'guess' };

    const isDrawer = playerId === this.currentDrawerId;
    const guessing = this.phase === 'drawing' && this.currentWord && !isDrawer && !p.guessedThisTurn;

    if (!guessing) {
      // Just a chat message.
      return { type: 'chat', name: p.name, text: raw, avatar: p.avatar, playerId };
    }

    const guess = raw.toLowerCase();
    const answer = this.currentWord.toLowerCase();

    if (guess === answer) {
      this.awardCorrect(p);
      this.channel().emit('chat:message', {
        type: 'correct',
        name: p.name,
        playerId,
        text: `${p.name} guessed the word! 🎉`,
      });
      this.checkAllGuessed();
      return { type: 'correct', playerId };
    }

    // "Close" feedback when one letter off-ish.
    if (this.isClose(guess, answer)) {
      this.io.to(playerId).emit('chat:message', {
        type: 'close',
        name: 'Sketchsy',
        text: `"${raw}" is close!`,
      });
    }
    return { type: 'guess', name: p.name, text: raw, avatar: p.avatar, playerId };
  }

  isClose(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    // simple Levenshtein <= 1
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
      } else {
        edits++;
        if (edits > 1) return false;
        if (a.length > b.length) i++;
        else if (a.length < b.length) j++;
        else {
          i++;
          j++;
        }
      }
    }
    edits += a.length - i + (b.length - j);
    return edits <= 1;
  }

  awardCorrect(player) {
    const total = this.settings.drawTime * 1000;
    const remaining = Math.max(0, this.turnEndsAt - Date.now());
    const speed = remaining / total; // 1 -> instant, 0 -> last second
    const order = this.correctOrder.length; // 0 = first to guess
    const base = 100 + Math.round(speed * 200); // 100..300
    const orderBonus = Math.max(0, 50 - order * 15);
    const points = base + orderBonus;

    player.score += points;
    player.roundScore += points;
    player.guessedThisTurn = true;
    player.emotion = EMOTIONS.HYPE;
    this.correctOrder.push(player.id);

    // Drawer earns for each correct guess.
    const drawer = this.players.get(this.currentDrawerId);
    if (drawer) {
      const drawPts = 60 + Math.round(speed * 60);
      drawer.score += drawPts;
      drawer.roundScore += drawPts;
    }
  }

  checkAllGuessed() {
    const guessers = [...this.players.values()].filter((p) => p.id !== this.currentDrawerId);
    const allGuessed = guessers.length > 0 && guessers.every((p) => p.guessedThisTurn);
    if (allGuessed) {
      this.endTurn('Everyone guessed it! 🥳');
    } else {
      this.broadcastState();
    }
  }

  computeEmotions() {
    const ranked = this.rankedPlayers();
    const last = ranked.length - 1;
    ranked.forEach((p, i) => {
      const climbed = p.rank < p.prevRank;
      const dropped = p.rank > p.prevRank;
      if (i === 0) p.emotion = EMOTIONS.COCKY;
      else if (i === last) p.emotion = EMOTIONS.CHILL;
      else if (climbed) p.emotion = EMOTIONS.HAPPY;
      else if (dropped) p.emotion = EMOTIONS.MAD;
      else if (p.roundScore > 0) p.emotion = EMOTIONS.HAPPY;
      else p.emotion = EMOTIONS.SAD;
    });
  }

  endTurn(reason) {
    if (this.phase === 'turnEnd' || this.phase === 'gameEnd') return;
    this.clearTimers();
    const revealedWord = this.currentWord;
    this.phase = 'turnEnd';
    this.recomputeRanks();
    this.computeEmotions();

    this.channel().emit('game:turnEnd', {
      word: revealedWord,
      reason: reason || 'Time\'s up!',
      scores: this.rankedPlayers().map((p) => this.publicPlayer(p)),
    });
    this.broadcastState();

    this.timers.next = setTimeout(() => {
      if (this.turnQueue.length === 0) {
        this.nextRound();
      } else {
        this.startTurn();
      }
    }, TURN_END_PAUSE);
  }

  endGame() {
    this.clearTimers();
    this.phase = 'gameEnd';
    this.currentDrawerId = null;
    this.recomputeRanks();
    const ranked = this.rankedPlayers();
    const last = ranked.length - 1;
    ranked.forEach((p, i) => {
      if (i === 0) p.emotion = EMOTIONS.COCKY;
      else if (i === 1) p.emotion = EMOTIONS.HAPPY;
      else if (i === last) p.emotion = EMOTIONS.CHILL;
      else p.emotion = EMOTIONS.MAD;
    });
    this.channel().emit('game:end', {
      scores: ranked.map((p) => this.publicPlayer(p)),
    });
    this.broadcastState();
  }

  returnToLobby() {
    this.clearTimers();
    this.phase = 'lobby';
    this.currentRound = 0;
    this.currentDrawerId = null;
    this.currentWord = null;
    this.maskedWord = null;
    this.strokes = [];
    for (const p of this.players.values()) {
      p.score = 0;
      p.roundScore = 0;
      p.guessedThisTurn = false;
      p.emotion = EMOTIONS.NEUTRAL;
    }
    this.recomputeRanks();
    this.broadcastState();
  }

  // ---- drawing -------------------------------------------------------------
  addStroke(stroke) {
    this.strokes.push(stroke);
  }

  clearStrokes() {
    this.strokes = [];
  }

  undoStroke() {
    // Remove the most recent stroke group (all trailing segments sharing the
    // same strokeId), so one "undo" erases a whole pen motion.
    if (this.strokes.length === 0) return;
    const lastId = this.strokes[this.strokes.length - 1].strokeId;
    while (this.strokes.length && this.strokes[this.strokes.length - 1].strokeId === lastId) {
      this.strokes.pop();
    }
  }
}
