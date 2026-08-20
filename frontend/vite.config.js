import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api and /socket.io to the backend so you don't deal with CORS.
//
// The proxy runs on the machine serving the frontend, so the browser only ever
// talks to this dev server. That matters once the backend moves to a real host:
// point the proxy at it and nothing else changes — no CORS entry to add on the
// server, no VITE_API_BASE, no rebuild of the client bundle.
//
// Set it in frontend/.env.local (git-ignored):
//     VITE_PROXY_TARGET=http://iot.tenmiencuaban.com
// Leave it unset and everything keeps pointing at a backend on this PC.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_PROXY_TARGET || 'http://localhost:4000';
  const proxy = {
    '/api': { target, changeOrigin: true },
    // ws:true is what carries Socket.IO. Without it the dashboard loads but the
    // numbers never move on their own.
    '/socket.io': { target, ws: true, changeOrigin: true },
  };

  return {
  plugins: [react()],
  server: { port: 5173, proxy },
  // `vite preview` (serving the production build) needs its own proxy config —
  // it does not inherit server.proxy.
  preview: { port: 5173, proxy },
  build: {
    rollupOptions: {
      output: {
        // Recharts + d3 are over half the bundle and only the DASHBOARD needs
        // them; MENU and CONTROL are what an operator hits first on a panel that
        // may be on a slow link. Splitting them out keeps the entry chunk small
        // and lets the browser cache the vendor code across app deploys.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          socket: ['socket.io-client'],
        },
      },
    },
  },
  };
});
