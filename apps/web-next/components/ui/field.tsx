'use client';

import {
  forwardRef,
  type FocusEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import clsx from 'clsx';
import { selectEditableInputValue } from '@/lib/input-selection.cjs';

type FieldProps = {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  labelFor?: string;
};

const controlClasses =
  'w-full rounded-md border border-line bg-white text-sm text-ink outline-none transition-colors duration-150 placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-muted';

export function Field({
  label,
  children,
  hint,
  error,
  required,
  className,
  labelFor,
}: FieldProps) {
  return (
    <label htmlFor={labelFor} className={clsx('block min-w-0', className)}>
      <span className="block text-sm font-medium text-ink">
        {label}{required ? <span className="ml-1 text-rose-600" aria-hidden="true">*</span> : null}
      </span>
      <div className="mt-2">{children}</div>
      {error ? <div className="mt-1.5 text-xs text-rose-600">{error}</div> : null}
      {!error && hint ? <div className="mt-1.5 text-xs leading-5 text-muted">{hint}</div> : null}
    </label>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  compact?: boolean;
  selectOnFirstFocus?: boolean;
};

export function selectInputValueOnFocus(event: FocusEvent<HTMLInputElement>) {
  selectEditableInputValue(event.currentTarget);
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, compact, selectOnFirstFocus, onFocus, className, ...props },
  ref
) {
  const handleFocus = selectOnFirstFocus || onFocus
    ? (event: FocusEvent<HTMLInputElement>) => {
        if (selectOnFirstFocus) selectInputValueOnFocus(event);
        onFocus?.(event);
      }
    : undefined;

  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      onFocus={handleFocus}
      className={clsx(controlClasses, compact ? 'h-8 px-2' : 'h-10 px-3', invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-100', className)}
      {...props}
    />
  );
});

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  invalid?: boolean;
  size?: 'sm' | 'md';
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { invalid, size = 'sm', className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-invalid={invalid || undefined}
      className={clsx(
        'shrink-0 rounded border-line accent-slate-900 outline-none transition-colors focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-5 w-5' : 'h-4 w-4',
        invalid && 'border-rose-400 focus:ring-rose-100',
        className
      )}
      {...props}
    />
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
  compact?: boolean;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, compact, className, children, ...props },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(controlClasses, compact ? 'h-8 px-2' : 'h-10 px-3', invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-100', className)}
      {...props}
    >
      {children}
    </select>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(controlClasses, 'min-h-24 resize-y px-3 py-2 leading-6', invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-100', className)}
      {...props}
    />
  );
});

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('space-y-4', className)}>
      <div className="border-b border-line pb-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description ? <p className="mt-1 text-xs leading-5 text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
