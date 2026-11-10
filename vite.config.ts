import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { formaAssets } from './tools/vite-plugin-forma-assets';

export default defineConfig({
  // Relative base so the built `dist/` works from any static path.
  base: './',
  plugins: [react(), formaAssets()],
  // Keep hashed build output apart from the vetted SVGs copied from public/assets.
  build: { assetsDir: 'static' },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
