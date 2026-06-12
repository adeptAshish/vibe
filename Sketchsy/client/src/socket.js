import { io } from 'socket.io-client';

// Connect to the same origin that served the page. In production the game
// server serves the app, so this "just works" on the LAN. In dev, Vite proxies
// /socket.io to the server on :3000.
export const socket = io('/', {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});

export function emit(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res));
  });
}
