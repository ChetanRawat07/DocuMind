import { type SubmitEvent, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/use-auth';
import { AuthCard } from '../components/auth-card';
import { FormAlert, SubmitButton, TextField } from '../components/form-controls';

export function ForgotPasswordPage() {
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    await client.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    // The same message whether or not the email is registered (or the request
    // failed), so this page cannot be used to discover accounts.
    setSent(true);
  }

  return (
    <AuthCard
      title="Reset your password"
      footer={
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <FormAlert tone="success">
          If an account exists for {email}, we sent a link to reset its password. The link works
          once, in this browser.
        </FormAlert>
      ) : (
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="space-y-4"
        >
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
          <SubmitButton busy={busy}>{busy ? 'Sending…' : 'Send reset link'}</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
