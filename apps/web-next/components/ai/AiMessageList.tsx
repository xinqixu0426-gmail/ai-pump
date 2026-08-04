'use client';

import type { RefObject } from 'react';
import { Bot, Loader2, MessageSquareWarning, ThumbsUp, UserRound } from 'lucide-react';
import type { AiAnswerFeedback, AiAttachment, AiToolResult } from '@/lib/ai';
import { aiStarterSamples } from '@/components/ai/AiConversationSidebars';
import { AiMessageAttachments } from '@/components/ai/AiAttachmentDisplays';
import { AnswerProcess, type ChatItem } from '@/components/ai/AiAnswerProcess';
import { StreamingText } from '@/components/prompt-kit/basic-chat';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

export function AiMessageList({
  items,
  panel,
  loading,
  feedbackByMessageId,
  feedbackSaving,
  scrollRef,
  onRunSample,
  onArchive,
  onConfirmed,
  onMarkHelpful,
  onReportIssue,
}: {
  items: ChatItem[];
  panel: boolean;
  loading: boolean;
  feedbackByMessageId: Record<number, AiAnswerFeedback>;
  feedbackSaving: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  onRunSample: (prompt: string) => void;
  onArchive: (attachment: AiAttachment) => void;
  onConfirmed: (messageId: string, index: number, result: AiToolResult) => void;
  onMarkHelpful: (item: ChatItem) => void;
  onReportIssue: (item: ChatItem) => void;
}) {
  return (
    <div ref={scrollRef} className={`flex-1 overflow-y-auto ${panel ? 'space-y-4 px-3 py-4' : 'space-y-5 px-4 py-5 md:space-y-4 md:p-5'}`}>
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
                  <StatusBadge tone="custom" className={`h-6 min-w-0 border-transparent px-2 ${item.role === 'user' ? 'bg-white/10 text-slate-100' : 'bg-slate-100 text-slate-600'}`}>
                    {item.statusMessage || item.status}
                  </StatusBadge>
                ) : null}
              </div>
              <AiMessageAttachments attachments={item.attachments || []} role={item.role} onArchive={onArchive} />
              {item.content ? (
                item.role === 'assistant'
                  ? <StreamingText id={item.id} text={item.content} streaming={loading && !['done', 'error', 'confirming', 'cancelled'].includes(item.status || 'idle')} />
                  : <div className="whitespace-pre-wrap text-sm leading-6">{item.content}</div>
              ) : null}
              {item.role === 'assistant' && loading && item.status !== 'done' && !item.content ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={15} className="animate-spin" />
                  {item.statusMessage || '处理中...'}
                </div>
              ) : null}
              {item.role === 'assistant' ? (
                <AnswerProcess
                  item={item}
                  onConfirmed={(index, next) => onConfirmed(item.id, index, next)}
                  onSendPrompt={onRunSample}
                  shortcutDisabled={loading}
                />
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
  );
}
