import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const commitHash = execSync('git rev-parse --short HEAD').toString().trim();

export default defineConfig({
  define: {
    '__COMMIT_HASH__': JSON.stringify(commitHash),
  },
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        admin: resolve(__dirname, 'web/admin.html'),
        phi_stripper: resolve(__dirname, 'web/phi_stripper.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
