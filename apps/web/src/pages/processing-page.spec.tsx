import type { OwnedProcessingJobDto, ProcessingSummary } from '@documind/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../test/fake-auth-client';
import { renderApp, stubApi } from '../test/render-app';

const SUMMARY: ProcessingSummary = {
  windowDays: 7,
  queued: 2,
  running: 1,
  oldestQueuedAt: '2026-10-29T10:00:00.000Z',
  succeeded: 12,
  failed: 3,
  failuresByCode: [
    { code: 'ai_timeout', count: 2 },
    { code: 'encrypted_pdf', count: 1 },
  ],
  processingMs: { average: 84_000, p95: 125_000 },
  textExtractionMs: { average: 1200, p95: 4000 },
  aiMs: { average: 62_400, p95: 90_000 },
};

function job(overrides: Partial<OwnedProcessingJobDto> = {}): OwnedProcessingJobDto {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    status: 'failed',
    stage: null,
    attempts: 3,
    maxAttempts: 3,
    errorCode: 'ai_timeout',
    requestId: '7d5e1f0a-1111-4000-8000-000000000001',
    textExtractionMs: 1500,
    aiMs: 61_000,
    availableAt: '2026-10-29T10:00:00.000Z',
    startedAt: '2026-10-29T10:00:00.000Z',
    finishedAt: '2026-10-29T10:01:05.000Z',
    createdAt: '2026-10-29T10:00:00.000Z',
    document: { id: '00000000-0000-4000-8000-0000000000d1', originalFilename: 'po-7781.pdf' },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubProcessing(jobs: OwnedProcessingJobDto[] = [job()]) {
  return stubApi((url) => {
    if (url === '/api/v1/processing/summary') return Response.json(SUMMARY);
    if (url.startsWith('/api/v1/processing/jobs')) return Response.json({ items: jobs });
    return undefined;
  });
}

describe('ProcessingPage', () => {
  it('summarizes the queue, outcomes, durations and failure reasons', async () => {
    stubProcessing();
    renderApp('/processing', fakeSession());

    const summary = await screen.findByRole('region', { name: 'Processing summary' });
    expect(within(summary).getByText('3')).toBeInTheDocument();
    expect(within(summary).getByText('2 queued · 1 running')).toBeInTheDocument();
    expect(within(summary).getByText('12')).toBeInTheDocument();
    expect(within(summary).getByText('1 min 24 s')).toBeInTheDocument();
    expect(within(summary).getByText(/95% within 2 min 5 s/)).toBeInTheDocument();
    expect(within(summary).getByText('1 min 2 s')).toBeInTheDocument();
    const failures = screen
      .getByRole('heading', { name: 'Why jobs failed' })
      .closest('div.rounded-xl');
    if (!(failures instanceof HTMLElement)) throw new Error('failures card not found');
    expect(within(failures).getByText('AI timed out')).toBeInTheDocument();
    expect(within(failures).getByText('Password-protected PDF')).toBeInTheDocument();
  });

  it('lists jobs with their document, outcome, attempts, step times and request', async () => {
    stubProcessing();
    renderApp('/processing', fakeSession());

    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByRole('link', { name: 'po-7781.pdf' })).toHaveAttribute(
      'href',
      '/documents/00000000-0000-4000-8000-0000000000d1',
    );
    expect(within(row).getByText('Failed')).toBeInTheDocument();
    expect(within(row).getByText('AI timed out')).toBeInTheDocument();
    expect(within(row).getByText('3/3')).toBeInTheDocument();
    expect(within(row).getByText('1.5 s')).toBeInTheDocument();
    expect(within(row).getByText('1 min 5 s')).toBeInTheDocument();
    expect(
      within(row).getByTitle('Request 7d5e1f0a-1111-4000-8000-000000000001'),
    ).toHaveTextContent('7d5e1f0a');
  });

  it('filters jobs by status', async () => {
    const fetchMock = stubProcessing();
    renderApp('/processing', fakeSession());
    const user = userEvent.setup();
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Running' }));

    expect(screen.getByRole('button', { name: 'Running' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url]) => url === '/api/v1/processing/jobs?limit=50&status=running',
        ),
      ).toBe(true);
    });
  });

  it('says when there are no jobs', async () => {
    stubProcessing([]);
    renderApp('/processing', fakeSession());

    expect(await screen.findByText('No jobs yet')).toBeInTheDocument();
  });

  it('shows the request id of a failed load as a reference', async () => {
    stubApi((url) => {
      if (url === '/api/v1/processing/summary') {
        return Response.json(
          {
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'An unexpected error occurred.',
              requestId: 'f00dfeed-0000-4000-8000-000000000001',
            },
          },
          { status: 500 },
        );
      }
      if (url.startsWith('/api/v1/processing/jobs')) return Response.json({ items: [] });
      return undefined;
    });
    renderApp('/processing', fakeSession());

    expect(await screen.findByText('Could not load the summary')).toBeInTheDocument();
    expect(screen.getByText('f00dfeed-0000-4000-8000-000000000001')).toBeInTheDocument();
  });
});
