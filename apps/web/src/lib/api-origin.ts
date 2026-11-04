const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The API's origin from VITE_API_URL, for a deployment where the API runs on
 * another host (Render, while the web app is on Cloudflare Pages). Empty means
 * the API is on the web app's own origin, as in development with the Vite proxy.
 * The build validates it (vite.config.ts), so a bad value never ships.
 */
export function apiOrigin(value: string | undefined): string {
  if (!value) return '';
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  const secure =
    url?.protocol === 'https:' || (url?.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (!url || url.origin !== value || !secure) {
    // The token travels with every request, so plain http is refused outside this machine.
    throw new Error(
      'VITE_API_URL must be https://host[:port] with no path or trailing slash (http only for localhost)',
    );
  }
  return url.origin;
}
