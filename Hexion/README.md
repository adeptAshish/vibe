# 🎲 Hexion

A **3D** web-based Hexion game built with [Three.js](https://threejs.org/). Orbit, zoom, and pan around a real 3D island. Play **solo against bots** or **multiplayer with friends** on your local network — all from one machine running the server.

This is the 3D sibling of the 2D `Hexion2D` project. It reuses the exact same authoritative game engine — only the front-end rendering differs.

## Quick start

```powershell
npm install
npm start
```

Then open the URL shown in the terminal (defaults to `http://localhost:3001`).

> The 3D server runs on **port 3001** so you can run the 2D version (`Hexion2D`, port 3000) and the 3D version at the same time.

## How to play with friends

When you run `npm start`, the terminal prints two kinds of URLs:

- **Local** (`http://localhost:3001`) — for you, on this machine.
- **Network** (`http://192.168.x.x:3001`) — share this with friends on the **same Wi‑Fi/LAN**.

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
cloudflared tunnel --url http://localhost:3001

# Option B: ngrok
ngrok http 3001
```

Share the public URL the tool prints. (If the firewall prompts on first run, allow Node.js on private networks.)

## Camera controls
- **Orbit:** left-click + drag
- **Zoom:** mouse wheel
- **Pan:** right-click + drag
- **Reset view:** the **⤢ View** button (top-right)

Click a highlighted spot (glowing spheres appear during placement) to build settlements, cities, and roads.

## Game features
Identical ruleset to the 2D version: setup placement, dice/production, roads/settlements/cities, robber (discard/move/steal), bank & port trading, player trades, all 5 development cards (Knight, Road Building, Year of Plenty, Monopoly, Victory Point), Longest Road & Largest Army bonuses, win at 10 VP, server-side bot AI, host map randomization, and an optional per-turn timer.

A **graphics quality toggle** (top-right) switches between **Simple** (smooth on any machine) and **✨ Extreme** (shadows, dense decorative props, sea waves, and hi-res rendering).

## Tech used
- **[Three.js](https://threejs.org/)** — WebGL 3D scene, meshes, lighting, and materials (loaded via CDN).
- **`THREE.OrbitControls`** — orbit/zoom/pan camera, with raycasting for clicking board markers.
- **[Node.js](https://nodejs.org/) + [Express](https://expressjs.com/)** — static hosting and the HTTP server.
- **[Socket.IO](https://socket.io/)** — real-time multiplayer rooms and game-state sync.
- **Vanilla JavaScript** front-end — no build step, no framework.

### How the 3D rendering works
- Each hex is an extruded prism built from the shared board geometry.
- Number tokens are flat canvas-textured discs; ports are 3D boats with floating ratio labels.
- Settlements are houses, cities are larger towered houses, roads are colored bars, and the robber is a dark cone.
- `THREE.OrbitControls` drives the camera; clicks use raycasting against per-vertex/edge markers.
- The server (`server/`) is unchanged from the 2D project — the 3D upgrade is purely front-end.

## Project layout
```
server/
  index.js       # Express + Socket.IO server, rooms, bot loop
  gameEngine.js  # Authoritative Hexion rules (shared with Hexion2D)
  board.js       # Board geometry generation
  bot.js         # Heuristic bot AI
public/
  index.html     # Lobby + 3D game UI (loads Three.js + OrbitControls via CDN)
  style.css
  client3d.js    # Three.js scene, pieces, camera, raycasting + shared sidebar logic
```
