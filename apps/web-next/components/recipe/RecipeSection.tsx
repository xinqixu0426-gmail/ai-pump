'use client';

import type { ReactNode } from 'react';
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';

export type RecipeSectionStatus = 'default' | 'active' | 'complete' | 'warning' | 'error' | 'disabled';
export type RecipeBadgeTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray';

type RecipeSectionProps = {
  id?: string;
  title: string;
  description?: string;
  summary?: ReactNode;
  status?: RecipeSectionStatus;
  badge?: ReactNode;
  badgeTone?: RecipeBadgeTone;
  action?: ReactNode;
  defaultOpen?: boolean;
  muted?: boolean;
  children: ReactNode;
};

export function RecipeSection({
  id,
  title,
  description,
  summary,
  status = 'default',
  badge,
  badgeTone = 'gray',
  action,
  defaultOpen = true,
  muted = false,
  children,
}: RecipeSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <section
      id={id}
      className={clsx(
        'rounded-panel border bg-white shadow-sm transition duration-200 focus-within:border-sky-300 focus-within:bg-sky-50/20 focus-within:ring-4 focus-within:ring-sky-100/60',
        sectionStatusClasses[status],
        muted && 'opacity-95'
      )}
    >
      <div className={clsx('flex items-center justify-between gap-3 px-4 py-3', open && 'border-b border-line')}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id ? `${id}-content` : undefined}
          onClick={() => setOpen((next) => !next)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-slate-900">{title}</span>
              {badge ? <RecipeStatusBadge tone={badgeTone}>{badge}</RecipeStatusBadge> : null}
            </div>
            {open && description ? <div className="mt-1 text-xs text-slate-500">{description}</div> : null}
            {!open && summary ? <div className="mt-1 text-xs text-slate-500">{summary}</div> : null}
          </div>
          <ChevronDown size={16} className={clsx('shrink-0 text-muted transition-transform duration-150', open && 'rotate-180')} />
        </button>
        {action}
      </div>
      {open ? <div id={id ? `${id}-content` : undefined} className="p-4">{children}</div> : null}
    </section>
  );
}

const sectionStatusClasses: Record<RecipeSectionStatus, string> = {
  default: 'border-slate-200',
  active: 'border-sky-300 bg-sky-50/20',
  complete: 'border-emerald-200',
  warning: 'border-amber-200',
  error: 'border-rose-200',
  disabled: 'border-slate-200 bg-slate-50/60 opacity-80',
};

const badgeToneMap: Record<RecipeBadgeTone, StatusBadgeTone> = {
  blue: 'blue',
  green: 'green',
  amber: 'amber',
  red: 'red',
  purple: 'purple',
  gray: 'slate',
};

export function RecipeStatusBadge({ tone = 'gray', children }: { tone?: RecipeBadgeTone; children: ReactNode }) {
  return <StatusBadge tone={badgeToneMap[tone]} className="h-6 min-w-0 px-2">{children}</StatusBadge>;
}
