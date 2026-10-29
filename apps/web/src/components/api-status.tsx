import { useEffect, useState } from 'react';
import { fetchApiHealth } from '../services/api-health';

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

/** Liveness indicator; validates the response against the shared health contract. */
export function ApiStatusIndicator() {
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
    <p className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
      <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOT_CLASS[status]}`} />
      {STATUS_LABEL[status]}
    </p>
  );
}
