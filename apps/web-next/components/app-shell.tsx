'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bot,
  Boxes,
  Cable,
  Database,
  FileText,
  Layers3,
  MessageSquareText,
  Package,
  ReceiptText,
  RotateCcwSquare,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UsersRound,
} from 'lucide-react';
import { AiView } from '@/components/ai-view';
import { NavItem, NavMenu } from '@/components/ui/nav-item';
import { Button } from '@/components/ui/button';
import {
  AI_PAGE_CONTEXT_EVENT,
  readCurrentAiPageContext,
  type AiPageContext,
} from '@/lib/page-context';

const salesNavItems = [
  { href: '/customers', label: '客户', icon: UsersRound },
  { href: '/quotations', label: '报价', icon: FileText },
  { href: '/orders', label: '订单', icon: ReceiptText },
];

const supplyNavItems = [
  { href: '/purchase', label: '采购', icon: ShoppingCart },
  { href: '/parts', label: '零件与库存', icon: Boxes },
  { href: '/coils', label: '线圈与库存', icon: Cable },
];

const engineeringNavItems = [
  { href: '/recipes', label: '配方', icon: Package },
  { href: '/rotor', label: '转子出图', icon: RotateCcwSquare },
];

const systemNavItems = [
  { href: '/dashboard?view=quality', label: '数据质量', icon: ShieldCheck },
  { href: '/dashboard?view=knowledge', label: '知识库', icon: Database },
  { href: '/setup', label: '系统设置', icon: Settings2 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAiWorkspace = pathname === '/ai';
  const isSetupWorkspace = pathname === '/setup';
  const isFullWorkspace = isAiWorkspace || isSetupWorkspace;
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelDocked, setAiPanelDocked] = useState(false);
  const [pageContext, setPageContext] = useState<AiPageContext | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1600px)');
    const syncDockedState = () => setAiPanelDocked(media.matches);
    syncDockedState();
    media.addEventListener('change', syncDockedState);
    return () => media.removeEventListener('change', syncDockedState);
  }, []);

  useEffect(() => {
    setAiPanelOpen(false);
  }, [pathname]);

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
          <nav
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:overflow-visible"
            aria-label="主导航"
          >
            <NavItem
              href="/dashboard"
              label="看板"
              icon={BarChart3}
              active={pathname === '/dashboard'}
              variant="top"
            />
            <NavMenu
              label="销售"
              icon={UsersRound}
              active={salesNavItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))}
              items={salesNavItems}
            />
            <NavMenu
              label="供应链"
              icon={Truck}
              active={supplyNavItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))}
              items={supplyNavItems}
            />
            <NavMenu
              label="产品工程"
              icon={Layers3}
              active={engineeringNavItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))}
              items={engineeringNavItems}
            />
            <NavItem
              href="/ai"
              label="AI"
              icon={Bot}
              active={pathname === '/ai'}
              variant="top"
            />
            <NavMenu
              label="系统"
              icon={Settings2}
              active={pathname === '/setup'}
              items={systemNavItems}
              align="right"
            />
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
