import { AuthApiError, type Session } from '@supabase/supabase-js';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth/auth-context';
import { createFakeAuthClient, fakeSession } from './test/fake-auth-client';

const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ada@example.test',
  displayName: 'Ada',
  createdAt: '2026-10-29T10:00:00.000Z',
};

/** Answers the API calls the signed-in page makes. */
function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = input;
      if (url === '/api/v1/me') return Promise.resolve(Response.json(USER));
      if (url === '/api/v1/documents') {
        return Promise.resolve(Response.json({ items: [], nextCursor: null }));
      }
      return Promise.resolve(
        Response.json({ status: 'ok', timestamp: '2026-10-29T10:00:00.000Z' }),
      );
    }),
  );
}

function renderApp(path: string, session: Session | null = null, state?: unknown) {
  const fake = createFakeAuthClient(session);
  render(
    <AuthProvider client={fake.client}>
      <MemoryRouter initialEntries={[{ pathname: path.split('?')[0] ?? path, state }]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  );
  return fake;
}

describe('App routing and authentication flows', () => {
  beforeEach(() => {
    stubApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a signed-out visitor from a protected page to the login page', async () => {
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the workspace to a signed-in user and loads their identity from the API', async () => {
    renderApp('/', fakeSession());

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('No documents yet.')).toBeInTheDocument();
  });

  it('signs in and returns the user to the page they wanted', async () => {
    const fake = renderApp('/login', null, { from: '/' });
    fake.mocks.signInWithPassword.mockImplementation(() => {
      fake.emit('SIGNED_IN', fakeSession());
      return Promise.resolve({ data: {}, error: null });
    });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(fake.mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
  });

  it('ignores an off-site redirect target after sign-in', async () => {
    renderApp('/login', fakeSession(), { from: '//evil.test' });

    expect(await screen.findByText('Ada')).toBeInTheDocument();
  });

  it('shows one generic message for wrong credentials', async () => {
    const fake = renderApp('/login');
    fake.mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('returns to the login page after signing out', async () => {
    const fake = renderApp('/', fakeSession());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(fake.mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('returns to the login page when the session ends elsewhere (expiry, other tab)', async () => {
    const fake = renderApp('/', fakeSession());
    await screen.findByText('Ada');

    act(() => {
      fake.emit('SIGNED_OUT', null);
    });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('asks the user to confirm their email when sign-up returns no session', async () => {
    const fake = renderApp('/signup');
    fake.mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name (optional)'), '  Ada  ');
    await user.type(screen.getByLabelText('Email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(fake.mocks.signUp).toHaveBeenCalledWith({
      email: 'ada@example.test',
      password: 'correct horse battery',
      options: {
        data: { display_name: 'Ada' },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
  });

  it('gives the same answer for a password reset whether or not the request failed', async () => {
    const fake = renderApp('/forgot-password');
    fake.mocks.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: new AuthApiError('User not found', 400, 'user_not_found'),
    });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'nobody@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'If an account exists for nobody@example.test',
    );
  });

  it('explains that a reset link without a recovery session has expired', async () => {
    renderApp('/reset-password');

    expect(await screen.findByRole('heading', { name: 'Link expired' })).toBeInTheDocument();
  });

  it('lets a recovery session set a new password', async () => {
    const fake = renderApp('/reset-password', fakeSession());
    fake.mocks.updateUser.mockResolvedValue({ data: { user: null }, error: null });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('New password'), 'a new long password');
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(fake.mocks.updateUser).toHaveBeenCalledWith({ password: 'a new long password' });
    expect(await screen.findByText('Ada')).toBeInTheDocument();
  });
});
