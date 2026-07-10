'use client';

import type { ReactNode } from 'react';
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

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
        <button type="button" onClick={() => setOpen((next) => !next)} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
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
      {open ? <div className="p-4">{children}</div> : null}
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

const badgeToneClasses: Record<RecipeBadgeTone, string> = {
  blue: 'border-sky-200 bg-sky-50 text-sky-700',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-rose-200 bg-rose-50 text-rose-700',
  purple: 'border-violet-200 bg-violet-50 text-violet-700',
  gray: 'border-slate-200 bg-slate-50 text-slate-600',
};

export function RecipeStatusBadge({ tone = 'gray', children }: { tone?: RecipeBadgeTone; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium', badgeToneClasses[tone])}>
      {children}
    </span>
  );
}
