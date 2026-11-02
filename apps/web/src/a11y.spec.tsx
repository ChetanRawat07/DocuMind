import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from './test/fake-auth-client';
import { stubXhr, waitForRequest } from './test/fake-xhr';
import { testExtraction } from './test/extraction-fixture';
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

  it('the documents page with a list, a delete confirmation and an upload queue has no violations', async () => {
    stubApi((url) =>
      url.startsWith('/api/v1/documents')
        ? Response.json({ items: [testDocument()], nextCursor: 'next' })
        : undefined,
    );
    const requests = stubXhr();
    renderApp('/documents', fakeSession());
    await screen.findByRole('table', { name: 'Your documents' });
    const user = userEvent.setup({ applyAccept: false });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('file input not found');

    await user.upload(input, [new File(['%PDF-1.7'], 'a.pdf'), new File(['MZ'], 'b.exe')]);
    (await waitForRequest(requests, 0)).progress(1, 2);
    await screen.findByRole('progressbar');
    await user.click(screen.getByRole('button', { name: 'Delete invoice-1023.pdf' }));

    await expectNoViolations();
  });

  it('the documents page with filters applied and no matches has no violations', async () => {
    stubApi();
    renderApp('/documents?q=nothing&status=failed', fakeSession());
    await screen.findByText('No matching documents');

    await expectNoViolations();
  });

  it.each([
    ['a PDF', testDocument()],
    ['an image', testDocument({ originalFilename: 'scan.png', mimeType: 'image/png' })],
  ])('the detail page previewing %s has no violations', async (_case, document) => {
    Object.assign(URL, { createObjectURL: () => 'blob:test/1', revokeObjectURL: () => undefined });
    stubApi((url) => {
      if (url === `/api/v1/documents/${document.id}`) return Response.json(document);
      if (url.includes('/content?')) return new Response(new Blob(['x']));
      return undefined;
    });
    renderApp(`/documents/${document.id}`, fakeSession());
    await screen.findByRole('heading', { level: 1, name: document.originalFilename });
    await waitFor(() => {
      expect(screen.queryByText('Loading preview…')).not.toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `Delete ${document.originalFilename}` }));

    await expectNoViolations();
  });

  it('the detail page reviewing an extraction, with a field being edited, has no violations', async () => {
    const document = testDocument({ status: 'needs_review' });
    Object.assign(URL, { createObjectURL: () => 'blob:test/1', revokeObjectURL: () => undefined });
    stubApi((url) => {
      if (url === `/api/v1/documents/${document.id}`) return Response.json(document);
      if (url.endsWith('/extraction')) return Response.json(testExtraction());
      if (url.includes('/content?')) return new Response(new Blob(['x']));
      return undefined;
    });
    renderApp(`/documents/${document.id}`, fakeSession());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit Total' }));
    await user.click(screen.getByRole('button', { name: 'Reject' }));

    await expectNoViolations();
  });

  it('the review queue has no violations', async () => {
    stubApi((url) =>
      url.includes('status=needs_review')
        ? Response.json({ items: [testDocument({ status: 'needs_review' })], nextCursor: null })
        : undefined,
    );
    renderApp('/review', fakeSession());
    await screen.findByRole('link', { name: /^Review / });

    await expectNoViolations();
  });

  it('the processing page with a summary and jobs has no violations', async () => {
    stubApi((url) => {
      if (url === '/api/v1/processing/summary') {
        return Response.json({
          windowDays: 7,
          queued: 1,
          running: 0,
          oldestQueuedAt: null,
          succeeded: 1,
          failed: 1,
          failuresByCode: [{ code: 'ai_timeout', count: 1 }],
          processingMs: { average: 1000, p95: 1000 },
          textExtractionMs: { average: null, p95: null },
          aiMs: { average: 900, p95: 900 },
        });
      }
      if (url.startsWith('/api/v1/processing/jobs')) {
        return Response.json({
          items: [
            {
              id: '00000000-0000-4000-8000-0000000000a1',
              status: 'running',
              stage: 'ai_extraction',
              attempts: 1,
              maxAttempts: 3,
              errorCode: null,
              requestId: null,
              textExtractionMs: 1000,
              aiMs: null,
              availableAt: '2026-10-29T10:00:00.000Z',
              startedAt: '2026-10-29T10:00:00.000Z',
              finishedAt: null,
              createdAt: '2026-10-29T10:00:00.000Z',
              document: { id: '00000000-0000-4000-8000-0000000000d1', originalFilename: 'a.pdf' },
            },
          ],
        });
      }
      return undefined;
    });
    renderApp('/processing', fakeSession());
    await screen.findByRole('table');

    await expectNoViolations();
  });

  it('the audit log with more pages has no violations', async () => {
    const document = testDocument();
    const entry = {
      id: '1',
      occurredAt: '2026-10-29T10:00:00.000Z',
      actor: 'system',
      action: 'document.text_extracted',
      resourceType: 'document',
      resourceId: document.id,
      requestId: '7d5e1f0a-0000-4000-8000-000000000001',
      metadata: { pageCount: 1 },
    };
    stubApi((url) => {
      if (url.startsWith('/api/v1/audit-logs'))
        return Response.json({ items: [entry], nextCursor: '1' });
      return undefined;
    });

    renderApp('/audit-logs', fakeSession());
    await screen.findByRole('button', { name: 'Load more' });
    await expectNoViolations();
  });

  it('the detail page activity has no violations', async () => {
    const document = testDocument();
    Object.assign(URL, { createObjectURL: () => 'blob:test/1', revokeObjectURL: () => undefined });
    stubApi((url) => {
      if (url.endsWith('/activity')) {
        return Response.json({
          items: [
            {
              id: '1',
              occurredAt: '2026-10-29T10:00:00.000Z',
              actor: 'user',
              action: 'document.uploaded',
              resourceType: 'document',
              resourceId: document.id,
              requestId: null,
              metadata: {},
            },
          ],
        });
      }
      if (url === `/api/v1/documents/${document.id}`) return Response.json(document);
      if (url.includes('/content?')) return new Response(new Blob(['x']));
      return undefined;
    });
    renderApp(`/documents/${document.id}`, fakeSession());
    await screen.findByRole('list', { name: 'Document activity' });

    await expectNoViolations();
  });

  it('the detail page for a missing document has no violations', async () => {
    stubApi((url) =>
      url.startsWith('/api/v1/documents/')
        ? Response.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 })
        : undefined,
    );
    renderApp('/documents/missing', fakeSession());
    await screen.findByRole('heading', { level: 1, name: 'Document not found' });

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
