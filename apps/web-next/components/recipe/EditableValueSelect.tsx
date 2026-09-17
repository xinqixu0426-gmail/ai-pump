'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { selectInputValueOnFocus } from '@/components/ui/field';
import { filterEditableOptions, moveActiveOptionIndex } from '@/components/recipe/editable-value-select-state';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const allOptions = useMemo(() => options.map((option) => (
    typeof option === 'string' ? { value: option, label: option } : option
  )), [options]);
  const normalizedOptions = useMemo(() => filterEditableOptions(allOptions, searchQuery), [allOptions, searchQuery]);
  const listboxOpen = open && !disabled && allOptions.length > 0;
  const activeOptionIsValid = activeOptionIndex >= 0 && activeOptionIndex < normalizedOptions.length;

  function closeListbox() {
    setOpen(false);
    setSearchQuery('');
    setDraftValue(null);
    setActiveOptionIndex(-1);
  }

  function openListbox() {
    if (disabled || allOptions.length === 0) return;
    if (!open) setSearchQuery('');
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
      if (!rootRef.current?.contains(event.target as Node) && !listboxRef.current?.contains(event.target as Node)) {
        if (draftValue !== null) onChange(draftValue);
        setOpen(false);
        setSearchQuery('');
        setDraftValue(null);
        setActiveOptionIndex(-1);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open, draftValue, onChange]);

  useEffect(() => {
    if (!listboxOpen) { setPosition(null); return; }
    const updatePosition = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const desiredHeight = Math.min(256, Math.max(1, normalizedOptions.length) * 32 + 8);
      const upwards = below < desiredHeight && above > below;
      const maxHeight = Math.max(0, Math.min(256, upwards ? above : below));
      const width = Math.min(Math.max(144, rect.width), window.innerWidth - 16);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: upwards ? rect.top - 4 - Math.min(maxHeight, desiredHeight) : rect.bottom + 4, width, maxHeight });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [listboxOpen, normalizedOptions.length]);

  useEffect(() => {
    if (!listboxOpen || !activeOptionIsValid) return;
    optionRefs.current[activeOptionIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionIndex, activeOptionIsValid, listboxOpen]);

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          if (draftValue !== null) onChange(draftValue);
          closeListbox();
        }
      }}
    >
      <input
        ref={inputRef}
        value={draftValue ?? value}
        onChange={(event) => {
          setSearchQuery(event.target.value);
          setActiveOptionIndex(-1);
          setOpen(true);
          if (inputType === 'number') onChange(event.target.value);
          else setDraftValue(event.target.value);
        }}
        onFocus={(event) => {
          if (selectOnFirstFocus) selectInputValueOnFocus(event);
          openListbox();
        }}
        onClick={() => { if (!open) { setSearchQuery(''); openListbox(); } }}
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
          } else if (event.key === 'Enter' && draftValue !== null) {
            event.preventDefault();
            onChange(draftValue);
            closeListbox();
          }
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
      {listboxOpen && position ? createPortal(
        <div ref={listboxRef} id={listboxId} role="listbox" aria-label={`${ariaLabel}候选`} style={position} className="fixed z-[160] overflow-y-auto rounded-md border border-line bg-white py-1 shadow-panel">
          {normalizedOptions.length === 0 ? <div role="status" className="px-3 py-2 text-xs text-muted">未找到匹配项，可继续输入自定义型号</div> : null}
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
              className={`flex min-h-8 w-full cursor-pointer items-center break-words px-3 py-1 text-left text-sm tabular-nums text-ink ${activeOptionIndex === index ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
            >
              {option.label}
            </div>
          ))}
        </div>, document.body
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
