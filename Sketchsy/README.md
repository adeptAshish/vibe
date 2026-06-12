# 🎨 Sketchsy

A vibrant, LAN‑friendly **draw‑and‑guess** party game (a Skribbl‑style clone). Run the
server on your machine and everyone on the **same WiFi** can join from their browser
and play — no internet required.

## ✨ Features

- **Local multiplayer over WiFi** — share a Network URL, friends join instantly.
- **Word sources**
  - **By genre** — host picks genres (Animals, Food, Movies, Sports, Tech, Fantasy…).
  - **Fully random** — words pulled from every genre.
  - **Players pick their own genre** when it's their turn to draw.
  - **Custom word lists** — the host can add their own words on the fly.
- **Difficulty tiers**: 🍼 **Giowa** (easy) · 🎉 **Fun** (medium) · 🧠 **Smartpants** (hard).
- **3D animated avatars** (Three.js / react‑three‑fiber) with face shape, colors, hats
  and accessories — and **expressive emotions** that react to the scoreboard
  (leader gets *cocky*, climbers get *happy*, overtaken players get *mad*, last place
  stays *chill*, fast guessers go *hype*).
- **Live drawing canvas** — brush, fill bucket, eraser, sizes, undo, clear.
- **Animated, color‑shifting UI** — no flat static palette; everything is HSL‑driven
  and in motion.

## 🚀 Run it

Requires **Node.js 18+**.

```powershell
# 1. install everything (root + client + server)
npm run install:all

# 2a. development (hot reload, two processes)
npm run dev
#   client: http://localhost:5173   server: http://localhost:3000

# 2b. production-style single server (build + serve on one port)
npm start
#   open the Network URL it prints, e.g. http://192.168.1.42:3000
```

When you run `npm start`, the console prints a **Network URL**. Share that with anyone
on the same WiFi — they open it in a browser, pick a name + avatar, and join your room
code.

> Tip: if friends can't connect, allow Node.js through your firewall for *Private*
> networks (Windows will usually prompt the first time).

## 🕹️ How to play

1. **Create a room** → you become the host.
2. Configure word source, genres, difficulty, rounds, draw time, custom lists.
3. Friends **join with the room code**.
4. Each turn one player draws their chosen word; everyone else guesses in chat.
   Faster guesses score more, and the artist earns points per correct guess.
5. After all rounds, a **3D podium** crowns the winners with attitude.

## 🧱 Tech

- **Server**: Node.js, Express, Socket.IO (in‑memory game state).
- **Client**: React + Vite, Three.js via `@react-three/fiber` / `drei`, Framer Motion.
