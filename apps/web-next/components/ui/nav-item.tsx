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
  variant?: 'sidebar' | 'mobile';
};

function navClassName(active: boolean, enabled: boolean, variant: 'sidebar' | 'mobile') {
  if (variant === 'mobile') {
    return clsx(
      'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors duration-150',
      active
        ? 'border-ink bg-ink text-white shadow-panel'
        : enabled
          ? 'border-line bg-white text-slate-600 hover:bg-slate-50 hover:text-ink'
          : 'cursor-default border-line bg-slate-50 text-slate-400'
    );
  }

  return clsx(
    'flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors duration-150',
    active
      ? 'bg-ink text-white shadow-panel'
      : enabled
        ? 'text-slate-600 hover:bg-slate-100 hover:text-ink'
        : 'cursor-default text-slate-400'
  );
}

export function NavItem({ href, label, icon: Icon, active = false, enabled = true, variant = 'sidebar' }: NavItemProps) {
  const className = navClassName(active, enabled, variant);
  const iconSize = variant === 'mobile' ? 15 : 16;

  if (!enabled) {
    return (
      <button type="button" className={className} aria-disabled="true" title="待迁移">
        <Icon size={iconSize} />
        <span>{label}</span>
        {variant === 'sidebar' ? (
          <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">soon</span>
        ) : null}
      </button>
    );
  }

  return (
    <Link href={href} prefetch={false} className={className}>
      <Icon size={iconSize} />
      <span>{label}</span>
    </Link>
  );
}
