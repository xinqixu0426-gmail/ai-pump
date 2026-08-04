'use client';

import { useCallback, useEffect, useState } from 'react';

type ConfirmDiscardOptions = {
  open: boolean;
  busy?: boolean;
  onDiscard: () => void;
  message?: string;
};

export function useConfirmDiscard({
  open,
  busy = false,
  onDiscard,
  message = '当前表单有尚未保存的修改，确定放弃吗？',
}: ConfirmDiscardOptions) {
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) setDirty(false);
  }, [open]);

  useEffect(() => {
    if (!open || !dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty, open]);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm(message)) return;
    setDirty(false);
    onDiscard();
  }, [busy, dirty, message, onDiscard]);
  const markDirty = useCallback(() => setDirty(true), []);
  const resetDirty = useCallback(() => setDirty(false), []);

  return {
    dirty,
    markDirty,
    resetDirty,
    requestClose,
  };
}
