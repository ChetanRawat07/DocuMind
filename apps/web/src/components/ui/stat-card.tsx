import { Card } from './card';

/**
 * One KPI. `value` is preformatted text; null means there is no data yet,
 * shown as a dash rather than a misleading zero.
 */
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <dl>
        <dt className="text-xs font-medium text-gray-500">{label}</dt>
        <dd className="mt-3 text-2xl font-bold tracking-tight text-gray-900">
          {value ?? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">No data yet</span>
            </>
          )}
        </dd>
      </dl>
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </Card>
  );
}
