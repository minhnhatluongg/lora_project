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
});
