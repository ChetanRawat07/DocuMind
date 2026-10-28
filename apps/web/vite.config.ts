import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Environment files live at the repository root, shared with the API.
const envDir = '../..';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    server: {
      // Same-origin /api calls in development avoid CORS and mirror a reverse-proxied deployment.
      proxy: {
        '/api': `http://localhost:${env.PORT ?? '3000'}`,
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
