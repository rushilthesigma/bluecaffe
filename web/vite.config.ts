import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = 'http://localhost:5401';

export default defineConfig({
  plugins: [react()],
  // On GitHub Pages the app lives at /deckstop/; locally no base is needed.
  base: process.env.GITHUB_PAGES ? '/bluecaffe/' : '/',
  server: {
    port: 5400,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/uploads': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
});
