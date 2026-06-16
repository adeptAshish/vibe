# Sketchsy — Technical Documentation

Engineering reference for **Sketchsy**, a LAN-first, real-time multiplayer
draw-and-guess party game. For player-facing setup and gameplay, see
[README.md](README.md).

---

## 1. Overview

Sketchsy is a single-host web application. One machine runs a Node.js server that
**both serves the built web client and hosts the real-time game** over WebSockets.
Players on the same network open the host's Network URL in any modern browser and
play — no installs, no accounts, no database.

- **Architecture style:** client–server, authoritative server, in-memory state.
- **Transport:** HTTP for static assets + REST metadata; WebSocket (Socket.IO) for
  all real-time game traffic.
- **State:** entirely in memory on the server. Nothing is persisted to disk; restarting
  the server clears all rooms.
- **Trust model:** the **server is authoritative** for game logic (turns, scoring,
  word reveal, timers). Clients only render state and send intents.

```
            same WiFi / LAN
 ┌────────────┐   HTTP + WS   ┌─────────────────────────────┐
 │  Player A  │ ◀───────────▶ │   Host machine              │
 │  (browser) │               │  ┌───────────────────────┐  │
 └────────────┘               │  │ Node.js server        │  │
 ┌────────────┐               │  │  • Express (static +  │  │
 │  Player B  │ ◀───────────▶ │  │    /api/*)            │  │
 │  (browser) │               │  │  • Socket.IO (game)   │  │
 └────────────┘               │  │  • Room engine        │  │
 ┌────────────┐               │  └───────────┬───────────┘  │
 │  Host too  │ ◀───────────▶ │              │ outbound     │
 │  plays     │               │              ▼ (host only)  │
 └────────────┘               │      Datamuse API (words)   │
                              └─────────────────────────────┘
```

---

## 2. Technology stack

### Server

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node.js 18+** (ES modules, `"type": "module"`) | Native `fetch`, `--watch`, modern syntax |
| HTTP framework | **Express 4** | Serve the built client + small REST endpoints |
| Real-time | **Socket.IO 4** | Rooms, reconnection, ack callbacks, broadcast helpers |
| Response gzip | **compression** | Shrinks the static JS bundle over the wire |
| ID generation | **nanoid** | Short, unambiguous room codes (`A–Z`/`2–9`, no `0/O/1/I`) |
| Fresh words | **Datamuse API** (no SDK, plain `fetch`) | Free, keyless, themed word generation |

### Client

| Concern | Choice | Why |
|---|---|---|
| UI library | **React 18** | Component model + hooks for game state |
| Build tool | **Vite 5** (`@vitejs/plugin-react`) | Fast dev server, LAN host mode, small prod build |
| Real-time | **socket.io-client 4** | Matches the server transport |
| 3D avatars | **three** + **@react-three/fiber** + **@react-three/drei** | Declarative Three.js (`<Canvas>`), helpers (`OrbitControls`, `Environment`, `ContactShadows`) |
| Animation | **framer-motion** | Overlay/podium/toast transitions |
| Drawing | Native **Canvas 2D API** | Brush, fill bucket, eraser, geometric shapes |
| Styling | Hand-written **CSS** (HSL design tokens) | Animated, theme-able look; no UI framework |

### Tooling / orchestration

| Tool | Role |
|---|---|
| **concurrently** | Runs server + client dev processes together (`npm run dev`) |
| npm workspaces-style scripts | Root `package.json` proxies into `client/` and `server/` |

---

## 3. Repository structure

