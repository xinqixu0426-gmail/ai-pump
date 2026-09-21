import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="p-8 text-center md:p-10">
      {Icon ? (
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-muted">
          <Icon size={18} />
        </div>
      ) : null}
      <div className={Icon ? 'mt-3 text-sm font-medium text-ink' : 'text-sm font-medium text-ink'}>{title}</div>
      {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
