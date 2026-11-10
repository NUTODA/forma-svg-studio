import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { formaAssets } from './tools/vite-plugin-forma-assets.ts';

export default defineConfig({
  // Relative base so the built `dist/` works from any static path.
  base: './',
  plugins: [react(), formaAssets()],
  // Keep hashed build output apart from the vetted SVGs copied from public/assets.
  build: { assetsDir: 'static' },
  // `npm run server` (port 8787) holds the optional LLM key; without it the app still works offline.
  server: { proxy: { '/api': 'http://localhost:8787' } },
  preview: { proxy: { '/api': 'http://localhost:8787' } },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
