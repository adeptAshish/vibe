# 🎲 Catan 3D

A **3D** web-based Catan game built with [Three.js](https://threejs.org/). Orbit, zoom, and pan around a real 3D island. Play **solo against bots** or **multiplayer with friends** on your local network.

This is the 3D sibling of the 2D `Catan` project. It reuses the exact same authoritative game engine — only the front-end rendering differs.

## Quick start

```powershell
npm install
npm start
```

Then open the URL shown in the terminal (defaults to `http://localhost:3001`).

> The 3D server runs on **port 3001** so you can run the 2D version (port 3000) and the 3D version at the same time.

## Camera controls

- **Orbit:** left-click + drag
- **Zoom:** mouse wheel
- **Pan:** right-click + drag
- **Reset view:** the **⤢ View** button (top-right)

Click a highlighted spot (glowing spheres appear during placement) to build settlements, cities, and roads.

## How to play with friends

When you run `npm start`, the terminal prints:

- **Local** (`http://localhost:3001`) — for you, on this machine.
- **Network** (`http://192.168.x.x:3001`) — share with friends on the **same Wi‑Fi/LAN**.

### Steps
1. You run `npm start` and open the site.
2. Enter your name → **Create a game**. You get a 4‑letter room code.
3. Friends open the **Network URL**, enter a name, type the code → **Join**.
4. Add bots to fill seats if you like (host only).
5. Host clicks **Start game** (2–4 players total).

### Playing over the internet (different networks)
```powershell
cloudflared tunnel --url http://localhost:3001
# or
ngrok http 3001
```

## Game features
Identical ruleset to the 2D version: setup placement, dice/production, roads/settlements/cities, robber (discard/move/steal), bank & port trading, player trades, all 5 development cards, Longest Road & Largest Army, win at 10 VP, server-side bot AI, host map randomization, and an optional per-turn timer.

## How the 3D rendering works
- Each hex is an extruded prism built from the shared board geometry.
- Number tokens are flat canvas-textured discs; ports are 3D boats with floating ratio labels.
- Settlements are houses, cities are larger towered houses, roads are colored bars, and the robber is a dark cone.
- `THREE.OrbitControls` drives the camera; clicks use raycasting against per-vertex/edge markers.
- The server (`server/`) is unchanged from the 2D project — the 3D upgrade is purely front-end.

## Project layout
```
server/            # identical authoritative engine (board, rules, bots, socket server)
public/
  index.html       # lobby + 3D game UI (loads Three.js + OrbitControls via CDN)
  style.css
  client3d.js      # Three.js scene, pieces, camera, raycasting + shared sidebar logic
```
