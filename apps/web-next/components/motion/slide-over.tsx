'use client';

import { AnimatePresence, motion } from 'motion/react';

type SlideOverProps = {
  open: boolean;
  children: React.ReactNode;
  onClose: () => void;
  size?: 'standard' | 'wide' | 'workspace';
};

const sizeClass = {
  standard: 'max-w-3xl',
  wide: 'max-w-5xl',
  workspace: 'max-w-[min(1280px,calc(100vw-2rem))]',
};

export function SlideOver({ open, children, onClose, size = 'standard' }: SlideOverProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 min-[1600px]:right-[500px]">
          <motion.button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 bg-slate-950/24"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ y: 12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 12, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={`relative max-h-[calc(100vh-2rem)] w-full ${sizeClass[size]} overflow-y-auto rounded-panel border border-line bg-white shadow-2xl`}
          >
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
