// gameEngine.js — authoritative Hexion rules engine.
// Handles setup, dice/production, building, trading, dev cards, robber,
// longest road, largest army, and win detection.

const { generateBoard } = require('./board');

const COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71']; // red, blue, yellow, green
const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

const COSTS = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { ore: 3, grain: 2 },
  dev: { ore: 1, wool: 1, grain: 1 },
};

function emptyResources() {
  return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
}

function buildDevDeck() {
  const deck = [
    ...Array(14).fill('knight'),
    ...Array(5).fill('vp'),
    ...Array(2).fill('road'),
    ...Array(2).fill('plenty'),
    ...Array(2).fill('monopoly'),
  ];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

class GameEngine {
  constructor(playerDefs, presetBoard) {
    // playerDefs: [{ id, name, isBot }]
    this.board = presetBoard || generateBoard();
    this.devDeck = buildDevDeck();
    this.bank = { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 };

    this.players = playerDefs.map((p, i) => ({
      id: p.id,
      name: p.name,
      isBot: !!p.isBot,
      color: COLORS[i],
      resources: emptyResources(),
      dev: { knight: 0, vp: 0, road: 0, plenty: 0, monopoly: 0 },
      newDev: { knight: 0, vp: 0, road: 0, plenty: 0, monopoly: 0 }, // bought this turn (can't play yet)
      playedKnights: 0,
      vp: 0, // public victory points (excludes hidden vp dev cards)
      ports: new Set(),
      playedDevThisTurn: false,
    }));

    this.buildings = {}; // vertexId -> { type:'settlement'|'city', owner }
    this.roads = {}; // edgeId -> owner (player index)
    this.robber = this.board.robber;

    this.turn = 0;
    this.phase = 'setup1'; // setup1 -> setup2 -> play -> over
    this.subPhase = 'setupSettlement'; // current required action
    this.dice = null;
    this.hasRolled = false;
    this.freeRoads = 0; // from road-building dev card / setup
    this.lastSetupSettlement = null;

    this.longestRoad = { owner: null, length: 4 }; // need >4 to claim
    this.largestArmy = { owner: null, size: 2 }; // need >2 to claim

    this.pendingDiscards = {}; // playerIndex -> count to discard
    this.robberMover = null; // player who must move robber
    this.tradeOffer = null; // { from, give, want, responses:{} }
    this.winner = null;
    this.log = [];

    // Setup snake order: 0..n-1 then n-1..0
    const n = this.players.length;
    this.setupOrder = [];
    for (let i = 0; i < n; i++) this.setupOrder.push(i);
    for (let i = n - 1; i >= 0; i--) this.setupOrder.push(i);
    this.setupStep = 0;
    this.turn = this.setupOrder[0];

    this.addLog(`Game started with ${n} players. ${this.players[this.turn].name} places first.`);
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 100) this.log.shift();
  }

  current() {
    return this.players[this.turn];
  }

  // ---------- Helpers ----------
  canAfford(player, cost) {
    return Object.entries(cost).every(([r, n]) => player.resources[r] >= n);
  }

  pay(player, cost) {
    Object.entries(cost).forEach(([r, n]) => {
      player.resources[r] -= n;
      this.bank[r] += n;
    });
  }

  give(player, resource, n = 1) {
    const take = Math.min(n, this.bank[resource]);
    player.resources[resource] += take;
    this.bank[resource] -= take;
  }

  vertexNeighbors(vid) {
    // vertices connected by one edge
    const result = [];
    this.board.vertices[vid].edges.forEach((eid) => {
      const e = this.board.edges[eid];
      result.push(e.v1 === vid ? e.v2 : e.v1);
    });
    return result;
  }

  // Is a settlement spot valid (distance rule + optionally connected to own road)
  canPlaceSettlement(player, vid, requireRoad) {
    if (this.buildings[vid]) return false;
    // distance rule: no adjacent vertex occupied
    for (const nb of this.vertexNeighbors(vid)) {
      if (this.buildings[nb]) return false;
    }
    if (requireRoad) {
      const pIdx = this.players.indexOf(player);
      const connected = this.board.vertices[vid].edges.some((eid) => this.roads[eid] === pIdx);
      if (!connected) return false;
    }
    return true;
  }

  canPlaceRoad(player, eid, freePlacement, anchorVertex) {
    if (this.roads[eid] !== undefined) return false;
    const pIdx = this.players.indexOf(player);
    const edge = this.board.edges[eid];

    if (freePlacement && anchorVertex != null) {
      // setup road must touch the just-placed settlement
      return edge.v1 === anchorVertex || edge.v2 === anchorVertex;
    }

    // must connect to own road or own building at either endpoint
    const touchesOwn = (vid) => {
      if (this.buildings[vid] && this.buildings[vid].owner === pIdx) return true;
      // connected via own road, but not through an opponent's settlement
      if (this.buildings[vid] && this.buildings[vid].owner !== pIdx) return false;
      return this.board.vertices[vid].edges.some((e) => e !== eid && this.roads[e] === pIdx);
    };
    return touchesOwn(edge.v1) || touchesOwn(edge.v2);
  }

  assignPorts(player, vid) {
    this.board.ports.forEach((port) => {
      if (port.vertices.includes(vid)) player.ports.add(port.type);
    });
  }

  // ---------- Setup phase ----------
  placeSetupSettlement(playerIdx, vid) {
    if (this.phase !== 'setup1' && this.phase !== 'setup2') return this.err('Not setup phase');
    if (this.turn !== playerIdx) return this.err('Not your turn');
    if (this.subPhase !== 'setupSettlement') return this.err('Place a road, not settlement');
    const player = this.players[playerIdx];
    if (!this.canPlaceSettlement(player, vid, false)) return this.err('Invalid settlement spot');

    this.buildings[vid] = { type: 'settlement', owner: playerIdx };
    player.vp += 1;
    this.assignPorts(player, vid);
    this.lastSetupSettlement = vid;

    // In setup2, the second settlement yields starting resources
    if (this.phase === 'setup2') {
      this.board.vertices[vid].hexes.forEach((hid) => {
        const hex = this.board.hexes[hid];
        if (hex.resource !== 'desert') this.give(player, hex.resource, 1);
      });
    }
    this.subPhase = 'setupRoad';
    this.addLog(`${player.name} placed a settlement.`);
    return this.ok();
  }

  placeSetupRoad(playerIdx, eid) {
    if (this.subPhase !== 'setupRoad') return this.err('Place a settlement first');
    if (this.turn !== playerIdx) return this.err('Not your turn');
    const player = this.players[playerIdx];
    if (!this.canPlaceRoad(player, eid, true, this.lastSetupSettlement)) return this.err('Road must touch your new settlement');

    this.roads[eid] = playerIdx;
    this.addLog(`${player.name} placed a road.`);
    this.advanceSetup();
    return this.ok();
  }

  advanceSetup() {
    this.setupStep += 1;
    const half = this.setupOrder.length / 2;
    if (this.setupStep < this.setupOrder.length) {
      this.turn = this.setupOrder[this.setupStep];
      this.subPhase = 'setupSettlement';
      if (this.setupStep === half) {
        this.phase = 'setup2';
      } else if (this.setupStep < half) {
        this.phase = 'setup1';
      } else {
        this.phase = 'setup2';
      }
    } else {
      // Setup complete -> begin play
      this.phase = 'play';
      this.turn = this.setupOrder[0];
      this.startTurn();
      this.addLog('Setup complete. Game on!');
    }
  }

  startTurn() {
    this.subPhase = 'roll';
    this.hasRolled = false;
    this.dice = null;
    this.freeRoads = 0;
    const p = this.current();
    p.playedDevThisTurn = false;
    // newly bought dev cards become playable
    RESOURCES; // noop
    Object.keys(p.newDev).forEach((k) => {
      p.dev[k] += p.newDev[k];
      p.newDev[k] = 0;
    });
  }

  // ---------- Play phase ----------
  rollDice(playerIdx) {
    if (this.phase !== 'play') return this.err('Not in play phase');
    if (this.turn !== playerIdx) return this.err('Not your turn');
    if (this.hasRolled) return this.err('Already rolled');
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    this.dice = [d1, d2];
    this.hasRolled = true;
    const total = d1 + d2;
    this.addLog(`${this.current().name} rolled ${total} (${d1}+${d2}).`);

    if (total === 7) {
      this.startRobber();
    } else {
      this.produce(total);
      this.subPhase = 'main';
    }
    return this.ok();
  }

  produce(total) {
    this.board.hexes.forEach((hex, hid) => {
      if (hex.number !== total) return;
      if (this.robber === hid) return;
      hex.vertices.forEach((vid) => {
        const b = this.buildings[vid];
        if (!b) return;
        const amount = b.type === 'city' ? 2 : 1;
        this.give(this.players[b.owner], hex.resource, amount);
      });
    });
  }

  startRobber() {
    // players with >7 cards must discard half
    this.pendingDiscards = {};
    this.players.forEach((p, i) => {
      const count = Object.values(p.resources).reduce((a, b) => a + b, 0);
      if (count > 7) this.pendingDiscards[i] = Math.floor(count / 2);
    });
    if (Object.keys(this.pendingDiscards).length > 0) {
      this.subPhase = 'discard';
    } else {
      this.subPhase = 'robber';
      this.robberMover = this.turn;
    }
  }

  discard(playerIdx, resources) {
    if (this.subPhase !== 'discard') return this.err('No discard required');
    const need = this.pendingDiscards[playerIdx];
    if (!need) return this.err('You do not need to discard');
    const total = Object.values(resources).reduce((a, b) => a + b, 0);
    if (total !== need) return this.err(`Must discard exactly ${need}`);
    const p = this.players[playerIdx];
    for (const r of RESOURCES) {
      if ((resources[r] || 0) > p.resources[r]) return this.err('Not enough resources');
    }
    for (const r of RESOURCES) {
      const n = resources[r] || 0;
      p.resources[r] -= n;
      this.bank[r] += n;
    }
    delete this.pendingDiscards[playerIdx];
    this.addLog(`${p.name} discarded ${need} cards.`);
    if (Object.keys(this.pendingDiscards).length === 0) {
      this.subPhase = 'robber';
      this.robberMover = this.turn;
    }
    return this.ok();
  }

  moveRobber(playerIdx, hexId, targetIdx) {
    if (this.subPhase !== 'robber') return this.err('Not time to move robber');
    if (this.robberMover !== playerIdx) return this.err('Not your robber to move');
    if (hexId === this.robber) return this.err('Robber must move to a new hex');
    this.robber = hexId;

    // valid targets = players with a building on this hex (not self)
    const victims = new Set();
    this.board.hexes[hexId].vertices.forEach((vid) => {
      const b = this.buildings[vid];
      if (b && b.owner !== playerIdx) victims.add(b.owner);
    });

    if (targetIdx != null && victims.has(targetIdx)) {
      const stolen = this.stealRandom(playerIdx, targetIdx);
      if (stolen) this.addLog(`${this.players[playerIdx].name} moved the robber and stole from ${this.players[targetIdx].name}.`);
    } else {
      this.addLog(`${this.players[playerIdx].name} moved the robber.`);
    }

    this.robberMover = null;
    // if robber came from a knight before rolling, return to roll; else main
    this.subPhase = this.hasRolled ? 'main' : 'roll';
    this.checkLargestArmy();
    this.checkWin();
    return this.ok();
  }

  stealRandom(thiefIdx, victimIdx) {
    const victim = this.players[victimIdx];
    const pool = [];
    RESOURCES.forEach((r) => {
      for (let i = 0; i < victim.resources[r]; i++) pool.push(r);
    });
    if (pool.length === 0) return null;
    const r = pool[Math.floor(Math.random() * pool.length)];
    victim.resources[r] -= 1;
    this.players[thiefIdx].resources[r] += 1;
    return r;
  }

  build(playerIdx, type, targetId) {
    if (this.phase !== 'play') return this.err('Not in play phase');
    if (this.turn !== playerIdx) return this.err('Not your turn');
    if (this.subPhase !== 'main') return this.err('Roll the dice first');
    const player = this.players[playerIdx];

    if (type === 'road') {
      const isFree = this.freeRoads > 0;
      if (!isFree && !this.canAfford(player, COSTS.road)) return this.err('Cannot afford road');
      if (!this.canPlaceRoad(player, targetId, false)) return this.err('Invalid road location');
      if (!isFree) this.pay(player, COSTS.road);
      else this.freeRoads -= 1;
      this.roads[targetId] = playerIdx;
      this.addLog(`${player.name} built a road.`);
      this.checkLongestRoad();
    } else if (type === 'settlement') {
      if (!this.canAfford(player, COSTS.settlement)) return this.err('Cannot afford settlement');
      if (!this.canPlaceSettlement(player, targetId, true)) return this.err('Invalid settlement location');
      this.pay(player, COSTS.settlement);
      this.buildings[targetId] = { type: 'settlement', owner: playerIdx };
      player.vp += 1;
      this.assignPorts(player, targetId);
      this.addLog(`${player.name} built a settlement.`);
      this.checkLongestRoad(); // a new settlement can break an opponent's road
    } else if (type === 'city') {
      if (!this.canAfford(player, COSTS.city)) return this.err('Cannot afford city');
      const b = this.buildings[targetId];
      if (!b || b.owner !== playerIdx || b.type !== 'settlement') return this.err('Must upgrade your own settlement');
      this.pay(player, COSTS.city);
      b.type = 'city';
      player.vp += 1;
      this.addLog(`${player.name} upgraded to a city.`);
    } else {
      return this.err('Unknown build type');
    }
    this.checkWin();
    return this.ok();
  }

  buyDev(playerIdx) {
    if (this.subPhase !== 'main') return this.err('Roll the dice first');
    if (this.turn !== playerIdx) return this.err('Not your turn');
    const player = this.players[playerIdx];
    if (this.devDeck.length === 0) return this.err('No development cards left');
    if (!this.canAfford(player, COSTS.dev)) return this.err('Cannot afford a development card');
    this.pay(player, COSTS.dev);
    const card = this.devDeck.pop();
    if (card === 'vp') {
      player.dev.vp += 1; // VP cards are usable immediately for scoring (hidden)
    } else {
      player.newDev[card] += 1; // can't play the same turn it's bought
    }
    this.addLog(`${player.name} bought a development card.`);
    this.checkWin();
    return this.ok();
  }

  playDev(playerIdx, card, args = {}) {
    if (this.turn !== playerIdx) return this.err('Not your turn');
    if (this.phase !== 'play') return this.err('Not in play phase');
    const player = this.players[playerIdx];
    if (player.playedDevThisTurn) return this.err('Only one development card per turn');
    if (card !== 'knight' && this.subPhase !== 'main') return this.err('Roll the dice first');
    if (player.dev[card] <= 0) return this.err('You do not have that card');

    if (card === 'knight') {
      player.dev.knight -= 1;
      player.playedKnights += 1;
      player.playedDevThisTurn = true;
      this.subPhase = 'robber';
      this.robberMover = playerIdx;
      this.addLog(`${player.name} played a Knight.`);
      this.checkLargestArmy();
    } else if (card === 'road') {
      player.dev.road -= 1;
      player.playedDevThisTurn = true;
      this.freeRoads += 2;
      this.addLog(`${player.name} played Road Building (2 free roads).`);
    } else if (card === 'plenty') {
      const picks = args.resources || [];
      if (picks.length !== 2) return this.err('Choose 2 resources');
      player.dev.plenty -= 1;
      player.playedDevThisTurn = true;
      picks.forEach((r) => this.give(player, r, 1));
      this.addLog(`${player.name} played Year of Plenty.`);
    } else if (card === 'monopoly') {
      const r = args.resource;
      if (!RESOURCES.includes(r)) return this.err('Choose a resource');
      player.dev.monopoly -= 1;
      player.playedDevThisTurn = true;
      let total = 0;
      this.players.forEach((p, i) => {
        if (i === playerIdx) return;
        total += p.resources[r];
        p.resources[r] = 0;
      });
      player.resources[r] += total;
      this.addLog(`${player.name} played Monopoly on ${r} (+${total}).`);
    } else {
      return this.err('That card cannot be played');
    }
    this.checkWin();
    return this.ok();
  }

  // Bank / port trade
  bankTrade(playerIdx, give, want) {
    if (this.subPhase !== 'main') return this.err('Roll the dice first');
    if (this.turn !== playerIdx) return this.err('Not your turn');
    const player = this.players[playerIdx];
    if (!RESOURCES.includes(give) || !RESOURCES.includes(want)) return this.err('Invalid resources');
    let rate = 4;
    if (player.ports.has(give)) rate = 2;
    else if (player.ports.has('3:1')) rate = 3;
    if (player.resources[give] < rate) return this.err(`Need ${rate} ${give}`);
    if (this.bank[want] < 1) return this.err('Bank is out of that resource');
    player.resources[give] -= rate;
    this.bank[give] += rate;
    this.give(player, want, 1);
    this.addLog(`${player.name} traded ${rate} ${give} for 1 ${want}.`);
    return this.ok();
  }

  // Simple player-trade: propose, others accept/decline, proposer confirms with one acceptor
  proposeTrade(playerIdx, give, want) {
    if (this.subPhase !== 'main') return this.err('Roll the dice first');
    if (this.turn !== playerIdx) return this.err('Not your turn');
    const player = this.players[playerIdx];
    for (const r of RESOURCES) {
      if ((give[r] || 0) > player.resources[r]) return this.err('You do not have those resources');
    }
    this.tradeOffer = { from: playerIdx, give, want, responses: {} };
    this.addLog(`${player.name} proposed a trade.`);
    return this.ok();
  }

  respondTrade(playerIdx, accept) {
    if (!this.tradeOffer) return this.err('No active trade');
    if (playerIdx === this.tradeOffer.from) return this.err('You proposed this trade');
    this.tradeOffer.responses[playerIdx] = !!accept;
    return this.ok();
  }

  confirmTrade(playerIdx, partnerIdx) {
    if (!this.tradeOffer) return this.err('No active trade');
    if (this.tradeOffer.from !== playerIdx) return this.err('Only the proposer can confirm');
    if (!this.tradeOffer.responses[partnerIdx]) return this.err('That player did not accept');
    const from = this.players[playerIdx];
    const to = this.players[partnerIdx];
    const { give, want } = this.tradeOffer;
    for (const r of RESOURCES) {
      if ((give[r] || 0) > from.resources[r]) return this.err('Proposer lacks resources');
      if ((want[r] || 0) > to.resources[r]) return this.err('Partner lacks resources');
    }
    for (const r of RESOURCES) {
      const g = give[r] || 0;
      const w = want[r] || 0;
      from.resources[r] -= g; to.resources[r] += g;
      to.resources[r] -= w; from.resources[r] += w;
    }
    this.addLog(`${from.name} traded with ${to.name}.`);
    this.tradeOffer = null;
    return this.ok();
  }

  cancelTrade(playerIdx) {
    if (this.tradeOffer && this.tradeOffer.from === playerIdx) {
      this.tradeOffer = null;
    }
    return this.ok();
  }

  endTurn(playerIdx) {
    if (this.phase !== 'play') return this.err('Not in play phase');
    if (this.turn !== playerIdx) return this.err('Not your turn');
    if (!this.hasRolled) return this.err('You must roll first');
    if (this.subPhase !== 'main') return this.err('Resolve the current action first');
    this.tradeOffer = null;
    this.turn = (this.turn + 1) % this.players.length;
    this.startTurn();
    this.addLog(`${this.current().name}'s turn.`);
    return this.ok();
  }

  // ---------- Scoring ----------
  checkLargestArmy() {
    let best = this.largestArmy.owner;
    let bestSize = this.largestArmy.owner != null ? this.players[this.largestArmy.owner].playedKnights : 2;
    this.players.forEach((p, i) => {
      if (p.playedKnights >= 3 && p.playedKnights > bestSize) {
        bestSize = p.playedKnights;
        best = i;
      }
    });
    if (best !== this.largestArmy.owner) {
      if (this.largestArmy.owner != null) this.players[this.largestArmy.owner].vp -= 2;
      this.largestArmy.owner = best;
      this.largestArmy.size = bestSize;
      if (best != null) {
        this.players[best].vp += 2;
        this.addLog(`${this.players[best].name} now has the Largest Army!`);
      }
    }
  }

  // Longest road via DFS over each player's edges
  playerRoadLength(pIdx) {
    const edges = Object.keys(this.roads)
      .filter((eid) => this.roads[eid] === pIdx)
      .map(Number);
    if (edges.length === 0) return 0;

    // adjacency: vertex -> list of {edge, other}
    const vAdj = {};
    edges.forEach((eid) => {
      const e = this.board.edges[eid];
      // a path can't pass THROUGH an opponent's settlement/city
      [[e.v1, e.v2], [e.v2, e.v1]].forEach(([a, b]) => {
        if (!vAdj[a]) vAdj[a] = [];
        vAdj[a].push({ edge: eid, other: b });
      });
    });

    let best = 0;
    const dfs = (vertex, used) => {
      let max = used.size;
      const blockedHere = this.buildings[vertex] && this.buildings[vertex].owner !== pIdx;
      // if blocked by opponent building, cannot continue past this vertex
      (vAdj[vertex] || []).forEach(({ edge, other }) => {
        if (used.has(edge)) return;
        if (blockedHere) return;
        used.add(edge);
        max = Math.max(max, dfs(other, used));
        used.delete(edge);
      });
      return max;
    };

    // start from every vertex that has one of this player's roads
    Object.keys(vAdj).forEach((v) => {
      best = Math.max(best, dfs(Number(v), new Set()));
    });
    return best;
  }

  checkLongestRoad() {
    let best = this.longestRoad.owner;
    let bestLen = this.longestRoad.owner != null ? this.playerRoadLength(this.longestRoad.owner) : 4;
    // recompute current owner length (could shrink if a settlement split it)
    if (this.longestRoad.owner != null) {
      bestLen = this.playerRoadLength(this.longestRoad.owner);
      if (bestLen < 5) {
        this.players[this.longestRoad.owner].vp -= 2;
        this.longestRoad = { owner: null, length: 4 };
        bestLen = 4;
        best = null;
      }
    }
    this.players.forEach((p, i) => {
      const len = this.playerRoadLength(i);
      if (len >= 5 && len > bestLen) {
        bestLen = len;
        best = i;
      }
    });
    if (best !== this.longestRoad.owner) {
      if (this.longestRoad.owner != null) this.players[this.longestRoad.owner].vp -= 2;
      this.longestRoad = { owner: best, length: bestLen };
      if (best != null) {
        this.players[best].vp += 2;
        this.addLog(`${this.players[best].name} now has the Longest Road (${bestLen})!`);
      }
    } else if (best != null) {
      this.longestRoad.length = bestLen;
    }
  }

  totalVP(pIdx) {
    const p = this.players[pIdx];
    return p.vp + p.dev.vp + p.newDev.vp;
  }

  checkWin() {
    this.players.forEach((p, i) => {
      if (this.totalVP(i) >= 10 && this.winner === null) {
        this.winner = i;
        this.phase = 'over';
        this.addLog(`🎉 ${p.name} wins the game!`);
      }
    });
  }

  // ---------- Result helpers ----------
  ok() {
    return { ok: true };
  }

  err(msg) {
    return { ok: false, error: msg };
  }

  // ---------- State serialization (per-viewer) ----------
  getState(viewerIdx) {
    return {
      board: this.board,
      buildings: this.buildings,
      roads: this.roads,
      robber: this.robber,
      phase: this.phase,
      subPhase: this.subPhase,
      turn: this.turn,
      dice: this.dice,
      hasRolled: this.hasRolled,
      freeRoads: this.freeRoads,
      winner: this.winner,
      log: this.log.slice(-30),
      bank: this.bank,
      tradeOffer: this.tradeOffer,
      pendingDiscards: this.pendingDiscards,
      robberMover: this.robberMover,
      longestRoad: this.longestRoad,
      largestArmy: this.largestArmy,
      youAre: viewerIdx,
      lastSetupSettlement: this.subPhase === 'setupRoad' ? this.lastSetupSettlement : null,
      players: this.players.map((p, i) => {
        const totalCards = Object.values(p.resources).reduce((a, b) => a + b, 0);
        const totalDev = Object.values(p.dev).reduce((a, b) => a + b, 0) +
          Object.values(p.newDev).reduce((a, b) => a + b, 0);
        const isSelf = i === viewerIdx;
        return {
          id: p.id,
          name: p.name,
          isBot: p.isBot,
          color: p.color,
          vp: this.totalVP(i),
          publicVp: p.vp, // visible VP (no hidden dev VP) for opponents
          playedKnights: p.playedKnights,
          ports: Array.from(p.ports),
          totalCards,
          totalDev,
          resources: isSelf ? p.resources : null,
          dev: isSelf ? p.dev : null,
          newDev: isSelf ? p.newDev : null,
          hasLongestRoad: this.longestRoad.owner === i,
          hasLargestArmy: this.largestArmy.owner === i,
        };
      }),
    };
  }
}

module.exports = { GameEngine, RESOURCES, COSTS };
