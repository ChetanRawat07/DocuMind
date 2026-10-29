import { type SubmitEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/use-auth';
import { signInErrorMessage } from '../auth/auth-errors';
import { safeRedirectPath } from '../auth/safe-redirect';
import { AuthCard } from '../components/auth-card';
import { FormAlert, SubmitButton, TextField } from '../components/form-controls';

export function LoginPage() {
  const { client, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = safeRedirectPath((location.state as { from?: unknown } | null)?.from);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signed_in') {
    return <Navigate to={destination} replace />;
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await client.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) {
      setError(signInErrorMessage(result.error));
      return;
    }
    await navigate(destination, { replace: true });
  }

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          No account?{' '}
          <Link to="/signup" className="font-medium text-blue-700 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="space-y-4"
      >
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <SubmitButton busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</SubmitButton>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-blue-700 hover:underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
