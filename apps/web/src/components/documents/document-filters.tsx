import {
  DOCUMENT_FORMATS,
  DOCUMENT_SORTS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  type DocumentFormat,
  type DocumentSort,
  type DocumentStatus,
  MAX_DOCUMENT_SEARCH_LENGTH,
  UNCLASSIFIED_DOCUMENT_TYPE,
} from '@documind/shared';
import { Search } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import {
  DOCUMENT_FORMAT_LABEL,
  DOCUMENT_SORT_LABEL,
  DOCUMENT_STATUS_DISPLAY,
  DOCUMENT_TYPE_LABEL,
} from '../../lib/document-labels';
import { type DocumentView, hasDocumentFilters } from '../../lib/document-view';
import { cx } from '../../lib/cx';
import { INPUT_CLASS } from '../form-controls';
import { Button } from '../ui/button';

/** How long typing must pause before the search runs. */
export const SEARCH_DEBOUNCE_MS = 300;

const FIELD_CLASS = `${INPUT_CLASS} h-8`;

/** A filter select as a compact chip; an active filter is tinted with the accent. */
const CHIP_CLASS =
  'block h-8 max-w-full rounded-lg border pr-8 pl-2.5 text-compact font-medium outline-2 -outline-offset-1 outline-transparent transition-[border-color,outline-color,background-color] duration-150 focus:outline-accent';

type TypeFilter = NonNullable<DocumentView['type']>;
const TYPE_OPTIONS: readonly [TypeFilter, string][] = [
  ...DOCUMENT_TYPES.map((type): [TypeFilter, string] => [type, DOCUMENT_TYPE_LABEL[type]]),
  [UNCLASSIFIED_DOCUMENT_TYPE, 'Not classified'],
];

function SelectField<T extends string>({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  /** Text of the "no filter" option; omit it when a value is always chosen. */
  allLabel?: string;
  options: readonly (readonly [T, string])[];
  onChange: (value: T | undefined) => void;
}) {
  const id = useId();
  // A compact chip: the label is for assistive technology; the chosen option says the rest.
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => {
          const selected = options.find(([option]) => option === event.target.value);
          onChange(selected?.[0]);
        }}
        className={cx(
          CHIP_CLASS,
          value !== undefined && allLabel
            ? 'border-accent bg-accent-subtle text-accent-fg'
            : 'border-line-strong bg-surface text-fg-secondary hover:bg-surface-subtle',
        )}
      >
        {allLabel ? <option value="">{allLabel}</option> : null}
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Search box that runs the search once typing pauses, or at once on Enter.
 * It follows `value` when the search changes elsewhere (cleared filters,
 * Back button) without disturbing what the user is typing.
 */
function SearchField({ value, onSearch }: { value: string; onSearch: (text: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(value);
  }

  const pending = text.trim().normalize('NFC') !== value;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      onSearch(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [onSearch, pending, text]);

  return (
    <form
      role="search"
      className="min-w-0 basis-full sm:basis-64"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(text);
      }}
    >
      <label htmlFor={id} className="sr-only">
        Search
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
        />
        <input
          id={id}
          type="search"
          value={text}
          maxLength={MAX_DOCUMENT_SEARCH_LENGTH}
          placeholder="Filename"
          autoComplete="off"
          onChange={(event) => {
            setText(event.target.value);
          }}
          className={`${FIELD_CLASS} pr-3 pl-9`}
        />
      </div>
    </form>
  );
}

/** Search, filters and sort order for the documents list. */
export function DocumentFilters({
  view,
  onChange,
  onSearch,
}: {
  view: DocumentView;
  onChange: (view: DocumentView) => void;
  /** Called with the raw search text; must be stable across renders. */
  onSearch: (text: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-6">
      <SearchField value={view.q ?? ''} onSearch={onSearch} />
      <SelectField<DocumentStatus>
        label="Status"
        value={view.status}
        allLabel="All statuses"
        options={DOCUMENT_STATUSES.map((status) => [status, DOCUMENT_STATUS_DISPLAY[status].label])}
        onChange={(status) => {
          onChange({ ...view, status });
        }}
      />
      <SelectField<TypeFilter>
        label="Type"
        value={view.type}
        allLabel="All types"
        options={TYPE_OPTIONS}
        onChange={(type) => {
          onChange({ ...view, type });
        }}
      />
      <SelectField<DocumentFormat>
        label="Format"
        value={view.format}
        allLabel="All formats"
        options={(Object.keys(DOCUMENT_FORMATS) as DocumentFormat[]).map((format) => [
          format,
          DOCUMENT_FORMAT_LABEL[format],
        ])}
        onChange={(format) => {
          onChange({ ...view, format });
        }}
      />
      <SelectField<DocumentSort>
        label="Sort by"
        value={view.sort}
        options={DOCUMENT_SORTS.map((sort) => [sort, DOCUMENT_SORT_LABEL[sort]])}
        onChange={(sort) => {
          if (sort) onChange({ ...view, sort });
        }}
      />
      {hasDocumentFilters(view) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange({ sort: view.sort });
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
