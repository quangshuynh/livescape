import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer is loaded by OBS from a plain HTTP URL, so relative asset paths
// keep it working whether it is served by `vite preview` or any static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
