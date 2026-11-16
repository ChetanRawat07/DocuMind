import { Check, FileText } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { cx } from '../lib/cx';
import { prefersMotion } from '../lib/motion';

/**
 * The scene runs on a 500ms tick; 40 ticks make a 20s loop:
 *   0–5 uploaded · 6–13 a scan line reads the invoice and marks fields ·
 *   14–19 the values fill the extracted list · 20–25 validated ·
 *   26–31 the record is shown as JSON · 32–39 marks fade, back to the start.
 */
const TICK_MS = 500;
const TICKS = 40;
const SCAN = { from: 6, to: 13 } as const;
const JSON_FROM = 26;
const RESET_AT = 32;
/** Reduced motion shows one still frame: every field extracted and validated. */
const STILL_TICK = 24;

type FieldKey = 'vendor' | 'number' | 'issued' | 'due' | 'total';

/** `scannedAt`: the tick the scan line passes the field on the page. */
const FIELDS: readonly {
  key: FieldKey;
  label: string;
  value: string;
  confidence: string;
  scannedAt: number;
}[] = [
  {
    key: 'vendor',
    label: 'Vendor',
    value: 'Northwind Supplies Ltd.',
    confidence: '97%',
    scannedAt: 7,
  },
  { key: 'number', label: 'Invoice number', value: 'INV-2041', confidence: '99%', scannedAt: 8 },
  { key: 'issued', label: 'Issue date', value: '14 Oct 2026', confidence: '96%', scannedAt: 9 },
  { key: 'due', label: 'Due date', value: '13 Nov 2026', confidence: '94%', scannedAt: 9 },
  { key: 'total', label: 'Total amount', value: '$4,280.00', confidence: '98%', scannedAt: 13 },
];

const LINE_ITEMS = [
  ['Archival storage boxes × 120', '$1,200.00'],
  ['Document scanning, 3,200 pp', '$2,560.00'],
  ['Courier pickups × 4', '$240.00'],
] as const;

const JSON_LINES = [
  '{',
  '  "vendor": "Northwind Supplies Ltd.",',
  '  "invoice_number": "INV-2041",',
  '  "issue_date": "2026-10-14",',
  '  "due_date": "2026-11-13",',
  '  "total": { "amount": 4280.00,',
  '             "currency": "USD" }',
  '}',
] as const;

const STAGES = ['Uploaded', 'Reading text', 'Extracting fields', 'Analysis complete'] as const;

function stageOf(tick: number): number {
  if (tick < SCAN.from) return 0;
  if (tick <= SCAN.to) return 1;
  if (tick < 20) return 2;
  return tick < RESET_AT ? 3 : 0;
}

const LABEL = 'font-label text-xs tracking-[0.08em] uppercase';
const FADE = 'transition-opacity duration-300';

