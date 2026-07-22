'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ChevronDown, type LucideIcon } from 'lucide-react';

type NavItemProps = {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  enabled?: boolean;
  variant?: 'sidebar' | 'mobile' | 'top';
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

export function NavItem({ href, label, icon: Icon, active = false, enabled = true, variant = 'sidebar' }: NavItemProps) {
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
    <Link href={href} prefetch={false} className={className}>
      <Icon size={iconSize} />
      <span>{label}</span>
    </Link>
  );
}

type NavMenuProps = {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  items: Array<{
    href: string;
    label: string;
    icon: LucideIcon;
  }>;
};

export function NavMenu({ label, icon: Icon, active = false, items }: NavMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={clsx(
          'flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150',
          active ? 'bg-ink text-white shadow-panel' : 'text-slate-600 hover:bg-slate-100 hover:text-ink'
        )}
      >
        <Icon size={15} />
        <span>{label}</span>
        <ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div role="menu" className="fixed left-3 right-3 z-40 mt-2 rounded-md border border-line bg-white p-1.5 shadow-xl sm:absolute sm:left-0 sm:right-auto sm:w-44">
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                role="menuitem"
                className="flex h-10 items-center gap-2 rounded-md px-3 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-ink"
                onClick={() => setOpen(false)}
              >
                <ItemIcon size={16} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
