import { currentUserSchema, documentSchema } from '@documind/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeAuthClient, fakeSession } from '../test/fake-auth-client';
import { stubXhr, waitForRequest } from '../test/fake-xhr';
import { testDocument } from '../test/render-app';
import { ApiError, createApiClient, isAbortError, SessionExpiredError } from './api-client';

const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ada@example.test',
  displayName: null,
  createdAt: '2026-10-29T10:00:00.000Z',
};

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const unauthorized = () =>
  Response.json(
    { error: { code: 'UNAUTHORIZED', message: 'Access token expired' } },
    { status: 401 },
  );

function authorizationOf(
  fetchMock: ReturnType<typeof stubFetch>,
  call: number,
): string | undefined {
  const init = fetchMock.mock.calls[call]?.[1];
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

describe('createApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the access token and validates the response', async () => {
    const { client } = createFakeAuthClient(fakeSession('token-1'));
    const fetchMock = stubFetch(Response.json(USER));

    const user = await createApiClient(client).get('/me', currentUserSchema);

    expect(user).toEqual(USER);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/me');
    expect(authorizationOf(fetchMock, 0)).toBe('Bearer token-1');
  });

  it('refreshes the session once on a 401 and retries with the new token', async () => {
    const { client, mocks } = createFakeAuthClient(fakeSession('stale'));
    mocks.refreshSession.mockResolvedValueOnce({
      data: { session: fakeSession('fresh'), user: null },
      error: null,
    });
    const fetchMock = stubFetch(unauthorized(), Response.json(USER));

    await expect(createApiClient(client).get('/me', currentUserSchema)).resolves.toEqual(USER);

    expect(authorizationOf(fetchMock, 1)).toBe('Bearer fresh');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('signs out locally when the refreshed token is rejected too', async () => {
    const { client, mocks } = createFakeAuthClient(fakeSession());
    stubFetch(unauthorized(), unauthorized());

    await expect(createApiClient(client).get('/me', currentUserSchema)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('signs out locally when the session cannot be refreshed', async () => {
    const { client, mocks } = createFakeAuthClient(fakeSession());
    mocks.refreshSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: null,
    });
    const fetchMock = stubFetch(unauthorized());

    await expect(createApiClient(client).get('/me', currentUserSchema)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('does not call the API without a session', async () => {
    const { client } = createFakeAuthClient(null);
    const fetchMock = stubFetch();

    await expect(createApiClient(client).get('/me', currentUserSchema)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces other API errors without ending the session', async () => {
    const { client, mocks } = createFakeAuthClient(fakeSession());
    stubFetch(
      Response.json(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'An unexpected error occurred.' } },
        { status: 503 },
      ),
    );

    const error = await createApiClient(client)
      .get('/me', currentUserSchema)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('rejects a response that breaks the shared contract', async () => {
    const { client } = createFakeAuthClient(fakeSession());
    stubFetch(Response.json({ id: 'not-a-uuid' }));

    await expect(createApiClient(client).get('/me', currentUserSchema)).rejects.toThrow();
  });
});

describe('upload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pdf = () => new File(['%PDF-1.7'], 'invoice.pdf', { type: 'application/pdf' });

  it('posts the file as multipart with the token and reports progress', async () => {
    const requests = stubXhr();
    const { client } = createFakeAuthClient(fakeSession('token-1'));
    const progress: number[] = [];
    const file = pdf();

    const result = createApiClient(client).upload('/documents', file, documentSchema, {
      onProgress: (fraction) => progress.push(fraction),
    });
    const request0 = await waitForRequest(requests, 0);
    const xhr = request0;
    xhr.progress(50, 100);
    xhr.progress(100, 100);
    xhr.respond(201, testDocument());

    await expect(result).resolves.toEqual(testDocument());
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/v1/documents');
    expect(xhr.headers.Authorization).toBe('Bearer token-1');
    const sent = xhr.body?.get('file');
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe(file.name);
    expect((sent as File).size).toBe(file.size);
    expect(progress).toEqual([0.5, 1]);
  });

  it('refreshes once and re-sends the file after a 401', async () => {
    const requests = stubXhr();
    const { client, mocks } = createFakeAuthClient(fakeSession('stale'));
    mocks.refreshSession.mockResolvedValueOnce({
      data: { session: fakeSession('fresh'), user: null },
      error: null,
    });

    const result = createApiClient(client).upload('/documents', pdf(), documentSchema);
    const request0 = await waitForRequest(requests, 0);
    request0.respond(401, { error: { code: 'UNAUTHORIZED', message: 'Access token expired' } });
    const request1 = await waitForRequest(requests, 1);
    request1.respond(201, testDocument());

    await expect(result).resolves.toEqual(testDocument());
    expect(request1.headers.Authorization).toBe('Bearer fresh');
  });

  it("surfaces the API's rejection reason", async () => {
    const requests = stubXhr();
    const { client } = createFakeAuthClient(fakeSession());

    const result = createApiClient(client).upload('/documents', pdf(), documentSchema);
    const request0 = await waitForRequest(requests, 0);
    request0.respond(415, {
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: "The file's content is not a valid PDF file.",
      },
    });

    await expect(result).rejects.toEqual(
      new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', "The file's content is not a valid PDF file."),
    );
  });

  it('rejects with an AbortError when cancelled', async () => {
    const requests = stubXhr();
    const { client } = createFakeAuthClient(fakeSession());
    const controller = new AbortController();

    const result = createApiClient(client).upload('/documents', pdf(), documentSchema, {
      signal: controller.signal,
    });
    const request0 = await waitForRequest(requests, 0);
    controller.abort();

    const error = await result.catch((caught: unknown) => caught);
    expect(isAbortError(error)).toBe(true);
    expect(request0.aborted).toBe(true);
  });

  it('rejects with a TypeError on a network failure', async () => {
    const requests = stubXhr();
    const { client } = createFakeAuthClient(fakeSession());

    const result = createApiClient(client).upload('/documents', pdf(), documentSchema);
    const request0 = await waitForRequest(requests, 0);
    request0.fail();

    await expect(result).rejects.toBeInstanceOf(TypeError);
  });
});

describe('delete', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends DELETE with the token and accepts 204', async () => {
    const { client } = createFakeAuthClient(fakeSession('token-1'));
    const fetchMock = stubFetch(new Response(null, { status: 204 }));

    await createApiClient(client).delete('/documents/abc');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/documents/abc');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
    expect(authorizationOf(fetchMock, 0)).toBe('Bearer token-1');
  });

  it('throws ApiError for a 404', async () => {
    const { client } = createFakeAuthClient(fakeSession());
    stubFetch(
      Response.json(
        { error: { code: 'NOT_FOUND', message: 'Document not found' } },
        { status: 404 },
      ),
    );

    await expect(createApiClient(client).delete('/documents/abc')).rejects.toMatchObject({
      status: 404,
    });
  });
});
