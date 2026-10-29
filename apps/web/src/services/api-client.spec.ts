import { currentUserSchema } from '@documind/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeAuthClient, fakeSession } from '../test/fake-auth-client';
import { ApiError, createApiClient, SessionExpiredError } from './api-client';

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
