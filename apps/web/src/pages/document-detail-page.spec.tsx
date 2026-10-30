import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { App } from '../App';
import { AuthProvider } from '../auth/auth-context';
import { createFakeAuthClient, fakeSession } from '../test/fake-auth-client';
import { apiErrorResponse, renderApp, stubApi, testDocument } from '../test/render-app';

const DOCUMENT = testDocument({ status: 'needs_review', sizeBytes: 1536 });
const DETAIL_URL = `/api/v1/documents/${DOCUMENT.id}`;
const PREVIEW_URL = `${DETAIL_URL}/content?disposition=inline`;
const DOWNLOAD_URL = `${DETAIL_URL}/content?disposition=attachment`;

/**
 * The page-level download button. (jsdom also renders the PDF preview's
 * fallback content, which has a second one; browsers that show the PDF do not.)
 */
const downloadButton = () =>
  screen.getAllByRole('button', { name: 'Download invoice-1023.pdf' })[0] as HTMLElement;

/** jsdom has no blob: URLs; these record what the page creates and releases. */
const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

beforeEach(() => {
  let next = 0;
  createObjectURL.mockReset().mockImplementation(() => `blob:test/${String((next += 1))}`);
  revokeObjectURL.mockReset();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fileResponse = (body: string, type: string) =>
  new Response(body, { headers: { 'Content-Type': type } });

async function renderDetail(
  handle: Parameters<typeof stubApi>[0] = () => undefined,
  document = DOCUMENT,
) {
  const fetchMock = stubApi((url, init) => {
    const custom = handle(url, init);
    if (custom) return custom;
    if (url === `/api/v1/documents/${document.id}`) return Response.json(document);
    if (url.includes('/content?')) return fileResponse('%PDF-1.7', document.mimeType);
    return undefined;
  });
  const fake = renderApp(`/documents/${document.id}`, fakeSession());
  await screen.findByRole('heading', { level: 1, name: document.originalFilename });
  return { fetchMock, fake };
}

describe('DocumentDetailPage', () => {
  it('shows the document metadata', async () => {
    await renderDetail();

    const details = screen.getByRole('heading', { name: 'Details' }).closest('div.rounded-xl');
    if (!(details instanceof HTMLElement)) throw new Error('details card not found');
    expect(within(details).getByText('Needs review')).toBeInTheDocument();
    expect(within(details).getByText('Invoice')).toBeInTheDocument();
    expect(within(details).getByText('PDF')).toBeInTheDocument();
    expect(within(details).getByText('1.5 KB')).toBeInTheDocument();
    // Processing reached an outcome (needs review), so it has a processed time.
    expect(details.querySelector(`time[datetime="${DOCUMENT.processedAt ?? ''}"]`)).not.toBeNull();
    await waitFor(() => {
      expect(document.title).toBe('invoice-1023.pdf · DocuMind');
    });
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'WorkspaceDocumentsDetails',
    );
  });

  it('previews a PDF from an authenticated request, typed by the API', async () => {
    // The blob takes the type the API detected at upload, not the response header.
    const { fetchMock } = await renderDetail((url) =>
      url === PREVIEW_URL ? fileResponse('%PDF-1.7', 'text/html') : undefined,
    );

    const preview = await screen.findByLabelText('Preview of invoice-1023.pdf');
    expect(preview.tagName).toBe('OBJECT');
    expect(preview).toHaveAttribute('data', 'blob:test/1');
    expect(preview).toHaveAttribute('type', 'application/pdf');
    const previewCall = fetchMock.mock.calls.find(([url]) => url === PREVIEW_URL);
    const headers = previewCall?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer access-token-1');
    expect(createObjectURL.mock.calls[0]?.[0].type).toBe('application/pdf');
  });

  it('says when a document has not been processed yet', async () => {
    await renderDetail(
      () => undefined,
      testDocument({ status: 'uploaded', processedAt: null, documentType: null }),
    );

    expect(screen.getByText('Not yet')).toBeInTheDocument();
    expect(screen.getByText('Not classified')).toBeInTheDocument();
  });

  it('previews an image as an image', async () => {
    await renderDetail(
      () => undefined,
      testDocument({ originalFilename: 'scan.png', mimeType: 'image/png' }),
    );

    expect(await screen.findByRole('img', { name: 'Preview of scan.png' })).toHaveAttribute(
      'src',
      'blob:test/1',
    );
  });

  it('does not fetch a file whose type cannot be previewed', async () => {
    const { fetchMock } = await renderDetail(
      () => undefined,
      testDocument({ originalFilename: 'notes.txt', mimeType: 'text/plain' }),
    );

    expect(screen.getByText('No preview for this file type')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/content'))).toBe(false);
  });

  it('releases the preview when leaving the page', async () => {
    await renderDetail();
    const user = userEvent.setup();
    await screen.findByLabelText('Preview of invoice-1023.pdf');

    await user.click(screen.getByRole('link', { name: 'All documents' }));

    await screen.findByRole('heading', { level: 1, name: 'Documents' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });

  it('offers a retry when the preview cannot load', async () => {
    let failures = 1;
    await renderDetail((url) => {
      if (url === PREVIEW_URL && failures > 0) {
        failures -= 1;
        return apiErrorResponse(503);
      }
      return undefined;
    });
    const user = userEvent.setup();

    expect(await screen.findByText('Could not load the preview')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText('Preview of invoice-1023.pdf')).toBeInTheDocument();
  });

  it('downloads the file under its original name', async () => {
    const { fetchMock } = await renderDetail();
    const user = userEvent.setup();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    await user.click(downloadButton());

    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(clicked[0]?.download).toBe('invoice-1023.pdf');
    expect(clicked[0]?.href).toMatch(/^blob:test\//);
    expect(fetchMock).toHaveBeenCalledWith(DOWNLOAD_URL, expect.anything());
  });

  it('reports a failed download', async () => {
    await renderDetail((url) => (url === DOWNLOAD_URL ? apiErrorResponse(500) : undefined));
    const user = userEvent.setup();

    await user.click(downloadButton());

    expect(await screen.findByText('Download failed.')).toBeInTheDocument();
  });

  it('deletes after confirmation and returns to the list', async () => {
    const { fetchMock } = await renderDetail((url, init) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Delete invoice-1023.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Confirm deleting invoice-1023.pdf' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      DETAIL_URL,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('replaces the deleted document in history, so Back does not return to it', async () => {
    stubApi((url, init) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (url === DETAIL_URL) return Response.json(DOCUMENT);
      if (url.includes('/content?')) return fileResponse('%PDF-1.7', 'application/pdf');
      return undefined;
    });
    const fake = createFakeAuthClient(fakeSession());
    const router = createMemoryRouter([{ path: '*', element: <App /> }], {
      initialEntries: ['/', `/documents/${DOCUMENT.id}`],
      initialIndex: 1,
    });
    render(
      <AuthProvider client={fake.client}>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete invoice-1023.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Confirm deleting invoice-1023.pdf' }));
    await screen.findByRole('heading', { level: 1, name: 'Documents' });

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/');
  });

  it.each([
    ['an unknown or foreign document (404)', 404],
    ['a malformed id (400)', 400],
  ])('shows not found for %s', async (_case, status) => {
    stubApi((url) =>
      url.startsWith('/api/v1/documents/')
        ? Response.json({ error: { code: 'X', message: 'Document not found' } }, { status })
        : undefined,
    );
    renderApp('/documents/whatever', fakeSession());

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Document not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to documents' })).toHaveAttribute(
      'href',
      '/documents',
    );
  });

  it('offers a retry when the document cannot load', async () => {
    let failures = 1;
    stubApi((url) => {
      if (url === DETAIL_URL && failures > 0) {
        failures -= 1;
        return apiErrorResponse(503);
      }
      if (url === DETAIL_URL) return Response.json(DOCUMENT);
      return undefined;
    });
    renderApp(`/documents/${DOCUMENT.id}`, fakeSession());
    const user = userEvent.setup();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Document unavailable' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'invoice-1023.pdf' }),
    ).toBeInTheDocument();
  });
});
