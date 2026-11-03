/**
 * The web app's Content-Security-Policy, injected into index.html at build
 * time (vite.config.ts). The access token lives in localStorage, so this is
 * the main defence if an XSS bug ever let a script in: only the app's own
 * scripts run, and data can only be sent to the API and Supabase.
 *
 * - `blob:` images and objects: previews show the file fetched with the
 *   token as a blob URL (use-document-preview.ts).
 * - Styles: React sets `style` through the DOM, which CSP does not block.
 * - `frame-ancestors` is ignored in a meta tag; it must be a response header
 *   from the host (deployment).
 */
export function contentSecurityPolicy(supabaseUrl: string): string {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    'object-src blob:',
    `connect-src 'self' ${supabaseOrigin}`,
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
