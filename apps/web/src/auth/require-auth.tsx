import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './use-auth';

/**
 * Renders children only for a signed-in user; otherwise redirects to the
 * login page, remembering where the user was going. This is a UX boundary,
 * not a security one: the API rejects unauthenticated requests on its own.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <p role="status" className="p-8 text-sm text-slate-600">
        Loading…
      </p>
    );
  }
  if (status === 'signed_out') {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return children;
}
