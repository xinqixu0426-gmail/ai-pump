'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BarChart3, Bot, Boxes, BriefcaseBusiness, Cable, FileText, MessageSquareText, Package, ReceiptText, RotateCcwSquare, ShoppingCart, UsersRound } from 'lucide-react';
import { AiView } from '@/components/ai-view';
import { NavItem, NavMenu } from '@/components/ui/nav-item';
import { Button } from '@/components/ui/button';
import {
  AI_PAGE_CONTEXT_EVENT,
  readCurrentAiPageContext,
  type AiPageContext,
} from '@/lib/page-context';

const navItems = [
  { href: '/ai', label: 'AI', icon: Bot, enabled: true },
  { href: '/dashboard', label: '看板', icon: BarChart3, enabled: true },
  { href: '/recipes', label: '配方', icon: Package, enabled: true },
  { href: '/parts', label: '零件', icon: Boxes, enabled: true },
  { href: '/purchase', label: '采购', icon: ShoppingCart, enabled: true },
  { href: '/coils', label: '线圈', icon: Cable, enabled: true },
  { href: '/rotor', label: '出图', icon: RotateCcwSquare, enabled: true },
];

const businessNavItems = [
  { href: '/customers', label: '客户', icon: UsersRound },
  { href: '/quotations', label: '报价', icon: FileText },
  { href: '/orders', label: '订单', icon: ReceiptText },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAiWorkspace = pathname === '/ai';
  const [mobileAiOpen, setMobileAiOpen] = useState(false);
  const [pageContext, setPageContext] = useState<AiPageContext | null>(null);

  useEffect(() => {
    const syncPageContext = () => setPageContext(readCurrentAiPageContext());
    syncPageContext();
    window.addEventListener('popstate', syncPageContext);
    window.addEventListener(AI_PAGE_CONTEXT_EVENT, syncPageContext);
    return () => {
      window.removeEventListener('popstate', syncPageContext);
      window.removeEventListener(AI_PAGE_CONTEXT_EVENT, syncPageContext);
    };
  }, [pathname]);

  useEffect(() => {
    if (!mobileAiOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileAiOpen]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen">
      <header className={`${isAiWorkspace ? 'hidden md:block' : 'block'} sticky top-0 z-30 border-b border-line bg-white/88 px-3 py-2 backdrop-blur md:px-5`}>
        <div className="mx-auto flex w-full max-w-[1920px] items-center gap-4">
          <div className="hidden shrink-0 xl:block">
            <div className="text-sm font-semibold text-ink">水泵 BOM 管理助手</div>
            <div className="text-xs text-muted">生产管理系统</div>
          </div>
          <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto xl:overflow-visible" aria-label="主导航">
            {navItems.slice(0, 2).map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={active}
                  enabled={item.enabled}
                  variant="top"
                />
              );
            })}
            <NavMenu
              label="业务"
              icon={BriefcaseBusiness}
              active={businessNavItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))}
              items={businessNavItems}
            />
            {navItems.slice(2).map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={active}
                  enabled={item.enabled}
                  variant="top"
                />
              );
            })}
          </nav>
          {!isAiWorkspace ? (
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 xl:hidden"
              icon={<MessageSquareText size={16} />}
              aria-label="打开业务 AI 助手"
              title="打开业务 AI 助手"
              onClick={() => setMobileAiOpen(true)}
            >
              <span className="hidden sm:inline">问 AI</span>
            </Button>
          ) : null}
        </div>
      </header>

      <main className={isAiWorkspace ? 'p-0 md:px-5 md:py-5' : 'px-3 py-4 md:px-5 md:py-5'}>
        {isAiWorkspace ? (
          <div className="mx-auto w-full max-w-[1720px]">{children}</div>
        ) : (
          <div className="mx-auto grid w-full max-w-[1920px] min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
            <div className="min-w-0">{children}</div>
            <aside
              className={`${mobileAiOpen ? 'fixed inset-0 z-50 bg-white p-0' : 'hidden'} min-w-0 xl:sticky xl:top-[73px] xl:block xl:h-[calc(100dvh-89px)] xl:bg-transparent`}
              aria-label="业务 AI 助手"
              role={mobileAiOpen ? 'dialog' : undefined}
              aria-modal={mobileAiOpen ? true : undefined}
            >
              <AiView
                variant="panel"
                pageContext={pageContext}
                onClose={() => setMobileAiOpen(false)}
              />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
