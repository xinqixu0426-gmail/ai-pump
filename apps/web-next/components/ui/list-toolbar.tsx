'use client';

import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';

type ListToolbarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  searchLabel: string;
  placeholder: string;
  resultText: string;
  filters?: ReactNode;
  hasActiveFilters?: boolean;
  onReset?: () => void;
  resetLabel?: string;
};

export function ListToolbar({
  query,
  onQueryChange,
  searchLabel,
  placeholder,
  resultText,
  filters,
  hasActiveFilters = false,
  onReset,
  resetLabel = '清除筛选',
}: ListToolbarProps) {
  return (
    <div className="border-b border-line p-3 md:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label={searchLabel}
            placeholder={placeholder}
            className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-slate-100 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              aria-label={`清空${searchLabel}`}
              title="清空搜索"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        {filters ? <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 lg:pb-0">{filters}</div> : null}
      </div>
      <div className="mt-2 flex min-h-6 items-center justify-between gap-3 text-xs text-muted">
        <span aria-live="polite">{resultText}</span>
        {hasActiveFilters && onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 rounded px-1.5 py-1 font-medium text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {resetLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
