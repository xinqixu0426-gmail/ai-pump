'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';

export type StatusBadgeTone = 'slate' | 'blue' | 'green' | 'amber' | 'orange' | 'red' | 'purple';

const toneClasses: Record<StatusBadgeTone, string> = {
  slate: 'border-slate-200 bg-slate-50 text-slate-600',
  blue: 'border-sky-200 bg-sky-50 text-sky-700',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  orange: 'border-orange-200 bg-orange-50 text-orange-700',
  red: 'border-rose-200 bg-rose-50 text-rose-700',
  purple: 'border-violet-200 bg-violet-50 text-violet-700',
};

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusBadgeTone | 'custom';
  className?: string;
};

export function StatusBadge({ children, tone = 'slate', className }: StatusBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex h-7 min-w-[3.75rem] shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2.5 text-xs font-medium leading-none',
        tone !== 'custom' && toneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
