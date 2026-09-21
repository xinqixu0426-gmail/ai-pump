import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, CircleAlert, Info } from 'lucide-react';
import clsx from 'clsx';

type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<NoticeTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
};

const toneIcons = {
  info: Info,
  success: CheckCircle2,
  warning: CircleAlert,
  danger: AlertCircle,
};

export function InlineNotice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const Icon = toneIcons[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={clsx('flex items-start gap-2.5 rounded-md border p-3 text-sm', toneClasses[tone], className)}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title ? <div className="font-medium">{title}</div> : null}
        <div className={clsx('leading-6', title && 'mt-0.5')}>{children}</div>
      </div>
    </div>
  );
}
