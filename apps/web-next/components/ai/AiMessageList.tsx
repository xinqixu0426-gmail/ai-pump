'use client';

import { memo, useEffect, useState, type RefObject } from 'react';
import { Bot, BrainCircuit, Clock3, Gauge, Hash, Loader2, MessageSquareWarning, RotateCcw, ThumbsUp, UserRound, Wrench } from 'lucide-react';
import type { AiAnswerFeedback, AiAttachment, AiToolResult, AiTurnMetrics } from '@/lib/ai';
import { aiStarterSamples } from '@/components/ai/AiConversationSidebars';
import { AiMessageAttachments } from '@/components/ai/AiAttachmentDisplays';
import { AnswerProcess, type ChatItem } from '@/components/ai/AiAnswerProcess';
import { NativeWriteProposalCard } from '@/components/ai/NativeWriteProposalCard';
import { StreamingText } from '@/components/ai/ai-text';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

function durationText(durationMs: number | null | undefined) {
  if (!Number.isFinite(durationMs)) return '暂无统计';
  const value = Number(durationMs);
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}

function AiTurnMetricsRow({ metrics }: { metrics: AiTurnMetrics }) {
  const legacySpeed = (metrics as AiTurnMetrics & { effectiveTokensPerSecond?: unknown }).effectiveTokensPerSecond;
  const speed = metrics.tokensPerSecondSource !== 'usage_over_model_time' && Number.isFinite(metrics.tokensPerSecond)
    ? Number(metrics.tokensPerSecond)
    : Number.isFinite(legacySpeed)
      ? Number(legacySpeed)
      : null;
  const speedLabel = metrics.tokensPerSecondSource === 'stream_observed'
    ? '生成速度·估算'
    : '生成速度';
  const items = [
    {
      icon: Gauge,
      label: speedLabel,
      value: speed === null
        ? '暂无统计'
        : `${speed.toFixed(1)} tok/s`,
    },
    { icon: Clock3, label: '总耗时', value: durationText(metrics.durationMs) },
    { icon: Clock3, label: '首条内容', value: durationText(metrics.firstContentMs) },
    ...(metrics.modelRequestCount > 0
      ? [{ icon: BrainCircuit, label: '模型', value: `${metrics.modelRequestCount} 轮 / ${durationText(metrics.modelDurationMs)}` }]
      : []),
    {
      icon: Hash,
      label: 'Token',
      value: metrics.usage
        ? `${metrics.usage.completionTokens} 输出 / ${metrics.usage.promptTokens} 输入`
        : '暂无统计',
    },
    ...(metrics.toolCallCount > 0
      ? [{ icon: Wrench, label: '工具调用', value: `${metrics.toolCallCount} 次 / ${durationText(metrics.toolDurationMs)}` }]
      : []),
  ];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-[11px] text-muted" aria-label="AI 运行统计">
      {items.map(({ icon: Icon, label, value }) => (
        <span key={label} className="inline-flex items-center gap-1.5" title={`${label}：${value}`}>
          <Icon size={13} aria-hidden="true" />
          <span>{label}</span>
          <span className="font-medium text-slate-700">{value}</span>
        </span>
      ))}
    </div>
  );
}

