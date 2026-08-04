'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Database,
  Maximize2,
  PanelLeft,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FadePanel } from '@/components/motion/fade-panel';
import {
  appendAiConversationMessage,
  createAiConversation,
  getAiSystemPrompt,
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
import { AiComposer } from '@/components/ai/AiComposer';
import { AiMessageList } from '@/components/ai/AiMessageList';
import { useAiAnswerFeedback } from '@/components/ai/useAiAnswerFeedback';
import { useAiSpeechInput } from '@/components/ai/useAiSpeechInput';

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type AiViewProps = {
  variant?: 'workspace' | 'panel';
  onClose?: () => void;
  pageContext?: AiPageContext | null;
  initialPrompt?: string;
  initialAttachmentId?: number;
};

export function AiView({
  variant = 'workspace',
  onClose,
  pageContext = null,
  initialPrompt = '',
  initialAttachmentId,
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
    refreshConversationList,
    openConversation: loadConversation,
    removeConversation,
  } = useAiConversationHistory(loading);
  const {
    aiCapabilities,
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
  const [input, setInput] = useState('');
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initialPromptAppliedRef = useRef(false);
  const {
    speechSupported,
    isListening,
    speechError,
    stopVoiceInput,
    toggleVoiceInput,
  } = useAiSpeechInput(input, setInput);
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items]);

  useEffect(() => {
    const prompt = initialPrompt.trim();
    if (!prompt || initialPromptAppliedRef.current) return;
    initialPromptAppliedRef.current = true;
    setInput(prompt);
  }, [initialPrompt]);

  async function sendMessage(text: string) {
    const attachments = pendingAttachments;
    const content = text.trim() || (attachments.length > 0 ? '请查看我上传的附件。' : '');
    if (!content || loading || uploadingAttachment) return;
    if (isListening) stopVoiceInput();

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

    const nextMessages = [...apiMessages, {
      role: 'user' as const,
      content,
      ...(attachments.length > 0 ? { attachments } : {}),
    }];
    setItems((current) => [...current, userItem, assistantItem]);
    setInput('');
    clearPendingAttachments();
    setLoading(true);

    let conversationId = activeConversationId;
    let finalAssistantItem = assistantItem;

    try {
      if (!conversationId) {
        const conversation = await createAiConversation(content);
        conversationId = conversation.id;
        addConversation(conversation);
      }
      await appendAiConversationMessage(conversationId, {
        role: 'user',
        content,
        metadata: attachments.length > 0 ? { attachments } : undefined,
      });
      markAttachmentsPersisted(attachments);
      setHistoryError('');
    } catch (error) {
      const message = (error as Error).message || '保存会话失败';
      updateAssistant(assistantId, (item) => ({ ...item, status: 'error', statusMessage: message, content: message }));
      setHistoryError(message);
      restorePendingAttachments(attachments);
      setLoading(false);
      return;
    }

    try {
      const controller = beginStream();
      await streamAiChat(nextMessages, (event) => {
        finalAssistantItem = applyAiStreamEvent(finalAssistantItem, event);
        updateAssistant(assistantId, (item) => applyAiStreamEvent(item, event));
      }, controller.signal, pageContext);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        finalAssistantItem = {
          ...finalAssistantItem,
          status: 'error',
          statusMessage: (err as Error).message || 'AI 请求失败',
          content: finalAssistantItem.content || 'AI 请求失败',
        };
        updateAssistant(assistantId, (item) => ({
          ...item,
          status: 'error',
          statusMessage: (err as Error).message || 'AI 请求失败',
          content: item.content || 'AI 请求失败',
        }));
      }
    } finally {
      if (conversationId && finalAssistantItem.content.trim()) {
        try {
          const saved = await appendAiConversationMessage(conversationId, {
            role: 'assistant',
            content: finalAssistantItem.content,
            metadata: {
              toolPlan: finalAssistantItem.toolPlan,
              toolCalls: finalAssistantItem.toolCalls,
              toolResults: finalAssistantItem.toolResults,
              provider: finalAssistantItem.provider,
            },
          });
          updateAssistant(assistantId, (item) => ({ ...item, persistedMessageId: saved.id }));
          await refreshConversationList();
        } catch (error) {
          setHistoryError((error as Error).message || '保存 AI 回复失败');
        }
      }
      finishStream();
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

  function startNewConversation() {
    if (loading) return;
    if (isListening) stopVoiceInput();
    discardAllPendingAttachments();
    clearActiveConversation();
    setItems([]);
    resetFeedback();
    setInput('');
    setAsideMode('history');
    setMobileSidebarOpen(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function openConversation(id: number) {
    const opened = await loadConversation(id);
    if (!opened) return;
    setFeedbackByMessageId(opened.feedbackByMessageId);
    setItems(opened.items);
    setMobileSidebarOpen(false);
  }

  async function confirmDeleteConversation() {
    if (!deleteTarget) return;
    const removedActiveConversation = await removeConversation(deleteTarget.id);
    if (removedActiveConversation === null) return;
    if (removedActiveConversation) startNewConversation();
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
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {aiCapabilities?.displayName || 'DeepSeek'}
            </div>
          </div>
          <div className="flex items-center gap-1">
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
            {isPanel && onClose ? (
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
            onRunSample={(prompt) => void sendMessage(prompt)}
            onEditPrompt={() => void openPromptEditor()}
          />

          <section className="flex min-h-0 min-w-0 flex-col bg-white md:bg-slate-50">
            <AiMessageList
              items={items}
              panel={isPanel}
              loading={loading}
              feedbackByMessageId={feedbackByMessageId}
              feedbackSaving={feedbackSaving}
              scrollRef={scrollRef}
              onRunSample={(prompt) => void sendMessage(prompt)}
              onArchive={setArchiveAttachment}
              onConfirmed={replaceToolResult}
              onMarkHelpful={(item) => void markAnswerHelpful(item)}
              onReportIssue={openAnswerIssue}
            />

            <AiComposer
              panel={isPanel}
              pageContext={pageContext}
              input={input}
              loading={loading}
              pendingAttachments={pendingAttachments}
              uploadingAttachment={uploadingAttachment}
              attachmentError={attachmentError}
              aiCapabilities={aiCapabilities}
              speechSupported={speechSupported}
              isListening={isListening}
              speechError={speechError}
              fileInputRef={fileInputRef}
              composerRef={composerRef}
              onInputChange={setInput}
              onSelectAttachments={(files) => void selectAttachments(files)}
              onRemoveAttachment={discardPendingAttachment}
              onStopVoice={stopVoiceInput}
              onToggleVoice={toggleVoiceInput}
              onStop={stopStream}
              onSend={(text) => void sendMessage(text)}
            />
          </section>
        </div>
      </FadePanel>

      <AiMobileConversationDrawer
        open={mobileSidebarOpen}
        panel={isPanel}
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
