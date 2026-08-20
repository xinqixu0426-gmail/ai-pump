'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import { Button } from '@/components/ui/button';

type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'workspace' | 'fullscreen';
type DialogLayer = 'base' | 'assistant' | 'top';

type DialogProps = {
  open: boolean;
  children: ReactNode;
  onClose: () => void;
  size?: DialogSize;
  closeOnBackdrop?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  panelClassName?: string;
  layer?: DialogLayer;
};

type DrawerProps = Omit<DialogProps, 'size'> & {
  width?: 'sm' | 'md' | 'lg';
  side?: 'left' | 'right';
};

const sizeClasses: Record<DialogSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  workspace: 'max-w-[min(1280px,calc(100vw-2rem))]',
  fullscreen: 'h-[calc(100dvh-1.5rem)] max-w-[calc(100vw-1.5rem)] sm:h-[calc(100dvh-2rem)] sm:max-w-[min(1600px,calc(100vw-2rem))]',
};

const drawerWidthClasses: Record<NonNullable<DrawerProps['width']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
};

const layerClasses: Record<DialogLayer, string> = {
  base: 'z-50',
  assistant: 'z-[130]',
  top: 'z-[150]',
};

const openDialogStack: symbol[] = [];
let bodyOverflowBeforeDialogs: string | null = null;

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function useDialogLifecycle(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const dialogIdRef = useRef(Symbol('dialog'));
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogId = dialogIdRef.current;
    if (openDialogStack.length === 0) {
      bodyOverflowBeforeDialogs = document.body.style.overflow;
    }
    openDialogStack.push(dialogId);
    document.body.style.overflow = 'hidden';

    const focusFrame = window.requestAnimationFrame(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (firstFocusable || dialogRef.current)?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (openDialogStack[openDialogStack.length - 1] !== dialogId) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      const stackIndex = openDialogStack.lastIndexOf(dialogId);
      if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1);
      if (openDialogStack.length === 0) {
        document.body.style.overflow = bodyOverflowBeforeDialogs ?? '';
        bodyOverflowBeforeDialogs = null;
      } else {
        document.body.style.overflow = 'hidden';
      }
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open]);

  return dialogRef;
}

function DialogPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

export function Dialog({
  open,
  children,
  onClose,
  size = 'md',
  closeOnBackdrop = true,
  ariaLabel = '操作面板',
  ariaLabelledBy,
  panelClassName,
  layer = 'base',
}: DialogProps) {
  const dialogRef = useDialogLifecycle(open, onClose);

  return (
    <DialogPortal>
      <AnimatePresence>
        {open ? (
          <div className={clsx('fixed inset-0 flex items-center justify-center p-3 sm:p-4', layerClasses[layer])}>
            <motion.button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              className="absolute inset-0 bg-slate-950/25"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={closeOnBackdrop ? onClose : undefined}
            />
            <motion.section
              ref={dialogRef}
              data-dialog-root=""
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabelledBy ? undefined : ariaLabel}
              aria-labelledby={ariaLabelledBy}
              tabIndex={-1}
              initial={{ y: 12, scale: 0.98, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 12, scale: 0.98, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className={clsx(
                'relative max-h-[calc(100dvh-1.5rem)] w-full overflow-y-auto rounded-panel border border-line bg-white shadow-2xl outline-none sm:max-h-[calc(100dvh-2rem)]',
                sizeClasses[size],
                panelClassName
              )}
            >
              {children}
            </motion.section>
          </div>
        ) : null}
      </AnimatePresence>
    </DialogPortal>
  );
}

export function Drawer({
  open,
  children,
  onClose,
  width = 'md',
  side = 'right',
  closeOnBackdrop = true,
  ariaLabel = '侧边面板',
  ariaLabelledBy,
  panelClassName,
  layer = 'base',
}: DrawerProps) {
  const dialogRef = useDialogLifecycle(open, onClose);
  const fromRight = side === 'right';

  return (
    <DialogPortal>
      <AnimatePresence>
        {open ? (
          <div className={clsx('fixed inset-0 flex', fromRight ? 'justify-end' : 'justify-start', layerClasses[layer])}>
            <motion.button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              className="absolute inset-0 bg-slate-950/25"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={closeOnBackdrop ? onClose : undefined}
            />
            <motion.aside
              ref={dialogRef}
              data-dialog-root=""
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabelledBy ? undefined : ariaLabel}
              aria-labelledby={ariaLabelledBy}
              tabIndex={-1}
              initial={{ x: fromRight ? 28 : -28, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: fromRight ? 28 : -28, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className={clsx(
                'relative h-full w-full overflow-y-auto border-line bg-white shadow-2xl outline-none',
                fromRight ? 'border-l' : 'border-r',
                drawerWidthClasses[width],
                panelClassName
              )}
            >
              {children}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>
    </DialogPortal>
  );
}

export function DialogHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5', className)}>
      {children}
    </div>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('p-4 sm:p-5', className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-line bg-white px-4 py-3 sm:px-5', className)}>
      {children}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  confirmVariant = 'primary',
  busy = false,
  onConfirm,
  onClose,
  layer = 'base',
}: {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  layer?: DialogLayer;
}) {
  const titleId = useId();
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      size="sm"
      layer={layer}
      closeOnBackdrop={!busy}
      ariaLabelledBy={titleId}
    >
      <DialogHeader>
        <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
      </DialogHeader>
      <DialogBody>
        <div className="text-sm leading-6 text-slate-700">{description}</div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
        <Button variant={confirmVariant} onClick={onConfirm} disabled={busy}>
          {busy ? '处理中' : confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
