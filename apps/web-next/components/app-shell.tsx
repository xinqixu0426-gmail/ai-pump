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
  Menu,
  Package,
  ReceiptText,
  RotateCcwSquare,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UsersRound,
  X,
} from 'lucide-react';
import { AiView } from '@/components/ai-view';
import {
  AI_PANEL_DEFAULT_WIDTH,
  AssistantPanel,
  clampAiPanelWidth,
} from '@/components/ai/assistant-panel';
import { NavItem, NavSection } from '@/components/ui/nav-item';
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

const AI_PANEL_STORAGE = {
  open: 'pump.ai-panel.open',
  pinned: 'pump.ai-panel.pinned',
  width: 'pump.ai-panel.width',
} as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAiWorkspace = pathname === '/ai';
  const isFullWorkspace = isAiWorkspace;
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelPinned, setAiPanelPinned] = useState(false);
  const [aiPanelFullscreen, setAiPanelFullscreen] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(AI_PANEL_DEFAULT_WIDTH);
  const [aiPanelPreferencesLoaded, setAiPanelPreferencesLoaded] = useState(false);
  const [isWideViewport, setIsWideViewport] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [currentHref, setCurrentHref] = useState(pathname);
  const [pageContext, setPageContext] = useState<AiPageContext | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1600px)');
    const syncWideViewport = () => setIsWideViewport(media.matches);
    syncWideViewport();
    media.addEventListener('change', syncWideViewport);
    return () => media.removeEventListener('change', syncWideViewport);
  }, []);

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(AI_PANEL_STORAGE.width));
    setAiPanelWidth(Number.isFinite(storedWidth) && storedWidth > 0 ? clampAiPanelWidth(storedWidth) : AI_PANEL_DEFAULT_WIDTH);
    setAiPanelPinned(window.localStorage.getItem(AI_PANEL_STORAGE.pinned) === 'true');
    setAiPanelOpen(window.localStorage.getItem(AI_PANEL_STORAGE.open) === 'true');
    setAiPanelPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!aiPanelPreferencesLoaded) return;
    window.localStorage.setItem(AI_PANEL_STORAGE.open, String(aiPanelOpen));
    window.localStorage.setItem(AI_PANEL_STORAGE.pinned, String(aiPanelPinned));
    window.localStorage.setItem(AI_PANEL_STORAGE.width, String(aiPanelWidth));
  }, [aiPanelOpen, aiPanelPinned, aiPanelPreferencesLoaded, aiPanelWidth]);

  useEffect(() => {
    setMobileNavOpen(false);
    setCurrentHref(`${pathname}${window.location.search}`);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.getElementById('mobile-nav-close')?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileNavOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileNavOpen]);

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

  function setAiPanelVisibility(open: boolean) {
    setAiPanelOpen(open);
    if (!open) setAiPanelFullscreen(false);
  }

  function isNavItemActive(href: string) {
    if (href.includes('?')) return currentHref === href;
    if (href === '/dashboard') return currentHref === '/dashboard';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function handleNavigation(href: string) {
    setCurrentHref(href);
    setMobileNavOpen(false);
  }

  const aiPanelDocked = aiPanelOpen && aiPanelPinned && isWideViewport && !aiPanelFullscreen;

  const navigation = (
    <nav className="space-y-4" aria-label="主导航">
      <NavItem
        href="/dashboard"
        label="看板"
        icon={BarChart3}
        active={isNavItemActive('/dashboard')}
        onNavigate={handleNavigation}
      />
      <NavSection
        label="销售"
        icon={UsersRound}
        active={salesNavItems.some((item) => isNavItemActive(item.href))}
        items={salesNavItems.map((item) => ({ ...item, active: isNavItemActive(item.href) }))}
        onNavigate={handleNavigation}
      />
      <NavSection
        label="供应链"
        icon={Truck}
        active={supplyNavItems.some((item) => isNavItemActive(item.href))}
        items={supplyNavItems.map((item) => ({ ...item, active: isNavItemActive(item.href) }))}
        onNavigate={handleNavigation}
      />
      <NavSection
        label="产品工程"
        icon={Layers3}
        active={engineeringNavItems.some((item) => isNavItemActive(item.href))}
        items={engineeringNavItems.map((item) => ({ ...item, active: isNavItemActive(item.href) }))}
        onNavigate={handleNavigation}
      />
      <NavItem
        href="/ai"
        label="AI"
        icon={Bot}
        active={isNavItemActive('/ai')}
        onNavigate={handleNavigation}
      />
      <NavSection
        label="系统"
        icon={Settings2}
        active={systemNavItems.some((item) => isNavItemActive(item.href))}
        items={systemNavItems.map((item) => ({ ...item, active: isNavItemActive(item.href) }))}
        onNavigate={handleNavigation}
      />
    </nav>
  );

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen min-w-0">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-white lg:flex">
        <div className="border-b border-line px-5 py-5">
          <div className="text-sm font-semibold text-ink">水泵 BOM 管理助手</div>
          <div className="mt-0.5 text-xs text-muted">生产管理系统</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">{navigation}</div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className={`${isAiWorkspace ? 'hidden' : 'flex'} sticky top-0 z-30 h-14 items-center gap-3 border-b border-line bg-white/92 px-3 backdrop-blur lg:hidden`}>
          <Button
            variant="secondary"
            size="sm"
            icon={<Menu size={17} />}
            aria-label="打开主导航"
            onClick={() => setMobileNavOpen(true)}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">水泵 BOM 管理助手</div>
            <div className="truncate text-[11px] text-muted">生产管理系统</div>
          </div>
        </header>

        {mobileNavOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 bg-slate-950/25 lg:hidden"
              aria-label="关闭主导航遮罩"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside
              className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,88vw)] flex-col border-r border-line bg-white shadow-xl lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="移动端主导航"
            >
              <div className="flex h-16 items-center justify-between border-b border-line px-4">
                <div>
                  <div className="text-sm font-semibold text-ink">水泵 BOM 管理助手</div>
                  <div className="text-xs text-muted">全部业务入口</div>
                </div>
                <Button
                  id="mobile-nav-close"
                  variant="ghost"
                  size="sm"
                  icon={<X size={18} />}
                  aria-label="关闭主导航"
                  onClick={() => setMobileNavOpen(false)}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">{navigation}</div>
            </aside>
          </>
        ) : null}

        <main className={isAiWorkspace ? 'p-0 lg:px-5 lg:py-5' : 'px-3 py-4 md:px-5 md:py-5'}>
          {isFullWorkspace ? (
            <div className={`mx-auto w-full ${isAiWorkspace ? 'max-w-[1720px]' : 'max-w-[1480px]'}`}>{children}</div>
          ) : (
            <div
              className="mx-auto grid w-full max-w-[1920px] min-w-0 gap-4"
              style={{ gridTemplateColumns: aiPanelDocked ? `minmax(0, 1fr) ${aiPanelWidth}px` : 'minmax(0, 1fr)' }}
            >
              <div className="min-w-0">{children}</div>
              {!aiPanelOpen ? (
                <button
                  type="button"
                  className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-[90] inline-flex h-14 w-14 items-center justify-center rounded-full border border-slate-700 bg-ink text-white shadow-xl transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                  aria-label="展开业务 AI 助手"
                  title="展开业务 AI 助手"
                  onClick={() => setAiPanelVisibility(true)}
                >
                  <Bot size={22} />
                </button>
              ) : null}
              <AssistantPanel
                open={aiPanelOpen}
                docked={aiPanelDocked}
                canDock={isWideViewport}
                pinned={aiPanelPinned}
                fullscreen={aiPanelFullscreen}
                width={aiPanelWidth}
                onClose={() => setAiPanelVisibility(false)}
                onPinnedChange={setAiPanelPinned}
                onFullscreenChange={setAiPanelFullscreen}
                onWidthChange={setAiPanelWidth}
              >
                {(controls) => (
                  <AiView
                    variant="panel"
                    pageContext={pageContext}
                    panelControls={controls}
                  />
                )}
              </AssistantPanel>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
