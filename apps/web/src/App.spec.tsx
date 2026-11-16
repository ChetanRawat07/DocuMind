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

/** Signs in through the login form, with the fake client accepting the password. */
async function signIn(fake: ReturnType<typeof renderApp>) {
  fake.mocks.signInWithPassword.mockImplementation(() => {
    fake.emit('SIGNED_IN', fakeSession());
    return Promise.resolve({ data: {}, error: null });
  });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Work email'), 'ada@example.test');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
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

    expect(
      await screen.findByRole('heading', { name: 'Good to see you again.' }),
    ).toBeInTheDocument();
  });

  it('shows the workspace to a signed-in user and loads their identity from the API', async () => {
    renderApp('/', fakeSession());

    expect(await findDashboard()).toBeInTheDocument();
    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
  });

  it('signs in and opens the dashboard', async () => {
    const fake = renderApp('/login');
    fake.mocks.signInWithPassword.mockImplementation(() => {
      fake.emit('SIGNED_IN', fakeSession());
      return Promise.resolve({ data: {}, error: null });
    });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Work email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await findDashboard()).toBeInTheDocument();
    expect(fake.mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
  });

  it('opens the dashboard, not the page the session ended on, after sign-in', async () => {
    const fake = renderApp('/settings');
    await screen.findByRole('heading', { name: 'Good to see you again.' });

    await signIn(fake);
    expect(await findDashboard()).toBeInTheDocument();
    expect(fake.router.state.location.pathname).toBe('/');
  });

  it('shows one generic message for wrong credentials', async () => {
    const fake = renderApp('/login');
    fake.mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Work email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('shows and hides the password on the login page', async () => {
    renderApp('/login');
    const user = userEvent.setup();
    const password = await screen.findByLabelText('Password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('returns to the login page after signing out', async () => {
    const fake = renderApp('/', fakeSession());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(fake.mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(
      await screen.findByRole('heading', { name: 'Good to see you again.' }),
    ).toBeInTheDocument();
    expect(fake.router.state.location.state).toBeNull();
  });

  it('opens the dashboard on the next sign-in after signing out from settings', async () => {
    const fake = renderApp('/settings', fakeSession());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Good to see you again.' });
    expect(fake.router.state.location).toMatchObject({ pathname: '/login', state: null });

    await signIn(fake);
    expect(await findDashboard()).toBeInTheDocument();
  });

  it('opens the dashboard on sign-in after the session expires on another page', async () => {
    const fake = renderApp('/settings', fakeSession());
    await screen.findByRole('heading', { level: 1, name: 'Settings' });

    act(() => {
      fake.emit('SIGNED_OUT', null);
    });
    await screen.findByRole('heading', { name: 'Good to see you again.' });

    await signIn(fake);
    expect(await findDashboard()).toBeInTheDocument();
  });

  it('returns to the login page when the session ends elsewhere (expiry, other tab)', async () => {
    const fake = renderApp('/', fakeSession());
    await findDashboard();

    act(() => {
      fake.emit('SIGNED_OUT', null);
    });

    expect(
      await screen.findByRole('heading', { name: 'Good to see you again.' }),
    ).toBeInTheDocument();
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
