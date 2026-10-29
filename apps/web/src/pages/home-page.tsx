import {
  type CurrentUser,
  currentUserSchema,
  type DocumentListResponse,
  documentListResponseSchema,
} from '@documind/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/use-auth';
import { ApiStatusIndicator } from '../components/api-status';
import { SessionExpiredError } from '../services/api-client';
import { useApi } from '../services/use-api';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; user: CurrentUser; documents: DocumentListResponse };

/**
 * Minimal signed-in page proving the authenticated API path end to end.
 * Phase 3 replaces it with the dashboard shell.
 */
export function HomePage() {
  const { client } = useAuth();
  const api = useApi();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    // /me first: it provisions the user record on the first visit.
    api
      .get('/me', currentUserSchema, options)
      .then(async (user) => {
        const documents = await api.get('/documents', documentListResponseSchema, options);
        setState({ status: 'loaded', user, documents });
      })
      .catch((error: unknown) => {
        // SessionExpiredError: already signed out; the route guard redirects.
        if (!controller.signal.aborted && !(error instanceof SessionExpiredError)) {
          setState({ status: 'error' });
        }
      });
    return () => {
      controller.abort();
    };
  }, [api]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">DocuMind</h1>
          <button
            type="button"
            onClick={() => void client.signOut({ scope: 'local' })}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Sign out
          </button>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {state.status === 'loading' ? (
            <p role="status" className="text-sm text-slate-600">
              Loading your workspace…
            </p>
          ) : state.status === 'error' ? (
            <p role="alert" className="text-sm text-red-700">
              Could not load your workspace. Please try again later.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                Signed in as{' '}
                <span className="font-medium text-slate-900">
                  {state.user.displayName ?? state.user.email}
                </span>
              </p>
              <h2 className="mt-6 text-base font-semibold">Your documents</h2>
              {state.documents.items.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No documents yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100">
                  {state.documents.items.map((document) => (
                    <li key={document.id} className="flex justify-between py-2 text-sm">
                      <span>{document.originalFilename}</span>
                      <span className="text-slate-500">{document.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <ApiStatusIndicator />
      </div>
    </main>
  );
}
