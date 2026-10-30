import { DOCUMENT_STATUSES } from '@documind/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileText } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { DOCUMENT_STATUS_DISPLAY } from '../../lib/document-labels';
import { BarChart, MeterList } from './charts';
import { EmptyState, ErrorState, Spinner } from './feedback';
import { StatCard } from './stat-card';
import { DocumentStatusBadge } from './status-badge';

describe('DocumentStatusBadge', () => {
  it.each(DOCUMENT_STATUSES)('shows a text label for the %s status', (status) => {
    render(<DocumentStatusBadge status={status} />);

    expect(screen.getByText(DOCUMENT_STATUS_DISPLAY[status].label)).toBeInTheDocument();
  });

  it('gives every status a distinct label', () => {
    const labels = DOCUMENT_STATUSES.map((status) => DOCUMENT_STATUS_DISPLAY[status].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('StatCard', () => {
  it('shows the value under its label', () => {
    render(<StatCard label="Documents" value="1,248" />);

    expect(screen.getByRole('term')).toHaveTextContent('Documents');
    expect(screen.getByRole('definition')).toHaveTextContent('1,248');
  });

  it('says there is no data instead of showing zero', () => {
    render(<StatCard label="Documents" value={null} />);

    expect(screen.getByRole('definition')).toHaveTextContent('No data yet');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('BarChart', () => {
  it('exposes its values to assistive technology as a table', () => {
    render(
      <BarChart
        caption="Documents processed per day"
        data={[
          { label: '27 Oct', value: 4 },
          { label: '28 Oct', value: 9 },
        ]}
      />,
    );

    const table = screen.getByRole('table', { name: 'Documents processed per day' });
    expect(within(table).getByRole('rowheader', { name: '28 Oct' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '9' })).toBeInTheDocument();
  });
});

describe('MeterList', () => {
  it('shows each count with its share of the total', () => {
    render(
      <MeterList
        data={[
          { label: 'Invoices', value: 742 },
          { label: 'Contracts', value: 274 },
          { label: 'Purchase orders', value: 166 },
        ]}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Invoices742 (63%)');
    expect(items[2]).toHaveTextContent('Purchase orders166 (14%)');
  });

  it('handles an all-zero total without dividing by zero', () => {
    render(<MeterList data={[{ label: 'Invoices', value: 0 }]} />);

    expect(screen.getByRole('listitem')).toHaveTextContent('Invoices0 (0%)');
  });
});

describe('feedback states', () => {
  it('announces loading', () => {
    render(<Spinner label="Loading documents…" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading documents…');
  });

  it('renders an empty state with its action', () => {
    render(
      <EmptyState
        icon={FileText}
        title="No documents yet"
        description="Upload one to start."
        action={<button type="button">Upload</button>}
      />,
    );

    expect(screen.getByText('No documents yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('announces an error and retries on request', async () => {
    const onRetry = vi.fn();
    render(<ErrorState description="Check your connection." onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
