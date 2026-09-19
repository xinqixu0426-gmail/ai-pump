'use client';

import { useEffect, useRef } from 'react';
import { CircleAlert } from 'lucide-react';

export function FormError({ message }: { message: string | null }) {
  const errorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!message) return;
    const frame = window.requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      errorRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [message]);

  if (!message) return null;

  return (
    <div
      ref={errorRef}
      role="alert"
      tabIndex={-1}
      className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 outline-none focus:ring-2 focus:ring-rose-300"
    >
      <CircleAlert size={16} className="shrink-0" />
      {message}
    </div>
  );
}
