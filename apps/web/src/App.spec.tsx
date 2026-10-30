import { AuthApiError } from '@supabase/supabase-js';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from './test/fake-auth-client';
import { renderApp, stubApi } from './test/render-app';

/** The dashboard greets the user by name once GET /me has loaded. */
async function findDashboard() {
  return screen.findByRole('heading', { level: 1, name: /, Ada$/ });
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

    expect(await findDashboard()).toBeInTheDocument();
    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
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

    expect(await findDashboard()).toBeInTheDocument();
    expect(fake.mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
  });

  it('ignores an off-site redirect target after sign-in', async () => {
    renderApp('/login', fakeSession(), { from: '//evil.test' });

    expect(await findDashboard()).toBeInTheDocument();
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

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(fake.mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('returns to the login page when the session ends elsewhere (expiry, other tab)', async () => {
    const fake = renderApp('/', fakeSession());
    await findDashboard();

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
    expect(await findDashboard()).toBeInTheDocument();
  });
});
