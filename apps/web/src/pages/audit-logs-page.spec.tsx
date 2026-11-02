import type { AuditLogEntryDto } from '@documind/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../test/fake-auth-client';
import { renderApp, stubApi } from '../test/render-app';

const DOCUMENT_ID = '00000000-0000-4000-8000-0000000000d1';

function entry(id: number, overrides: Partial<AuditLogEntryDto> = {}): AuditLogEntryDto {
  return {
    id: String(id),
    occurredAt: '2026-10-29T10:00:00.000Z',
    actor: 'user',
    action: 'document.uploaded',
    resourceType: 'document',
    resourceId: DOCUMENT_ID,
    requestId: '7d5e1f0a-2222-4000-8000-000000000001',
    metadata: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuditLogsPage', () => {
  it('lists entries with what happened, who did it, the document and the request', async () => {
    stubApi((url) =>
      url === '/api/v1/audit-logs?limit=50'
        ? Response.json({
            items: [
              entry(2, {
                actor: 'system',
                action: 'document.text_extracted',
                requestId: null,
                metadata: { pageCount: 3, ocrPageCount: 1, durationMs: 4200 },
              }),
              entry(1),
            ],
            nextCursor: null,
          })
        : undefined,
    );
    renderApp('/audit-logs', fakeSession());

    const table = await screen.findByRole('table', { name: 'Audit log, newest first' });
    const rows = within(table).getAllByRole('row');
    const row = (index: number) => {
      const element = rows[index];
      if (!element) throw new Error(`no row ${String(index)}`);
      return element;
    };
    const [first, second] = [row(1), row(2)];
    expect(within(first).getByText('Text extracted')).toBeInTheDocument();
    expect(within(first).getByText('3 pages · 1 by OCR · 4.2 s')).toBeInTheDocument();
    expect(within(first).getByText('System')).toBeInTheDocument();
    expect(within(second).getByText('You')).toBeInTheDocument();
    expect(within(second).getByText('7d5e1f0a')).toBeInTheDocument();
    expect(within(second).getByRole('link')).toHaveAttribute('href', `/documents/${DOCUMENT_ID}`);
  });

  it('loads older entries with the cursor', async () => {
    const fetchMock = stubApi((url) => {
      if (url === '/api/v1/audit-logs?limit=50') {
        return Response.json({ items: [entry(5)], nextCursor: '5' });
      }
      if (url === '/api/v1/audit-logs?limit=50&cursor=5') {
        return Response.json({
          items: [entry(4, { action: 'document.deleted' })],
          nextCursor: null,
        });
      }
      return undefined;
    });
    renderApp('/audit-logs', fakeSession());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Deleted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(
      fetchMock.mock.calls.some(([url]) => url === '/api/v1/audit-logs?limit=50&cursor=5'),
    ).toBe(true);
  });

  it('says when there is no activity', async () => {
    stubApi((url) =>
      url.startsWith('/api/v1/audit-logs')
        ? Response.json({ items: [], nextCursor: null })
        : undefined,
    );
    renderApp('/audit-logs', fakeSession());

    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
  });
});
