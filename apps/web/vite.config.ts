import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The web app calls the API at /api on its own origin, so a phone on the LAN that loads
 * http://<laptop-ip>:5173 reaches the API through this proxy with no extra config. The Host
 * header is passed through (no changeOrigin) so the API can presign photo URLs for the same
 * host. In production the same /api prefix is routed at the edge, or VITE_API_URL points
 * straight at the API.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
});
