# 🎲 Catan (Web)

A full, browser-based Catan game. Play **solo against bots** or **multiplayer with friends** on your local network — all from one machine running the server.

## Quick start

```powershell
npm install
npm start
```

Then open the URL shown in the terminal (e.g. `http://localhost:3000`).

## How to play with friends

When you run `npm start`, the terminal prints two kinds of URLs:

- **Local** (`http://localhost:3000`) — for you, on this machine.
- **Network** (`http://192.168.x.x:3000`) — share this with friends on the **same Wi‑Fi/LAN**.

### Steps
1. You run `npm start` and open the site.
2. Enter your name → **Create a game**. You get a 4‑letter room code.
3. Friends open the **Network URL** on their device, enter a name, type the code → **Join**.
4. Add bots to fill empty seats if you like (host only).
5. Host clicks **Start game** (2–4 players total).

### Solo vs. bots
Create a game, click **+ Add bot** one or more times, then **Start game**.

### Playing over the internet (different networks)
Your local server isn't reachable from outside your network by default. Use a free tunnel:

```powershell
# Option A: Cloudflare Tunnel (no account needed for quick tunnels)
cloudflared tunnel --url http://localhost:3000

# Option B: ngrok
ngrok http 3000
```

Share the public URL the tool prints. (If the firewall prompts on first run, allow Node.js on private networks.)

## Game features
- Standard 19‑hex island with **resource icons** (🌲 lumber, 🐑 wool, 🌾 grain, 🧱 brick, ⛰️ ore) so tiles read at a glance
- Clear **ports** with visible trade ratios (3:1 and 2:1 badges)
- Snake setup placement, dice rolls & resource production
- Build roads, settlements, cities
- Bank/port trading and player-to-player trade offers
- Development cards: Knight, Road Building, Year of Plenty, Monopoly, Victory Point
- Robber (on a 7): discarding, moving, stealing
- Longest Road & Largest Army bonuses, win at 10 VP
- Server-side bot AI for any empty seats

## Host controls (in the lobby)
- **🗺️ Randomize map** — re-roll the board (live preview) until you like it, then Start.
- **⏱️ Turn timer** — choose Off / 30s / 45s / 60s / 90s / 2min. On expiry a player's turn auto-rolls (if needed) and auto-ends; setup, discard, and robber steps are untimed.

## In-game UI
- **⬅ Home** button to leave and return to the lobby
- **Zoom & pan**: mouse wheel or the +/−/⤢ buttons to zoom, drag to pan the board
- Animated dice roll, turn-timer ring, resource-gain pops, and a modern themed interface

## Roadmap
- **Full 3D board** (Three.js) with orbit/zoom camera is the planned next milestone. The 2D zoom/pan above is the stepping stone; the server/game engine needs no changes for the 3D upgrade.

## Project layout
```
server/
  index.js       # Express + Socket.IO server, rooms, bot loop
  gameEngine.js  # Authoritative Catan rules
  board.js       # Board geometry generation
  bot.js         # Heuristic bot AI
public/
  index.html     # Lobby + game UI
  style.css
  client.js      # Canvas rendering + interactions
```
