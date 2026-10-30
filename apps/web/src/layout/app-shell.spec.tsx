import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../test/fake-auth-client';
import { apiErrorResponse, renderApp, stubApi } from '../test/render-app';
import { NAV_ITEMS } from './navigation';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderShell(path: string) {
  stubApi();
  const fake = renderApp(path, fakeSession());
  await screen.findByRole('heading', { level: 1 });
  return fake;
}

describe('AppShell', () => {
  it.each(Object.values(NAV_ITEMS).filter((item) => item.path !== '/'))(
    'routes $path to the $label page and marks its link current',
    async (item) => {
      await renderShell(item.path);

      expect(screen.getByRole('heading', { level: 1, name: item.label })).toBeInTheDocument();
      const nav = screen.getByRole('navigation', { name: 'Main' });
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(within(nav).getAllByRole('link', { current: 'page' })).toHaveLength(1);
    },
  );

  it('keeps a section highlighted on its nested pages, and only that section', async () => {
    await renderShell('/documents/00000000-0000-4000-8000-0000000000d1');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link', { current: 'page' })).toEqual([
      within(nav).getByRole('link', { name: 'Documents' }),
    ]);
  });

  it('shows the section and page in the breadcrumb', async () => {
    await renderShell('/audit-logs');

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(breadcrumb).toHaveTextContent('InsightsAudit Logs');
    expect(within(breadcrumb).getByText('Audit Logs')).toHaveAttribute('aria-current', 'page');
  });

  it('sets the browser tab title for the page', async () => {
    await renderShell('/review');

    await waitFor(() => {
      expect(document.title).toBe('Review · DocuMind');
    });
  });

  it('shows a not-found page inside the shell for an unknown path', async () => {
    await renderShell('/no-such-page');

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('moves focus to the page after navigating', async () => {
    await renderShell('/');
    const user = userEvent.setup();

    const nav = screen.getByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('link', { name: 'Analytics' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('offers a skip link to the main content', async () => {
    await renderShell('/');

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('shows an error with a retry when the profile cannot load', async () => {
    let failures = 1;
    stubApi((url) => {
      if (url === '/api/v1/me' && failures > 0) {
        failures -= 1;
        return apiErrorResponse(500);
      }
      return undefined;
    });
    renderApp('/', fakeSession());
    const user = userEvent.setup();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your workspace');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: /, Ada$/ })).toBeInTheDocument();
  });

  describe('mobile navigation drawer', () => {
    it('opens as a modal, makes the page behind it inert, and closes on Escape', async () => {
      await renderShell('/');
      const user = userEvent.setup();
      const opener = screen.getByRole('button', { name: 'Open navigation' });

      await user.click(opener);

      const dialog = screen.getByRole('dialog', { name: 'Navigation' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(opener).toHaveAttribute('aria-expanded', 'true');
      expect(within(dialog).getByRole('button', { name: 'Close navigation' })).toHaveFocus();
      expect(screen.getByRole('main', { hidden: true }).closest('[inert]')).not.toBeNull();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
      expect(document.querySelector('[inert]')).toBeNull();
    });

    it('closes after following a link', async () => {
      await renderShell('/');
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Open navigation' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Documents' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument();
      // The new page takes focus, not the menu button the drawer would otherwise return it to.
      expect(screen.getByRole('main')).toHaveFocus();
    });
  });

  describe('account menu', () => {
    it('shows who is signed in and closes on Escape, returning focus', async () => {
      await renderShell('/');
      const user = userEvent.setup();
      const trigger = screen.getByRole('button', { name: 'Account' });

      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('ada@example.test')).toBeVisible();

      await user.keyboard('{Escape}');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('button', { name: 'Sign out', hidden: true })).not.toBeVisible();
      expect(trigger).toHaveFocus();
    });

    it('closes on a click outside', async () => {
      await renderShell('/');
      const user = userEvent.setup();
      const trigger = screen.getByRole('button', { name: 'Account' });

      await user.click(trigger);
      await user.click(screen.getByRole('heading', { level: 1 }));

      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('links to settings and closes', async () => {
      await renderShell('/');
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Account' }));
      const panel = screen.getByRole('button', { name: 'Sign out' }).closest('div[id]');
      await user.click(within(panel as HTMLElement).getByRole('link', { name: 'Settings' }));

      expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });
  });

  it('keeps the shell responsive to a sign-out from another tab', async () => {
    const fake = await renderShell('/settings');

    act(() => {
      fake.emit('SIGNED_OUT', null);
    });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
