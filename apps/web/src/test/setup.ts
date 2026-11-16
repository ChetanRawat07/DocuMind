import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { invalidateApiCache } from '../services/use-api-query';

// Page tests render the whole app with several requests; the 1 s default flakes under parallel load.
configure({ asyncUtilTimeout: 3000 });

// jsdom has no layout, so no scrolling; ScrollRestoration calls this on every navigation.
window.scrollTo = () => undefined;

afterEach(() => {
  cleanup();
  // The API cache is module state; each test starts without one.
  invalidateApiCache();
});
