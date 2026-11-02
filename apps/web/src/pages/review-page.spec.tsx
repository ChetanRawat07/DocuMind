import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../test/fake-auth-client';
import { renderApp, stubApi, testDocument } from '../test/render-app';

const QUEUE_URL = '/api/v1/documents?status=needs_review&sort=oldest&limit=20';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReviewPage', () => {
  it('lists documents waiting for review, oldest first, each linking to its review', async () => {
    const waiting = testDocument({ status: 'needs_review', originalFilename: 'po-7781.pdf' });
    const fetchMock = stubApi((url) =>
      url === QUEUE_URL ? Response.json({ items: [waiting], nextCursor: null }) : undefined,
    );

    renderApp('/review', fakeSession());

    const table = await screen.findByRole('table', {
      name: 'Documents waiting for review, oldest first',
    });
    expect(within(table).getByText('po-7781.pdf')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review po-7781.pdf' })).toHaveAttribute(
      'href',
      `/documents/${waiting.id}`,
    );
    expect(fetchMock.mock.calls.some(([url]) => url === QUEUE_URL)).toBe(true);
  });

  it('says when nothing is waiting', async () => {
    stubApi();

    renderApp('/review', fakeSession());

    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
  });
});
