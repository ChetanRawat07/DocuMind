import { Check } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { cx } from '../lib/cx';
import { prefersMotion } from '../lib/motion';
import { BrandMark } from './ui/brand-mark';
import { Card } from './ui/card';

/**
 * Card for a signed-out page, inside AuthLayout. `leaving` fades it out
 * before the page navigates away after a successful submit (index.css).
 */
export function AuthCard({
  title,
  children,
  footer,
  leaving = false,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  leaving?: boolean;
}) {
  return (
    <div data-leaving={leaving || undefined}>
      <title>{`${title} · DocuMind`}</title>
      <Card className="p-6 sm:p-8">
        <div className="auth-head">
          <BrandMark />
          <h1 className="mt-6 text-2xl font-semibold tracking-[-0.01em] text-fg">{title}</h1>
        </div>
        <div className="mt-6">{children}</div>
      </Card>
      {footer ? <div className="mt-4 text-center text-sm text-fg-secondary">{footer}</div> : null}
    </div>
  );
}

/**
 * Signed-out layout: the card centred, beside a brand panel from 1024px.
 * It stays mounted between the signed-out pages, so the card's entrance
 * (index.css, `.auth-card`) plays for the first page only; moving between
 * pages is a crossfade (a view transition) that leaves the brand panel still.
 */
export function AuthLayout() {
  const { pathname } = useLocation();
  // Null once the user has moved to another page: later pages skip the entrance.
  const [firstPath, setFirstPath] = useState<string | null>(pathname);
  if (firstPath !== null && pathname !== firstPath) setFirstPath(null);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <main className="flex items-center justify-center px-4 py-8">
        <div
          className="auth-card w-full max-w-[400px]"
          data-entered={firstPath === null || undefined}
        >
          <Outlet />
        </div>
      </main>
      <div
        aria-hidden="true"
        className="hidden items-center justify-center border-l border-line bg-accent-subtle p-12 [view-transition-name:auth-brand] lg:flex"
      >
        <InvoiceVignette />
      </div>
    </div>
  );
}

const VIGNETTE_FIELDS = [
  { label: 'Invoice number', value: 'INV-2041', confidence: '99%' },
  { label: 'Vendor', value: 'Northwind Supplies', confidence: '97%' },
  { label: 'Invoice date', value: '14 Oct 2026', confidence: '95%' },
  { label: 'Due date', value: '13 Nov 2026', confidence: '91%' },
  { label: 'Total', value: '$4,280.00', confidence: '98%' },
] as const;

/** One step every 1.2s; 8 steps make the ~10s loop (5 fields, then a pause). */
const STEP_MS = 1200;
const STEPS = 8;

/**
 * A mock invoice whose fields light up one by one, each getting a
 * confidence chip and then a "Confirmed" check. Decorative. Reduced motion
 * shows every field confirmed, without the loop.
 */
function InvoiceVignette() {
  const [step, setStep] = useState(() => (prefersMotion() ? 0 : STEPS));
  useEffect(() => {
    if (!prefersMotion()) return;
    const timer = setInterval(() => {
      setStep((previous) => (previous + 1) % STEPS);
    }, STEP_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
      <div className="flex items-start justify-between border-b border-line-subtle pb-4">
        <div>
          <p className="text-sm font-semibold text-fg">Invoice</p>
          <p className="mt-1 text-xs text-fg-muted">Northwind Supplies Ltd.</p>
        </div>
        <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-fg-secondary">
          PDF
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {VIGNETTE_FIELDS.map((field, index) => {
          const found = index < step;
          const confirmed = index < step - 1;
          return (
            <li key={field.label} className="relative flex items-center gap-3 px-2 py-2.5">
              <span
                className={cx(
                  'absolute inset-0 rounded-md bg-accent-subtle ring-1 ring-info-line transition-opacity duration-300',
                  found ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span className="relative min-w-0 flex-1">
                <span className="block text-xs text-fg-muted">{field.label}</span>
                <span className="block truncate text-compact font-medium text-fg">
                  {field.value}
                </span>
              </span>
              <span
                className={cx(
                  'relative rounded-md border border-line bg-surface px-1.5 text-xs leading-5 font-medium text-fg-secondary tabular-nums transition-opacity duration-300',
                  found ? 'opacity-100' : 'opacity-0',
                )}
              >
                {field.confidence}
              </span>
              <span
                className={cx(
                  'relative inline-flex w-20 items-center gap-1 text-xs font-medium text-success-fg transition-opacity duration-300',
                  confirmed ? 'opacity-100' : 'opacity-0',
                )}
              >
                <Check className="size-3.5" />
                Confirmed
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
