import { type SubmitEvent, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/use-auth';
import { signUpErrorMessage } from '../auth/auth-errors';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_STRENGTH_LABELS,
  passwordStrength,
} from '../auth/password-policy';
import { AuthCard } from '../components/auth-card';
import { FormAlert, SubmitButton, TextField } from '../components/form-controls';
import { cx } from '../lib/cx';
import { afterMotion, nudge } from '../lib/motion';

/** Four bars and a word; shown once something is typed. */
function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const strength = passwordStrength(password);
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden="true" className="grid flex-1 grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={cx(
              'h-1 rounded-full transition-colors duration-150',
              bar > strength
                ? 'bg-surface-muted'
                : strength === 1
                  ? 'bg-danger-fg'
                  : strength === 2
                    ? 'bg-warning-fg'
                    : 'bg-success-fg',
            )}
          />
        ))}
      </div>
      <p className="w-28 text-right text-xs text-fg-muted">
        Strength: {PASSWORD_STRENGTH_LABELS[strength]}
      </p>
    </div>
  );
}

export function SignupPage() {
  const { client, status } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);

  // While a submit is in flight or the card fades out, this page navigates itself.
  if (status === 'signed_in' && !busy && !leaving) {
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
    if (result.error) {
      setBusy(false);
      setError(signUpErrorMessage(result.error));
      nudge(passwordInput.current);
      return;
    }
    // With email confirmation on, Supabase returns no session (and the same
    // response for an already registered email, so it cannot be probed).
    if (result.data.session) {
      setLeaving(true);
      await afterMotion(150);
      await navigate('/', { replace: true });
    } else {
      setBusy(false);
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
          <Link to="/login" viewTransition className="font-medium text-accent-fg hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      leaving={leaving}
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" viewTransition className="font-medium text-accent-fg hover:underline">
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
          ref={passwordInput}
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
        <PasswordStrength password={password} />
        <SubmitButton busy={busy}>{busy ? 'Creating account…' : 'Create account'}</SubmitButton>
      </form>
    </AuthCard>
  );
}
