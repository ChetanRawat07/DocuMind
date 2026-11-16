import { ArrowRight } from 'lucide-react';
import { type SubmitEvent, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/use-auth';
import { signInErrorMessage } from '../auth/auth-errors';
import { FormAlert, INPUT_CLASS } from '../components/form-controls';
import { LoginShowcase } from '../components/login-showcase';
import { BrandMark } from '../components/ui/brand-mark';
import { Button } from '../components/ui/button';
import { cx } from '../lib/cx';
import { afterMotion, nudge } from '../lib/motion';

export function LoginPage() {
  const { client, status } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);

  // While a submit is in flight or the card fades out, this page navigates itself.
  if (status === 'signed_in' && !busy && !leaving) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await client.signInWithPassword({ email, password });
    if (result.error) {
      setBusy(false);
      setError(signInErrorMessage(result.error));
      nudge(passwordInput.current);
      return;
    }
    setLeaving(true);
    await afterMotion(150);
    // Every sign-in opens the dashboard; the view transition crossfades into it (index.css).
    await navigate('/', { replace: true, viewTransition: true });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(440px,0.82fr)_1.18fr]">
      <title>Sign in · DocuMind</title>
      <main className="flex min-h-screen flex-col bg-paper px-5.5 pt-6 pb-5 sm:px-12 sm:pt-9 xl:px-22">
        <header className="flex items-center justify-between gap-4">
          <BrandMark className="font-display text-base font-extrabold tracking-[-0.03em]" />
          <p className="text-xs text-fg-muted">
            New here?{' '}
            <Link to="/signup" viewTransition className="font-semibold text-fg hover:underline">
              Create account
            </Link>
          </p>
        </header>

        <div className="auth-card m-auto w-full max-w-[390px] py-14">
          <div data-leaving={leaving || undefined}>
            <div className="auth-head">
              <p className="mb-5 font-label text-xs tracking-[0.12em] text-accent-fg uppercase">
                Document intelligence platform
              </p>
              <h1 className="mb-3.5 font-display text-[clamp(2.125rem,3.2vw,2.75rem)] leading-[1.08] font-bold tracking-[-0.045em] text-fg">
                Good to see <br />
                you again.
              </h1>
              <p className="mb-9 max-w-[340px] text-sm leading-relaxed text-fg-muted">
                Sign in to your workspace and keep your documents moving.
              </p>
            </div>
            <form
              onSubmit={(event) => {
                void handleSubmit(event);
              }}
              className="space-y-5"
            >
              {error ? <FormAlert tone="error">{error}</FormAlert> : null}
              <div>
                <label htmlFor="login-email" className="mb-2 block text-xs font-bold text-fg">
                  Work email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@company.com"
                  required
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                  className={cx(INPUT_CLASS, 'h-12 px-3.5')}
                />
              </div>
              <div>
                <label htmlFor="login-password" className="mb-2 block text-xs font-bold text-fg">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    ref={passwordInput}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    required
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                    }}
                    className={cx(INPUT_CLASS, 'h-12 pr-16 pl-3.5')}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => {
                      setShowPassword((shown) => !shown);
                    }}
                    className="absolute inset-y-0 right-0 rounded-r-lg px-3.5 text-xs font-semibold text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <p className="-mt-1 text-right text-xs">
                <Link
                  to="/forgot-password"
                  viewTransition
                  className="font-semibold text-accent-fg hover:underline"
                >
                  Forgot password?
                </Link>
              </p>
              <Button type="submit" loading={busy} className="h-12 w-full font-bold">
                {busy ? 'Signing in…' : 'Sign in'}
                {busy ? null : <ArrowRight aria-hidden="true" className="size-4" />}
              </Button>
            </form>
          </div>
        </div>

        <footer className="text-xs text-fg-muted">© {new Date().getFullYear()} DocuMind</footer>
      </main>
      <LoginShowcase />
    </div>
  );
}
