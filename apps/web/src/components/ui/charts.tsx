export interface DataPoint {
  readonly label: string;
  readonly value: number;
}

function percentOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

/**
 * Vertical bars scaled to the largest value. The bars are decorative; screen
 * readers get the same numbers as a table.
 */
export function BarChart({ data, caption }: { data: readonly DataPoint[]; caption: string }) {
  const max = Math.max(0, ...data.map((point) => point.value));
  return (
    <figure>
      <div aria-hidden="true" className="flex h-52 items-end gap-2 pt-6">
        {data.map((point) => (
          <div
            key={point.label}
            title={`${point.label}: ${point.value}`}
            className="flex-1 rounded-t-md rounded-b-xs bg-brand-100 transition-colors hover:bg-brand-300"
            style={{ height: `${Math.max(percentOf(point.value, max), 2)}%` }}
          />
        ))}
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
    <ul className="space-y-5">
      {data.map((point) => {
        const percent = percentOf(point.value, total);
        return (
          <li key={point.label}>
            <div className="mb-2 flex justify-between text-xs">
              <span className="text-gray-900">{point.label}</span>
              <span className="text-gray-500">
                {point.value.toLocaleString()}
                <span className="sr-only"> ({percent}%)</span>
              </span>
            </div>
            <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
