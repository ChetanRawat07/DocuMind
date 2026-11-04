import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { apiOrigin } from './src/lib/api-origin.ts';
import { contentSecurityPolicy } from './src/lib/content-security-policy.ts';

// Environment files live at the repository root, shared with the API.
const envDir = '../..';

/** Build only: the dev server injects inline scripts (React refresh) that this policy blocks. */
function contentSecurityPolicyMeta(
  supabaseUrl: string | undefined,
  apiUrl: string | undefined,
): Plugin {
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
            // apiOrigin throws on an invalid VITE_API_URL, which fails the build.
            content: contentSecurityPolicy(supabaseUrl, apiOrigin(apiUrl)),
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
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicyMeta(env.VITE_SUPABASE_URL, env.VITE_API_URL),
    ],
    server: {
      // Same-origin /api calls in development avoid CORS and mirror a reverse-proxied deployment.
      proxy: {
        '/api': `http://localhost:${env.PORT ?? '3000'}`,
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // `npm run test:coverage`. Thresholds sit just under the measured numbers, so a drop fails.
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.spec.{ts,tsx}', 'src/test/**'],
        reporter: ['text-summary', 'html'],
        thresholds: { lines: 93, statements: 92, branches: 84, functions: 94 },
      },
    },
  };
});
