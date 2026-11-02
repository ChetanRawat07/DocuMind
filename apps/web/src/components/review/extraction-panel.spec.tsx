import type { DocumentDto, DocumentExtractionDto } from '@documind/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatCalendarDate } from '../../lib/format';
import { fakeSession } from '../../test/fake-auth-client';
import { testExtraction as extraction } from '../../test/extraction-fixture';
import { renderApp, stubApi, testDocument } from '../../test/render-app';

const IN_REVIEW = testDocument({ status: 'needs_review' });
const BASE = `/api/v1/documents/${IN_REVIEW.id}`;

interface Request {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

/**
 * The review API for one document: confirming or correcting marks the
 * field reviewed, and decisions change the document. `respond` overrides a
 * request's answer.
 */
function stubReviewApi(
  options: {
    document?: DocumentDto;
    extraction?: DocumentExtractionDto;
    respond?: (request: Request) => Response | undefined;
  } = {},
) {
  let document = options.document ?? IN_REVIEW;
  let current = options.extraction ?? extraction();
  const requests: Request[] = [];
  const fetchMock = stubApi((url, init) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const request = { url, method, body };
    if (method !== 'GET') requests.push(request);
    const custom = options.respond?.(request);
    if (custom) return custom;
    if (url === BASE) return Response.json(document);
    if (url.includes('/content?')) return new Response('%PDF-1.7');
    if (url === `${BASE}/extraction`) return Response.json(current);
    const fieldMatch = /\/extraction\/fields\/(\w+)$/.exec(url);
    if (fieldMatch && method === 'PUT') {
      const payload = body as { action: string; value?: string | number | null };
      current = {
        ...current,
        fields: current.fields.map((candidate) =>
          candidate.name === fieldMatch[1]
            ? {
                ...candidate,
                reviewed: true,
                value: payload.action === 'correct' ? (payload.value ?? null) : candidate.value,
                corrected:
                  payload.action === 'correct' && payload.value !== candidate.extractedValue,
              }
            : candidate,
        ),
      };
      return Response.json(current);
    }
    const decision = /\/extraction\/(approve|reject)$/.exec(url);
    if (decision) {
      const approved = decision[1] === 'approve';
      document = { ...document, status: approved ? 'completed' : 'rejected' };
      current = {
        ...current,
        review: {
          decision: approved ? 'approved' : 'rejected',
          decidedBy: 'user',
          decidedAt: '2026-10-29T11:00:00.000Z',
          rejectReason: (body as { reason?: string }).reason ?? null,
        },
      };
      return Response.json(document);
    }
    if (url === `${BASE}/jobs` && method === 'POST') {
      document = { ...document, status: 'queued', processedAt: null };
      return Response.json(
        {
          id: '00000000-0000-4000-8000-0000000000f1',
          status: 'queued',
          stage: null,
          attempts: 0,
          maxAttempts: 3,
          errorCode: null,
          requestId: '7d5e1f0a-0000-4000-8000-000000000001',
          textExtractionMs: null,
          aiMs: null,
          availableAt: '2026-10-29T11:00:00.000Z',
          startedAt: null,
          finishedAt: null,
          createdAt: '2026-10-29T11:00:00.000Z',
        },
        { status: 202 },
      );
    }
    return undefined;
  });
  return { fetchMock, requests };
}

async function renderReview(options: Parameters<typeof stubReviewApi>[0] = {}) {
  const api = stubReviewApi(options);
  renderApp(`/documents/${(options.document ?? IN_REVIEW).id}`, fakeSession());
  await screen.findByRole('list', { name: 'Extracted fields' });
  return api;
}

