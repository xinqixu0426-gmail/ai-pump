'use client';

import Link from 'next/link';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';

type NavItemProps = {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  enabled?: boolean;
};

function navClassName(active: boolean, enabled: boolean) {
  return clsx(
    'flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors duration-150',
    active
      ? 'bg-ink text-white shadow-panel'
      : enabled
        ? 'text-slate-600 hover:bg-slate-100 hover:text-ink'
        : 'cursor-default text-slate-400'
  );
}

export function NavItem({ href, label, icon: Icon, active = false, enabled = true }: NavItemProps) {
  const className = navClassName(active, enabled);

  if (!enabled) {
    return (
      <button type="button" className={className} aria-disabled="true" title="待迁移">
        <Icon size={16} />
        <span>{label}</span>
        <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">soon</span>
      </button>
    );
  }

  return (
    <Link href={href} prefetch={false} className={className}>
      <Icon size={16} />
      <span>{label}</span>
    </Link>
  );
}
