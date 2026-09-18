import type { ReactNode } from 'react';

type TableScrollAreaProps = {
  label: string;
  children: ReactNode;
};

export function TableScrollArea({ label, children }: TableScrollAreaProps) {
  return (
    <div>
      <div className="border-b border-line bg-slate-50/70 px-3 py-1.5 text-xs text-muted lg:hidden">
        左右滑动查看完整表格
      </div>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400"
      >
        {children}
      </div>
    </div>
  );
}
