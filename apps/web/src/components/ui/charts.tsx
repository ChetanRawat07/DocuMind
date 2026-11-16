import { cx } from '../../lib/cx';

export interface DataPoint {
  readonly label: string;
  readonly value: number;
}

function percentOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

/** A round axis top at or above `max`, so gridlines land on readable numbers. */
function axisMax(max: number): number {
  if (max <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(max / 4));
  return Math.ceil(max / 4 / step) * step * 4;
}

/**
 * Vertical bars on light gridlines, scaled to a rounded axis, with a tooltip
 * per bar on hover. The drawing is decorative; screen readers get the same
 * numbers as a table.
 */
export function BarChart({ data, caption }: { data: readonly DataPoint[]; caption: string }) {
  const top = axisMax(Math.max(0, ...data.map((point) => point.value)));
  const ticks = [top, top / 2, 0];
  return (
    <figure>
      <div aria-hidden="true" className="flex gap-2">
        <div className="flex h-48 w-8 shrink-0 flex-col justify-between pb-px text-right text-xs text-fg-muted tabular-nums">
          {ticks.map((tick) => (
            <span key={tick} className="-my-2 leading-4">
              {tick.toLocaleString()}
            </span>
          ))}
        </div>
        <div className="relative h-48 flex-1">
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((tick) => (
              <div
                key={tick}
                className={cx('border-t', tick === 0 ? 'border-line' : 'border-line-subtle')}
              />
            ))}
          </div>
          <div className="relative flex h-full items-end gap-0.5 sm:gap-1">
            {data.map((point) => (
              <div key={point.label} className="group relative flex h-full flex-1 items-end">
                <div
                  className="w-full rounded-t-[2px] bg-chart transition-colors duration-150 group-hover:bg-accent"
                  style={{
                    height: `${String(point.value > 0 ? Math.max(percentOf(point.value, top), 1) : 0)}%`,
                  }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1 text-xs whitespace-nowrap opacity-0 shadow-sm transition-opacity duration-100 group-hover:opacity-100">
                  <span className="text-fg-muted">{point.label}</span>{' '}
                  <span className="font-medium text-fg tabular-nums">
                    {point.value.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{point.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Labelled horizontal bars showing each item's share of the total. */
export function MeterList({ data }: { data: readonly DataPoint[] }) {
  const total = data.reduce((sum, point) => sum + point.value, 0);
  return (
    <ul className="space-y-4">
      {data.map((point) => {
        const percent = percentOf(point.value, total);
        return (
          <li key={point.label}>
            <div className="mb-2 flex justify-between gap-3 text-compact">
              <span className="text-fg">{point.label}</span>
              <span className="text-fg-secondary tabular-nums">
                {point.value.toLocaleString()}
                <span className="sr-only"> ({percent}%)</span>
              </span>
            </div>
            <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${String(percent)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
