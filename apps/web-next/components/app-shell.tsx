'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BarChart3, Bot, Boxes, BriefcaseBusiness, Cable, FileText, MessageSquareText, Package, ReceiptText, RotateCcwSquare, Settings2, ShoppingCart, UsersRound } from 'lucide-react';
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
  { href: '/setup', label: '初始化', icon: Settings2, enabled: true },
];

const businessNavItems = [
  { href: '/customers', label: '客户', icon: UsersRound },
  { href: '/quotations', label: '报价', icon: FileText },
  { href: '/orders', label: '订单', icon: ReceiptText },
];

const AI_PANEL_PREF_KEY = 'pump.ai-panel-open';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAiWorkspace = pathname === '/ai';
  const isSetupWorkspace = pathname === '/setup';
  const isFullWorkspace = isAiWorkspace || isSetupWorkspace;
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelDocked, setAiPanelDocked] = useState(false);
  const [pageContext, setPageContext] = useState<AiPageContext | null>(null);

  useEffect(() => {
    setAiPanelOpen(window.localStorage.getItem(AI_PANEL_PREF_KEY) === 'true');
    const media = window.matchMedia('(min-width: 1600px)');
    const syncDockedState = () => setAiPanelDocked(media.matches);
    syncDockedState();
    media.addEventListener('change', syncDockedState);
    return () => media.removeEventListener('change', syncDockedState);
  }, []);

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
    if (!aiPanelOpen || aiPanelDocked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [aiPanelDocked, aiPanelOpen]);

  function setAiPanelVisibility(open: boolean) {
    setAiPanelOpen(open);
    window.localStorage.setItem(AI_PANEL_PREF_KEY, String(open));
  }

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
          {!isFullWorkspace ? (
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              icon={<MessageSquareText size={16} />}
              aria-label={aiPanelOpen ? '收起业务 AI 助手' : '打开业务 AI 助手'}
              title={aiPanelOpen ? '收起业务 AI 助手' : '打开业务 AI 助手'}
              onClick={() => setAiPanelVisibility(!aiPanelOpen)}
            >
              <span className="hidden sm:inline">{aiPanelOpen ? '收起 AI' : '问 AI'}</span>
            </Button>
          ) : null}
        </div>
      </header>

      <main className={isAiWorkspace ? 'p-0 md:px-5 md:py-5' : 'px-3 py-4 md:px-5 md:py-5'}>
        {isFullWorkspace ? (
          <div className={`mx-auto w-full ${isAiWorkspace ? 'max-w-[1720px]' : 'max-w-[1480px]'}`}>{children}</div>
        ) : (
          <div className={`mx-auto grid w-full max-w-[1920px] min-w-0 gap-5 ${aiPanelOpen ? 'min-[1600px]:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
            <div className="min-w-0">{children}</div>
            {aiPanelOpen && !aiPanelDocked ? (
              <button
                type="button"
                className="fixed inset-0 z-[60] bg-slate-950/20"
                aria-label="关闭业务 AI 助手遮罩"
                onClick={() => setAiPanelVisibility(false)}
              />
            ) : null}
            <aside
              className={`${aiPanelOpen
                ? 'fixed inset-0 z-[70] min-w-0 bg-white p-0 sm:left-auto sm:w-[460px] sm:border-l sm:border-line sm:shadow-xl min-[1600px]:sticky min-[1600px]:bottom-auto min-[1600px]:left-auto min-[1600px]:right-auto min-[1600px]:top-[73px] min-[1600px]:h-[calc(100dvh-89px)] min-[1600px]:w-auto min-[1600px]:border-0 min-[1600px]:bg-transparent min-[1600px]:shadow-none'
                : 'hidden'}`}
              aria-label="业务 AI 助手"
              role={aiPanelOpen && !aiPanelDocked ? 'dialog' : undefined}
              aria-modal={aiPanelOpen && !aiPanelDocked ? true : undefined}
            >
              <AiView
                variant="panel"
                pageContext={pageContext}
                onClose={() => setAiPanelVisibility(false)}
              />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
