import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { contentSecurityPolicy } from './src/lib/content-security-policy.ts';

// Environment files live at the repository root, shared with the API.
const envDir = '../..';

/** Build only: the dev server injects inline scripts (React refresh) that this policy blocks. */
function contentSecurityPolicyMeta(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'documind-content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      // Fail the build rather than ship a policy that blocks sign-in.
      if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is required to build the CSP');
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: contentSecurityPolicy(supabaseUrl),
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');

  return {
    envDir,
    plugins: [react(), tailwindcss(), contentSecurityPolicyMeta(env.VITE_SUPABASE_URL)],
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
