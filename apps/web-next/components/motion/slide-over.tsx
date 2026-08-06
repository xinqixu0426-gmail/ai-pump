'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';

type SlideOverProps = {
  open: boolean;
  children: React.ReactNode;
  onClose: () => void;
  size?: 'standard' | 'wide' | 'workspace';
  closeOnBackdrop?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
};

const sizeClass = {
  standard: 'max-w-3xl',
  wide: 'max-w-5xl',
  workspace: 'max-w-[min(1280px,calc(100vw-2rem))]',
};

const openDialogStack: symbol[] = [];
let bodyOverflowBeforeDialogs: string | null = null;

export function SlideOver({
  open,
  children,
  onClose,
  size = 'standard',
  closeOnBackdrop = true,
  ariaLabel = '操作面板',
  ariaLabelledBy,
}: SlideOverProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const dialogIdRef = useRef(Symbol('slide-over'));
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
    dialogRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openDialogStack[openDialogStack.length - 1] === dialogId) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
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

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:left-56 min-[1600px]:right-[516px] min-[1920px]:right-[576px]">
          <motion.button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 bg-slate-950/24"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={closeOnBackdrop ? onClose : undefined}
          />
          <motion.aside
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabelledBy ? undefined : ariaLabel}
            aria-labelledby={ariaLabelledBy}
            tabIndex={-1}
            initial={{ y: 12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 12, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={`relative max-h-[calc(100vh-2rem)] w-full ${sizeClass[size]} overflow-y-auto rounded-panel border border-line bg-white shadow-2xl outline-none`}
          >
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
