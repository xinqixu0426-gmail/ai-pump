'use client';

import clsx from 'clsx';

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  badge?: string | number;
};

type SegmentedControlProps<T extends string> = {
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={clsx('flex rounded-md border border-line bg-slate-50 p-0.5', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={clsx(
            'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-3 text-sm transition-colors duration-150',
            value === option.value
              ? 'bg-white text-ink shadow-panel'
              : 'text-muted hover:text-ink'
          )}
        >
          {option.label}
          {option.badge !== undefined ? (
            <span className={clsx(
              'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-none',
              value === option.value ? 'bg-ink text-white' : 'bg-slate-200 text-slate-700'
            )}>
              {option.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
