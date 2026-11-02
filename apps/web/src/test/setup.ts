import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Page tests render the whole app with several requests; the 1 s default flakes under parallel load.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
});