/** Advances the scene; holds still under reduced motion and while the tab is hidden. */
function useSceneTick(): number {
  const [tick, setTick] = useState(() => (prefersMotion() ? 0 : STILL_TICK));
  useEffect(() => {
    if (!prefersMotion()) return;
    const timer = setInterval(() => {
      if (!document.hidden) setTick((previous) => (previous + 1) % TICKS);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return tick;
}

/** A field on the page, outlined once the scan line has read it. */
function Mark({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className="relative -mx-1 inline-block px-1">
      <span
        className={cx(
          'absolute inset-0 rounded-sm bg-accent-subtle ring-1 ring-info-line',
          FADE,
          on ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span className="relative">{children}</span>
    </span>
  );
}

/**
 * The sign-in page's navy panel: an invoice is read, its fields are marked,
 * extracted and turned into a structured record, on a 20s loop. Shown from
 * 1024px; the scene is decorative.
 */
export function LoginShowcase() {
  const tick = useSceneTick();
  const stage = stageOf(tick);
  const live = tick < RESET_AT;
  const scanned = (key: FieldKey) =>
    live && tick >= (FIELDS.find((field) => field.key === key)?.scannedAt ?? TICKS);
  const scanning = tick >= SCAN.from && tick <= SCAN.to;
  const showJson = tick >= JSON_FROM && live;

  return (
    <aside className="hidden min-h-screen flex-col bg-showcase px-12 py-9 text-showcase-fg lg:flex xl:px-19">
      <div className={cx(LABEL, 'flex items-center justify-between text-showcase-muted')}>
        <span>DocuMind workspace / Overview</span>
        <span className="rounded-sm border border-showcase-line px-2.5 py-1.5">
          Built for clarity
        </span>
      </div>

      <div className="m-auto w-full max-w-[790px] py-14">
        <div className="mb-7 flex items-end justify-between gap-6">
          <h2 className="max-w-[440px] font-display text-[clamp(1.625rem,2.8vw,2.25rem)] leading-[1.13] font-semibold tracking-[-0.035em]">
            From document to decision.
            <br />
            Without the busywork.
          </h2>
          <p className="mb-1 max-w-[180px] text-xs leading-relaxed text-showcase-muted">
            Turn unstructured files into information your team can use.
          </p>
        </div>

        <div
          aria-hidden="true"
          className="rounded-lg border border-showcase-line bg-canvas p-5 text-fg shadow-sm motion-safe:animate-rise"
        >
          <div className="mb-4 flex items-center justify-between border-b border-line pb-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-8 place-items-center rounded-md border border-line bg-surface text-accent-fg">
                <FileText className="size-4" />
              </span>
              <span>
                <span className="block text-xs font-semibold">Invoice_2041.pdf</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  1 of 3 in batch · 2 pages
                </span>
              </span>
            </div>
            <span
              className={cx(
                LABEL,
                'inline-flex items-center gap-1 rounded-sm px-2 py-1.5 transition-colors duration-300',
                stage === 3
                  ? 'bg-success-subtle text-success-fg'
                  : 'bg-surface-muted text-fg-secondary',
              )}
            >
              {stage === 3 ? <Check className="size-3" /> : null}
              {STAGES[stage]}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 xl:grid-cols-[1.04fr_0.96fr]">
            {/* The invoice on top of the batch; the two sheets behind are the rest of it. */}
            <div className="relative mt-3">
              <div className="absolute inset-x-4 -top-3 h-8 rounded-t-sm border border-line bg-surface-muted" />
              <div className="absolute inset-x-2 -top-1.5 h-8 rounded-t-sm border border-line bg-surface-subtle" />
              <div className="relative overflow-hidden border border-line bg-surface px-4.5 py-5 text-xs">
                <div className="flex items-start justify-between border-b border-line-subtle pb-3.5">
                  <Mark on={scanned('vendor')}>
                    <span className="block font-display font-extrabold">NORTHWIND</span>
                    <span className="mt-1 block text-fg-muted">Supplies Limited</span>
                  </Mark>
                  <span className={cx(LABEL, 'text-fg-muted')}>Invoice</span>
                </div>
                <p className="mt-4 mb-3 font-display text-sm font-bold">
                  <Mark on={scanned('number')}>INV-2041</Mark>
                </p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-fg-muted">
                  <dt>Issue date</dt>
                  <dt>Due date</dt>
                  <dd className="text-fg">
                    <Mark on={scanned('issued')}>14 Oct 2026</Mark>
                  </dd>
                  <dd className="text-fg">
                    <Mark on={scanned('due')}>13 Nov 2026</Mark>
                  </dd>
                </dl>
                <ul className="my-4 space-y-1.5 border-y border-line-subtle py-2.5 text-fg-secondary">
                  {LINE_ITEMS.map(([item, amount]) => (
                    <li key={item} className="flex justify-between gap-2">
                      <span className="truncate">{item}</span>
                      <span className="tabular-nums">{amount}</span>
                    </li>
                  ))}
                </ul>
                <div className="space-y-1 text-fg-muted">
                  <p className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="tabular-nums">$4,000.00</span>
                  </p>
                  <p className="flex justify-between">
                    <span>Sales tax 7%</span>
                    <span className="tabular-nums">$280.00</span>
                  </p>
                </div>
                <div className="mt-3 flex items-baseline justify-between text-fg-muted">
                  <span>Amount due</span>
                  <b className="text-sm text-fg tabular-nums">
                    <Mark on={scanned('total')}>$4,280.00</Mark>
                  </b>
                </div>

                {/* The scan line: moved by the tick, so it pauses with the scene. */}
                <div
                  className={cx(
                    'absolute inset-x-0 h-px bg-accent',
                    scanning
                      ? 'opacity-100 transition-[top] duration-500 ease-linear'
                      : 'opacity-0',
                  )}
                  style={{
                    top: scanning
                      ? `${String(((tick - SCAN.from) / (SCAN.to - SCAN.from)) * 100)}%`
                      : '0%',
                  }}
                >
                  <div className="absolute inset-x-0 bottom-0 h-6 bg-accent-subtle opacity-40" />
                </div>
              </div>
            </div>

            <div className="py-1">
              <div className="mb-3 flex items-center justify-between">
                <strong className="font-display text-xs font-bold">
                  {showJson ? 'invoice_2041.json' : 'Extracted fields'}
                </strong>
                <span className={cx(LABEL, 'hidden text-fg-muted xl:inline')}>Structured data</span>
              </div>
              <div className="grid">
                <dl
                  className={cx(
                    'col-start-1 row-start-1 border-t border-line',
                    FADE,
                    showJson ? 'opacity-0' : 'opacity-100',
                  )}
                >
                  {FIELDS.map((field, index) => {
                    const filled = live && tick >= 14 + index;
                    return (
                      <div
                        key={field.key}
                        className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 text-xs"
                      >
                        <dt className="text-fg-muted">{field.label}</dt>
                        <dd className="relative text-right font-semibold">
                          <span
                            className={cx(
                              FADE,
                              filled ? 'opacity-0' : 'opacity-100',
                              'absolute right-0 text-fg-muted',
                            )}
                          >
                            —
                          </span>
                          <span className={cx(FADE, filled ? 'opacity-100' : 'opacity-0')}>
                            {field.value}
                            <span className="ml-2 font-normal text-fg-muted tabular-nums">
                              {field.confidence}
                            </span>
                          </span>
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                <pre
                  className={cx(
                    'col-start-1 row-start-1 overflow-hidden rounded-md border border-line bg-surface p-3 font-mono text-[10px] leading-[1.7] xl:text-[11px] text-fg-secondary',
                    FADE,
                    showJson ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  {JSON_LINES.join('\n')}
                </pre>
              </div>
              <p
                className={cx(
                  'mt-4 flex items-center gap-2 text-xs text-fg-secondary',
                  FADE,
                  stage === 3 ? 'opacity-100' : 'opacity-0',
                )}
              >
                <Check className="size-3.5 text-success-fg" />
                Key fields validated
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-between gap-5 text-xs text-showcase-muted">
          <span>Upload. Extract. Verify. Move forward.</span>
          <span className="font-label">
            {String(stage + 1).padStart(2, '0')} / {STAGES[stage]}
          </span>
        </div>
      </div>

      <div className={cx(LABEL, 'flex justify-between text-showcase-muted')}>
        <span>Intelligent document processing</span>
        <span>Private by design</span>
      </div>
    </aside>
  );
}
