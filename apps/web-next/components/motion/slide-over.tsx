'use client';

import { Dialog, Drawer } from '@/components/ui/dialog';

type SlideOverProps = {
  open: boolean;
  children: React.ReactNode;
  onClose: () => void;
  size?: 'standard' | 'wide' | 'workspace' | 'fullscreen';
  closeOnBackdrop?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
};

export function SlideOver({
  open,
  children,
  onClose,
  size = 'standard',
  closeOnBackdrop = true,
  ariaLabel = '操作面板',
  ariaLabelledBy,
}: SlideOverProps) {
  if (size === 'workspace' || size === 'fullscreen') {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        size={size}
        closeOnBackdrop={closeOnBackdrop}
        ariaLabel={ariaLabel}
        ariaLabelledBy={ariaLabelledBy}
      >
        {children}
      </Dialog>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={size === 'standard' ? 'md' : 'lg'}
      closeOnBackdrop={closeOnBackdrop}
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
    >
      {children}
    </Drawer>
  );
}
