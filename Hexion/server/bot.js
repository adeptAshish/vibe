// bot.js — simple heuristic AI for Hexion.
// Bots place sensibly during setup and take reasonable build/trade actions on their turn.

const { RESOURCES, COSTS } = require('./gameEngine');

// Probability "pips" for each dice number (out of 36)
const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

function vertexValue(engine, vid) {
  let score = 0;
  engine.board.vertices[vid].hexes.forEach((hid) => {
    const hex = engine.board.hexes[hid];
    if (hex.number) score += PIPS[hex.number] || 0;
  });
  return score;
}

function bestSettlementSpot(engine, player, requireRoad) {
  let best = null;
  let bestScore = -1;
  engine.board.vertices.forEach((v) => {
    if (engine.canPlaceSettlement(player, v.id, requireRoad)) {
      const score = vertexValue(engine, v.id) + Math.random() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = v.id;
      }
    }
  });
  return best;
}

function roadTowardExpansion(engine, player, fromVertex) {
  const pIdx = engine.players.indexOf(player);
  // prefer a road that opens a new high-value settlement spot
  let best = null;
  let bestScore = -1;
  const candidateEdges = fromVertex != null
    ? engine.board.vertices[fromVertex].edges
    : Object.keys(engine.roads)
        .filter((eid) => engine.roads[eid] === pIdx)
        .flatMap((eid) => {
          const e = engine.board.edges[eid];
          return [...engine.board.vertices[e.v1].edges, ...engine.board.vertices[e.v2].edges];
        });

  candidateEdges.forEach((eid) => {
    if (!engine.canPlaceRoad(player, eid, fromVertex != null, fromVertex)) return;
    const e = engine.board.edges[eid];
    const score = Math.max(vertexValue(engine, e.v1), vertexValue(engine, e.v2)) + Math.random();
    if (score > bestScore) {
      bestScore = score;
      best = eid;
    }
  });
  return best;
}

function needForBuild(player, cost) {
  // returns map of resource -> deficit
  const deficit = {};
  Object.entries(cost).forEach(([r, n]) => {
    const short = n - player.resources[r];
    if (short > 0) deficit[r] = short;
  });
  return deficit;
}

function surplusResource(player) {
  // resource the bot has the most of
  let best = null;
  let max = -1;
  RESOURCES.forEach((r) => {
    if (player.resources[r] > max) {
      max = player.resources[r];
      best = r;
    }
  });
  return { resource: best, amount: max };
}

// Run a single bot decision step. Called repeatedly until it ends its turn
// or is waiting (returns null). Returns true if it took an action.
function botStep(engine, pIdx) {
  const player = engine.players[pIdx];

  // ---- Setup phase ----
  if (engine.phase === 'setup1' || engine.phase === 'setup2') {
    if (engine.turn !== pIdx) return false;
    if (engine.subPhase === 'setupSettlement') {
      const spot = bestSettlementSpot(engine, player, false);
      if (spot != null) engine.placeSetupSettlement(pIdx, spot);
      return true;
    }
    if (engine.subPhase === 'setupRoad') {
      const road = roadTowardExpansion(engine, player, engine.lastSetupSettlement);
      if (road != null) engine.placeSetupRoad(pIdx, road);
      return true;
    }
    return false;
  }

  // ---- Discard (any player, on a 7) ----
  if (engine.subPhase === 'discard' && engine.pendingDiscards[pIdx]) {
    const need = engine.pendingDiscards[pIdx];
    const discard = {};
    let remaining = need;
    // discard from most-plentiful resources first
    const sorted = RESOURCES.slice().sort((a, b) => player.resources[b] - player.resources[a]);
    for (const r of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(player.resources[r], remaining);
      if (take > 0) {
        discard[r] = take;
        remaining -= take;
      }
    }
    engine.discard(pIdx, discard);
    return true;
  }

  // ---- Move robber ----
  if (engine.subPhase === 'robber' && engine.robberMover === pIdx) {
    // place robber on the opponent hex with the most enemy buildings / value
    let bestHex = -1;
    let bestScore = -1;
    let bestVictim = null;
    engine.board.hexes.forEach((hex, hid) => {
      if (hid === engine.robber) return;
      let score = 0;
      let victim = null;
      hex.vertices.forEach((vid) => {
        const b = engine.buildings[vid];
        if (b && b.owner !== pIdx) {
          score += (b.type === 'city' ? 2 : 1) * (PIPS[hex.number] || 0);
          const total = Object.values(engine.players[b.owner].resources).reduce((a, c) => a + c, 0);
          if (total > 0) victim = b.owner;
        }
      });
      score += Math.random();
      if (score > bestScore) {
        bestScore = score;
        bestHex = hid;
        bestVictim = victim;
      }
    });
    if (bestHex < 0) bestHex = (engine.robber + 1) % engine.board.hexes.length;
    engine.moveRobber(pIdx, bestHex, bestVictim);
    return true;
  }

  // ---- Main turn ----
  if (engine.turn !== pIdx) return false;

  if (engine.subPhase === 'roll') {
    // maybe play a knight before rolling if it has 3+ knights race; keep simple: just roll
    engine.rollDice(pIdx);
    return true;
  }

  if (engine.subPhase === 'main') {
    // 1. Upgrade to a city if possible
    if (engine.canAfford(player, COSTS.city)) {
      const ownSettlement = Object.keys(engine.buildings).find(
        (vid) => engine.buildings[vid].owner === pIdx && engine.buildings[vid].type === 'settlement'
      );
      if (ownSettlement != null) {
        const r = engine.build(pIdx, 'city', Number(ownSettlement));
        if (r.ok) return true;
      }
    }

    // 2. Build a settlement if possible
    if (engine.canAfford(player, COSTS.settlement)) {
      const spot = bestSettlementSpot(engine, player, true);
      if (spot != null) {
        const r = engine.build(pIdx, 'settlement', spot);
        if (r.ok) return true;
      }
    }

    // 3. Build a road toward expansion (sometimes)
    if (engine.canAfford(player, COSTS.road) && Math.random() < 0.6) {
      const road = roadTowardExpansion(engine, player, null);
      if (road != null) {
        const r = engine.build(pIdx, 'road', road);
        if (r.ok) return true;
      }
    }

    // 4. Buy a dev card if rich in ore/wool/grain
    if (engine.canAfford(player, COSTS.dev) && engine.devDeck.length > 0 && Math.random() < 0.5) {
      const r = engine.buyDev(pIdx);
      if (r.ok) return true;
    }

    // 5. Try a bank trade to enable a settlement or city
    const targets = [COSTS.city, COSTS.settlement];
    for (const cost of targets) {
      const deficit = needForBuild(player, cost);
      const deficitResources = Object.keys(deficit);
      if (deficitResources.length === 1) {
        const needR = deficitResources[0];
        const { resource: surR, amount } = surplusResource(player);
        const rate = player.ports.has(surR) ? 2 : player.ports.has('3:1') ? 3 : 4;
        if (surR && surR !== needR && amount >= rate && player.resources[needR] < cost[needR]) {
          const r = engine.bankTrade(pIdx, surR, needR);
          if (r.ok) return true;
        }
      }
    }

    // Nothing useful to do -> end turn
    engine.endTurn(pIdx);
    return true;
  }

  return false;
}

module.exports = { botStep };
