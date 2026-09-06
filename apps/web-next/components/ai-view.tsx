'use client';

import { conversationTransportId } from '@/lib/conversation-context';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  Database,
  Maximize2,
  PanelLeft,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { FadePanel } from '@/components/motion/fade-panel';
import {
  appendAiConversationMessage,
  createAiConversation,
  findAiResolutionContext,
  findAiTurnStateV3,
  getAiSystemPrompt,
  isRetryableAiStreamError,
  streamAiChat,
  updateAiConversationMessage,
  updateAiSystemPrompt,
  type AiAttachment,
  type AiConversationSummary,
  type AiToolResult,
} from '@/lib/ai';
import { syncFactoryKnowledge, type KnowledgeSyncStats } from '@/lib/knowledge';
import type { AiPageContext } from '@/lib/page-context';
import {
  AnswerFeedbackDialog,
  DeleteConversationDialog,
  KnowledgeSyncDialog,
  SystemPromptDialog,
} from '@/components/ai/AiWorkspaceDialogs';
import type { ChatItem } from '@/components/ai/AiAnswerProcess';
import {
  AiDesktopSidebar,
  AiMobileConversationDrawer,
  type AiAsideMode,
  type AiSampleCategory,
} from '@/components/ai/AiConversationSidebars';
import { useAiConversationHistory } from '@/components/ai/useAiConversationHistory';
import {
  applyAiStreamEvent,
  useAiMessageStream,
} from '@/components/ai/useAiMessageStream';
import { useAiAttachments } from '@/components/ai/useAiAttachments';
import { AiAttachmentArchiveController } from '@/components/ai/AiAttachmentArchiveController';
import { AiComposer, type AiComposerHandle } from '@/components/ai/AiComposer';
import { AiMessageList } from '@/components/ai/AiMessageList';
import { useAiAnswerFeedback } from '@/components/ai/useAiAnswerFeedback';

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_AI_STREAM_ATTEMPTS = 2;

function useStableEvent<Args extends unknown[], Result>(handler: (...args: Args) => Result) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback((...args: Args) => handlerRef.current(...args), []);
}

type AiViewProps = {
  variant?: 'workspace' | 'panel';
  onClose?: () => void;
  pageContext?: AiPageContext | null;
  initialPrompt?: string;
  initialAttachmentId?: number;
  panelControls?: ReactNode;
};

