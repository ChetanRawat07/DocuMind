import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from './test/fake-auth-client';
import { renderApp, stubApi, testAnalytics, testDocument } from './test/render-app';

/** A response that never arrives: a page that needs it stays loading. */
const pending = () => new Promise<Response>(() => undefined);

const nav = () => screen.getByRole('navigation', { name: 'Main' });

async function goTo(label: string, heading: string | RegExp = label) {
  await userEvent.click(within(nav()).getByRole('link', { name: label }));
  return screen.findByRole('heading', { level: 1, name: heading });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('moving between pages', () => {
  it('shows a revisited page from the cache at once while it refreshes', async () => {
    let analyticsCalls = 0;
    stubApi((url) => {
      if (!url.startsWith('/api/v1/analytics')) return undefined;
      analyticsCalls += 1;
      // The refresh on the second visit never answers: only the cache can fill the page.
      return analyticsCalls === 1
        ? Response.json(
            testAnalytics({
              documents: { uploaded: 7, processed: 0, succeeded: 0, failed: 0, needsReview: 0 },
            }),
          )
        : pending();
    });
    renderApp('/', fakeSession());
    const metrics = await screen.findByRole('region', { name: 'Key metrics' });
    expect(await within(metrics).findByText('7')).toBeInTheDocument();

    await goTo('Documents');
    await goTo('Dashboard', /, Ada$/);

    const revisited = screen.getByRole('region', { name: 'Key metrics' });
    expect(within(revisited).getByText('7')).toBeInTheDocument();
    expect(within(revisited).queryByText('Loading…')).not.toBeInTheDocument();
    expect(analyticsCalls).toBe(2);
  });

  it('does not bring a deleted document back from the cache', async () => {
    const document = testDocument();
    let deleted = false;
    stubApi((url, init) => {
      if (init?.method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      if (url.startsWith('/api/v1/documents?') && url.includes('limit=20')) {
        return deleted ? pending() : Response.json({ items: [document], nextCursor: null });
      }
      return undefined;
    });
    renderApp('/documents', fakeSession());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete invoice-1023.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Confirm deleting invoice-1023.pdf' }));

    await goTo('Dashboard', /, Ada$/);
    await goTo('Documents');

    expect(screen.queryByText('invoice-1023.pdf')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading documents…');
  });

  it("never shows one user's data to the next user who signs in", async () => {
    let analyticsCalls = 0;
    stubApi((url) => {
      if (!url.startsWith('/api/v1/analytics')) return undefined;
      analyticsCalls += 1;
      return analyticsCalls === 1
        ? Response.json(
            testAnalytics({
              documents: { uploaded: 7, processed: 0, succeeded: 0, failed: 0, needsReview: 0 },
            }),
          )
        : pending();
    });
    const { emit, router } = renderApp('/', fakeSession());
    const metrics = await screen.findByRole('region', { name: 'Key metrics' });
    expect(await within(metrics).findByText('7')).toBeInTheDocument();

    act(() => {
      emit('SIGNED_OUT', null);
    });
    await screen.findByRole('heading', { level: 1, name: 'Good to see you again.' });
    const other = fakeSession('access-token-2');
    act(() => {
      emit('SIGNED_IN', { ...other, user: { ...other.user, id: 'another-user' } });
    });
    await act(() => router.navigate('/'));

    const theirs = await screen.findByRole('region', { name: 'Key metrics' });
    expect(within(theirs).queryByText('7')).not.toBeInTheDocument();
    expect(within(theirs).getAllByText('Loading…')).toHaveLength(4);
  });

  it('opens a new page at the top and moves focus to it without scrolling', async () => {
    stubApi();
    renderApp('/', fakeSession());
    await screen.findByRole('heading', { level: 1, name: /, Ada$/ });
    const scrollTo = vi.spyOn(window, 'scrollTo');
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');

    await goTo('Analytics');

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(screen.getByRole('main')).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('returns to the scroll position on Back', async () => {
    stubApi();
    const { router } = renderApp('/', fakeSession());
    await screen.findByRole('heading', { level: 1, name: /, Ada$/ });
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    await goTo('Analytics');
    const scrollTo = vi.spyOn(window, 'scrollTo');

    await act(() => router.navigate(-1));

    expect(scrollTo).toHaveBeenLastCalledWith(0, 640);
  });

  it('keeps the scroll position when a filter changes the list', async () => {
    stubApi();
    renderApp('/documents', fakeSession());
    await screen.findByText('No documents yet');
    const scrollTo = vi.spyOn(window, 'scrollTo');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Failed');

    await screen.findByText('No matching documents');
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('moving between signed-out pages', () => {
  it('keeps the card mounted and plays its entrance only on the first page', async () => {
    stubApi();
    const { router } = renderApp('/signup');
    await screen.findByRole('heading', { level: 1, name: 'Create your account' });
    const main = screen.getByRole('main');
    expect(main.querySelector('.auth-card')).not.toHaveAttribute('data-entered');

    await act(() => router.navigate('/forgot-password'));

    await screen.findByRole('heading', { level: 1, name: 'Reset your password' });
    expect(screen.getByRole('main')).toBe(main);
    expect(main.querySelector('.auth-card')).toHaveAttribute('data-entered');
  });
});
