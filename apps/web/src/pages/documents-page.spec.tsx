import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../test/fake-auth-client';
import { stubXhr, waitForRequest } from '../test/fake-xhr';
import { apiErrorResponse, renderApp, stubApi, testDocument } from '../test/render-app';
import { DOCUMENTS_PAGE_SIZE } from './documents-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

const pdf = (name = 'invoice-1023.pdf') =>
  new File(['%PDF-1.7'], name, { type: 'application/pdf' });

function listResponse(items: ReturnType<typeof testDocument>[], nextCursor: string | null = null) {
  return Response.json({ items, nextCursor });
}

async function renderDocuments(handle: Parameters<typeof stubApi>[0] = () => undefined) {
  const fetchMock = stubApi(handle);
  const requests = stubXhr();
  const fake = renderApp('/documents', fakeSession());
  await screen.findByRole('heading', { level: 1, name: 'Documents' });
  return { fetchMock, requests, fake };
}

/** The file input sits behind the "Choose files" button. */
function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input;
}

describe('DocumentsPage', () => {
  describe('upload', () => {
    it('uploads a chosen file with progress and adds it to the list', async () => {
      const { requests } = await renderDocuments();
      const user = userEvent.setup();
      expect(await screen.findByText('No documents yet')).toBeInTheDocument();

      await user.upload(fileInput(), pdf());
      const request = await waitForRequest(requests, 0);
      request.progress(25, 100);

      const progress = await screen.findByRole('progressbar', {
        name: 'Uploading invoice-1023.pdf',
      });
      expect(progress).toHaveAttribute('aria-valuenow', '25');

      request.respond(201, testDocument({ status: 'uploaded' }));

      const uploads = screen.getByRole('list', { name: 'Uploads' });
      expect(await within(uploads).findByText('Uploaded')).toBeInTheDocument();
      const table = await screen.findByRole('table', { name: 'Your documents' });
      expect(within(table).getByText('invoice-1023.pdf')).toBeInTheDocument();
      expect(screen.queryByText('No documents yet')).not.toBeInTheDocument();
    });

    it('limits the file picker to the allowed types and allows several files', async () => {
      await renderDocuments();

      expect(fileInput()).toHaveAttribute('accept', '.pdf,.png,.jpg,.jpeg');
      expect(fileInput()).toHaveAttribute('multiple');
      expect(screen.getByText('PDF, PNG, or JPEG, up to 10 MB each')).toBeInTheDocument();
    });

    it('rejects an unsupported file before sending it', async () => {
      const { requests } = await renderDocuments();
      const user = userEvent.setup({ applyAccept: false });

      await user.upload(fileInput(), new File(['MZ'], 'setup.exe'));

      expect(
        await screen.findByText('Unsupported file type. Upload a PDF, PNG, or JPEG file.'),
      ).toBeInTheDocument();
      expect(requests).toHaveLength(0);
    });

    it("shows the API's reason when it rejects a file, and retries on request", async () => {
      const { requests } = await renderDocuments();
      const user = userEvent.setup();

      await user.upload(fileInput(), pdf('fake.pdf'));
      (await waitForRequest(requests, 0)).respond(415, {
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: "The file's content is not a valid PDF file.",
        },
      });

      expect(
        await screen.findByText("The file's content is not a valid PDF file."),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry fake.pdf' }));
      expect(await waitForRequest(requests, 1)).toBeDefined();
    });

    it('cancels an upload in progress', async () => {
      const { requests } = await renderDocuments();
      const user = userEvent.setup();

      await user.upload(fileInput(), pdf());
      const request = await waitForRequest(requests, 0);
      await user.click(await screen.findByRole('button', { name: 'Cancel invoice-1023.pdf' }));

      expect(request.aborted).toBe(true);
      expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    });

    it('accepts files dropped onto the drop area', async () => {
      const { requests } = await renderDocuments();
      const dropArea = screen.getByText('Drag files here').closest('div');
      if (!dropArea) throw new Error('drop area not found');
      const dataTransfer = { files: [pdf('dropped.pdf')], types: ['Files'] };

      fireEvent.dragOver(dropArea, { dataTransfer });
      expect(screen.getByText('Drop to upload')).toBeInTheDocument();
      fireEvent.drop(dropArea, { dataTransfer });

      const request = await waitForRequest(requests, 0);
      expect((request.body?.get('file') as File).name).toBe('dropped.pdf');
    });

    it('announces progress of the batch to screen readers', async () => {
      const { requests } = await renderDocuments();
      const user = userEvent.setup({ applyAccept: false });

      await user.upload(fileInput(), [pdf('a.pdf'), new File(['x'], 'b.exe')]);
      (await waitForRequest(requests, 0)).respond(201, testDocument());

      await waitFor(() => {
        expect(screen.getByText('1 uploaded, 1 with problems, 0 remaining.')).toBeInTheDocument();
      });
    });
  });

  describe('list', () => {
    it('shows each document with its size', async () => {
      await renderDocuments((url, init) =>
        url.startsWith('/api/v1/documents') && !init?.method
          ? listResponse([testDocument({ sizeBytes: 1536 })])
          : undefined,
      );

      const table = await screen.findByRole('table', { name: 'Your documents' });
      expect(within(table).getByText('1.5 KB')).toBeInTheDocument();
    });

    it('loads more documents with the cursor', async () => {
      const { fetchMock } = await renderDocuments((url) => {
        if (url === `/api/v1/documents?limit=${DOCUMENTS_PAGE_SIZE}`) {
          return listResponse([testDocument()], 'cursor/1+=');
        }
        if (url.includes('cursor=')) {
          return listResponse([
            testDocument({
              id: '00000000-0000-4000-8000-0000000000d9',
              originalFilename: 'older.pdf',
            }),
          ]);
        }
        return undefined;
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Load more' }));

      expect(await screen.findByText('older.pdf')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/documents?limit=${DOCUMENTS_PAGE_SIZE}&cursor=cursor%2F1%2B%3D`,
        expect.anything(),
      );
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });

    it('shows an error with retry when the list cannot load', async () => {
      let failures = 1;
      await renderDocuments((url) => {
        if (url.startsWith('/api/v1/documents') && failures > 0) {
          failures -= 1;
          return apiErrorResponse(503);
        }
        return undefined;
      });
      const user = userEvent.setup();

      const alert = await screen.findByRole('alert');
      await user.click(within(alert).getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    });
  });

  describe('delete', () => {
    function withOneDocument(deleteResponse: () => Response) {
      return renderDocuments((url, init) => {
        if (init?.method === 'DELETE') return deleteResponse();
        if (url.startsWith('/api/v1/documents')) return listResponse([testDocument()]);
        return undefined;
      });
    }

    it('asks for confirmation, then deletes and removes the row', async () => {
      const { fetchMock } = await withOneDocument(() => new Response(null, { status: 204 }));
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Delete invoice-1023.pdf' }));
      const confirm = screen.getByRole('button', { name: 'Confirm deleting invoice-1023.pdf' });
      expect(confirm).toHaveFocus();
      await user.click(confirm);

      expect(await screen.findByText('No documents yet')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/documents/${testDocument().id}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('keeps the document when the user cancels', async () => {
      const { fetchMock } = await withOneDocument(() => new Response(null, { status: 204 }));
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Delete invoice-1023.pdf' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.getByText('invoice-1023.pdf')).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    });

    it('reports a failed delete and keeps the row', async () => {
      await withOneDocument(() => apiErrorResponse(500));
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Delete invoice-1023.pdf' }));
      await user.click(screen.getByRole('button', { name: 'Confirm deleting invoice-1023.pdf' }));

      expect(await screen.findByText('Could not delete.')).toBeInTheDocument();
      expect(screen.getByText('invoice-1023.pdf')).toBeInTheDocument();
    });

    it('treats a 404 as already deleted', async () => {
      await withOneDocument(() =>
        Response.json(
          { error: { code: 'NOT_FOUND', message: 'Document not found' } },
          { status: 404 },
        ),
      );
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Delete invoice-1023.pdf' }));
      await user.click(screen.getByRole('button', { name: 'Confirm deleting invoice-1023.pdf' }));

      expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    });
  });

  it('is reachable from the Upload button in the top bar', async () => {
    stubApi();
    renderApp('/', fakeSession());

    expect(await screen.findByRole('link', { name: 'Upload' })).toHaveAttribute(
      'href',
      '/documents#upload',
    );
  });
});
