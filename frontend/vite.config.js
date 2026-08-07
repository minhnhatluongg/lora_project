import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api and /socket.io to the backend so you don't deal with CORS.
// The proxy runs on the machine serving the frontend, so 'localhost' here means
// "the PC running the backend" even when the dashboard is opened from a phone.
const proxy = {
  '/api': 'http://localhost:4000',
  '/socket.io': { target: 'http://localhost:4000', ws: true },
};

export default defineConfig({
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
});
