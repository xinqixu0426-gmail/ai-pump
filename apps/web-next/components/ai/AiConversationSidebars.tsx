'use client';

import {
  AlertCircle,
  ClipboardList,
  Coins,
  Database,
  FileSearch,
  History,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  ShieldAlert,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { AiConversationSummary } from '@/lib/ai';
import { dateText } from '@/components/ai/AiResultPrimitives';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge } from '@/components/ui/status-badge';

export type AiSampleCategory = '常用' | '成本' | '订单' | '质量';
export type AiAsideMode = 'history' | 'templates';

export type AiTaskSample = {
  category: AiSampleCategory;
  icon: LucideIcon;
  label: string;
  prompt: string;
  mode?: 'read' | 'write';
};

const asideModeOptions: Array<{ value: AiAsideMode; label: string }> = [
  { value: 'history', label: '历史' },
  { value: 'templates', label: '模板' },
];

const sampleCategoryOptions: Array<{ value: AiSampleCategory; label: string }> = [
  { value: '常用', label: '常用' },
  { value: '成本', label: '成本' },
  { value: '订单', label: '订单' },
  { value: '质量', label: '质量' },
];

export const aiTaskSamples: AiTaskSample[] = [
  { category: '常用', icon: ClipboardList, label: '最近订单', prompt: '查一下最近 5 个订单' },
  { category: '常用', icon: FileSearch, label: '转子出图', prompt: '用 V750 模板出 160 片转子图' },
  { category: '成本', icon: Database, label: '成本查询', prompt: 'V750 的成本是多少' },
  { category: '成本', icon: Database, label: '配方对比', prompt: '对比 V750 和 V550 配方' },
  { category: '成本', icon: Coins, label: '差异解释', prompt: '为什么 12-140 比 12-120 贵' },
  { category: '订单', icon: ClipboardList, label: '订单流转', prompt: '把订单 5 改成采购中', mode: 'write' },
  { category: '订单', icon: ReceiptText, label: '待采购', prompt: '现在有哪些订单卡在待采购' },
  { category: '质量', icon: ShieldAlert, label: '今日待办', prompt: '今天最先需要处理什么' },
  { category: '质量', icon: Database, label: '数据质量', prompt: '系统资料还有什么问题会影响 AI 准确性' },
  { category: '质量', icon: FileSearch, label: '零件检索', prompt: '找所有螺丝零件' },
];

export const aiStarterSamples = aiTaskSamples.filter((sample) => (
  ['最近订单', '成本查询', '待采购', '今日待办'].includes(sample.label)
));

type ConversationListProps = {
  conversations: AiConversationSummary[];
  filteredConversations: AiConversationSummary[];
  activeConversationId: number | null;
  openingConversationId: number | null;
  historyLoading: boolean;
  loading: boolean;
  mobile?: boolean;
  onOpenConversation: (id: number) => void;
  onDeleteConversation: (conversation: AiConversationSummary) => void;
  selectionMode: boolean;
  selectedConversationIds: Set<number>;
  onToggleConversation: (id: number) => void;
};

