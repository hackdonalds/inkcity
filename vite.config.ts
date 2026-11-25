import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ (or anywhere else).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
});