export function AiView({
  variant = 'workspace',
  onClose,
  pageContext = null,
  initialPrompt = '',
  initialAttachmentId,
  panelControls,
}: AiViewProps = {}) {
  const isPanel = variant === 'panel';
  const router = useRouter();
  const {
    items,
    setItems,
    loading,
    setLoading,
    apiMessages,
    updateAssistant,
    beginStream,
    finishStream,
    stopStream,
  } = useAiMessageStream();
  const {
    conversations,
    activeConversationId,
    restorableConversationId,
    historyQuery,
    historyLoading,
    historyError,
    openingConversationId,
    deletingConversation,
    filteredConversations,
    setHistoryQuery,
    setHistoryError,
    addConversation,
    clearActiveConversation,
    clearRestorableConversation,
    refreshConversationList,
    openConversation: loadConversation,
    removeConversation,
  } = useAiConversationHistory(loading);
  const {
    aiCapabilities,
    capabilitiesLoading,
    capabilitiesError,
    pendingAttachments,
    uploadingAttachment,
    attachmentError,
    fileInputRef,
    selectAttachments,
    discardPendingAttachment,
    clearPendingAttachments,
    restorePendingAttachments,
    markAttachmentsPersisted,
    discardAllPendingAttachments,
  } = useAiAttachments(initialAttachmentId);
  const [asideMode, setAsideMode] = useState<AiAsideMode>('history');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeSampleCategory, setActiveSampleCategory] = useState<AiSampleCategory>('常用');
  const [deleteTarget, setDeleteTarget] = useState<AiConversationSummary | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [knowledgeSyncOpen, setKnowledgeSyncOpen] = useState(false);
  const [knowledgeSyncing, setKnowledgeSyncing] = useState(false);
  const [knowledgeSyncResult, setKnowledgeSyncResult] = useState<KnowledgeSyncStats | null>(null);
  const [knowledgeSyncError, setKnowledgeSyncError] = useState('');
  const [archiveAttachment, setArchiveAttachment] = useState<AiAttachment | null>(null);
  const [draftTransition, setDraftTransition] = useState<{ type: 'new' } | { type: 'open'; conversationId: number } | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const composerRef = useRef<AiComposerHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const initialPromptAppliedRef = useRef(false);
  const restoredConversationRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const restoreComposerFocusAfterSendRef = useRef(false);
  const autoFollowRef = useRef(true);
  const restoreConversationActionsRef = useRef({
    openConversation,
    clearRestorableConversation,
  });
  restoreConversationActionsRef.current = {
    openConversation,
    clearRestorableConversation,
  };
  const aiRoutingStatusText = capabilitiesLoading
    ? '正在读取路由配置'
    : capabilitiesError
      ? '模型配置异常'
      : aiCapabilities?.provider === 'auto'
        ? '智能路由 · 默认 DeepSeek'
        : `固定使用 ${aiCapabilities?.displayName || 'AI 模型'}`;
  const aiRoutingStatusDetail = aiCapabilities?.provider === 'auto'
    ? '普通对话使用 DeepSeek，图片和文件附件使用 Kimi'
    : aiCapabilities?.displayName
      ? `所有对话固定使用 ${aiCapabilities.displayName}`
      : aiRoutingStatusText;
  const {
    feedbackByMessageId,
    feedbackTarget,
    feedbackRating,
    feedbackNote,
    feedbackLearn,
    feedbackSaving,
    feedbackError,
    setFeedbackByMessageId,
    setFeedbackNote,
    setFeedbackLearn,
    markAnswerHelpful,
    openAnswerIssue,
    saveAnswerIssue,
    changeFeedbackRating,
    resetFeedback,
    closeFeedbackDialog,
  } = useAiAnswerFeedback(setHistoryError);

  const scheduleScrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (!autoFollowRef.current) return;
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (!autoFollowRef.current) return;
      const scroller = scrollRef.current;
      if (!scroller) return;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    });
  }, []);

  useEffect(() => {
    scheduleScrollToLatest(loading ? 'auto' : 'smooth');
  }, [items, loading, scheduleScrollToLatest]);

  useEffect(() => {
    const content = scrollContentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => scheduleScrollToLatest('auto'));
    observer.observe(content);
    return () => observer.disconnect();
  }, [scheduleScrollToLatest]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (loading || !restoreComposerFocusAfterSendRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const composer = composerRef.current;
      const composerElement = composer?.element();
      const activeElement = document.activeElement;
      const userMovedFocus = Boolean(
        activeElement
        && activeElement !== document.body
        && activeElement !== composerElement
      );
      const hasFinePointer = window.matchMedia?.('(pointer: fine)').matches ?? true;
      if (composer && !userMovedFocus && hasFinePointer) {
        composer.focus();
      }
      restoreComposerFocusAfterSendRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading]);

  useEffect(() => {
    const prompt = initialPrompt.trim();
    if (!prompt || initialPromptAppliedRef.current) return;
    initialPromptAppliedRef.current = true;
    composerRef.current?.replace(prompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (historyLoading || restoredConversationRef.current) return;
    restoredConversationRef.current = true;
    if (!restorableConversationId) return;
    if (!conversations.some((conversation) => conversation.id === restorableConversationId)) {
      restoreConversationActionsRef.current.clearRestorableConversation();
      return;
    }
    void restoreConversationActionsRef.current.openConversation(restorableConversationId);
  }, [conversations, historyLoading, restorableConversationId]);

  async function sendMessage(text: string, options?: {
    retryAssistantId?: string;
    attachments?: AiAttachment[];
    onDraftPersisted?: (persisted: boolean) => void;
  }) {
    const retryAssistantId = options?.retryAssistantId;
    const retrying = Boolean(retryAssistantId && activeConversationId);
    const attachments = retrying ? (options?.attachments || []) : pendingAttachments;
    const content = text.trim() || (attachments.length > 0 ? '请查看我上传的附件。' : '');
    if (!content || loading || uploadingAttachment || sendInFlightRef.current) return;
    restoreComposerFocusAfterSendRef.current = composerRef.current?.isFocused() || false;
    sendInFlightRef.current = true;

    const userItem: ChatItem = { id: makeId(), role: 'user', content, attachments };
    const assistantId = makeId();
    const assistantItem: ChatItem = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'thinking',
      statusMessage: '正在理解问题...',
      toolCalls: [],
      toolResults: [],
    };

    const nextMessages = retrying ? apiMessages : [...apiMessages, {
      role: 'user' as const,
      content,
      ...(attachments.length > 0 ? { attachments } : {}),
    }];
    const latestAssistant = [...items].reverse().find((item) => item.role === 'assistant');
    const resolutionContext = retrying
      ? null
      : findAiResolutionContext(latestAssistant?.toolResults);
    const turnState = retrying
      ? null
      : latestAssistant?.turnState || findAiTurnStateV3(latestAssistant?.toolResults);
    const streamAssistantId = retrying ? retryAssistantId! : assistantId;
    setItems((current) => retrying
      ? current.map((item) => (item.id === streamAssistantId ? { ...assistantItem, id: streamAssistantId } : item))
      : [...current, userItem, assistantItem]);
    if (!retrying) {
      clearPendingAttachments();
    }
    autoFollowRef.current = true;
    setShowJumpToLatest(false);
    setLoading(true);

    let conversationId = activeConversationId;
    let finalAssistantItem = assistantItem;
    let streamCompleted = false;

    try {
      if (!conversationId) {
        const conversation = await createAiConversation(content);
        conversationId = conversation.id;
        addConversation(conversation);
      }
      if (!retrying) {
        await appendAiConversationMessage(conversationId, {
          role: 'user',
          content,
          metadata: attachments.length > 0 ? { attachments } : undefined,
        });
        markAttachmentsPersisted(attachments);
      }
      options?.onDraftPersisted?.(true);
      setHistoryError('');
    } catch (error) {
      const message = (error as Error).message || '保存会话失败';
      updateAssistant(streamAssistantId, (item) => ({ ...item, status: 'error', statusMessage: message, content: message, retryable: false }));
      setHistoryError(message);
      restorePendingAttachments(attachments);
      options?.onDraftPersisted?.(false);
      setLoading(false);
      sendInFlightRef.current = false;
      return;
    }

    try {
      const controller = beginStream();
      for (let attempt = 1; attempt <= MAX_AI_STREAM_ATTEMPTS; attempt += 1) {
        try {
          await streamAiChat(nextMessages, (event) => {
            finalAssistantItem = applyAiStreamEvent(finalAssistantItem, event);
            updateAssistant(streamAssistantId, (item) => applyAiStreamEvent(item, event));
          }, controller.signal, pageContext, resolutionContext, turnState, conversationTransportId(conversationId!));
          streamCompleted = true;
          break;
        } catch (error) {
          const canRetry = (
            attempt < MAX_AI_STREAM_ATTEMPTS
            && !controller.signal.aborted
            && isRetryableAiStreamError(error)
          );
          if (!canRetry) throw error;

          finalAssistantItem = {
            ...assistantItem,
            status: 'thinking',
            statusMessage: '连接中断，正在自动重试...',
          };
          updateAssistant(streamAssistantId, () => ({ ...finalAssistantItem, id: streamAssistantId }));
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        finalAssistantItem = {
          ...assistantItem,
          status: 'cancelled',
          statusMessage: '已停止',
          retryable: true,
        };
        updateAssistant(streamAssistantId, () => ({ ...finalAssistantItem, id: streamAssistantId }));
      } else {
        const message = isRetryableAiStreamError(err)
          ? '连接中断，未取得完整结果。请再试一次。'
          : ((err as Error).message || 'AI 请求失败');
        finalAssistantItem = {
          ...assistantItem,
          status: 'error',
          statusMessage: message,
          content: message,
          retryable: true,
        };
        updateAssistant(streamAssistantId, () => ({ ...finalAssistantItem, id: streamAssistantId }));
      }
    } finally {
      if (
        conversationId
        && streamCompleted
        && finalAssistantItem.status === 'done'
        && finalAssistantItem.content.trim()
      ) {
        try {
          const saved = await appendAiConversationMessage(conversationId, {
            role: 'assistant',
            content: finalAssistantItem.content,
            metadata: {
              toolPlan: finalAssistantItem.toolPlan,
              toolCalls: finalAssistantItem.toolCalls,
              toolResults: finalAssistantItem.toolResults,
              provider: finalAssistantItem.provider,
              turnState: finalAssistantItem.turnState,
            },
          });
          updateAssistant(streamAssistantId, (item) => ({ ...item, persistedMessageId: saved.id, retryable: false }));
          await refreshConversationList();
        } catch (error) {
          setHistoryError((error as Error).message || '保存 AI 回复失败');
        }
      }
      finishStream();
      sendInFlightRef.current = false;
    }
  }

  function replaceToolResult(messageId: string, oldIndex: number, next: AiToolResult) {
    const currentItem = items.find((item) => item.id === messageId);
    const toolResults = (currentItem?.toolResults || []).map((tool, index) => (index === oldIndex ? next : tool));
    updateAssistant(messageId, (item) => ({ ...item, toolResults }));
    if (activeConversationId && currentItem?.persistedMessageId) {
      void updateAiConversationMessage(activeConversationId, currentItem.persistedMessageId, {
        toolPlan: currentItem.toolPlan,
        toolCalls: currentItem.toolCalls,
        toolResults,
      }).catch((error) => setHistoryError((error as Error).message || '更新会话记录失败'));
    }
  }

  function hasPendingDraft() {
    return Boolean(composerRef.current?.hasDraft() || pendingAttachments.length > 0);
  }

  function performStartNewConversation() {
    if (loading) return;
    discardAllPendingAttachments();
    clearActiveConversation();
    setItems([]);
    resetFeedback();
    composerRef.current?.clear();
    setAsideMode('history');
    setMobileSidebarOpen(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function startNewConversation() {
    if (hasPendingDraft()) {
      setDraftTransition({ type: 'new' });
      return;
    }
    performStartNewConversation();
  }

  async function performOpenConversation(id: number) {
    const opened = await loadConversation(id);
    if (!opened) return;
    discardAllPendingAttachments();
    composerRef.current?.clear();
    setFeedbackByMessageId(opened.feedbackByMessageId);
    setItems(opened.items);
    autoFollowRef.current = true;
    setShowJumpToLatest(false);
    setMobileSidebarOpen(false);
  }

  function openConversation(id: number) {
    if (id === activeConversationId) {
      setMobileSidebarOpen(false);
      return;
    }
    if (hasPendingDraft()) {
      setDraftTransition({ type: 'open', conversationId: id });
      return;
    }
    void performOpenConversation(id);
  }

  function confirmDraftTransition() {
    if (!draftTransition) return;
    const transition = draftTransition;
    setDraftTransition(null);
    if (transition.type === 'new') {
      performStartNewConversation();
      return;
    }
    void performOpenConversation(transition.conversationId);
  }

  function retryAssistant(item: ChatItem) {
    const assistantIndex = items.findIndex((candidate) => candidate.id === item.id);
    const userItem = items.slice(0, assistantIndex).reverse().find((candidate) => candidate.role === 'user');
    if (!userItem) return;
    void sendMessage(userItem.content, {
      retryAssistantId: item.id,
      attachments: userItem.attachments || [],
    });
  }

  function handleMessageScroll() {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
    autoFollowRef.current = nearBottom;
    if (!nearBottom && scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    setShowJumpToLatest(!nearBottom);
  }

  function scrollToLatest() {
    autoFollowRef.current = true;
    setShowJumpToLatest(false);
    scheduleScrollToLatest('smooth');
  }

  function applyTaskTemplate(prompt: string) {
    composerRef.current?.append(prompt);
    setMobileSidebarOpen(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function confirmDeleteConversation() {
    if (!deleteTarget) return;
    const removedActiveConversation = await removeConversation(deleteTarget.id);
    if (removedActiveConversation === null) return;
    if (removedActiveConversation) performStartNewConversation();
    setDeleteTarget(null);
  }

  async function openPromptEditor() {
    setPromptOpen(true);
    setPromptLoading(true);
    setPromptError('');
    try {
      setPromptDraft(await getAiSystemPrompt());
    } catch (error) {
      setPromptError((error as Error).message || '读取工厂配置失败');
    } finally {
      setPromptLoading(false);
    }
  }

  async function savePrompt() {
    const prompt = promptDraft.trim();
    if (!prompt) {
      setPromptError('工厂配置不能为空');
      return;
    }
    setPromptSaving(true);
    setPromptError('');
    try {
      await updateAiSystemPrompt(prompt);
      setPromptDraft(prompt);
      setPromptOpen(false);
    } catch (error) {
      setPromptError((error as Error).message || '保存工厂配置失败');
    } finally {
      setPromptSaving(false);
    }
  }

  function openKnowledgeSync() {
    setKnowledgeSyncResult(null);
    setKnowledgeSyncError('');
    setKnowledgeSyncOpen(true);
  }

  async function runKnowledgeSync() {
    setKnowledgeSyncing(true);
    setKnowledgeSyncError('');
    try {
      setKnowledgeSyncResult(await syncFactoryKnowledge());
    } catch (error) {
      setKnowledgeSyncError((error as Error).message || '知识库同步失败');
    } finally {
      setKnowledgeSyncing(false);
    }
  }

  const runMessageSample = useStableEvent((prompt: string) => void sendMessage(prompt));
  const confirmMessageTool = useStableEvent((messageId: string, index: number, result: AiToolResult) => {
    replaceToolResult(messageId, index, result);
  });
  const retryMessage = useStableEvent((item: ChatItem) => retryAssistant(item));
  const markMessageHelpful = useStableEvent((item: ChatItem) => void markAnswerHelpful(item));
  const reportMessageIssue = useStableEvent((item: ChatItem) => openAnswerIssue(item));
  const scrollMessages = useStableEvent(() => handleMessageScroll());
  const sendComposerDraft = useStableEvent((text: string) => new Promise<boolean>((resolve) => {
    const content = text.trim() || (pendingAttachments.length > 0 ? '请查看我上传的附件。' : '');
    if (!content || loading || uploadingAttachment || sendInFlightRef.current) {
      resolve(false);
      return;
    }
    void sendMessage(text, { onDraftPersisted: resolve }).catch(() => resolve(false));
  }));

  return (
    <div className={`min-h-0 bg-white ${isPanel ? 'h-full' : 'lg:bg-transparent'}`}>
      <FadePanel className={`flex min-h-0 flex-col overflow-hidden border-0 bg-white shadow-none ${isPanel ? 'h-full xl:rounded-panel xl:border xl:border-line xl:shadow-panel' : 'h-[100dvh] md:h-[calc(100vh-8rem)] md:min-h-[620px] md:rounded-panel md:border md:border-line md:shadow-panel'}`}>
        <div className={`ai-mobile-header h-auto shrink-0 items-center justify-between border-b border-line bg-white px-3 pb-2 ${isPanel ? 'flex xl:pt-2' : 'flex lg:hidden'}`}>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 px-0"
            icon={<PanelLeft size={19} />}
            aria-label="打开会话记录"
            title="会话记录"
            onClick={() => setMobileSidebarOpen(true)}
          />
          <div className="min-w-0 flex-1 px-2 text-center">
            <div className="truncate text-sm font-semibold text-ink">
              {conversations.find((conversation) => conversation.id === activeConversationId)?.title || (isPanel ? '业务 AI 助手' : 'AI 工作台')}
            </div>
            <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[11px] text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${capabilitiesLoading ? 'animate-pulse bg-slate-400' : capabilitiesError ? 'bg-rose-500' : 'bg-emerald-500'}`} />
              <span title={aiRoutingStatusDetail}>{aiRoutingStatusText}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isPanel ? panelControls : null}
            {isPanel ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0"
                icon={<Database size={17} />}
                aria-label="同步知识库"
                title="同步知识库"
                onClick={openKnowledgeSync}
                disabled={knowledgeSyncing}
              />
            ) : null}
            {isPanel ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0"
                icon={<Maximize2 size={17} />}
                aria-label="进入 AI 工作台"
                title="进入 AI 工作台"
                onClick={() => router.push('/ai')}
              />
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              icon={<Plus size={19} />}
              aria-label="新建会话"
              title="新建会话"
              onClick={startNewConversation}
              disabled={loading}
            />
            {isPanel && onClose && !panelControls ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0"
                icon={<X size={18} />}
                aria-label="关闭 AI 助手"
                title="关闭"
                onClick={onClose}
              />
            ) : null}
          </div>
        </div>

        <div className={`${isPanel ? 'hidden' : 'hidden lg:flex'} shrink-0 flex-wrap items-center justify-between gap-4 border-b border-line bg-slate-50 px-5 py-4`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-ink text-white">
              <Sparkles size={20} />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-normal text-ink">AI 工作台</h1>
              <p className="mt-1 text-sm text-muted">查询成本、订单、库存与工厂知识</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="mr-2 inline-flex items-center gap-1.5 text-xs text-muted" aria-label="AI 模型状态">
              <span className={`h-1.5 w-1.5 rounded-full ${capabilitiesLoading ? 'animate-pulse bg-slate-400' : capabilitiesError ? 'bg-rose-500' : 'bg-emerald-500'}`} />
              <span title={aiRoutingStatusDetail}>{aiRoutingStatusText}</span>
            </div>
            <Button variant="secondary" size="sm" icon={<Plus size={15} />} onClick={startNewConversation} disabled={loading}>
              新会话
            </Button>
          </div>
        </div>

        <div className={`grid min-h-0 min-w-0 flex-1 ${isPanel ? '' : 'lg:grid-cols-[310px_minmax(0,1fr)]'}`}>
          <AiDesktopSidebar
            hidden={isPanel}
            asideMode={asideMode}
            activeSampleCategory={activeSampleCategory}
            conversations={conversations}
            filteredConversations={filteredConversations}
            activeConversationId={activeConversationId}
            openingConversationId={openingConversationId}
            historyQuery={historyQuery}
            historyLoading={historyLoading}
            historyError={historyError}
            loading={loading}
            promptBusy={promptLoading || promptSaving}
            onAsideModeChange={setAsideMode}
            onSampleCategoryChange={setActiveSampleCategory}
            onHistoryQueryChange={setHistoryQuery}
            onOpenConversation={(id) => void openConversation(id)}
            onDeleteConversation={setDeleteTarget}
            onRunSample={applyTaskTemplate}
            onEditPrompt={() => void openPromptEditor()}
          />

          <section className="relative flex min-h-0 min-w-0 flex-col bg-white md:bg-slate-50">
            <AiMessageList
              items={items}
              panel={isPanel}
              loading={loading}
              feedbackByMessageId={feedbackByMessageId}
              feedbackSaving={feedbackSaving}
              scrollRef={scrollRef}
              contentRef={scrollContentRef}
              onRunSample={runMessageSample}
              onArchive={setArchiveAttachment}
              onConfirmed={confirmMessageTool}
              onRetry={retryMessage}
              onMarkHelpful={markMessageHelpful}
              onReportIssue={reportMessageIssue}
              onScroll={scrollMessages}
            />

            {showJumpToLatest ? (
              <Button
                variant="secondary"
                size="sm"
                className="absolute bottom-24 right-4 z-20 rounded-full shadow-lg md:bottom-28"
                icon={<ArrowDown size={15} />}
                onClick={scrollToLatest}
              >
                回到最新
              </Button>
            ) : null}

            <AiComposer
              ref={composerRef}
              panel={isPanel}
              pageContext={pageContext}
              loading={loading}
              pendingAttachments={pendingAttachments}
              uploadingAttachment={uploadingAttachment}
              attachmentError={attachmentError}
              aiCapabilities={aiCapabilities}
              fileInputRef={fileInputRef}
              onSelectAttachments={(files) => void selectAttachments(files)}
              onRemoveAttachment={discardPendingAttachment}
              onStop={stopStream}
              onSend={sendComposerDraft}
            />
          </section>
        </div>
      </FadePanel>

      <AiMobileConversationDrawer
        open={mobileSidebarOpen}
        asideMode={asideMode}
        activeSampleCategory={activeSampleCategory}
        conversations={conversations}
        filteredConversations={filteredConversations}
        activeConversationId={activeConversationId}
        openingConversationId={openingConversationId}
        historyQuery={historyQuery}
        historyLoading={historyLoading}
        historyError={historyError}
        loading={loading}
        promptBusy={promptLoading || promptSaving}
        onClose={() => setMobileSidebarOpen(false)}
        onNewConversation={startNewConversation}
        onHistoryQueryChange={setHistoryQuery}
        onOpenConversation={(id) => void openConversation(id)}
        onDeleteConversation={(conversation) => {
          setMobileSidebarOpen(false);
          setDeleteTarget(conversation);
        }}
        onEditPrompt={() => {
          setMobileSidebarOpen(false);
          void openPromptEditor();
        }}
        onAsideModeChange={setAsideMode}
        onSampleCategoryChange={setActiveSampleCategory}
        onRunSample={applyTaskTemplate}
      />

      <AiAttachmentArchiveController
        attachment={archiveAttachment}
        onClose={() => setArchiveAttachment(null)}
      />

      {feedbackTarget ? (
        <AnswerFeedbackDialog
          rating={feedbackRating}
          note={feedbackNote}
          learnFromCorrection={feedbackLearn}
          saving={feedbackSaving}
          error={feedbackError}
          onRatingChange={changeFeedbackRating}
          onNoteChange={setFeedbackNote}
          onLearnFromCorrectionChange={setFeedbackLearn}
          onSave={saveAnswerIssue}
          onClose={closeFeedbackDialog}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteConversationDialog
          title={deleteTarget.title}
          deleting={deletingConversation}
          onConfirm={confirmDeleteConversation}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}

      {draftTransition ? (
        <ConfirmDialog
          open
          layer="assistant"
          title="当前还有未发送内容"
          description="切换会话会清除当前输入和待发送附件。要继续吗？"
          confirmLabel={draftTransition.type === 'new' ? '丢弃并新建' : '丢弃并切换'}
          confirmVariant="danger"
          onConfirm={confirmDraftTransition}
          onClose={() => setDraftTransition(null)}
        />
      ) : null}

      {knowledgeSyncOpen ? (
        <KnowledgeSyncDialog
          result={knowledgeSyncResult}
          syncing={knowledgeSyncing}
          error={knowledgeSyncError}
          onSync={runKnowledgeSync}
          onClose={() => setKnowledgeSyncOpen(false)}
        />
      ) : null}

      {promptOpen ? (
        <SystemPromptDialog
          draft={promptDraft}
          loading={promptLoading}
          saving={promptSaving}
          error={promptError}
          onDraftChange={setPromptDraft}
          onSave={savePrompt}
          onClose={() => setPromptOpen(false)}
        />
      ) : null}
    </div>
  );
}
