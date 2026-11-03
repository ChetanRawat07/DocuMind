import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../test/fake-auth-client';
import { renderApp, stubApi, testAnalytics } from '../test/render-app';

const WITH_DATA = testAnalytics({
  documents: { uploaded: 25, processed: 20, succeeded: 18, failed: 2, needsReview: 4 },
  successRate: 0.9,
  failureRate: 0.1,
  processingMs: { average: 84_000, p95: 125_000 },
  documentTypes: [
    { type: 'invoice', count: 12 },
    { type: 'contract', count: 6 },
    { type: 'unclassified', count: 2 },
  ],
  confidence: [
    { bucket: 'below_50', count: 3 },
    { bucket: '50_to_70', count: 2 },
    { bucket: '70_to_90', count: 5 },
    { bucket: '90_and_above', count: 8 },
  ],
  review: {
    extracted: 18,
    autoCompleted: 8,
    approvedAfterReview: 6,
    rejected: 1,
    pending: 3,
    rate: 10 / 18,
  },
  corrections: { reviewedFields: 50, correctedFields: 5, rate: 0.1 },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const analyticsCalls = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/v1/analytics'));

describe('AnalyticsPage', () => {
  it('shows rates, timing, types, confidence and review outcomes', async () => {
    stubApi((url) => (url.startsWith('/api/v1/analytics') ? Response.json(WITH_DATA) : undefined));
    renderApp('/analytics', fakeSession());

    const metrics = await screen.findByRole('region', { name: 'Key metrics' });
    expect(within(metrics).getByText('20')).toBeInTheDocument();
    expect(within(metrics).getByText('90%')).toBeInTheDocument();
    // Both the failure rate and the correction rate are 10%.
    expect(within(metrics).getAllByText('10%')).toHaveLength(2);
    expect(within(metrics).getByText('1 min 24 s')).toBeInTheDocument();
    expect(within(metrics).getByText(/95% within 2 min 5 s/)).toBeInTheDocument();
    expect(screen.getByText('Unclassified')).toBeInTheDocument();
    expect(screen.getByText('90% and above')).toBeInTheDocument();
    expect(screen.getByText('Completed automatically')).toBeInTheDocument();
    expect(screen.getByText('56%')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /Documents processed per day/ })).toBeInTheDocument();
  });

  it('switches the range, keeping it in the URL', async () => {
    const fetchMock = stubApi();
    renderApp('/analytics', fakeSession());
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Key metrics' });
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '7 days' }));

    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(analyticsCalls(fetchMock).some((url) => url.includes('days=7&'))).toBe(true);
    });
  });

  it('reads the range from the URL and ignores one it does not offer', async () => {
    const fetchMock = stubApi();
    renderApp('/analytics?days=90', fakeSession());
    await screen.findByRole('region', { name: 'Key metrics' });
    expect(analyticsCalls(fetchMock).at(-1)).toContain('days=90&');

    vi.unstubAllGlobals();
    const second = stubApi();
    renderApp('/analytics?days=365', fakeSession());
    await waitFor(() => {
      expect(analyticsCalls(second).at(-1)).toContain('days=30&');
    });
  });

  it('shows empty states, not zero percentages, when nothing was processed', async () => {
    stubApi();
    renderApp('/analytics', fakeSession());

    const metrics = await screen.findByRole('region', { name: 'Key metrics' });
    expect(within(metrics).queryByText('0%')).toBeNull();
    expect(screen.getByText('No processing activity yet')).toBeInTheDocument();
    expect(screen.getByText('No extractions yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing reviewed yet')).toBeInTheDocument();
  });
});