```
Sketchsy/
├── package.json              # root scripts (install:all, dev, build, start)
├── README.md                 # player-facing setup & gameplay
├── TECHNICAL.md              # this document
│
├── server/
│   ├── package.json          # express, socket.io, compression, nanoid
│   └── src/
│       ├── index.js          # HTTP + Socket.IO wiring, REST endpoints, LAN print
│       ├── game.js           # Room class: authoritative game engine
│       ├── words.js          # static curated word bank (Option A fallback)
│       └── wordSource.js     # Datamuse fetch + cache + static fallback (Option B)
│
└── client/
    ├── package.json          # react, vite, three, r3f, framer-motion
    ├── vite.config.js        # dev proxy to :3000, LAN host, build output
    ├── index.html            # app shell
    └── src/
        ├── main.jsx          # React root
        ├── App.jsx           # screen router (Home | Lobby | Game)
        ├── GameContext.jsx   # central state + socket event wiring (React context)
        ├── socket.js         # Socket.IO client singleton + promisified emit()
        ├── avatar.js         # avatar option sets + HSL color helpers
        ├── screens/
        │   ├── Home.jsx      # name, avatar customizer, create/join
        │   ├── Lobby.jsx     # settings, genres, custom lists, share link
        │   └── Game.jsx      # in-round layout (header, canvas, chat, players)
        ├── components/
        │   ├── AvatarModel.jsx     # the 3D mesh + emotion animation params
        │   ├── Avatar3D.jsx        # <Canvas> wrapper for one avatar
        │   ├── AvatarFace.jsx      # lightweight 2D SVG avatar (dense lists)
        │   ├── AvatarCustomizer.jsx# customizer controls
        │   ├── DrawingCanvas.jsx   # Canvas 2D drawing + tools + sync
        │   ├── GameHeader.jsx      # round badge, masked word, timer, home
        │   ├── Chat.jsx            # guesses + chat log
        │   ├── PlayerList.jsx      # live scoreboard
        │   ├── Overlays.jsx        # word choice / turn end / podium
        │   ├── ThemeToggle.jsx     # Vibrant ⇄ Night mode
        │   └── Toast.jsx           # transient notifications
        └── styles/
            ├── index.css     # design tokens, buttons, theme (incl. night mode)
            └── game.css       # screen/component layouts
```

---

## 4. Server architecture

### 4.1 Entry point — `server/src/index.js`

Responsibilities:

1. **Static hosting** — serves `client/dist` (the Vite build) and SPA-falls back to
   `index.html`.
2. **REST endpoints**
   - `GET /api/network` → the host's LAN URL(s), so the lobby can build a shareable
     invite that is never `localhost`.
   - `GET /api/genres` → genre metadata (names, emojis, word counts) + difficulty
     definitions for the lobby UI.
3. **Socket.IO server** — accepts connections, routes events to the right `Room`.
4. **Room registry** — `Map<roomCode, Room>`; creates codes via nanoid, deletes
   empty rooms.
5. **Startup banner** — binds `0.0.0.0:3000`, prints Local + every LAN Network URL,
   and (on Windows) the exact firewall rule command.

The socket handlers are thin: they validate the sender (e.g. host-only actions),
then delegate to the `Room` instance. Drawing events are relayed directly to the
room channel for minimal latency.

### 4.2 Game engine — `server/src/game.js`

A single `Room` class encapsulates **all** game state and rules. Key ideas:

- **Authoritative & server-timed.** Turn length, the choosing window, hint reveals,
  and turn/round transitions are all driven by `setTimeout`/`setInterval` on the
  server. Clients never decide timing.
- **Phases:** `lobby → choosing → drawing → turnEnd → (next turn/round) → gameEnd`.
- **Per-turn flow:** pick drawer → send 3 private word choices → drawer picks (or
  auto-pick on timeout) → broadcast masked word + deadline → schedule progressive
  letter hints → accept guesses → score → reveal → pause → next.
- **Scoring:** guessers earn points scaled by remaining time + guess order; the
  drawer earns per correct guess. Exact match wins; near-misses get a private
  "close!" nudge (Levenshtein ≤ 1).
- **The word is never sent to guessers.** Only `maskedWord` (underscores, with
  letters revealed progressively) goes to the room; the real word goes only to the
  drawer (`game:yourWord`) and is revealed to all at `game:turnEnd`.
- **Expressive avatars:** after each turn the engine recomputes ranks and assigns an
  **emotion** per player (`cocky` leader, `happy` climber, `mad` overtaken, `chill`
  last place, `hype` fast guesser, `sad` scored nothing). Emotions ship inside
  `room:state` and the podium.
- **Resilience:** if the drawer disconnects mid-turn, the turn ends gracefully; host
  migration picks a new host if the host leaves.

