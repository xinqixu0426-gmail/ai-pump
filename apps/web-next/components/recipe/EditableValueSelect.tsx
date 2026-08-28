'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { selectInputValueOnFocus } from '@/components/ui/field';
import { moveActiveOptionIndex } from '@/components/recipe/editable-value-select-state';

type EditableValueSelectProps = {
  value: string;
  options: Array<string | { value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
  listboxId: string;
  placeholder?: string;
  rootClassName?: string;
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
  placeholder = '选择或输入',
  rootClassName = 'relative mt-1',
  inputType = 'text',
  inputMode,
  min,
  step,
  disabled = false,
  compact = false,
  selectOnFirstFocus = false,
}: EditableValueSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const normalizedOptions = useMemo(() => options.map((option) => (
    typeof option === 'string' ? { value: option, label: option } : option
  )), [options]);
  const listboxOpen = open && !disabled && normalizedOptions.length > 0;
  const activeOptionIsValid = activeOptionIndex >= 0 && activeOptionIndex < normalizedOptions.length;

  function closeListbox() {
    setOpen(false);
    setActiveOptionIndex(-1);
  }

  function openListbox() {
    if (disabled || normalizedOptions.length === 0) return;
    setOpen(true);
    setActiveOptionIndex(-1);
  }

  function selectOption(index: number) {
    const option = normalizedOptions[index];
    if (!option) return;
    onChange(option.value);
    closeListbox();
  }

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveOptionIndex(-1);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!listboxOpen || !activeOptionIsValid) return;
    optionRefs.current[activeOptionIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionIndex, activeOptionIsValid, listboxOpen]);

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeListbox();
      }}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => {
          if (selectOnFirstFocus) selectInputValueOnFocus(event);
          openListbox();
        }}
        onClick={openListbox}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (listboxOpen) {
              event.preventDefault();
              event.stopPropagation();
            }
            closeListbox();
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (normalizedOptions.length === 0 || disabled) return;
            event.preventDefault();
            setOpen(true);
            setActiveOptionIndex((current) => {
              const selectedIndex = normalizedOptions.findIndex((option) => option.value === value);
              return moveActiveOptionIndex({
                currentIndex: current,
                optionCount: normalizedOptions.length,
                selectedIndex,
                direction: event.key === 'ArrowDown' ? 'next' : 'previous',
              });
            });
            return;
          }
          if (event.key === 'Enter' && listboxOpen && activeOptionIsValid) {
            event.preventDefault();
            selectOption(activeOptionIndex);
          }
        }}
        onKeyUp={(event) => {
          if (event.key === 'Backspace' || event.key === 'Delete') closeListbox();
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
        aria-expanded={listboxOpen}
        aria-controls={listboxId}
        aria-activedescendant={listboxOpen && activeOptionIsValid ? `${listboxId}-option-${activeOptionIndex}` : undefined}
        placeholder={placeholder}
        className={`${compact ? 'h-8 px-2 pr-8' : 'h-9 px-3 pr-10'} w-full rounded-md border border-line text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60`}
      />
      <button
        type="button"
        aria-label={`展开${ariaLabel}选项`}
        title={`展开${ariaLabel}选项`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          inputRef.current?.focus({ preventScroll: true });
          if (listboxOpen) closeListbox();
          else openListbox();
        }}
        disabled={disabled}
        className={`absolute right-0 top-0 flex items-center justify-center rounded-r-md border-l border-line text-muted hover:bg-slate-50 hover:text-ink disabled:opacity-60 ${compact ? 'h-8 w-8' : 'h-9 w-9'}`}
      >
        <ChevronDown size={15} />
      </button>
      {listboxOpen ? (
        <div id={listboxId} role="listbox" aria-label={`${ariaLabel}候选`} className="absolute z-30 mt-1 max-h-64 w-full min-w-36 overflow-y-auto rounded-md border border-line bg-white py-1 shadow-panel">
          {normalizedOptions.map((option, index) => (
            <div
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              key={`${option.value}\u0000${option.label}`}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={value === option.value}
              onMouseEnter={() => setActiveOptionIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(index)}
              className={`flex h-8 w-full cursor-pointer items-center px-3 text-left text-sm tabular-nums text-ink ${activeOptionIndex === index ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
            >
              {option.label}
            </div>
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
