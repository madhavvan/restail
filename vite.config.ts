import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No build-time API-key injection: keys come exclusively from the in-app
// Settings UI (browser localStorage). Inlining a key from .env would bake it
// into a publicly served bundle.
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
