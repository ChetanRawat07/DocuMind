import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../test/fake-auth-client';
import {
  apiErrorResponse,
  renderApp,
  stubApi,
  TEST_USER,
  testAnalytics,
  testDocument,
} from '../test/render-app';
import { RECENT_DOCUMENTS_LIMIT } from './dashboard-page';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function documentsResponse(items: ReturnType<typeof testDocument>[]) {
  return Response.json({ items, nextCursor: null });
}

describe('DashboardPage', () => {
  it('greets the user and shows real zeros, not invented numbers, before anything is processed', async () => {
    stubApi();
    renderApp('/', fakeSession());

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Good (morning|afternoon|evening), Ada$/,
      }),
    ).toBeInTheDocument();
    const metrics = screen.getByRole('region', { name: 'Key metrics' });
    await within(metrics).findByText('Uploaded in the last 30 days');
    const values = within(metrics)
      .getAllByRole('definition')
      .map((value) => value.textContent);
    // Counts are zero; a rate with nothing to divide by is a dash, not 0%.
    expect(values).toEqual(['0', '0', '—No data yet', '0']);
    expect(screen.getByText('No processing activity yet')).toBeInTheDocument();
    expect(screen.getByText('No classified documents yet')).toBeInTheDocument();
  });

  it("shows the last 30 days of analytics in the viewer's timezone", async () => {
    const fetchMock = stubApi((url) =>
      url.startsWith('/api/v1/analytics')
        ? Response.json(
            testAnalytics({
              documents: { uploaded: 12, processed: 10, succeeded: 9, failed: 1, needsReview: 3 },
              successRate: 0.9,
              documentTypes: [
                { type: 'invoice', count: 7 },
                { type: 'unclassified', count: 1 },
              ],
              corrections: { reviewedFields: 40, correctedFields: 6, rate: 0.15 },
            }),
          )
        : undefined,
    );
    renderApp('/', fakeSession());

    const metrics = await screen.findByRole('region', { name: 'Key metrics' });
    expect(await within(metrics).findByText('12')).toBeInTheDocument();
    expect(within(metrics).getByText('90% succeeded')).toBeInTheDocument();
    expect(within(metrics).getByText('15%')).toBeInTheDocument();
    expect(within(metrics).getByText('of 40 reviewed values were corrected')).toBeInTheDocument();
    expect(within(metrics).getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Unclassified')).toBeInTheDocument();
    const request = fetchMock.mock.calls.find(([url]) => url.startsWith('/api/v1/analytics'));
    expect(request?.[0]).toMatch(/^\/api\/v1\/analytics\?days=30&tz=[\w%]+$/);
  });

  it('greets without a name when the profile has none', async () => {
    stubApi((url) =>
      url === '/api/v1/me' ? Response.json({ ...TEST_USER, displayName: null }) : undefined,
    );
    renderApp('/', fakeSession());

    expect(
      await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)$/ }),
    ).toBeInTheDocument();
  });

  it('lists the most recent documents with type and status', async () => {
    const fetchMock = stubApi((url) =>
      url.startsWith('/api/v1/documents')
        ? documentsResponse([
            testDocument(),
            testDocument({
              id: '00000000-0000-4000-8000-0000000000d2',
              originalFilename: 'contract-882.pdf',
              documentType: null,
              status: 'needs_review',
            }),
          ])
        : undefined,
    );
    renderApp('/', fakeSession());

    const table = await screen.findByRole('table', { name: 'Recent documents' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('invoice-1023.pdf');
    expect(rows[1]).toHaveTextContent('Invoice');
    expect(rows[1]).toHaveTextContent('Complete');
    expect(rows[2]).toHaveTextContent('Not classified');
    expect(rows[2]).toHaveTextContent('Needs review');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/documents?limit=${RECENT_DOCUMENTS_LIMIT}`,
      expect.anything(),
    );
  });

  it('links to the full document list', async () => {
    stubApi();
    renderApp('/', fakeSession());

    expect(await screen.findByRole('link', { name: 'View all' })).toHaveAttribute(
      'href',
      '/documents',
    );
  });

  it('shows an error for recent documents and recovers on retry', async () => {
    let failures = 1;
    stubApi((url) => {
      if (url.startsWith('/api/v1/documents') && failures > 0) {
        failures -= 1;
        return apiErrorResponse(503);
      }
      return url.startsWith('/api/v1/documents') ? documentsResponse([testDocument()]) : undefined;
    });
    renderApp('/', fakeSession());
    const user = userEvent.setup();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load documents');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('invoice-1023.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never renders raw server error text', async () => {
    stubApi((url) =>
      url.startsWith('/api/v1/documents')
        ? Response.json(
            { error: { code: 'X', message: '<b>stack trace at db.ts:12</b>' } },
            { status: 500 },
          )
        : undefined,
    );
    renderApp('/', fakeSession());

    await screen.findByRole('alert');
    expect(screen.queryByText(/stack trace/)).not.toBeInTheDocument();
  });
});

describe('SettingsPage', () => {
  it('shows the profile from the API', async () => {
    stubApi();
    renderApp('/settings', fakeSession());

    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const profile = screen.getByRole('heading', { name: 'Profile' }).closest('div.rounded-xl');
    expect(profile).toHaveTextContent('NameAda');
    expect(profile).toHaveTextContent('Emailada@example.test');
    expect(profile).toHaveTextContent(/Member since\S+/);
  });

  it('signs out from the session card', async () => {
    stubApi();
    const fake = renderApp('/settings', fakeSession());
    const user = userEvent.setup();

    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const session = screen.getByRole('heading', { name: 'Session' }).closest('div.rounded-xl');
    await user.click(within(session as HTMLElement).getByRole('button', { name: 'Sign out' }));

    expect(fake.mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