function ConversationList({
  conversations,
  filteredConversations,
  activeConversationId,
  openingConversationId,
  historyLoading,
  loading,
  mobile = false,
  onOpenConversation,
  onDeleteConversation,
  selectionMode,
  selectedConversationIds,
  onToggleConversation,
}: ConversationListProps) {
  if (historyLoading) {
    return <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted"><Loader2 size={15} className="animate-spin" />正在读取</div>;
  }
  if (conversations.length === 0) {
    return <div className={mobile ? 'px-3 py-8 text-center text-sm text-muted' : 'rounded-md border border-dashed border-line px-3 py-5 text-center text-sm text-muted'}>暂无历史会话</div>;
  }
  if (filteredConversations.length === 0) {
    return <div className={mobile ? 'px-3 py-8 text-center text-sm text-muted' : 'rounded-md border border-dashed border-line px-3 py-5 text-center text-sm text-muted'}>没有匹配的会话</div>;
  }

  return filteredConversations.map((conversation) => (
    <div
      key={`${mobile ? 'mobile-' : ''}${conversation.id}`}
      className={mobile
        ? `flex items-center gap-1 rounded-md p-1 ${activeConversationId === conversation.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`
        : `group flex items-center gap-1 rounded-md border p-1 ${activeConversationId === conversation.id ? 'border-slate-300 bg-slate-100' : 'border-transparent hover:bg-slate-50'}`}
    >
      {selectionMode ? (
        <label className="flex h-10 w-9 shrink-0 items-center justify-center" title={`选择会话 ${conversation.title}`}>
          <Checkbox
            checked={selectedConversationIds.has(conversation.id)}
            onChange={() => onToggleConversation(conversation.id)}
            aria-label={`选择会话 ${conversation.title}`}
            disabled={loading}
          />
        </label>
      ) : null}
      <button
        type="button"
        onClick={() => selectionMode ? onToggleConversation(conversation.id) : onOpenConversation(conversation.id)}
        disabled={loading || (!selectionMode && openingConversationId !== null)}
        className={mobile
          ? 'min-w-0 flex-1 rounded px-2 py-2 text-left disabled:opacity-60'
          : 'min-w-0 flex-1 rounded px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-60'}
      >
        <span className="flex items-center gap-2">
          {openingConversationId === conversation.id
            ? <Loader2 size={mobile ? 14 : 13} className="shrink-0 animate-spin text-muted" />
            : <MessageSquareText size={mobile ? 14 : 13} className="shrink-0 text-muted" />}
          <span className="truncate text-sm font-medium text-ink">{conversation.title}</span>
        </span>
        <span className="mt-1 block truncate pl-5 text-xs text-muted">{conversation.messageCount} 条 · {dateText(conversation.updatedAt)}</span>
      </button>
      {!selectionMode ? <Button
        variant="ghost"
        size="sm"
        className={mobile
          ? 'h-9 w-9 px-0 text-slate-400 hover:text-rose-600'
          : 'w-8 px-0 text-slate-400 opacity-0 transition-opacity hover:text-rose-600 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100'}
        icon={<Trash2 size={14} />}
        aria-label={`删除会话 ${conversation.title}`}
        title="删除会话"
        onClick={() => onDeleteConversation(conversation)}
        disabled={loading}
      /> : null}
    </div>
  ));
}

type ConversationStateProps = {
  conversations: AiConversationSummary[];
  filteredConversations: AiConversationSummary[];
  activeConversationId: number | null;
  openingConversationId: number | null;
  historyQuery: string;
  historyLoading: boolean;
  historyError: string;
  loading: boolean;
  onHistoryQueryChange: (value: string) => void;
  onOpenConversation: (id: number) => void;
  onDeleteConversation: (conversation: AiConversationSummary) => void;
  selectionMode: boolean;
  selectedConversationIds: Set<number>;
  onSelectionModeChange: (value: boolean) => void;
  onToggleConversation: (id: number) => void;
  onToggleAllVisible: () => void;
  onRequestBatchDelete: () => void;
};

type AiDesktopSidebarProps = ConversationStateProps & {
  hidden: boolean;
  asideMode: AiAsideMode;
  activeSampleCategory: AiSampleCategory;
  promptBusy: boolean;
  onAsideModeChange: (value: AiAsideMode) => void;
  onSampleCategoryChange: (value: AiSampleCategory) => void;
  onRunSample: (prompt: string) => void;
  onEditPrompt: () => void;
};