### 4.3 Word system — `words.js` + `wordSource.js`

Two-tier design ("Option B with Option A fallback"):

- **`words.js` (Option A, static):** a curated `GENRES` corpus, each genre split into
  three difficulty tiers — `giowa` (easy), `fun` (medium), `smartpants` (hard). Always
  available, fully offline. Also hosts the difficulty metadata and the
  pooling/selection helpers.
- **`wordSource.js` (Option B, dynamic):** fetches **fresh, on-theme nouns** from the
  **Datamuse API** by seeding it with curated words (`ml=` "means like" + a per-genre
  `topics=` bias). Results are filtered (nouns only, drawable, stop-listed,
  frequency-floored), **binned into difficulty tiers by frequency + length**, and
  cached in memory (20-min TTL) with background refresh. The engine warms the cache
  on `startGame` (capped wait) so even turn 1 is fresh.
- **Automatic fallback:** if the host is offline, a fetch fails, or the cache is cold,
  selection transparently falls back to the static corpus. Only the **host** ever
  calls Datamuse; players never touch the internet.
- **Custom lists & per-player genre** are merged into the candidate pool at selection
  time. A per-room `usedWords` set avoids repeats within a game.

---

## 5. Client architecture

### 5.1 State flow

- **`socket.js`** creates a single Socket.IO client (same-origin; Vite proxies it in
  dev) and exposes a promisified `emit()` for request/ack calls.
- **`GameContext.jsx`** is the heart of the client: it subscribes to every server
  event, mirrors `room:state` and transient events (word choices, turn end, game end,
  chat, toasts) into React state, and exposes **action creators** (create/join room,
  update settings, start game, choose word, send guess, drawing ops, leave room).
- **Drawing events** use a lightweight pub/sub (`onDrawEvent`) so the canvas can
  subscribe imperatively without re-rendering on every stroke.
- **`App.jsx`** is a pure router: not-in-room → `Home`, `phase === 'lobby'` → `Lobby`,
  otherwise → `Game`. The theme toggle and toast layer sit above all screens.

### 5.2 3D avatars

- **`AvatarModel.jsx`** builds the character from Three.js primitives (no external
  model files): head/body capsule, eyes, brows, mouth, plus parametric hats and
  accessories. `useFrame` animates pose/expression per the player's **emotion**.
- **`Avatar3D.jsx`** wraps one model in an R3F `<Canvas>` with lighting, soft contact
  shadows, an `Environment` for reflections, and optional auto-rotate/orbit. Used in
  the customizer, lobby spotlight, and podium.
- **`AvatarFace.jsx`** is a cheap **2D SVG** version of the same look + emotions, used
  in dense lists (scoreboard, chat) where many avatars render at once.
- **`avatar.js`** defines the option sets (skin/body hues, faces, hats, accessories)
  and HSL helpers; colors are generated from hues so the palette stays vivid and
  consistent.

### 5.3 Drawing canvas

`DrawingCanvas.jsx` uses the raw **Canvas 2D API** at a fixed internal resolution
(`1000×700`) with normalized `[0..1]` coordinates so strokes map correctly across
different screen sizes. Tools: **brush, fill bucket** (scanline flood fill), **eraser**
(`destination-out`), and **geometric shapes** (line, box, circle, triangle) with live
rubber-band preview and an outline/filled toggle, plus size presets, **undo** (per
stroke group), and **clear**. Every operation is emitted to the server, relayed to
peers, and replayed for late joiners (the server keeps the stroke list per room).

### 5.4 Theming

Two themes via a `data-theme` attribute on `<html>` (persisted to `localStorage`):
**Vibrant** (animated, hue-cycling, glowing) and **Night** (calm dark-blue, no
animation). All colors are HSL design tokens in `styles/index.css`, so switching
themes only swaps the token values.

---

## 6. Real-time protocol (Socket.IO events)

### Client → Server

