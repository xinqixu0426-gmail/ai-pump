'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { type LucideIcon } from 'lucide-react';

type NavItemProps = {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  enabled?: boolean;
  variant?: 'sidebar' | 'mobile' | 'top';
  onNavigate?: (href: string) => void;
};

function navClassName(active: boolean, enabled: boolean, variant: 'sidebar' | 'mobile' | 'top') {
  if (variant === 'mobile' || variant === 'top') {
    return clsx(
      'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150',
      active
        ? 'bg-ink text-white shadow-panel'
        : enabled
          ? 'text-slate-600 hover:bg-slate-100 hover:text-ink'
          : 'cursor-default text-slate-400'
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

export function NavItem({
  href,
  label,
  icon: Icon,
  active = false,
  enabled = true,
  variant = 'sidebar',
  onNavigate,
}: NavItemProps) {
  const className = navClassName(active, enabled, variant);
  const iconSize = variant === 'sidebar' ? 16 : 15;

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
    <Link
      href={href}
      prefetch={false}
      className={className}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate?.(href)}
    >
      <Icon size={iconSize} />
      <span>{label}</span>
    </Link>
  );
}

type NavSectionProps = {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  items: Array<{
    href: string;
    label: string;
    icon: LucideIcon;
    active?: boolean;
  }>;
  onNavigate?: (href: string) => void;
};

export function NavSection({ label, icon: Icon, active = false, items, onNavigate }: NavSectionProps) {
  return (
    <section aria-label={label} className="space-y-1">
      <div
        className={clsx(
          'flex h-8 items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em]',
          active ? 'text-ink' : 'text-slate-400'
        )}
      >
        <Icon size={14} />
        <span>{label}</span>
        <span className="ml-auto h-px flex-1 bg-slate-200" aria-hidden="true" />
      </div>
      <div className="space-y-1 border-l border-slate-200 pl-2">
        {items.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            variant="sidebar"
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </section>
  );
}
