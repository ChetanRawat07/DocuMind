import { type SubmitEvent, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/use-auth';
import { passwordUpdateErrorMessage } from '../auth/auth-errors';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password-policy';
import { AuthCard } from '../components/auth-card';
import { FormAlert, SubmitButton, TextField } from '../components/form-controls';
import { afterMotion, nudge } from '../lib/motion';

/**
 * Target of the reset email. supabase-js exchanges the link's one-time code
 * for a short recovery session, which is what authorizes the password change.
 */
export function ResetPasswordPage() {
  const { client, status } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);

  if (status === 'loading') {
    return (
      <AuthCard title="Reset your password">
        <p role="status" className="text-sm text-fg-secondary">
          Checking your reset link…
        </p>
      </AuthCard>
    );
  }

  if (status === 'signed_out') {
    return (
      <AuthCard title="Link expired">
        <FormAlert tone="error">This reset link is invalid or has expired.</FormAlert>
        <p className="mt-4 text-center text-sm">
          <Link
            to="/forgot-password"
            viewTransition
            className="font-medium text-accent-fg hover:underline"
          >
            Request a new link
          </Link>
        </p>
      </AuthCard>
    );
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await client.updateUser({ password });
    if (result.error) {
      setBusy(false);
      setError(passwordUpdateErrorMessage(result.error));
      nudge(passwordInput.current);
      return;
    }
    setLeaving(true);
    await afterMotion(150);
    await navigate('/', { replace: true });
  }

  return (
    <AuthCard title="Choose a new password" leaving={leaving}>
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="space-y-4"
      >
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <TextField
          label="New password"
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
        <SubmitButton busy={busy}>{busy ? 'Saving…' : 'Save password'}</SubmitButton>
      </form>
    </AuthCard>
  );
}
