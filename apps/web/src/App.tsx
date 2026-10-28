import { useEffect, useState } from 'react';
import { fetchApiHealth } from './services/api-health';

type ApiStatus = 'checking' | 'online' | 'offline';

const STATUS_LABEL: Record<ApiStatus, string> = {
  checking: 'Checking API…',
  online: 'API online',
  offline: 'API unreachable',
};

const STATUS_DOT_CLASS: Record<ApiStatus, string> = {
  checking: 'bg-slate-400',
  online: 'bg-emerald-500',
  offline: 'bg-red-500',
};

/**
 * Phase 0 placeholder that proves the toolchain end to end (React, Tailwind,
 * shared contracts, API proxy). The product UI is built in Phase 3.
 */
export function App() {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetchApiHealth(controller.signal)
      .then(() => {
        setStatus('online');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('offline');
      });
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">DocuMind</h1>
        <p className="mt-2 text-sm text-slate-600">AI document intelligence platform</p>
        <p className="mt-6 flex items-center gap-2 text-sm" role="status" aria-live="polite">
          <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOT_CLASS[status]}`} />
          {STATUS_LABEL[status]}
        </p>
      </div>
    </main>
  );
}