| Event | Payload | Notes |
|---|---|---|
| `room:create` | `{ name, avatar, settings? }` | ack → `{ code, you }`; creator becomes host |
| `room:join` | `{ code, name, avatar }` | ack → `{ code, you }` or `{ error }` |
| `room:leave` | — | ack → `{ ok }`; leaves & returns home |
| `room:updateSettings` | `settings` | host-only |
| `room:addCustomList` | `{ name, words[] }` | host-only; ack → `{ list }` or `{ error }` |
| `player:setGenre` | `{ genre }` | per-player preferred genre |
| `player:updateAvatar` | `{ avatar }` | live avatar change |
| `game:start` | — | host-only; ack → `{ ok }` or `{ error }` |
| `game:chooseWord` | `{ word }` | drawer picks from the 3 choices |
| `game:returnToLobby` | — | host-only; after game end |
| `chat:guess` | `{ text }` | guess or chat (server decides) |
| `draw:stroke` / `draw:clear` / `draw:undo` | stroke / — / — | drawer-only |

### Server → Client

| Event | Payload | Purpose |
|---|---|---|
| `room:state` | full room snapshot | players, phase, settings, masked word, deadline, emotions |
| `game:turnStart` | `{ drawerId, drawerName, round, chooseTime }` | new turn begins |
| `game:wordChoices` | `{ choices[], chooseTime }` | **drawer only** — pick a word |
| `game:turnBegin` | `{ maskedWord, wordLength, turnEndsAt }` | drawing phase starts |
| `game:yourWord` | `{ word }` | **drawer only** — the real word |
| `game:hint` | `{ maskedWord }` | a letter was revealed |
| `chat:message` | `{ type, name, text, ... }` | guess / correct / close / chat |
| `game:turnEnd` | `{ word, reason, scores[] }` | reveal + per-turn scores |
| `game:end` | `{ scores[] }` | final standings → podium |
| `draw:stroke` / `draw:clear` / `draw:init` / `draw:replace` | stroke data | canvas sync (incl. late-joiner replay) |

---

## 7. Build, run & dev workflow

### Scripts (root `package.json`)

| Command | What it does |
|---|---|
| `npm run install:all` | Installs root + client + server dependencies |
| `npm run dev` | Runs server (`--watch`) and Vite dev server concurrently |
| `npm run build` | Builds the client into `client/dist` |
| `npm start` | Builds the client, then starts the server (single-port, prod-style) |

### Dev vs. production topology

- **Development:** client on `:5173` (Vite), server on `:3000`. `vite.config.js`
  proxies `/api` and `/socket.io` (incl. WS upgrade) to `:3000`, and exposes the dev
  server on the LAN (`host: true`).
- **Production / LAN play:** `npm start` builds the client and the **server serves
  everything on `:3000`**. The Socket.IO client connects same-origin, so it "just
  works" on the host's Network URL.

---

## 8. Networking & deployment notes

- The server binds `0.0.0.0`, so it's reachable on every interface. It auto-detects
  and prints all LAN IPv4 URLs at startup.
- Players must reach the host's **LAN IP** (e.g. `http://192.168.x.x:3000`), not
  `localhost`. The lobby's invite/share link uses `/api/network` to surface the
  correct address.
- **Windows Firewall** blocks inbound Node by default; the startup banner prints the
  one-line `New-NetFirewallRule` fix.
- **Corporate/guest WiFi often enables client isolation**, which silently drops
  device-to-device traffic (symptom: works on host, times out for friends). Use a
  **phone hotspot** or a tunnel (Cloudflare/ngrok) for remote players. See the README
  networking section for details.

---

## 9. Design decisions & trade-offs

| Decision | Rationale | Trade-off |
|---|---|---|
| In-memory state, no DB | Zero setup, instant LAN play | State lost on restart; single host only |
| Authoritative server | Prevents cheating, single source of truth for timing/scoring | All logic centralized on the host |
| Built-in Three.js avatars (no model files) | No asset pipeline, fully procedural & themeable | More code; stylized rather than photoreal |
| Datamuse + static fallback | Fresh, non-repeating words while staying offline-capable | Online quality depends on a third-party API |
| Canvas 2D (not WebGL) for drawing | Simple, precise, easy stroke sync | No GPU brush effects |
| Single port in production | One URL to share, no CORS headaches | Must rebuild client to update the served app |
