import { Fragment, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { Spinner } from '../components/ui/feedback';
import { useAuth } from './use-auth';

/**
 * Renders children only for a signed-in user; otherwise redirects to the
 * login page, and the next sign-in opens the dashboard. This is a UX boundary,
 * not a security one: the API rejects unauthenticated requests on its own.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, session } = useAuth();

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (status === 'signed_out') {
    return <Navigate to="/login" replace />;
  }
  // Keyed by user: another account signing in (in another tab) remounts every page, so none keeps the last user's data.
  return <Fragment key={session?.user.id}>{children}</Fragment>;
}
