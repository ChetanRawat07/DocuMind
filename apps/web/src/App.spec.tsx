import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function mockFetchResponse(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(body, { status }))),
  );
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the API as online when the health contract is satisfied', async () => {
    mockFetchResponse({ status: 'ok', timestamp: '2026-10-26T10:00:00.000Z' });

    render(<App />);

    expect(await screen.findByText('API online')).toBeInTheDocument();
  });

  it('shows the API as unreachable on an HTTP error', async () => {
    mockFetchResponse({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'x' } }, 500);

    render(<App />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });

  it('treats a response that breaks the shared contract as unreachable', async () => {
    mockFetchResponse({ status: 'ok' });

    render(<App />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });

  it('shows the API as unreachable on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    render(<App />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });
});