function LiveAiStatus({ label, startedAt }: { label: string; startedAt?: number }) {
  const [elapsedMs, setElapsedMs] = useState(() => startedAt ? Date.now() - startedAt : 0);

  useEffect(() => {
    if (!startedAt) return;
    const update = () => setElapsedMs(Date.now() - startedAt);
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return (
    <StatusBadge tone="custom" className="h-6 min-w-0 border-transparent bg-slate-100 px-2 text-slate-600">
      {label}{startedAt ? ` · ${(elapsedMs / 1000).toFixed(1)} s` : ''}
    </StatusBadge>
  );
}

function confirmedWriteContent(item: ChatItem) {
  const hasProtectedWrite = item.toolPlan?.steps?.some(
    (step) => step.mode === 'write' && step.requiresConfirmation,
  );
  if (!hasProtectedWrite) return null;

  const receipt = [...(item.toolResults || [])].reverse().find((tool) => {
    if (!tool.result || typeof tool.result !== 'object') return false;
    const result = tool.result as Record<string, unknown>;
    return result.success === true && result.requiresConfirmation !== true;
  });
  if (!receipt?.result || typeof receipt.result !== 'object') return null;

  const result = receipt.result as Record<string, unknown>;
  const summary = typeof result.message === 'string' && result.message.trim()
    ? result.message.trim()
    : typeof result.summary === 'string' && result.summary.trim()
      ? result.summary.trim()
      : '操作已通过正式 API 执行完成。';
  return `## 已执行\n\n${summary}`;
}

export const AiMessageList = memo(function AiMessageList({
  items,
  panel,
  loading,
  feedbackByMessageId,
  feedbackSaving,
  scrollRef,
  contentRef,
  onRunSample,
  onArchive,
  onConfirmed,
  onConfirmWriteProposal,
  onCancelWriteProposal,
  onRetry,
  onMarkHelpful,
  onReportIssue,
  onScroll,
}: {
  items: ChatItem[];
  panel: boolean;
  loading: boolean;
  feedbackByMessageId: Record<number, AiAnswerFeedback>;
  feedbackSaving: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
  onRunSample: (prompt: string) => void;
  onArchive: (attachment: AiAttachment) => void;
  onConfirmed: (messageId: string, index: number, result: AiToolResult) => void;
  onConfirmWriteProposal: (messageId: string) => void;
  onCancelWriteProposal: (messageId: string) => void;
  onRetry: (item: ChatItem) => void;
  onMarkHelpful: (item: ChatItem) => void;
  onReportIssue: (item: ChatItem) => void;
  onScroll: () => void;
}) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [touch-action:pan-y] [-webkit-overflow-scrolling:touch]"
    >
      <div ref={contentRef} className={`min-h-full ${panel ? 'space-y-4 px-3 py-4' : 'space-y-5 px-4 py-5 md:space-y-4 md:p-5'}`}>
      {items.length === 0 ? (
        <div className={`flex h-full items-center justify-center ${panel ? 'min-h-[220px]' : 'min-h-[220px] md:min-h-[360px]'}`}>
          <div className={`w-full px-2 py-7 text-center ${panel ? 'max-w-lg' : 'max-w-2xl md:rounded-panel md:border md:border-line md:bg-white md:px-7 md:shadow-panel'}`}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-ink text-white">
              <Bot size={22} />
            </div>
            <div className="mt-4 text-lg font-semibold text-ink">今天想先处理什么？</div>
            <p className="mt-1 text-sm leading-6 text-muted">直接描述任务，或从常用操作开始</p>
            <div className={`mx-auto mt-5 grid max-w-xl gap-2 ${panel ? '' : 'sm:grid-cols-2'}`}>
              {(panel ? aiStarterSamples.slice(0, 2) : aiStarterSamples).map((sample) => {
                const Icon = sample.icon;
                return (
                  <button
                    key={sample.prompt}
                    type="button"
                    onClick={() => onRunSample(sample.prompt)}
                    disabled={loading}
                    className="group flex min-h-16 items-center gap-3 rounded-md border border-line bg-slate-50 px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-white disabled:opacity-60"
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 group-hover:text-ink">
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{sample.label}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{sample.prompt}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {items.map((item) => {
        const answerFeedback = item.persistedMessageId ? feedbackByMessageId[item.persistedMessageId] : undefined;
        const displayContent = item.role === 'assistant'
          ? confirmedWriteContent(item) || item.content
          : item.content;
        const hasAnswerProcess = item.role === 'assistant' && Boolean(
          item.toolPlan || item.toolCalls?.length || item.toolResults?.length
        );
        return (
          <div key={item.id} className={`mx-auto w-full max-w-4xl ${item.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
            <div className={`text-ink ${panel ? 'max-w-[94%]' : 'max-w-[940px]'} ${item.role === 'user' ? 'rounded-2xl bg-slate-100 px-3 py-2.5 md:rounded-panel md:border md:border-ink md:bg-ink md:p-3 md:text-white md:shadow-panel' : 'w-full bg-transparent md:w-auto md:rounded-panel md:border md:border-line md:bg-white md:p-3 md:shadow-panel'}`}>
              <div className={`mb-2 flex items-center gap-2 text-xs font-medium ${item.role === 'user' ? 'text-muted md:text-slate-200' : 'text-muted'} ${item.role === 'user' ? 'hidden md:flex' : ''}`}>
                <span className={`hidden h-6 w-6 items-center justify-center rounded-md md:inline-flex ${item.role === 'user' ? 'bg-white/10' : 'bg-slate-100 text-slate-600'}`}>
                  {item.role === 'user' ? <UserRound size={14} /> : <Bot size={14} />}
                </span>
                <span>{item.role === 'user' ? '你' : 'AI'}</span>
                {item.role === 'assistant' && item.provider ? (
                  <StatusBadge tone={item.provider.provider === 'kimi' ? 'blue' : 'custom'} className="h-6 min-w-0 px-2">
                    {item.provider.displayName}{item.provider.fallback ? '（已降级）' : ''}
                  </StatusBadge>
                ) : null}
                {item.status && item.status !== 'done' ? (
                  item.role === 'assistant'
                    ? <LiveAiStatus label={item.statusMessage || item.status} startedAt={item.startedAt} />
                    : (
                      <StatusBadge tone="custom" className="h-6 min-w-0 border-transparent bg-white/10 px-2 text-slate-100">
                        {item.statusMessage || item.status}
                      </StatusBadge>
                    )
                ) : null}
              </div>
              {item.role === 'assistant' ? (
                <AnswerProcess
                  item={item}
                  onConfirmed={(index, next) => onConfirmed(item.id, index, next)}
                  onSendPrompt={onRunSample}
                  shortcutDisabled={loading}
                />
              ) : null}
              {item.role === 'assistant' && item.writeProposal ? (
                <div className="mt-3">
                  <NativeWriteProposalCard
                    card={item.writeProposal}
                    onConfirm={() => onConfirmWriteProposal(item.id)}
                    onCancel={() => onCancelWriteProposal(item.id)}
                  />
                </div>
              ) : null}
              {hasAnswerProcess && (displayContent || item.attachments?.length) ? (
                <div className="my-3 border-t border-line" aria-hidden="true" />
              ) : null}
              <AiMessageAttachments attachments={item.attachments || []} role={item.role} onArchive={onArchive} />
              {displayContent ? (
                item.role === 'assistant'
                  ? <StreamingText id={item.id} text={displayContent} streaming={loading && !['done', 'error', 'confirming', 'cancelled'].includes(item.status || 'idle')} />
                  : <div className="whitespace-pre-wrap text-sm leading-6">{displayContent}</div>
              ) : null}
              {item.role === 'assistant' && loading && item.status !== 'done' && !item.content ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={15} className="animate-spin" />
                  {item.statusMessage || '处理中...'}
                </div>
              ) : null}
              {item.role === 'assistant' && item.metrics ? <AiTurnMetricsRow metrics={item.metrics} /> : null}
              {item.role === 'assistant' && item.retryable && (item.status === 'error' || item.status === 'cancelled') ? (
                <div className="mt-3 flex items-center gap-2 border-t border-line pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8"
                    icon={<RotateCcw size={14} />}
                    onClick={() => onRetry(item)}
                    disabled={loading}
                  >
                    重新回答
                  </Button>
                  <span className="text-xs text-muted">沿用上一个问题，不会重复保存提问</span>
                </div>
              ) : null}
              {item.role === 'assistant' && item.persistedMessageId && item.status !== 'error' ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  <span className="text-xs text-muted">这条回答是否可靠？</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-8 px-2 text-xs ${answerFeedback?.rating === 'helpful' ? 'bg-emerald-50 text-emerald-700' : ''}`}
                    icon={<ThumbsUp size={14} />}
                    onClick={() => onMarkHelpful(item)}
                    disabled={feedbackSaving}
                  >
                    {answerFeedback?.rating === 'helpful' ? '已标记准确' : '准确'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-8 px-2 text-xs ${answerFeedback && answerFeedback.rating !== 'helpful' ? 'bg-amber-50 text-amber-800' : ''}`}
                    icon={<MessageSquareWarning size={14} />}
                    onClick={() => onReportIssue(item)}
                    disabled={feedbackSaving}
                  >
                    {answerFeedback && answerFeedback.rating !== 'helpful' ? '已报告问题' : '报告问题'}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
});

AiMessageList.displayName = 'AiMessageList';
