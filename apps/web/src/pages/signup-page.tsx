import { type SubmitEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/use-auth';
import { signUpErrorMessage } from '../auth/auth-errors';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password-policy';
import { AuthCard } from '../components/auth-card';
import { FormAlert, SubmitButton, TextField } from '../components/form-controls';

export function SignupPage() {
  const { client, status } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);

  if (status === 'signed_in') {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const trimmedName = displayName.trim();
    const result = await client.signUp({
      email,
      password,
      options: {
        ...(trimmedName ? { data: { display_name: trimmedName } } : {}),
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    setBusy(false);
    if (result.error) {
      setError(signUpErrorMessage(result.error));
      return;
    }
    // With email confirmation on, Supabase returns no session (and the same
    // response for an already registered email, so it cannot be probed).
    if (result.data.session) {
      await navigate('/', { replace: true });
    } else {
      setAwaitingConfirmation(true);
    }
  }

  if (awaitingConfirmation) {
    return (
      <AuthCard title="Check your email">
        <FormAlert tone="success">
          We sent a confirmation link to {email}. Open it to activate your account, then sign in.
        </FormAlert>
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="font-medium text-blue-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-blue-700 hover:underline">
            Sign in
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
          label="Name (optional)"
          autoComplete="name"
          maxLength={100}
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <SubmitButton busy={busy}>{busy ? 'Creating account…' : 'Create account'}</SubmitButton>
      </form>
    </AuthCard>
  );
}
