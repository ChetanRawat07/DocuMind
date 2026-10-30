import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from './test/fake-auth-client';
import { renderApp, stubApi, testDocument } from './test/render-app';

/**
 * Automated accessibility checks (axe-core) on each screen. jsdom has no
 * layout, so color contrast is checked separately in a real browser; these
 * catch structural problems: names, roles, landmarks, labels, ARIA misuse.
 */
async function expectNoViolations() {
  const results = await axe.run(document.body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility', () => {
  it.each(['/login', '/signup', '/forgot-password'])('%s has no violations', async (path) => {
    stubApi();
    renderApp(path);
    await screen.findByRole('heading', { level: 1 });

    await expectNoViolations();
  });

  it('the dashboard with documents has no violations', async () => {
    stubApi((url) =>
      url.startsWith('/api/v1/documents')
        ? Response.json({ items: [testDocument()], nextCursor: null })
        : undefined,
    );
    renderApp('/', fakeSession());
    await screen.findByRole('table', { name: 'Recent documents' });

    await expectNoViolations();
  });

  it.each(['/settings', '/documents', '/no-such-page'])('%s has no violations', async (path) => {
    stubApi();
    renderApp(path, fakeSession());
    await screen.findByRole('heading', { level: 1 });

    await expectNoViolations();
  });

  it('has no violations with the navigation drawer and account menu open', async () => {
    stubApi();
    renderApp('/', fakeSession());
    await screen.findByRole('heading', { level: 1 });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await expectNoViolations();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await expectNoViolations();
  });
});
