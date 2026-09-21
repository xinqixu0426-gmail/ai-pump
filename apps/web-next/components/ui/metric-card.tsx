'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';
import { FadePanel } from '@/components/motion/fade-panel';

type MetricCardTone = 'default' | 'attention' | 'success';

type MetricCardProps = {
  value: ReactNode;
  label: string;
  note?: ReactNode;
  href?: string;
  ariaLabel?: string;
  delay?: number;
  tone?: MetricCardTone;
};

const toneClasses: Record<MetricCardTone, string> = {
  default: 'border-line bg-white',
  attention: 'border-amber-200 bg-amber-50/60',
  success: 'border-emerald-200 bg-emerald-50/60',
};

export function MetricCard({
  value,
  label,
  note,
  href,
  ariaLabel,
  delay = 0,
  tone = 'default',
}: MetricCardProps) {
  const content = (
    <FadePanel
      delay={delay}
      className={clsx(
        'h-full rounded-panel border p-3 shadow-panel transition-colors sm:p-4',
        toneClasses[tone],
        href && 'hover:border-slate-300 hover:bg-slate-50'
      )}
    >
      <div className="break-words text-xl font-semibold tracking-tight text-ink sm:text-2xl">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
      {note ? <div className="mt-1 text-xs text-slate-500">{note}</div> : null}
    </FadePanel>
  );

  if (!href) return content;

  return (
    <a
      href={href}
      aria-label={ariaLabel || `查看${label}`}
      className="block rounded-panel focus:outline-none focus:ring-2 focus:ring-slate-400"
    >
      {content}
    </a>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{children}</div>;
}
