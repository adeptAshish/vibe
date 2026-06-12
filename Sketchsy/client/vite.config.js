import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During dev the client runs on 5173 and proxies API + socket traffic to the
// game server on 3000. In production the server serves the built dist directly.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose dev server on the LAN too
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
