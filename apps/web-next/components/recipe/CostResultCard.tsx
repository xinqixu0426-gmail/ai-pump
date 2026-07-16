'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';
import { RecipeStatusBadge, type RecipeBadgeTone } from './RecipeSection';

type CostResultCardProps = {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'blue' | 'green' | 'slate' | 'purple';
  badge?: ReactNode;
  badgeTone?: RecipeBadgeTone;
  className?: string;
};

const toneClasses: Record<NonNullable<CostResultCardProps['tone']>, string> = {
  blue: 'border-sky-200 bg-sky-50/80',
  green: 'border-emerald-200 bg-emerald-50/80',
  slate: 'border-line bg-slate-50',
  purple: 'border-violet-200 bg-violet-50/80',
};

export function CostResultCard({ label, value, note, tone = 'slate', badge, badgeTone = 'gray', className = '' }: CostResultCardProps) {
  return (
    <div className={clsx('rounded-md border p-3', toneClasses[tone], className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-xs font-medium text-slate-500">{label}</div>
        {badge ? <RecipeStatusBadge tone={badgeTone}>{badge}</RecipeStatusBadge> : null}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
      {note ? <div className="mt-1 text-xs text-slate-500">{note}</div> : null}
    </div>
  );
}
