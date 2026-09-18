'use client';

import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Maximize2, Minimize2, Pin, PinOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const AI_PANEL_MIN_WIDTH = 420;
export const AI_PANEL_MAX_WIDTH = 720;
export const AI_PANEL_DEFAULT_WIDTH = 540;

export function clampAiPanelWidth(width: number) {
  return Math.min(AI_PANEL_MAX_WIDTH, Math.max(AI_PANEL_MIN_WIDTH, Math.round(width)));
}

type AssistantPanelProps = {
  open: boolean;
  docked: boolean;
  canDock: boolean;
  pinned: boolean;
  fullscreen: boolean;
  width: number;
  children: (controls: ReactNode) => ReactNode;
  onClose: () => void;
  onPinnedChange: (pinned: boolean) => void;
  onFullscreenChange: (fullscreen: boolean) => void;
  onWidthChange: (width: number) => void;
};

export function AssistantPanel({
  open,
  docked,
  canDock,
  pinned,
  fullscreen,
  width,
  children,
  onClose,
  onPinnedChange,
  onFullscreenChange,
  onWidthChange,
}: AssistantPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || docked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [docked, open]);

  useEffect(() => {
    if (!open || docked) return;
    const focusFrame = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Element && event.target.closest('[data-dialog-root]')) return;
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [docked, onClose, open]);

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (fullscreen || window.innerWidth < 640) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      onWidthChange(clampAiPanelWidth(startWidth + startX - moveEvent.clientX));
    };
    const stopResize = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      panelRef.current?.focus({ preventScroll: true });
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
  }

  if (!open) return null;

  const controls = (
    <>
      {canDock ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 px-0"
          icon={pinned ? <PinOff size={16} /> : <Pin size={16} />}
          aria-label={pinned ? '取消固定 AI 助手' : '固定 AI 助手到右侧'}
          title={pinned ? '取消固定' : '固定到右侧'}
          onClick={() => onPinnedChange(!pinned)}
        />
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="hidden h-9 w-9 px-0 sm:inline-flex"
        icon={fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        aria-label={fullscreen ? '退出 AI 助手全屏' : '全屏显示 AI 助手'}
        title={fullscreen ? '退出全屏' : '全屏'}
        onClick={() => onFullscreenChange(!fullscreen)}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-9 w-9 px-0"
        icon={<X size={18} />}
        aria-label="收起 AI 助手"
        title="收起"
        onClick={onClose}
      />
    </>
  );

  if (docked) {
    return (
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="sticky top-5 h-[calc(100dvh-40px)] min-w-0 outline-none"
        aria-label="业务 AI 助手"
        style={{ width }}
      >
        <button
          type="button"
          className="absolute inset-y-0 left-0 z-20 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center min-[1600px]:flex"
          aria-label="调整 AI 助手宽度"
          title="拖动调整宽度"
          onPointerDown={startResize}
        >
          <span className="h-14 w-1 rounded-full bg-slate-300 transition-colors hover:bg-slate-500" />
        </button>
        {children(controls)}
      </aside>
    );
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[100] bg-slate-950/25"
        aria-label="关闭业务 AI 助手遮罩"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className={`fixed z-[110] min-w-0 bg-white outline-none ${
          fullscreen
            ? 'inset-0'
            : 'inset-0 w-full sm:bottom-5 sm:left-auto sm:right-5 sm:top-5 sm:w-[min(var(--ai-panel-width),calc(100vw-2.5rem))] sm:overflow-hidden sm:rounded-panel sm:border sm:border-line sm:shadow-2xl'
        }`}
        aria-label="业务 AI 助手"
        role="dialog"
        aria-modal="true"
        style={fullscreen ? undefined : ({ '--ai-panel-width': `${width}px` } as CSSProperties)}
      >
        {!fullscreen ? (
          <button
            type="button"
            className="absolute inset-y-0 left-0 z-20 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center sm:flex"
            aria-label="调整 AI 助手宽度"
            title="拖动调整宽度"
            onPointerDown={startResize}
          >
            <span className="h-14 w-1 rounded-full bg-slate-300 transition-colors hover:bg-slate-500" />
          </button>
        ) : null}
        {children(controls)}
      </aside>
    </>
  );
}
