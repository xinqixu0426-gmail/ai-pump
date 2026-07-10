'use client';

import { usePathname } from 'next/navigation';
import { BarChart3, Bot, Boxes, Cable, FileText, Package, ReceiptText, RotateCcwSquare, ShoppingCart, UsersRound } from 'lucide-react';
import { NavItem } from '@/components/ui/nav-item';

const navItems = [
  { href: '/orders', label: '订单', icon: ReceiptText, enabled: true },
  { href: '/parts', label: '零件', icon: Boxes, enabled: true },
  { href: '/customers', label: '客户', icon: UsersRound, enabled: true },
  { href: '/recipes', label: '配方', icon: Package, enabled: true },
  { href: '/coils', label: '线圈', icon: Cable, enabled: true },
  { href: '/rotor', label: '出图', icon: RotateCcwSquare, enabled: true },
  { href: '/quotations', label: '报价', icon: FileText, enabled: true },
  { href: '/purchase', label: '采购', icon: ShoppingCart, enabled: true },
  { href: '/dashboard', label: '看板', icon: BarChart3, enabled: true },
  { href: '/ai', label: 'AI', icon: Bot, enabled: false },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-white/88 px-3 py-4 backdrop-blur md:block">
        <div className="px-3 pb-5">
          <div className="text-sm font-semibold tracking-tight text-ink">水泵管理系统</div>
          <div className="mt-1 text-xs text-muted">Next UI preview</div>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <NavItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={active}
                enabled={item.enabled}
              />
            );
          })}
        </nav>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-20 border-b border-line bg-white/78 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-ink">重构预览版</div>
              <div className="text-xs text-muted">API 仍由现有 Express 服务提供</div>
            </div>
            <div className="rounded-full border border-line bg-white px-3 py-1 text-xs text-muted shadow-panel">
              localhost:3001
            </div>
          </div>
        </header>

        <main className="px-4 py-6 md:px-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