export function AiDesktopSidebar({
  hidden,
  asideMode,
  activeSampleCategory,
  conversations,
  filteredConversations,
  activeConversationId,
  openingConversationId,
  historyQuery,
  historyLoading,
  historyError,
  loading,
  promptBusy,
  onAsideModeChange,
  onSampleCategoryChange,
  onHistoryQueryChange,
  onOpenConversation,
  onDeleteConversation,
  selectionMode,
  selectedConversationIds,
  onSelectionModeChange,
  onToggleConversation,
  onToggleAllVisible,
  onRequestBatchDelete,
  onRunSample,
  onEditPrompt,
}: AiDesktopSidebarProps) {
  const visibleSamples = aiTaskSamples.filter((sample) => sample.category === activeSampleCategory);

  return (
    <aside className={`${hidden ? 'hidden' : 'hidden lg:flex'} min-h-0 min-w-0 flex-col border-r border-line bg-white p-4`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          {asideMode === 'history' ? <History size={16} /> : <MessageSquareText size={16} />}
          {asideMode === 'history' ? '会话记录' : '任务模板'}
        </div>
        <SegmentedControl value={asideMode} options={asideModeOptions} onChange={onAsideModeChange} ariaLabel="AI 侧栏内容" />
      </div>

      {asideMode === 'history' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <label className="relative mb-2 block">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={historyQuery}
              onChange={(event) => onHistoryQueryChange(event.target.value)}
              placeholder="搜索会话"
              aria-label="搜索会话"
              className="h-9 w-full rounded-md border border-line bg-slate-50 pl-8 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
            />
          </label>
          <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
            {selectionMode ? (
              <>
                <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
                  <Checkbox
                    checked={filteredConversations.length > 0 && filteredConversations.every((item) => selectedConversationIds.has(item.id))}
                    onChange={onToggleAllVisible}
                    aria-label="全选当前会话"
                    disabled={loading || filteredConversations.length === 0}
                  />
                  <span className="truncate">已选 {selectedConversationIds.size} 项</span>
                </label>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => onSelectionModeChange(false)} disabled={loading}>取消</Button>
                  <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={onRequestBatchDelete} disabled={loading || selectedConversationIds.size === 0}>删除</Button>
                </div>
              </>
            ) : (
              <Button variant="ghost" size="sm" className="ml-auto text-muted" onClick={() => onSelectionModeChange(true)} disabled={loading || conversations.length === 0}>批量管理</Button>
            )}
          </div>
          {historyError ? (
            <div className="mb-2 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{historyError}</span>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            <ConversationList
              conversations={conversations}
              filteredConversations={filteredConversations}
              activeConversationId={activeConversationId}
              openingConversationId={openingConversationId}
              historyLoading={historyLoading}
              loading={loading}
              onOpenConversation={onOpenConversation}
              onDeleteConversation={onDeleteConversation}
              selectionMode={selectionMode}
              selectedConversationIds={selectedConversationIds}
              onToggleConversation={onToggleConversation}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <SegmentedControl value={activeSampleCategory} options={sampleCategoryOptions} onChange={onSampleCategoryChange} ariaLabel="AI 任务模板分类" />
          <div className="-mx-1 mt-3 flex max-w-full gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:grid lg:max-h-[calc(100vh-21rem)] lg:grid-cols-1 lg:overflow-y-auto lg:px-0 lg:pb-0">
            {visibleSamples.map((sample) => {
              const Icon = sample.icon;
              return (
                <button
                  key={sample.prompt}
                  type="button"
                  onClick={() => onRunSample(sample.prompt)}
                  disabled={loading}
                  className="group flex min-h-14 min-w-[190px] items-center gap-3 rounded-panel border border-line bg-slate-50 px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-16 lg:min-w-0"
                >
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 group-hover:text-ink"><Icon size={17} /></span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{sample.label}</span>
                      <StatusBadge tone={sample.mode === 'write' ? 'amber' : 'blue'} className="h-5 min-w-0 px-1.5">{sample.mode === 'write' ? '确认' : '只读'}</StatusBadge>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{sample.prompt}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-3 border-t border-line pt-2">
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted" icon={<Pencil size={15} />} onClick={onEditPrompt} disabled={promptBusy}>
          工厂配置
        </Button>
      </div>
    </aside>
  );
}

type AiMobileConversationDrawerProps = ConversationStateProps & {
  open: boolean;
  asideMode: AiAsideMode;
  activeSampleCategory: AiSampleCategory;
  promptBusy: boolean;
  onClose: () => void;
  onNewConversation: () => void;
  onEditPrompt: () => void;
  onAsideModeChange: (value: AiAsideMode) => void;
  onSampleCategoryChange: (value: AiSampleCategory) => void;
  onRunSample: (prompt: string) => void;
};

export function AiMobileConversationDrawer({
  open,
  asideMode,
  activeSampleCategory,
  conversations,
  filteredConversations,
  activeConversationId,
  openingConversationId,
  historyQuery,
  historyLoading,
  historyError,
  loading,
  promptBusy,
  onClose,
  onNewConversation,
  onHistoryQueryChange,
  onOpenConversation,
  onDeleteConversation,
  selectionMode,
  selectedConversationIds,
  onSelectionModeChange,
  onToggleConversation,
  onToggleAllVisible,
  onRequestBatchDelete,
  onEditPrompt,
  onAsideModeChange,
  onSampleCategoryChange,
  onRunSample,
}: AiMobileConversationDrawerProps) {
  const visibleSamples = aiTaskSamples.filter((sample) => sample.category === activeSampleCategory);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="left"
      width="sm"
      layer="assistant"
      ariaLabel="AI 会话与任务模板"
      panelClassName="ai-mobile-drawer flex w-[86vw] max-w-[340px] flex-col overflow-hidden px-3"
    >
            <div className="flex items-center justify-between gap-3 border-b border-line pb-2 pt-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">AI 工作台</div>
                <div className="mt-0.5 text-xs text-muted">{asideMode === 'history' ? '会话记录' : '任务模板'}</div>
              </div>
              <Button variant="ghost" size="sm" className="h-9 w-9 px-0" icon={<X size={17} />} aria-label="关闭" title="关闭" onClick={onClose} />
            </div>

            <Button variant="secondary" className="mt-3 w-full" icon={<Plus size={16} />} onClick={onNewConversation} disabled={loading}>
              新建会话
            </Button>

            <div className="mt-3">
              <SegmentedControl value={asideMode} options={asideModeOptions} onChange={onAsideModeChange} ariaLabel="移动端 AI 侧栏内容" />
            </div>

            {asideMode === 'history' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <label className="relative mt-3 block">
                  <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="search"
                    value={historyQuery}
                    onChange={(event) => onHistoryQueryChange(event.target.value)}
                    placeholder="搜索会话"
                    aria-label="搜索会话"
                    className="h-9 w-full rounded-md border border-line bg-slate-50 pl-8 pr-3 text-sm text-ink outline-none placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
                  />
                </label>

                <div className="mt-2 flex min-h-9 items-center justify-between gap-2">
                  {selectionMode ? (
                    <>
                      <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
                        <Checkbox
                          checked={filteredConversations.length > 0 && filteredConversations.every((item) => selectedConversationIds.has(item.id))}
                          onChange={onToggleAllVisible}
                          aria-label="全选当前会话"
                          disabled={loading || filteredConversations.length === 0}
                        />
                        <span>已选 {selectedConversationIds.size} 项</span>
                      </label>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onSelectionModeChange(false)} disabled={loading}>取消</Button>
                        <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={onRequestBatchDelete} disabled={loading || selectedConversationIds.size === 0}>删除</Button>
                      </div>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" className="ml-auto text-muted" onClick={() => onSelectionModeChange(true)} disabled={loading || conversations.length === 0}>批量管理</Button>
                  )}
                </div>

                {historyError ? (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{historyError}</span>
                  </div>
                ) : null}

                <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
                  <ConversationList
                    conversations={conversations}
                    filteredConversations={filteredConversations}
                    activeConversationId={activeConversationId}
                    openingConversationId={openingConversationId}
                    historyLoading={historyLoading}
                    loading={loading}
                    mobile
                    onOpenConversation={onOpenConversation}
                    onDeleteConversation={onDeleteConversation}
                    selectionMode={selectionMode}
                    selectedConversationIds={selectedConversationIds}
                    onToggleConversation={onToggleConversation}
                  />
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto py-3">
                <SegmentedControl value={activeSampleCategory} options={sampleCategoryOptions} onChange={onSampleCategoryChange} ariaLabel="移动端 AI 任务模板分类" />
                <div className="mt-3 grid gap-2">
                  {visibleSamples.map((sample) => {
                    const Icon = sample.icon;
                    return (
                      <button
                        key={sample.prompt}
                        type="button"
                        onClick={() => onRunSample(sample.prompt)}
                        disabled={loading}
                        className="flex min-h-16 items-center gap-3 rounded-md border border-line bg-slate-50 px-3 py-2.5 text-left disabled:opacity-60"
                      >
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600"><Icon size={17} /></span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-ink">{sample.label}</span>
                            <StatusBadge tone={sample.mode === 'write' ? 'amber' : 'blue'} className="h-5 min-w-0 px-1.5">{sample.mode === 'write' ? '确认' : '只读'}</StatusBadge>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted">{sample.prompt}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="border-t border-line pt-2">
              <Button variant="ghost" className="w-full justify-start" icon={<Pencil size={16} />} onClick={onEditPrompt} disabled={promptBusy}>
                编辑工厂配置
              </Button>
            </div>
    </Drawer>
  );
}
