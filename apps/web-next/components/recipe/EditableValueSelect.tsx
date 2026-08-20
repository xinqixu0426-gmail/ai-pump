'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { selectInputValueOnFocus } from '@/components/ui/field';

type EditableValueSelectProps = {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
  listboxId: string;
  inputType?: 'text' | 'number';
  inputMode?: 'text' | 'decimal' | 'numeric';
  min?: string;
  step?: string;
  disabled?: boolean;
  compact?: boolean;
  selectOnFirstFocus?: boolean;
};

export function EditableValueSelect({
  value,
  options,
  onChange,
  ariaLabel,
  listboxId,
  inputType = 'text',
  inputMode,
  min,
  step,
  disabled = false,
  compact = false,
  selectOnFirstFocus = false,
}: EditableValueSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative mt-1">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => {
          if (selectOnFirstFocus) selectInputValueOnFocus(event);
          if (!disabled && options.length > 0) setOpen(true);
        }}
        onClick={() => {
          if (!disabled && options.length > 0) setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'ArrowDown') setOpen(true);
        }}
        type={inputType}
        inputMode={inputMode}
        min={min}
        step={step}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        placeholder="选择或输入"
        className={`${compact ? 'h-8 px-2 pr-8' : 'h-9 px-3 pr-10'} w-full rounded-md border border-line text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60`}
      />
      <button
        type="button"
        aria-label={`展开${ariaLabel}选项`}
        title={`展开${ariaLabel}选项`}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        className={`absolute right-0 top-0 flex items-center justify-center rounded-r-md border-l border-line text-muted hover:bg-slate-50 hover:text-ink disabled:opacity-60 ${compact ? 'h-8 w-8' : 'h-9 w-9'}`}
      >
        <ChevronDown size={15} />
      </button>
      {open && !disabled && options.length > 0 ? (
        <div id={listboxId} role="listbox" aria-label={`${ariaLabel}候选`} className="absolute z-30 mt-1 max-h-64 w-full min-w-36 overflow-y-auto rounded-md border border-line bg-white py-1 shadow-panel">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={value === option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className="flex h-8 w-full items-center px-3 text-left text-sm tabular-nums text-ink hover:bg-slate-50"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function EditableNumberSelect(props: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return <EditableValueSelect {...props} listboxId="recipe-coil-sheet-listbox" inputType="number" inputMode="numeric" min="0" step="1" compact selectOnFirstFocus />;
}

export function EditableWireSelect({
  value,
  options,
  onChange,
  ariaLabel,
  listboxId,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
  listboxId: string;
  disabled: boolean;
}) {
  return <EditableValueSelect value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} listboxId={listboxId} inputMode="decimal" disabled={disabled} />;
}