const fieldsList = () => screen.getByRole('list', { name: 'Extracted fields' });
const rowOf = (label: string) => {
  const row = within(fieldsList()).getByText(label, { selector: 'p' }).closest('li');
  if (!row) throw new Error(`no row for ${label}`);
  return row;
};
const approveButton = () => screen.getByRole('button', { name: 'Approve' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExtractionPanel', () => {
  it('shows each field with its score, and why a flagged one needs a check', async () => {
    await renderReview();

    expect(within(rowOf('Invoice number')).getByText('INV-1023')).toBeInTheDocument();
    expect(
      within(rowOf('Invoice date')).getByText(formatCalendarDate('2026-10-20')),
    ).toBeInTheDocument();
    expect(within(rowOf('Total')).getByText('₹58,200.00')).toBeInTheDocument();
    expect(within(rowOf('Total')).getByText('72%')).toBeInTheDocument();
    expect(within(rowOf('Due date')).getByText('Not found')).toBeInTheDocument();

    const vendor = rowOf('Vendor');
    expect(within(vendor).getByText('Check')).toBeInTheDocument();
    expect(within(vendor).getByText('The quoted text is not in the document')).toBeInTheDocument();
    expect(within(vendor).getByText('Sold by ABC')).toBeInTheDocument();
    // Unflagged fields need no action and show no quote.
    expect(within(rowOf('Invoice number')).queryByText('Check')).toBeNull();
    expect(screen.getByText('Confidence 30%')).toBeInTheDocument();
  });

  it('keeps Approve disabled until every flagged field is checked', async () => {
    const { requests } = await renderReview();
    const user = userEvent.setup();

    expect(approveButton()).toBeDisabled();
    expect(screen.getByText(/Confirm or correct 2 more flagged fields/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm Vendor' }));
    await screen.findByText(/Confirm or correct 1 more flagged field to approve/);
    await user.click(screen.getByRole('button', { name: 'Confirm Total' }));

    await waitFor(() => {
      expect(approveButton()).toBeEnabled();
    });
    expect(within(rowOf('Vendor')).getByText('Confirmed')).toBeInTheDocument();
    expect(requests[0]).toEqual({
      url: `${BASE}/extraction/fields/vendorName`,
      method: 'PUT',
      body: { extractionId: extraction().id, action: 'confirm' },
    });
  });

  it('corrects an amount as a number and shows the extracted value beside it', async () => {
    const { requests } = await renderReview();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit Total' }));
    const input = screen.getByLabelText('New value for Total');
    await user.clear(input);
    await user.type(input, '58000');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await within(rowOf('Total')).findByText('Corrected');
    expect(requests[0]?.body).toEqual({
      extractionId: extraction().id,
      action: 'correct',
      value: 58_000,
    });
    expect(within(rowOf('Total')).getByText('₹58,000.00')).toBeInTheDocument();
    expect(within(rowOf('Total')).getByText('Extracted: ₹58,200.00')).toBeInTheDocument();
  });

  it('upper-cases a currency code before sending it', async () => {
    const { requests } = await renderReview();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit Currency' }));
    const input = screen.getByLabelText('New value for Currency');
    await user.clear(input);
    await user.type(input, 'usd');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(requests[0]?.body).toMatchObject({ value: 'USD' });
    });
  });

  it('explains a refused value in its own words, keeping the form open', async () => {
    await renderReview({
      respond: ({ method }) =>
        method === 'PUT'
          ? Response.json(
              { error: { code: 'BAD_REQUEST', message: 'issueDate: Invalid ISO date' } },
              { status: 400 },
            )
          : undefined,
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit Invoice date' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid date.');
    expect(screen.getByLabelText('New value for Invoice date')).toBeInTheDocument();
  });

  it('reloads when the document changed elsewhere', async () => {
    const { fetchMock } = await renderReview({
      respond: ({ method }) =>
        method === 'PUT'
          ? Response.json(
              { error: { code: 'CONFLICT', message: 'The extracted data has changed' } },
              { status: 409 },
            )
          : undefined,
    });
    const user = userEvent.setup();
    const loads = () => fetchMock.mock.calls.filter(([url]) => url === `${BASE}/extraction`).length;
    const before = loads();

    await user.click(screen.getByRole('button', { name: 'Confirm Vendor' }));

    await waitFor(() => {
      expect(loads()).toBe(before + 1);
    });
  });

  it('approves, and the document becomes complete with no further actions', async () => {
    const { requests } = await renderReview();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Confirm Vendor' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm Total' }));
    await waitFor(() => {
      expect(approveButton()).toBeEnabled();
    });

    await user.click(approveButton());

    expect(await screen.findByText(/^Approved on/)).toBeInTheDocument();
    expect(screen.getAllByText('Complete').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Confirm / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(requests.at(-1)).toEqual({
      url: `${BASE}/extraction/approve`,
      method: 'POST',
      body: { extractionId: extraction().id },
    });
  });

  it('rejects with a reason, then offers to reprocess the document', async () => {
    const { requests } = await renderReview();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText(/Why is this extraction unusable/), 'Not an invoice');
    await user.click(screen.getByRole('button', { name: 'Reject extraction' }));

    expect(await screen.findByText('Reason: Not an invoice')).toBeInTheDocument();
    expect(requests.at(-1)?.body).toEqual({
      extractionId: extraction().id,
      reason: 'Not an invoice',
    });

    await user.click(screen.getByRole('button', { name: 'Reprocess' }));

    expect(await screen.findByText('No extracted data yet')).toBeInTheDocument();
    expect(requests.at(-1)).toMatchObject({ url: `${BASE}/jobs`, method: 'POST' });
    expect(screen.queryByRole('button', { name: 'Reprocess' })).toBeNull();
  });

  it('says when an extraction completed without review', async () => {
    await renderReview({
      document: testDocument({ status: 'completed' }),
      extraction: extraction({
        review: {
          decision: 'approved',
          decidedBy: 'system',
          decidedAt: '2026-10-29T10:01:00.000Z',
          rejectReason: null,
        },
      }),
    });

    expect(screen.getByText(/^Approved automatically/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('warns when the document type itself is uncertain', async () => {
    await renderReview({ extraction: extraction({ classificationConfidence: 0.5 }) });

    expect(screen.getByText(/If the type is wrong, reject the extraction/)).toBeInTheDocument();
    expect(screen.getByText('(type uncertain)')).toBeInTheDocument();
  });

  it('does not ask for an extraction before processing finishes', async () => {
    const { fetchMock } = stubReviewApi({ document: testDocument({ status: 'processing' }) });
    renderApp(`/documents/${IN_REVIEW.id}`, fakeSession());

    expect(await screen.findByText('No extracted data yet')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/extraction'))).toBe(false);
  });
});
